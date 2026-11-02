import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiConfigured, logAssistantCall, translateRule } from "./ai";
import type { Access } from "./auth";
import type { Constraint, RuleContext } from "./constraints";
import { db, newId, now } from "./db";
import { checkRota, SolverDown, solveWhatIf } from "./solver";
import { storeStaff } from "./org";
import { storeRoles } from "./team";
import { dayDate, prettyDate, shiftsForStore, weekLabel } from "./time";
import { DAY_NAME, DAYS, type Day, type Employee, type Rota } from "./types";

/**
 * Rota assistant. The same six tools back both modes:
 *  - with Anthropic credentials, Claude decides which tools to call;
 *  - without, an offline intent parser handles the common questions (dev/demo).
 * Nothing changes the rota directly. Rules it creates are "pending" until the manager confirms.
 */

const MODEL = process.env.CLAUDE_ASSISTANT_MODEL ?? "claude-opus-5-5";
const PRICE_IN = Number(process.env.CLAUDE_ASSISTANT_PRICE_IN_PER_MTOK ?? 4);
const PRICE_OUT = Number(process.env.CLAUDE_ASSISTANT_PRICE_OUT_PER_MTOK ?? 20);

export interface ChatTurn { role: "user" | "assistant"; text: string }
export type AssistantAction =
  | { kind: "rule"; ruleId: string; summary: string; scope: "permanent" | "week"; weekStart: string | null }
  | { kind: "suggestRule"; text: string; scope: "permanent" | "week"; label: string };
export interface AssistantReply { reply: string; actions: AssistantAction[]; usedAi: boolean }

interface Ctx {
  access: Access;
  week: string;
  employees: Employee[];
  rota: Rota | null;
  ruleCtx: RuleContext;
}

const first = (e: Pick<Employee, "name">) => e.name.split(" ")[0];
const DAY_WORDS: Record<string, Day[]> = {
  weekend: ["sat", "sun"], weekends: ["sat", "sun"],
  monday: ["mon"], tuesday: ["tue"], wednesday: ["wed"], thursday: ["thu"], friday: ["fri"], saturday: ["sat"], sunday: ["sun"],
  mon: ["mon"], tue: ["tue"], tues: ["tue"], wed: ["wed"], thu: ["thu"], thur: ["thu"], thurs: ["thu"], fri: ["fri"], sat: ["sat"], sun: ["sun"],
};
function parseDays(text: string): Day[] {
  const out = new Set<Day>();
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) for (const d of DAY_WORDS[w] ?? []) out.add(d);
  return DAYS.filter((d) => out.has(d));
}

// ------------------------------------------------------------------ tools (shared)

function findStaff(ctx: Ctx, name: string) {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  return ctx.employees.filter((e) => e.name.toLowerCase() === n || e.name.toLowerCase().split(" ").includes(n) || e.name.toLowerCase().startsWith(n));
}

async function weekOverview(ctx: Ctx) {
  const shifts = Object.fromEntries(shiftsForStore(ctx.access.store).map((s) => [s.id, s]));
  const mins: Record<string, number> = {};
  for (const a of ctx.rota?.assignments ?? []) mins[a.employeeId] = (mins[a.employeeId] ?? 0) + (shifts[a.shiftId]?.minutes ?? 0);
  let problems: string[] = [];
  if (ctx.rota) {
    try {
      problems = (await checkRota(ctx.access.store, ctx.week, ctx.rota.assignments, ctx.rota.exceptions ?? [])).issues.filter((i) => i.severity !== "info").map((i) => i.message);
    } catch (e) {
      problems = [e instanceof SolverDown ? "Rule check unavailable: the solver isn't running." : "Rule check unavailable."];
    }
  }
  return {
    week: weekLabel(ctx.week),
    rota: ctx.rota ? `${ctx.rota.status === "approved" ? "published" : "draft"} (v${ctx.rota.version})` : "not built yet",
    people: ctx.employees.map((e) => ({ id: e.id, name: e.name, roles: e.role, scheduledHours: +((mins[e.id] ?? 0) / 60).toFixed(1), contractHours: e.contractedHours, maxHours: e.maxHoursPerWeek })),
    problems,
  };
}

function whoIsWorking(ctx: Ctx, day?: Day) {
  if (!ctx.rota) return { error: "There's no rota for this week yet." };
  const shifts = shiftsForStore(ctx.access.store).filter((s) => !day || s.day === day);
  return shifts.map((s) => ({
    shift: `${DAY_NAME[s.day]} ${prettyDate(dayDate(ctx.week, s.day))} ${s.name} ${s.start}–${s.end}`,
    people: ctx.rota!.assignments.filter((a) => a.shiftId === s.id).map((a) => ctx.employees.find((e) => e.id === a.employeeId)?.name ?? "former staff"),
  }));
}

/** Re-solve the week with this person off on those days. Nothing is saved. */
async function checkTimeOff(ctx: Ctx, employeeId: string, days: Day[]) {
  const e = ctx.employees.find((x) => x.id === employeeId);
  if (!e) return { error: "Unknown person." };
  if (!days.length) return { error: "Which days?" };
  const shifts = Object.fromEntries(shiftsForStore(ctx.access.store).map((s) => [s.id, s]));
  const current = (ctx.rota?.assignments ?? []).filter((a) => a.employeeId === e.id && days.includes(shifts[a.shiftId]?.day));
  const extra = days.map((d, i) => ({ id: `whatif-${i}`, originalText: `${first(e)} off on ${DAY_NAME[d]}`, constraint: { type: "unavailable", employee: e.id, shift: "*", day: d, hard: true } as Constraint }));
  try {
    const r = await solveWhatIf(ctx.access.store, ctx.week, extra);
    const label = days.map((d) => `${DAY_NAME[d]} ${prettyDate(dayDate(ctx.week, d))}`).join(" and ");
    if (r.status !== "ok") return { feasible: false, person: e.name, days: label, reasons: r.reasons ?? [] };
    const hoursAfter = r.assignments.filter((a) => a.employeeId === e.id).reduce((n, a) => n + (shifts[a.shiftId]?.minutes ?? 0), 0);
    const cover = current.map((a) => {
      const s = shifts[a.shiftId];
      const now = r.assignments.filter((x) => x.shiftId === a.shiftId).map((x) => x.employeeId);
      const before = (ctx.rota?.assignments ?? []).filter((x) => x.shiftId === a.shiftId).map((x) => x.employeeId);
      const added = now.filter((id) => !before.includes(id)).map((id) => ctx.employees.find((x) => x.id === id)?.name ?? id);
      return { shift: `${DAY_NAME[s.day]} ${s.name}`, coveredBy: added };
    });
    return {
      feasible: true,
      person: e.name,
      days: label,
      currentlyWorking: current.map((a) => `${DAY_NAME[shifts[a.shiftId].day]} ${shifts[a.shiftId].name}`),
      cover,
      hoursAfter: +(hoursAfter / 60).toFixed(1),
      contractHours: e.contractedHours,
      rotaStatus: ctx.rota?.status ?? "none",
    };
  } catch (err) {
    return { error: err instanceof SolverDown ? "The solver isn't running, so I can't test that right now." : (err as Error).message };
  }
}

export async function createRule(ctx: Ctx, text: string, scope: "permanent" | "week"): Promise<{ ok: true; action: AssistantAction; summary: string } | { ok: false; error: string }> {
  if (!ctx.access.perms.has("rules.manage")) return { ok: false, error: "You don't have permission to add rules." };
  const r = await translateRule(ctx.access.store, ctx.ruleCtx, text);
  if (!r.ok) return { ok: false, error: r.error };
  const weekStart = scope === "week" ? ctx.week : null;
  const id = newId();
  await (await db()).insert("rules", {
    id, storeId: ctx.access.store.id, originalText: text, weekStart, constraint: r.constraint, summary: r.summary,
    status: "pending", createdBy: `${ctx.access.actor} (via assistant)`, createdAt: now(), confirmedBy: null, confirmedAt: null,
  });
  return { ok: true, summary: r.summary, action: { kind: "rule", ruleId: id, summary: r.summary, scope, weekStart } };
}

async function listRules(ctx: Ctx) {
  const rules = await (await db()).list("rules", { storeId: ctx.access.store.id });
  return rules
    .filter((r) => !r.weekStart || r.weekStart === ctx.week)
    .map((r) => ({ text: r.originalText, meaning: r.summary, status: r.status, scope: r.weekStart ? `week of ${prettyDate(r.weekStart)} only` : "permanent" }));
}

// ------------------------------------------------------------------ entry point

export async function assistantContext(access: Access, week: string): Promise<Ctx> {
  const d = await db();
  const [employees, rotas, roles] = await Promise.all([storeStaff(access.store), d.list("rotas", { storeId: access.store.id, weekStart: week }), storeRoles(access.store.id)]);
  return { access, week, employees, rota: rotas[0] ?? null, ruleCtx: { templates: access.store.shiftTemplates, employees, roleNames: roles.map((r) => r.name) } };
}

export async function runAssistant(access: Access, week: string, history: ChatTurn[]): Promise<AssistantReply> {
  const d = await db();
  const [employees, rotas, roles] = await Promise.all([d.list("employees", { storeId: access.store.id, active: true }, { orderBy: "name" }), d.list("rotas", { storeId: access.store.id, weekStart: week }), storeRoles(access.store.id)]);
  const ctx: Ctx = { access, week, employees, rota: rotas[0] ?? null, ruleCtx: { templates: access.store.shiftTemplates, employees, roleNames: roles.map((r) => r.name) } };
  const question = history.at(-1)?.text.trim() ?? "";
  if (!question) return { reply: "Ask me about this week's rota.", actions: [], usedAi: false };
  return aiConfigured() ? runClaude(ctx, history) : runOffline(ctx, question);
}

// ------------------------------------------------------------------ offline mode (no API key)

async function runOffline(ctx: Ctx, q: string): Promise<AssistantReply> {
  const t = q.toLowerCase();
  const done = async (reply: string, actions: AssistantAction[] = []) => {
    await logAssistantCall(ctx.access.store.id, "offline", 0, 0, 0, 0, true);
    return { reply, actions, usedAi: false };
  };

  // "add a rule (for this week): ..."
  const ruleMatch = q.match(/^(?:please\s+)?(?:add|create|make|set)\s+(?:a\s+)?(?:new\s+)?(?:(permanent|this[- ]week|weekly|one[- ]off)\s+)?rule(?:\s+for\s+(this week|next week|good|ever))?\s*[:,-]?\s*(.+)$/i);
  if (ruleMatch) {
    const scopeWord = `${ruleMatch[1] ?? ""} ${ruleMatch[2] ?? ""}`.toLowerCase();
    const scope = /this[- ]week|one[- ]off/.test(scopeWord) ? "week" : "permanent";
    const r = await createRule(ctx, ruleMatch[3].trim(), scope);
    if (!r.ok) return done(`I couldn't turn that into a rule: ${r.error}`);
    return done(`Here's the rule I'd add ${scope === "week" ? `for the week of ${prettyDate(ctx.week)} only` : "permanently"}:\n“${r.summary}”\nConfirm it below and the next rota you build will follow it.`, [r.action]);
  }

  // "X wants (this weekend|Friday) off — can we accommodate?"
  const person = ctx.employees.find((e) => new RegExp(`\\b${first(e).toLowerCase()}\\b`).test(t));
  const days = parseDays(t);
  if (person && days.length && /\b(off|holiday|leave|free|can't|cannot|unavailable|time off|day off|away)\b/.test(t)) {
    const r = await checkTimeOff(ctx, person.id, days);
    if ("error" in r) return done(r.error!);
    if (!r.feasible) {
      return done(`Not without breaking something. If ${first(person)} is off on ${r.days}, the rota can't be built because of:\n• ${(r.reasons ?? []).join("\n• ")}\nOptions: agree extra availability with someone, relax a rule for this week, or adjust ${first(person)}'s contract hours for the week.`);
    }
    const lines = [
      `Yes, ${first(person)} can have ${r.days} off.`,
      r.currentlyWorking!.length ? `They're currently on ${r.currentlyWorking!.join(", ")}.` : `They aren't on the current ${r.rotaStatus === "approved" ? "published" : "draft"} rota for those days anyway.`,
      ...r.cover!.filter((c) => c.coveredBy.length).map((c) => `• ${c.shift}: covered by ${c.coveredBy.join(", ")}`),
      r.hoursAfter! >= r.contractHours! ? `Their ${r.contractHours}h contract is still met (${r.hoursAfter}h across the other days).` : `Note: they'd get ${r.hoursAfter}h, below their ${r.contractHours}h contract.`,
      ctx.rota?.status === "approved" ? "This week is published, so you'd need to unlock it, add the rule and regenerate." : "Add it as a rule for this week, then regenerate the rota.",
    ];
    return done(lines.join("\n"), [{ kind: "suggestRule", text: `${first(person)} can't work ${days.map((d) => DAY_NAME[d]).join(" or ")}`, scope: "week", label: `Add “${first(person)} off ${days.map((d) => DAY_NAME[d].slice(0, 3)).join("/")}” for this week` }]);
  }

  // "who is working on Saturday?"
  if (/\bwho(?:'s| is)? (?:working|on|in)\b/.test(t)) {
    const r = whoIsWorking(ctx, days[0]);
    if ("error" in r) return done(r.error);
    return done(r.map((x) => `${x.shift}: ${x.people.join(", ") || "nobody yet"}`).join("\n"));
  }

  // hours / contract / problems overview
  if (/\b(contract|hours|short|under|over|problem|issue|overview|summary|status)\b/.test(t)) {
    const o = await weekOverview(ctx);
    const short = o.people.filter((p) => p.scheduledHours < p.contractHours);
    const parts = [`Week of ${o.week}: rota ${o.rota}.`];
    parts.push(short.length ? `Below contract: ${short.map((p) => `${p.name} (${p.scheduledHours}/${p.contractHours}h)`).join(", ")}.` : "Everyone has at least their contracted hours.");
    if (o.problems.length) parts.push(`Problems:\n• ${o.problems.slice(0, 8).join("\n• ")}`);
    return done(parts.join("\n"));
  }

  if (/\brules?\b/.test(t)) {
    const rules = await listRules(ctx);
    return done(rules.length ? rules.map((r) => `• ${r.meaning} (${r.scope}, ${r.status})`).join("\n") : "No rules yet.");
  }

  return done(
    "I can help with things like:\n• “Can John have this weekend off?” (I test it with the solver)\n• “Who is working Saturday?”\n• “Who's below their contract hours?”\n• “Add a rule for this week: Sam can't work Friday”\n• “Add rule: never put two new starters on closing”\n(Offline demo mode: set an Anthropic API key for free-form questions.)",
  );
}

// ------------------------------------------------------------------ Claude mode

const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "find_staff", description: "Find staff by first or full name. Returns ids to use with other tools.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "week_overview", description: "This week's rota status, each person's scheduled vs contract/max hours, and current rule problems.", input_schema: { type: "object", properties: {} } },
  { name: "who_is_working", description: "Who is on each shift this week, optionally for one day.", input_schema: { type: "object", properties: { day: { type: "string", enum: [...DAYS] } } } },
  {
    name: "check_time_off",
    description: "Test whether a person can have given days off this week by re-solving the rota with them unavailable. Returns feasibility, who would cover, their hours vs contract, or the conflicting requirements. Saves nothing.",
    input_schema: { type: "object", properties: { employee_id: { type: "string" }, days: { type: "array", items: { type: "string", enum: [...DAYS] } } }, required: ["employee_id", "days"] },
  },
  {
    name: "create_rule",
    description: "Create a scheduling rule from a plain-English sentence. scope 'this_week' applies only to the week being viewed; 'permanent' applies to every week. The rule is saved as pending and only takes effect after the manager confirms it in the chat. Only call when the manager asks for a rule or agrees to your suggestion.",
    input_schema: { type: "object", properties: { text: { type: "string" }, scope: { type: "string", enum: ["this_week", "permanent"] } }, required: ["text", "scope"] },
  },
  { name: "list_rules", description: "Rules that apply to this week (permanent and week-only), with status.", input_schema: { type: "object", properties: {} } },
];

async function runClaude(ctx: Ctx, history: ChatTurn[]): Promise<AssistantReply> {
  const client = new Anthropic();
  const actions: AssistantAction[] = [];
  const system = `You are the rota assistant for ${ctx.access.store.name}, a UK hospitality business, helping a manager plan the week of ${weekLabel(ctx.week)} (Monday ${ctx.week}). Today is ${new Date().toISOString().slice(0, 10)}.
Answer questions about staff, availability and the rota using the tools: never guess hours, availability or feasibility. For "can X have Y off" questions, always call check_time_off and report: yes/no, who covers which shift, and whether their contract hours are still met. Contracted hours, UK working-time law (11h rest between shifts including across weeks, weekly rest, breaks, under-18 limits) and required service roles can never be broken; say so if a request would need that.
You cannot edit the rota yourself. You can create rules (create_rule) when asked: use scope this_week for one-off requests such as time off this week, permanent otherwise. Tell the manager to confirm the rule below your message, then regenerate the rota.
Be brief and concrete: short sentences, bullet points for lists, names and days. British English.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((h) => ({ role: h.role, content: h.text }));
  let inTok = 0;
  let outTok = 0;

  try {
    for (let step = 0; step < 8; step++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools: TOOLS,
        messages,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      inTok += res.usage.input_tokens;
      outTok += res.usage.output_tokens;
      if (res.stop_reason === "refusal") {
        await logAssistantCall(ctx.access.store.id, MODEL, inTok, outTok, PRICE_IN, PRICE_OUT, false);
        return { reply: "I can't help with that one. Try rephrasing your question about the rota.", actions, usedAi: true };
      }
      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) {
        const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        await logAssistantCall(ctx.access.store.id, MODEL, inTok, outTok, PRICE_IN, PRICE_OUT, true);
        return { reply: text || "Done.", actions, usedAi: true };
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const input = (u.input ?? {}) as Record<string, unknown>;
        let out: unknown;
        try {
          switch (u.name) {
            case "find_staff":
              out = findStaff(ctx, String(input.name ?? "")).map((e) => ({ id: e.id, name: e.name, roles: e.role, contractHours: e.contractedHours, under18: e.isUnder18 }));
              break;
            case "week_overview":
              out = await weekOverview(ctx);
              break;
            case "who_is_working":
              out = whoIsWorking(ctx, DAYS.includes(input.day as Day) ? (input.day as Day) : undefined);
              break;
            case "check_time_off":
              out = await checkTimeOff(ctx, String(input.employee_id ?? ""), (Array.isArray(input.days) ? input.days : []).filter((x): x is Day => DAYS.includes(x as Day)));
              break;
            case "create_rule": {
              const r = await createRule(ctx, String(input.text ?? ""), input.scope === "this_week" ? "week" : "permanent");
              if (r.ok) actions.push(r.action);
              out = r.ok ? { created: true, meaning: r.summary, status: "pending - the manager must confirm it below your reply" } : { created: false, error: r.error };
              break;
            }
            case "list_rules":
              out = await listRules(ctx);
              break;
            default:
              out = { error: `Unknown tool ${u.name}` };
          }
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
        } catch (err) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: `Error: ${(err as Error).message}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    await logAssistantCall(ctx.access.store.id, MODEL, inTok, outTok, PRICE_IN, PRICE_OUT, false);
    return { reply: "That took too many steps. Try a narrower question.", actions, usedAi: true };
  } catch (err) {
    console.error("assistant failed", err);
    await logAssistantCall(ctx.access.store.id, MODEL, inTok, outTok, PRICE_IN, PRICE_OUT, false);
    if (err instanceof Anthropic.RateLimitError) return { reply: "The AI service is busy. Try again in a minute.", actions, usedAi: true };
    if (err instanceof Anthropic.AuthenticationError) return { reply: "The AI key is invalid. Check ANTHROPIC_API_KEY.", actions, usedAi: true };
    return { reply: "I couldn't reach the AI service just now. Try again shortly.", actions, usedAi: true };
  }
}

