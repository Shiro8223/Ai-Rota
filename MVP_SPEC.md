# AI Rota Agent — MVP Spec

Source: https://claude.ai/artifact/NYzjjUmBfQngN68VwvateY (as of 2026-11-02)

## Overview

The MVP is a web app where a restaurant manager writes scheduling rules in plain English, an AI turns them into structured constraints, and a solver produces a weekly rota the manager approves.

**Target customer:** independent restaurants and small-to-medium franchise owners (1–10 sites) in the UK, run by managers comfortable with Office but not AI tools.

**MVP scope (in):**

- Store setup: opening hours, shift templates, staffing levels per shift
- Employee records with weekly availability, entered by staff or imported from CSV/Excel
- Plain-English rules, translated once by AI and confirmed by the manager
- Weekly rota generation by a deterministic solver
- Manager review, edit and approve; printable rota view
- Shift swap board, with every swap checked against the rules
- Responsive web UI that works on phones (no native app)

**Success test:** 5 paying locations, each approving at least 3 generated rotas in a row with fewer than 5 manual edits per week.

## Data model

Six objects cover the whole MVP; every one is small JSON that fits in a single Postgres table with a JSONB column where useful.

| Object | Key fields | Notes |
| --- | --- | --- |
| Store | id, name, timezone, openingHours (per day), shiftTemplates, minStaff per shift | One per location; owner can hold several |
| Employee | id, storeId, name, role, startDate, contractedHours, maxHoursPerWeek, isUnder18 | startDate drives "new starter" rules |
| Availability | employeeId, weekStart, days: { mon…sun: [{from, to}] } | "Any to any" = full opening hours |
| Rule | id, storeId, originalText, constraint (JSON), status (pending/confirmed), createdBy | AI writes constraint, manager confirms |
| Rota | id, storeId, weekStart, assignments [{shiftId, employeeId}], status (draft/approved), approvedBy | Approved rota is locked and versioned |
| SwapRequest | id, rotaId, shiftId, fromEmployee, toEmployee, ruleCheck result, status | Visible on the swap board |

Example constraint the AI produces from "never put two new starters on closing":

```json
{
  "type": "max_count",
  "shift": "close",
  "filter": { "field": "tenureDays", "op": "lt", "value": 90 },
  "max": 1,
  "hard": true
}
```

Keep a fixed list of constraint types so the solver only ever sees shapes it understands: `max_count`, `min_count`, `never_together`, `unavailable`, `max_hours`, `min_rest_hours`, `prefer`.

## AI rule translation and guardrails

The AI is called only when a manager adds or edits a rule, never to build the rota, which keeps AI cost to pennies per location per month.

1. Manager types a rule in plain English.
2. Backend sends it to a small, cheap model with a system prompt listing the allowed constraint types, the store's shift names and the employee fields.
3. Model returns JSON only.
4. Backend validates the JSON against a schema (Zod or Pydantic). Invalid → one retry, then ask the manager to rephrase.
5. App shows the rule back in plain words: "Understood: no more than 1 person with under 90 days' service on closing shifts."
6. Manager confirms; rule is saved with status `confirmed`. Only confirmed rules reach the solver.

**Guardrails:**

- Strict schema and a closed list of constraint types; anything else is rejected.
- Rules can reference only fields that exist (name, role, tenure, age flag, hours); free-text reasons are never stored in the constraint.
- Disciplinary separations stored as neutral `never_together` rules with no reason field, and logged with who created them and when.
- Per-location cap, e.g. 50 rule translations a month; a counter in the database blocks calls past the cap.
- Prompt-injection hygiene: rule text is passed as data inside delimiters, and output is schema-checked regardless.
- Log every AI call (tokens, cost, store) so you can see margins per customer.

## Solver

Google OR-Tools CP-SAT builds the rota in seconds, free and deterministic, from employees, availability, shift templates and confirmed rules.

- **Variables:** one boolean `x[employee, shift]` = 1 if assigned.
- **Built-in hard constraints:** staff only on shifts inside their availability; one shift per person per day; `minStaff` met per shift; weekly hours ≤ `maxHoursPerWeek`; at least 11 hours rest between shifts and under-18 limits (UK Working Time Regulations).
- **Rule constraints:** each confirmed rule maps to a small function, e.g. `max_count` → sum of matching `x` on that shift ≤ max; `never_together` → `x[a,s] + x[b,s] ≤ 1`.
- **Soft goals (objective):** get people close to contracted hours, spread weekends and closes fairly, honour `prefer` rules. Hard rules can't be broken; soft ones are weighted.
- **No solution found:** return which constraints conflict (CP-SAT can report this) in plain words, e.g. "Not enough available staff for Saturday close", so the manager can fix it.
- **Time limit:** 10 seconds per store-week; plenty for teams under 50 people.

Run the solver in a small Python service (FastAPI) the web app calls, or as a background job queued when the manager clicks Generate.

## Swap board and approval flow

Swaps are checked in plain code against the same confirmed rules, with no AI call, and the manager approves in one tap.

1. Employee posts a shift to the swap board from their phone browser.
2. Colleagues see only shifts they're available for and offer to take it.
3. Backend runs the rule check on the rota with the swap applied: availability, hours, rest, and every confirmed rule.
4. Fails → offer is blocked with a plain reason ("This would put two new starters on Friday close"). Passes → goes to the manager.
5. Manager approves or declines; rota updates and both staff are notified by email.

Reuse one function, `check_rota(rota, rules)`, for both the solver's output test and swaps, so the two can never disagree.

Logins for staff: magic-link email or a store join code plus PIN, kept simple for teams without work email.

## Tech stack and costs

Running cost for the first five locations should stay under about £25 a month, on free tiers plus light AI use (approximate figures; check current pricing).

| Layer | Choice | Approx. cost (first 5 sites) |
| --- | --- | --- |
| Frontend | Next.js + Tailwind, responsive | £0 (Vercel free tier) |
| Auth + database | Supabase (Postgres, row-level security per store) | £0 (free tier) |
| Solver service | Python, FastAPI, OR-Tools | £0–£5 (Render/Fly small instance) |
| AI rule translation | Small Claude model via API | £5–£20 / month |
| Email | Resend or similar | £0 (free tier) |
| Domain | .co.uk or .com | ~£10 / year |
| ICO registration | Data protection fee | ~£52 / year |

Pricing to test: Starter £39 per location per month; Pro £79–£99; 15–20% off for 5+ sites; 30-day free trial.

## Build plan for Claude Code

Build in seven milestones, each a working slice you can demo; paste one milestone at a time into Claude Code with this doc as context.

- [ ] **1. Skeleton:** Next.js app, Supabase project, auth for managers, Store and Employee CRUD, row-level security by store.
- [ ] **2. Availability:** weekly availability grid per employee; CSV/Excel import with column mapping and a preview before saving.
- [ ] **3. Solver v1:** Python service with OR-Tools, built-in hard constraints only; "Generate rota" button; grid view of the result.
- [ ] **4. Rules:** plain-English rule box → AI call → schema validation → plain-words confirmation → saved constraint; solver reads confirmed rules.
- [ ] **5. Review and approve:** drag to edit assignments, live `check_rota` warnings, approve and lock, printable A4 view.
- [ ] **6. Staff access and swap board:** staff login, my-shifts view, post/offer swaps, rule check, manager approval, email notifications.
- [ ] **7. Pilot hardening:** usage caps, AI cost logging, audit log for rules and approvals, data export and delete per store, simple billing (Stripe).

**Test data:** create one fake store ("Test Wings, Leeds") with 15 staff, mixed tenure and availability, and 5 rules including a `never_together` pair. Use it in every milestone.

**Starter prompt for Claude Code:** "Read MVP_SPEC.md. Implement milestone 1 only. Use Next.js App Router, TypeScript, Supabase, Tailwind. Stop and summarise when done."

## Compliance and out of scope

You act as a data processor for each store, so register with the ICO, sign a short data processing agreement with every customer, and keep data minimal.

- Store only what scheduling needs: name, role, start date, availability, an under-18 flag. No addresses, NI numbers or pay rates in the MVP.
- Host in the UK or EU (Supabase and Vercel both offer EU regions).
- Give each store export and delete-all buttons; delete data 30 days after a customer cancels.
- No reasons stored for separation rules; audit log of who created each rule and who approved each rota.
- The manager always approves the final rota; the product is advice, and the terms should say so.
- Have a solicitor review the terms, privacy notice and DPA before the first paid customer.

**Out of scope for the MVP:** native mobile apps, payroll and POS integrations, timeclock and attendance tracking, labour-cost forecasting, multi-language, and agents beyond scheduling. Revisit after 5 paying locations.
