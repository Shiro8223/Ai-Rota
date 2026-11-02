"""Solve the fixture once and store the result as web/fixtures/test-wings-leeds.json -> demoRota.

Run after changing the fixture:  .venv/Scripts/python -m scripts.make_demo_rota
"""
import json
from pathlib import Path

from app.domain import Problem
from app.solve import solve
from tests.test_solver import FIXTURE, payload

data = payload()
res = solve(Problem(data), time_limit=10)
assert res["status"] == "ok", res
fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
fx["demoRota"] = [{"shiftId": a["shiftId"], "employee": a["employeeId"]} for a in res["assignments"]]
FIXTURE.write_text(json.dumps(fx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(len(fx["demoRota"]), "assignments;", res["summary"], [i["message"] for i in res["issues"]])
