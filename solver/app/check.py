"""check_rota: the one rule checker.

Used to test every solver result, to give live warnings while a manager edits,
and to approve or block shift swaps - so the three can never disagree.
"""

from __future__ import annotations

from collections import defaultdict

from .domain import (
    DAY_LABEL,
    OPT_OUT_LIMIT_MIN,
    Emp,
    MaxCount,
    MaxHours,
    MinCount,
    MinRestHours,
    NeverTogether,
    Prefer,
    Problem,
    Shift,
    Unavailable,
)


# Breaking these is against UK working-time law: they can never be approved "anyway".
LEGAL_CODES = {"rest", "under18", "weekly_rest", "break"}
# Contracted hours are mandatory too: like legal problems, they block publishing.
BLOCKING_CODES = LEGAL_CODES | {"contract"}


def _issue(severity: str, code: str, message: str, **extra) -> dict:
    out = {"severity": severity, "code": code, "message": message, "legal": code in LEGAL_CODES, "blocking": code in BLOCKING_CODES and severity == "error"}
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def _hours(minutes: int) -> str:
    h = minutes / 60
    return f"{h:g}h"


def check_rota(p: Problem, assignments: list[tuple[str, str]] | None = None) -> list[dict]:
    """Return every problem with a rota, worst first.

    severity: "error" = breaks a hard rule or the law; "warning" = breaks a soft
    rule or a staffing ceiling; "info" = worth knowing (e.g. under contracted hours).
    """
    pairs = p.assignments if assignments is None else assignments
    issues: list[dict] = []

    by_shift: dict[str, list[Emp]] = defaultdict(list)
    by_emp: dict[str, list[Shift]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for shift_id, emp_id in pairs:
        s = p.shift_by_id.get(shift_id)
        e = p.emp_by_id.get(emp_id)
        if s is None or e is None:
            issues.append(_issue("error", "unknown", f"Assignment refers to an unknown shift or person ({shift_id}, {emp_id})", shiftId=shift_id))
            continue
        if (shift_id, emp_id) in seen:
            continue
        seen.add((shift_id, emp_id))
        by_shift[s.id].append(e)
        by_emp[e.id].append(s)

    # --- per assignment: availability and under-18 limits
    for s_id, emps in by_shift.items():
        s = p.shift_by_id[s_id]
        for e in emps:
            if not p.available(e, s):
                status = p.exceptions.get((s.id, e.id))
                if status == "agreed":
                    issues.append(_issue("info", "exception_agreed", f"{e.first_name} agreed to work {s.label} outside their usual availability", shiftId=s.id, employeeIds=[e.id]))
                elif status == "pending":
                    issues.append(_issue("warning", "exception_pending", f"Waiting for {e.first_name} to agree to {s.label} (outside their availability)", shiftId=s.id, employeeIds=[e.id]))
                elif status == "declined":
                    issues.append(_issue("error", "exception_declined", f"{e.first_name} declined {s.label} (outside their availability): reassign it", shiftId=s.id, employeeIds=[e.id]))
                else:
                    issues.append(_issue("error", "availability", f"{e.first_name} isn't available for {s.label}", shiftId=s.id, employeeIds=[e.id]))
            reason = p.young_ok(e, s)
            if reason:
                issues.append(_issue("error", "under18", f"{reason} ({s.label})", shiftId=s.id, employeeIds=[e.id]))

    # --- staffing levels
    for s in p.shifts:
        people = by_shift.get(s.id, [])
        if people and s.break_min < p.break_needed(s.minutes, False):
            issues.append(_issue("error", "break", f"{s.label} is over 6 working hours, so it needs at least a 20-minute unpaid break (set {s.break_min} min in Shifts)", shiftId=s.id))
        for role, need in s.reqs:
            have = sum(1 for e in people if p.has_role(e, role))
            if have < need:
                issues.append(_issue("error", "requirement", f"{s.label} needs {need} {role} but has {have}", shiftId=s.id))
        n = len(people)
        if n < s.min_staff:
            issues.append(_issue("error", "min_staff", f"{s.label} needs {s.min_staff} staff but has {n}", shiftId=s.id))
        elif n > s.max_staff:
            issues.append(_issue("warning", "max_staff", f"{s.label} has {n} staff; the most it needs is {s.max_staff}", shiftId=s.id))

    # --- per person: one shift a day, hours, rest (counting shifts at other sites and in
    # neighbouring weeks, so shared staff and rolling rotas stay legal)
    for emp_id, shifts in by_emp.items():
        e = p.emp_by_id[emp_id]
        shifts = sorted(shifts, key=lambda x: x.start)
        per_day: dict[str, list[Shift]] = defaultdict(list)
        for s in shifts:
            per_day[s.day].append(s)
        for day, ss in per_day.items():
            if len(ss) > 1:
                issues.append(_issue("error", "one_per_day", f"{e.first_name} has {len(ss)} shifts on {DAY_LABEL[day]}", shiftId=ss[1].id, employeeIds=[e.id]))
        fixed = p.fixed(e)
        for s in shifts:
            for x in fixed:
                if x.start // 1440 == s.day_index:
                    issues.append(_issue("error", "one_per_day", f"{e.first_name} already works {x.label} on {DAY_LABEL[s.day]}", shiftId=s.id, employeeIds=[e.id]))

        total = sum(s.minutes for s in shifts) + p.fixed_minutes(e)
        cap = p.max_week_min(e)
        elsewhere = " (including other sites)" if fixed else ""
        if total > cap:
            why = "under-18 limit" if e.under18 and cap < e.max_min else "weekly maximum"
            issues.append(_issue("error", "max_hours", f"{e.first_name} has {_hours(total)} this week{elsewhere}, over their {_hours(cap)} {why}", employeeIds=[e.id]))
        if total > OPT_OUT_LIMIT_MIN and not e.under18 and total <= cap and not e.opted_out:
            issues.append(_issue("warning", "opt_out", f"{e.first_name} has {_hours(total)}{elsewhere}: over 48h needs a signed opt-out", employeeIds=[e.id]))

        # Every interval this person works, here and elsewhere, in time order.
        here = [(s.start, s.end, s.label, s) for s in shifts]
        other = [(x.start, x.end, x.label, None) for x in p.edge.get(e.id, [])]
        timeline = sorted(here + other, key=lambda t: t[0])

        # Weekly rest: longest uninterrupted break in this week.
        if shifts:
            inside = [t for t in timeline if t[1] > 0 and t[0] < 7 * 1440]
            lo = max([0] + [t[1] for t in timeline if t[1] <= 0 or (t[0] < 0 < t[1])])
            lo = max(0, lo)
            hi = min([7 * 1440] + [t[0] for t in timeline if t[0] >= 7 * 1440])
            edges = [lo] + [x for t in inside for x in (max(t[0], 0), min(t[1], 7 * 1440))] + [hi]
            longest = max(edges[i + 1] - edges[i] for i in range(0, len(edges) - 1, 2))
            need_weekly = p.weekly_rest_min(e)
            if longest < need_weekly:
                issues.append(_issue("error", "weekly_rest", f"{e.first_name} has no {_hours(need_weekly)} break this week (longest {_hours(longest)})", employeeIds=[e.id]))

        # Daily rest between consecutive shifts on different days, wherever they are.
        need_rest = p.rest_min(e, hard_only=True)
        for (a_s, a_e, a_l, a_sh), (b_s, b_e, b_l, b_sh) in zip(timeline, timeline[1:]):
            if a_sh is None and b_sh is None:
                continue
            if a_s // 1440 == b_s // 1440 and (a_sh is None or b_sh is None):
                continue  # same-day clash with another site is reported as one_per_day
            if a_sh is not None and b_sh is not None and a_sh.day == b_sh.day:
                continue
            gap = b_s - a_e
            if gap < need_rest:
                target = b_sh or a_sh
                issues.append(_issue("error", "rest", f"{e.first_name} gets only {_hours(max(gap, 0))} rest between {a_l} and {b_l} (needs {_hours(need_rest)})", shiftId=target.id, employeeIds=[e.id]))

    # --- confirmed rules
    for r in p.rules:
        c = r.constraint
        sev = "error" if c.hard else "warning"
        label = p.rule_label(r)
        if isinstance(c, (MaxCount, MinCount)):
            for s in p.shifts:
                if not p.shift_matches(s, c.shift, c.day):
                    continue
                n = sum(1 for e in by_shift.get(s.id, []) if p.matches(e, c.filter))
                if isinstance(c, MaxCount) and n > c.max:
                    issues.append(_issue(sev, "rule", f"{s.label} breaks “{label}” ({n} where the limit is {c.max})", shiftId=s.id, ruleId=r.id))
                if isinstance(c, MinCount) and n < c.min and by_shift.get(s.id):
                    issues.append(_issue(sev, "rule", f"{s.label} breaks “{label}” ({n} where at least {c.min} needed)", shiftId=s.id, ruleId=r.id))
                elif isinstance(c, MinCount) and n < c.min:
                    issues.append(_issue(sev, "rule", f"{s.label} breaks “{label}” (nobody assigned)", shiftId=s.id, ruleId=r.id))
        elif isinstance(c, NeverTogether):
            a, b = (p.emp_by_id[x] for x in c.employees)
            for sa in by_emp.get(a.id, []):
                for sb in by_emp.get(b.id, []):
                    if sa.overlaps(sb):
                        where = sa.label if sa.id == sb.id else f"{sa.label} / {sb.label}"
                        issues.append(_issue(sev, "rule", f"{a.first_name} and {b.first_name} are working together on {where}", shiftId=sb.id, employeeIds=[a.id, b.id], ruleId=r.id))
        elif isinstance(c, Unavailable):
            e = p.emp_by_id[c.employee]
            for s in by_emp.get(e.id, []):
                if p.shift_matches(s, c.shift, c.day):
                    issues.append(_issue(sev, "rule", f"{e.first_name} is on {s.label}, which breaks “{label}”", shiftId=s.id, employeeIds=[e.id], ruleId=r.id))
        elif isinstance(c, MaxHours):
            for e in p.who(c.employee, c.filter):
                total = sum(s.minutes for s in by_emp.get(e.id, []))
                if total > c.max * 60:
                    issues.append(_issue(sev, "rule", f"{e.first_name} has {_hours(total)}, over the {c.max:g}h in “{label}”", employeeIds=[e.id], ruleId=r.id))
        elif isinstance(c, MinRestHours) and not c.hard:
            need = round(c.hours * 60)
            for e in p.who(c.employee, c.filter):
                ss = sorted(by_emp.get(e.id, []), key=lambda x: x.start)
                for a, b in zip(ss, ss[1:]):
                    if a.day != b.day and b.start - a.end < need:
                        issues.append(_issue(sev, "rule", f"{e.first_name} gets only {_hours(max(b.start - a.end, 0))} rest before {b.label} (“{label}”)", shiftId=b.id, employeeIds=[e.id], ruleId=r.id))
        elif isinstance(c, Prefer):
            pass  # a preference is a goal, not a breakable rule

    # --- contracted hours are mandatory
    for e in p.employees:
        if e.contracted_min <= 0:
            continue
        total = sum(s.minutes for s in by_emp.get(e.id, [])) + p.fixed_minutes(e)
        if total < e.contracted_min:
            elsewhere = " (including other sites)" if p.fixed(e) else ""
            issues.append(_issue("error", "contract", f"{e.first_name} has {_hours(total)}{elsewhere} of their {_hours(e.contracted_min)} contract", employeeIds=[e.id]))

    order = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: order[i["severity"]])
    return issues


def summarise(issues: list[dict]) -> dict:
    return {
        "ok": not any(i["severity"] == "error" for i in issues),
        "legal": sum(1 for i in issues if i["severity"] == "error" and i["legal"]),
        "blocking": sum(1 for i in issues if i.get("blocking")),
        "errors": sum(1 for i in issues if i["severity"] == "error"),
        "warnings": sum(1 for i in issues if i["severity"] == "warning"),
    }
