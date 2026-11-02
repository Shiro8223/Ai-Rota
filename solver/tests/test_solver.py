"""Solver + check_rota tests against the Test Wings, Leeds fixture."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.check import check_rota, summarise
from app.domain import Problem
from app.main import app
from app.solve import solve

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "test-wings-leeds.json"
WEEK = date(2026, 11, 9)  # a Monday
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ANY = [{"from": "00:00", "to": "24:00"}]


def payload(confirmed_only: bool = True) -> dict:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    employees, availability = [], {}
    for e in fx["employees"]:
        employees.append(
            {
                "id": e["key"],
                "name": e["name"],
                "role": e["role"],
                "roles": fx["roleMap"][e["role"]],
                "startDate": (WEEK - timedelta(days=e["startDaysAgo"])).isoformat(),
                "contractedHours": e["contractedHours"],
                "maxHoursPerWeek": e["maxHoursPerWeek"],
                "isUnder18": e["isUnder18"],
            }
        )
        av = e["availability"]
        days = {}
        for d in DAYS:
            spec = av if av == "any" else av.get(d)
            if spec == "any":
                days[d] = ANY
            elif spec:
                days[d] = [{"from": f, "to": t} for f, t in spec]
            else:
                days[d] = []
        availability[e["key"]] = days
    rules = [
        {"id": f"r{i}", "summary": r["originalText"], "constraint": r["constraint"]}
        for i, r in enumerate(fx["rules"])
        if r["status"] == "confirmed" or not confirmed_only
    ]
    store = {**fx["store"], "id": "store1"}
    return {"weekStart": WEEK.isoformat(), "store": store, "employees": employees, "availability": availability, "rules": rules}


@pytest.fixture(scope="module")
def solved():
    p = Problem(payload())
    return p, solve(p, time_limit=10)


def test_generates_valid_rota(solved):
    p, res = solved
    assert res["status"] == "ok", res.get("reasons")
    pairs = [(a["shiftId"], a["employeeId"]) for a in res["assignments"]]
    assert summarise(check_rota(p, pairs))["ok"]


def test_rules_hold(solved):
    p, res = solved
    by_shift: dict[str, set[str]] = {}
    for a in res["assignments"]:
        by_shift.setdefault(a["shiftId"], set()).add(a["employeeId"])
    new = {e.id for e in p.employees if e.tenure_days < 90}
    leads = {e.id for e in p.employees if e.role == "Shift Lead"}
    for s in p.shifts:
        people = by_shift.get(s.id, set())
        assert len(people) >= s.min_staff
        assert people & leads, f"no lead on {s.id}"
        if s.template_id == "close":
            assert len(people & new) <= 1, f"two new starters on {s.id}"
            assert not people & {"olivia", "tom"}, "under-18 on a close"
        assert not {"jordan", "casey"} <= people
    assert "priya" not in by_shift.get("open:sun", set())


def test_check_catches_breaks(solved):
    p, res = solved
    pairs = [(a["shiftId"], a["employeeId"]) for a in res["assignments"]]
    # Put Jordan and Casey together on Monday close, and Tom (under 18) on a close.
    bad = pairs + [("close:mon", "jordan"), ("close:mon", "casey"), ("close:tue", "tom")]
    msgs = [i["message"] for i in check_rota(p, bad) if i["severity"] == "error"]
    assert any("Jordan and Casey" in m for m in msgs)
    assert any("Tom" in m for m in msgs)


def test_rest_rule():
    p = Problem(payload())
    # Alex closes Monday (ends 23:00) and opens Tuesday (10:00): exactly 11h, allowed.
    assert not [i for i in check_rota(p, [("close:mon", "alex"), ("open:tue", "alex")]) if i["code"] == "rest"]
    # Olivia (under 18) needs 12h.
    data = payload()
    data["store"]["shiftTemplates"].append({"id": "late", "name": "Late", "start": "15:00", "end": "21:30", "days": ["sat"], "minStaff": 0, "maxStaff": 2})
    data["store"]["shiftTemplates"].append({"id": "early", "name": "Early", "start": "08:00", "end": "14:00", "days": ["sun"], "minStaff": 0, "maxStaff": 2})
    p2 = Problem(data)
    assert [i for i in check_rota(p2, [("late:sat", "olivia"), ("early:sun", "olivia")]) if i["code"] == "rest"]


def test_infeasible_explains():
    data = payload()
    for t in data["store"]["shiftTemplates"]:
        if t["id"] == "close":
            t["minStaff"] = 12  # impossible
            t["maxStaff"] = 12
    res = solve(Problem(data), time_limit=5)
    assert res["status"] == "infeasible"
    assert any("Close" in r for r in res["reasons"])


def test_infeasible_rule_conflict_named():
    data = payload()
    data["rules"].append(
        {"id": "nolead", "summary": "No shift leads on Monday close", "constraint": {"type": "max_count", "shift": "close", "day": "mon", "filter": {"field": "role", "op": "eq", "value": "Shift Lead"}, "max": 0, "hard": True}}
    )
    res = solve(Problem(data), time_limit=5)
    assert res["status"] == "infeasible"
    joined = " ".join(res["reasons"])
    assert "No shift leads on Monday close" in joined


def test_rejects_unknown_constraint():
    data = payload()
    data["rules"].append({"id": "bad", "constraint": {"type": "delete_everyone", "hard": True}})
    client = TestClient(app)
    assert client.post("/solve", json=data).status_code == 422


def test_http_roundtrip():
    client = TestClient(app)
    data = payload()
    res = client.post("/solve", json=data).json()
    assert res["status"] == "ok"
    data["assignments"] = res["assignments"]
    chk = client.post("/check", json=data).json()
    assert chk["summary"]["ok"]


def test_weekly_rest_and_legal_flag():
    p = Problem(payload())
    week = [(f"open:{d}", "alex") for d in DAYS]  # 7 opens: no 24h break
    errs = [i for i in check_rota(p, week) if i["code"] == "weekly_rest"]
    assert errs and errs[0]["legal"]
    assert summarise(check_rota(p, week))["legal"] >= 1


def test_out_of_availability_exception():
    data = payload()
    base = [("open:mon", "dan")]  # Dan is evenings only
    assert any(i["code"] == "availability" for i in check_rota(Problem(data), base))
    for status, code, sev in (("pending", "exception_pending", "warning"), ("agreed", "exception_agreed", "info"), ("declined", "exception_declined", "error")):
        data["exceptions"] = [{"shiftId": "open:mon", "employeeId": "dan", "status": status}]
        found = [i for i in check_rota(Problem(data), base) if i["code"] == code]
        assert found and found[0]["severity"] == sev, status


def test_solver_respects_weekly_rest(solved):
    p, res = solved
    days: dict[str, set[str]] = {}
    for a in res["assignments"]:
        days.setdefault(a["employeeId"], set()).add(a["shiftId"].split(":")[1])
    for e in p.employees:
        assert len(days.get(e.id, set())) <= (5 if e.under18 else 6)


def test_contracts_are_met(solved):
    p, res = solved
    worked: dict[str, int] = {}
    for a in res["assignments"]:
        worked[a["employeeId"]] = worked.get(a["employeeId"], 0) + p.shift_by_id[a["shiftId"]].minutes
    for e in p.employees:
        assert worked.get(e.id, 0) >= e.contracted_min, e.name


def test_required_roles_filled(solved):
    p, res = solved
    for s in p.shifts:
        people = [p.emp_by_id[a["employeeId"]] for a in res["assignments"] if a["shiftId"] == s.id]
        for role, need in s.reqs:
            assert sum(1 for e in people if p.has_role(e, role)) >= need, (s.id, role)


def test_contract_shortfall_is_blocking():
    p = Problem(payload())
    issues = [i for i in check_rota(p, [("close:mon", "dan")]) if i["code"] == "contract" and "Dan" in i["message"]]
    assert issues and issues[0]["blocking"] and not issues[0]["legal"]


def test_cross_week_rest_sunday_to_monday():
    data = payload()
    # Alex closed last Sunday until 23:00 (= -60 minutes from this Monday 00:00).
    data["edgeShifts"] = [{"employeeId": "alex", "label": "last Sun Close", "start": -7 * 60, "end": -60}]
    p = Problem(data)
    # Monday open starts 10:00 = 600: only 11h after 23:00 -> exactly legal for an adult.
    assert not [i for i in check_rota(p, [("open:mon", "alex")]) if i["code"] == "rest"]
    # A 09:00 start would be 10h: illegal, and the solver must never schedule it.
    data["store"]["shiftTemplates"].append({"id": "early", "name": "Early", "start": "09:00", "end": "15:00", "days": ["mon"], "minStaff": 0, "maxStaff": 2, "breakMinutes": 0})
    p2 = Problem(data)
    errs = [i for i in check_rota(p2, [("early:mon", "alex")]) if i["code"] == "rest"]
    assert errs and errs[0]["legal"] and "last Sun Close" in errs[0]["message"]
    res = solve(p2, time_limit=10)
    assert res["status"] == "ok"
    assert ("early:mon", "alex") not in {(a["shiftId"], a["employeeId"]) for a in res["assignments"]}


def test_breaks_are_legal():
    data = payload()
    for t in data["store"]["shiftTemplates"]:
        t["breakMinutes"] = 0  # 7h close with no break
    p = Problem(data)
    assert any(i["code"] == "break" and i["legal"] for i in check_rota(p, [("close:mon", "alex")]))
    # Under-18s need 30 minutes on anything over 4.5 working hours.
    assert any(i["code"] == "under18" for i in check_rota(p, [("open:sat", "tom")]))


def test_conflict_explanation_is_short():
    data = payload()
    for e in data["employees"]:
        if e["id"] == "grace":
            e["contractedHours"] = 20
    res = solve(Problem(data), time_limit=10)
    assert res["status"] == "infeasible"
    assert len(res["reasons"]) <= 4, res["reasons"]


SAT = 5 * 1440


def test_shared_staff_other_site_same_day_and_rest():
    data = payload()
    # Casey closes at another site on Saturday (16:00-23:00).
    data["edgeShifts"] = [{"employeeId": "casey", "label": "York Sat Close", "start": SAT + 16 * 60, "end": SAT + 23 * 60, "minutes": 390}]
    p = Problem(data)
    issues = check_rota(p, [("open:sat", "casey")])
    assert any(i["code"] == "one_per_day" and "York Sat Close" in i["message"] for i in issues)
    # Sunday open here at 10:00 is exactly 11h after 23:00: legal.
    assert not [i for i in check_rota(p, [("open:sun", "casey")]) if i["code"] == "rest"]
    # A 09:00 Sunday start would be 10h: illegal, flagged, and never scheduled.
    data["store"]["shiftTemplates"].append({"id": "early", "name": "Early", "start": "09:00", "end": "15:00", "days": ["sun"], "minStaff": 0, "maxStaff": 2, "breakMinutes": 0})
    # (the "lead on every shift" rule would also demand a lead on this extra shift: not what we're testing)
    data["rules"] = [r for r in data["rules"] if "shift lead" not in r["summary"].lower()]
    p2 = Problem(data)
    assert any(i["code"] == "rest" and i["legal"] for i in check_rota(p2, [("early:sun", "casey")]))
    res = solve(p2, time_limit=10)
    assert res["status"] == "ok", res.get("reasons")
    mine = {a["shiftId"] for a in res["assignments"] if a["employeeId"] == "casey"}
    assert "early:sun" not in mine and not any(s.endswith(":sat") for s in mine)


def test_shared_staff_hours_and_contract_count_across_sites():
    data = payload()
    # Mia (25h contract, 35h max) already has 5 x 6.5h = 32.5h at another site this week.
    data["edgeShifts"] = [{"employeeId": "mia", "label": f"York {d} Open", "start": i * 1440 + 600, "end": i * 1440 + 960, "minutes": 390} for i, d in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri"])]
    p = Problem(data)
    # 32.5h elsewhere + a 6.5h close here = 39h > 35h max.
    assert any(i["code"] == "max_hours" and "other sites" in i["message"] for i in check_rota(p, [("close:sat", "mia")]))
    # Her contract is already met by the other site: no contract error with zero shifts here.
    assert not [i for i in check_rota(p, []) if i["code"] == "contract" and "Mia" in i["message"]]
    res = solve(p, time_limit=10)
    assert res["status"] == "ok", res.get("reasons")
    here = sum(p.shift_by_id[a["shiftId"]].minutes for a in res["assignments"] if a["employeeId"] == "mia")
    assert here + 5 * 390 <= 35 * 60
