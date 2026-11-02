"""Weekly rota solver (OR-Tools CP-SAT).

x[e, s] = 1 when employee e works shift s. Hard rules are constraints; soft goals
are a weighted objective. When no rota exists, a second solve with one assumption
literal per requirement asks CP-SAT which requirements conflict, and we report
those in plain words.
"""

from __future__ import annotations

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .check import check_rota, summarise
from .domain import (
    DAYS,
    MaxCount,
    MaxHours,
    MinCount,
    MinRestHours,
    NeverTogether,
    Prefer,
    Problem,
    Unavailable,
)

# Objective weights, in "points". One minute away from contracted hours = 1 point.
W_CLOSE_SPREAD = 90  # per extra close on the busiest closer
W_WEEKEND_SPREAD = 90  # per extra weekend shift on the busiest weekend worker
W_PREFER = 30  # per weight unit of a prefer rule
W_SOFT_RULE = 240  # per unit of slack on a soft count/hours rule
W_OVERSTAFF = 20  # per person above min staff (keeps rotas lean)


class _Builder:
    def __init__(self, p: Problem, with_assumptions: bool):
        self.p = p
        self.m = cp_model.CpModel()
        self.with_assumptions = with_assumptions
        self.groups: list[tuple[cp_model.IntVar, str]] = []  # (literal, plain-words reason)
        self.objective: list = []
        self.x: dict[tuple[str, str], cp_model.IntVar] = {}

    def guard(self, key: str, reason: str):
        """Literal that enforces a requirement group (only used when diagnosing)."""
        if not self.with_assumptions:
            return None
        lit = self.m.NewBoolVar(key)
        self.groups.append((lit, reason))
        return lit

    def add(self, ct, lit):
        if lit is not None:
            ct.OnlyEnforceIf(lit)

    def build(self):
        p, m = self.p, self.m

        # Variables only where the person is available and the law allows it.
        for e in p.employees:
            for s in p.shifts:
                if p.available(e, s) and p.young_ok(e, s) is None and p.clash_with_edges(e, s) is None:
                    self.x[e.id, s.id] = m.NewBoolVar(f"x_{e.id}_{s.id}")
        x = self.x

        def on(s_id):
            return [x[e.id, s_id] for e in p.employees if (e.id, s_id) in x]

        # Staffing levels per shift.
        for s in p.shifts:
            vars_ = on(s.id)
            lit = self.guard(f"min_{s.id}", f"Not enough available staff for {s.label} (needs {s.min_staff})")
            self.add(m.Add(sum(vars_) >= s.min_staff), lit)
            m.Add(sum(vars_) <= s.max_staff)
            for role, need in s.reqs:
                lit_r = self.guard(f"req_{s.id}_{role}", f"{s.label} needs {need} {role}")
                self.add(m.Add(sum(x[e.id, s.id] for e in p.employees if (e.id, s.id) in x and p.has_role(e, role)) >= need), lit_r)
            over = m.NewIntVar(0, len(p.employees), f"over_{s.id}")
            m.Add(over >= sum(vars_) - s.min_staff)
            self.objective.append(W_OVERSTAFF * over)

        # Per person: one shift a day, weekly hours, rest between shifts.
        for e in p.employees:
            mine = [(s, x[e.id, s.id]) for s in p.shifts if (e.id, s.id) in x]
            by_day = defaultdict(list)
            for s, v in mine:
                by_day[s.day].append(v)
            for vs in by_day.values():
                m.Add(sum(vs) <= 1)

            # Hours already worked at other sites this week count towards limits and contract.
            worked = (sum(s.minutes * v for s, v in mine) if mine else 0) + p.fixed_minutes(e)
            cap = p.max_week_min(e)
            lit = self.guard(f"hours_{e.id}", f"{e.first_name}'s {cap / 60:g}h weekly limit")
            self.add(m.Add(worked <= cap), lit)

            need = p.rest_min(e)
            lit = self.guard(f"rest_{e.id}", f"{e.first_name}'s {need / 60:g}h minimum rest between shifts")

            for i, (a, va) in enumerate(mine):
                for b, vb in mine[i + 1 :]:
                    first, second = (a, b) if a.start <= b.start else (b, a)
                    if first.day != second.day and second.start - first.end < need:
                        self.add(m.AddBoolOr([va.Not(), vb.Not()]), lit)

            # Weekly rest (UK WTR): adults one full day off, under-18s two days off in a row.
            day_vars = {}
            for d, vs in by_day.items():
                w = m.NewBoolVar(f"works_{e.id}_{d}")
                m.Add(sum(vs) >= 1).OnlyEnforceIf(w)
                m.Add(sum(vs) == 0).OnlyEnforceIf(w.Not())
                day_vars[d] = w
            need = "two days" if e.under18 else "one day"
            lit = self.guard(f"wrest_{e.id}", f"{e.first_name}'s weekly rest ({need} off)")
            busy_elsewhere = {DAYS[i] for i in p.fixed_days(e) if 0 <= i < 7}
            if e.under18:
                pairs = []
                for i in range(6):
                    a, b = DAYS[i], DAYS[i + 1]
                    if a in busy_elsewhere or b in busy_elsewhere:
                        continue
                    off = m.NewBoolVar(f"off2_{e.id}_{a}")
                    for d in (a, b):
                        if d in day_vars:
                            m.AddImplication(off, day_vars[d].Not())
                    pairs.append(off)
                self.add(m.AddBoolOr(pairs) if pairs else m.Add(0 == 1), lit)
            elif len(set(day_vars) | busy_elsewhere) == 7:
                self.add(m.Add(sum(day_vars.values()) + len(busy_elsewhere) <= 6), lit)

            # Contracted hours are mandatory; beyond that, keep extra hours low.
            if e.contracted_min > 0:
                lit = self.guard(f"contract_{e.id}", f"{e.first_name}'s {e.contracted_min / 60:g}h contract")
                self.add(m.Add(worked >= e.contracted_min), lit)
                dev = m.NewIntVar(0, 7 * 1440, f"dev_{e.id}")
                m.Add(dev >= worked - e.contracted_min)
                self.objective.append(dev)

        # Fair spread of closes and weekend shifts: minimise the busiest person's count.
        for attr, weight, name in (("is_close", W_CLOSE_SPREAD, "close"), ("is_weekend", W_WEEKEND_SPREAD, "wknd")):
            top = m.NewIntVar(0, 7, f"top_{name}")
            for e in p.employees:
                vs = [x[e.id, s.id] for s in p.shifts if getattr(s, attr) and (e.id, s.id) in x]
                if vs:
                    m.Add(top >= sum(vs))
            self.objective.append(weight * top)

        # Confirmed rules.
        for r in p.rules:
            self.rule(r)

        if self.with_assumptions:
            m.AddAssumptions([lit for lit, _ in self.groups])
        m.Minimize(sum(self.objective))

    def rule(self, r):
        p, m, x = self.p, self.m, self.x
        c = r.constraint
        label = p.rule_label(r)
        lit = self.guard(f"rule_{r.id}", f"Rule: “{label}”") if c.hard else None

        def slack(name):
            v = m.NewIntVar(0, 1000, f"slack_{r.id}_{name}")
            self.objective.append(W_SOFT_RULE * v)
            return v

        if isinstance(c, (MaxCount, MinCount)):
            for s in p.shifts:
                if not p.shift_matches(s, c.shift, c.day):
                    continue
                vs = [x[e.id, s.id] for e in p.employees if (e.id, s.id) in x and p.matches(e, c.filter)]
                total = sum(vs) if vs else 0
                if isinstance(c, MaxCount):
                    if c.hard:
                        self.add(m.Add(total <= c.max), lit)
                    else:
                        m.Add(total <= c.max + slack(s.id))
                else:
                    if c.hard:
                        self.add(m.Add(total >= c.min), lit)
                    else:
                        m.Add(total + slack(s.id) >= c.min)
        elif isinstance(c, NeverTogether):
            a, b = c.employees
            for sa in p.shifts:
                for sb in p.shifts:
                    if (a, sa.id) in x and (b, sb.id) in x and sa.overlaps(sb):
                        self.add(m.AddBoolOr([x[a, sa.id].Not(), x[b, sb.id].Not()]), lit)
        elif isinstance(c, Unavailable):
            for s in p.shifts:
                if p.shift_matches(s, c.shift, c.day) and (c.employee, s.id) in x:
                    if c.hard:
                        self.add(m.Add(x[c.employee, s.id] == 0), lit)
                    else:
                        self.objective.append(W_SOFT_RULE * x[c.employee, s.id])
        elif isinstance(c, MaxHours):
            for e in p.who(c.employee, c.filter):
                vs = [s.minutes * x[e.id, s.id] for s in p.shifts if (e.id, s.id) in x]
                if not vs:
                    continue
                cap = round(c.max * 60)
                if c.hard:
                    self.add(m.Add(sum(vs) <= cap), lit)
                else:
                    over = m.NewIntVar(0, 7 * 1440, f"overh_{r.id}_{e.id}")
                    m.Add(over >= sum(vs) - cap)
                    self.objective.append(over * 4)
        elif isinstance(c, MinRestHours):
            pass  # hard rest rules are folded into Problem.rest_min(); soft ones are only warned about
        elif isinstance(c, Prefer):
            for e in p.who(c.employee, c.filter):
                for s in p.shifts:
                    if (e.id, s.id) in x and p.shift_matches(s, c.shift, c.day):
                        sign = 1 if c.avoid else -1
                        self.objective.append(sign * W_PREFER * c.weight * x[e.id, s.id])


def _precheck(p: Problem) -> list[str]:
    reasons = []
    for s in p.shifts:
        ok = [e for e in p.employees if p.available(e, s) and p.young_ok(e, s) is None]
        if len(ok) < s.min_staff:
            reasons.append(f"Not enough available staff for {s.label}: {len(ok)} available, {s.min_staff} needed")
        for role, need in s.reqs:
            have = sum(1 for e in ok if p.has_role(e, role))
            if have < need:
                reasons.append(f"{s.label} needs {need} {role} but only {have} {'is' if have == 1 else 'are'} available")
    # Contracts are mandatory: can this person's availability even cover them?
    for e in p.employees:
        if e.contracted_min <= 0:
            continue
        best = sorted((max((s.minutes for s in p.shifts if s.day == d and p.available(e, s) and p.young_ok(e, s) is None), default=0) for d in {s.day for s in p.shifts}), reverse=True)
        days = 5 if e.under18 else 6
        reach = min(sum(best[:days]) + p.fixed_minutes(e), p.max_week_min(e))
        if reach < e.contracted_min:
            reasons.append(f"{e.first_name}'s availability this week only allows {reach / 60:g}h, below their {e.contracted_min / 60:g}h contract. Agree more availability or a contract change")
    return reasons


def _params(time_limit: float, workers: int) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = workers
    solver.parameters.random_seed = 7
    return solver


def _feasible_with(p: Problem, keep: set[str], time_limit: float) -> bool | None:
    """Solve with only the requirement groups in `keep` enforced. None = ran out of time."""
    b = _Builder(p, with_assumptions=True)
    b.build()
    for lit, _ in b.groups:
        if lit.Name() not in keep:
            b.m.AddHint(lit, 0)
    solver = _params(time_limit, workers=8)
    # Fix every group not in `keep` off, the rest on.
    for lit, _ in b.groups:
        b.m.Add(lit == (1 if lit.Name() in keep else 0))
    b.m.ClearAssumptions()
    st = solver.Solve(b.m)
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return True
    if st == cp_model.INFEASIBLE:
        return False
    return None


def explain_infeasible(p: Problem, time_limit: float = 10.0) -> list[str]:
    """Name a small set of requirements that can't all hold together.

    CP-SAT gives a first conflict set from assumptions; then each member is dropped in turn
    and kept out if the rest is still infeasible, leaving a short list a manager can act on.
    """
    b = _Builder(p, with_assumptions=True)
    b.build()
    solver = _params(time_limit, workers=1)
    solver.parameters.cp_model_presolve = False
    status = solver.Solve(b.m)
    if status != cp_model.INFEASIBLE:
        return ["The solver ran out of time before it could say which requirements conflict. Try relaxing a rule or adding availability."]
    core_idx = set(solver.SufficientAssumptionsForInfeasibility())
    reason_of = {lit.Name(): reason for lit, reason in b.groups}
    core = [lit.Name() for lit, _ in b.groups if lit.Index() in core_idx] or [lit.Name() for lit, _ in b.groups]
    deadline = time.perf_counter() + max(5.0, time_limit * 2)
    for name in list(core):
        if len(core) <= 2 or time.perf_counter() > deadline:
            break
        trial = [n for n in core if n != name]
        if _feasible_with(p, set(trial), 1.5) is False:
            core = trial
    return [reason_of[n] for n in core] or ["The requirements conflict, but CP-SAT couldn't narrow down which ones."]


def solve(p: Problem, time_limit: float = 10.0) -> dict:
    t0 = time.perf_counter()
    pre = _precheck(p)
    if pre:
        return {"status": "infeasible", "reasons": pre, "assignments": [], "issues": [], "stats": {"seconds": round(time.perf_counter() - t0, 3)}}

    b = _Builder(p, with_assumptions=False)
    b.build()
    solver = _params(time_limit, workers=8)
    status = solver.Solve(b.m)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if status == cp_model.INFEASIBLE:
            reasons = explain_infeasible(p, time_limit)
        else:
            reasons = ["No rota found within the time limit. Try relaxing a rule or adding availability."]
        return {"status": "infeasible", "reasons": reasons, "assignments": [], "issues": [], "stats": {"seconds": round(time.perf_counter() - t0, 3)}}

    assignments = [{"shiftId": s_id, "employeeId": e_id} for (e_id, s_id), v in b.x.items() if solver.Value(v)]
    assignments.sort(key=lambda a: (p.shift_by_id[a["shiftId"]].start, a["employeeId"]))
    issues = check_rota(p, [(a["shiftId"], a["employeeId"]) for a in assignments])
    summary = summarise(issues)
    if not summary["ok"]:  # should never happen: the model and the checker disagree
        return {
            "status": "error",
            "reasons": ["The solver produced a rota that fails the rule check. This is a bug - please report it."],
            "assignments": assignments,
            "issues": issues,
            "stats": {"seconds": round(time.perf_counter() - t0, 3)},
        }
    return {
        "status": "ok",
        "optimal": status == cp_model.OPTIMAL,
        "assignments": assignments,
        "issues": issues,
        "summary": summary,
        "stats": {"seconds": round(time.perf_counter() - t0, 3), "objective": solver.ObjectiveValue()},
    }
