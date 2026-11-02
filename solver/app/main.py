"""Solver HTTP service. The web app calls POST /solve and POST /check."""

from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException

from .check import check_rota, summarise
from .domain import Problem, ProblemError
from .solve import solve

app = FastAPI(title="AI Rota Agent solver", version="0.1.0")
API_KEY = os.environ.get("SOLVER_API_KEY", "")
TIME_LIMIT = float(os.environ.get("SOLVER_TIME_LIMIT", "10"))


def _auth(key: str | None) -> None:
    if API_KEY and key != API_KEY:
        raise HTTPException(status_code=401, detail="bad solver key")


def _problem(body: dict) -> Problem:
    try:
        return Problem(body)
    except ProblemError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/solve")
def solve_route(body: dict, x_solver_key: str | None = Header(default=None)) -> dict:
    _auth(x_solver_key)
    return solve(_problem(body), TIME_LIMIT)


@app.post("/check")
def check_route(body: dict, x_solver_key: str | None = Header(default=None)) -> dict:
    _auth(x_solver_key)
    p = _problem(body)
    issues = check_rota(p)
    return {"issues": issues, "summary": summarise(issues)}
