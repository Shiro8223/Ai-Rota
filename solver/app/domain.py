"""Problem model shared by the solver and check_rota.

Everything the web app sends is parsed and validated here, so the solver and the
checker only ever see shapes they understand.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_LABEL = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"}
WEEKEND = {"sat", "sun"}

# UK Working Time Regulations defaults
ADULT_REST_MIN = 11 * 60
YOUNG_REST_MIN = 12 * 60
YOUNG_MAX_WEEK_MIN = 40 * 60
YOUNG_MAX_SHIFT_MIN = 8 * 60
YOUNG_NIGHT_FROM = 22 * 60  # under-18s may not work 22:00-06:00
YOUNG_NIGHT_TO = 6 * 60
ADULT_WEEKLY_REST_MIN = 24 * 60  # one uninterrupted 24h break in the week
YOUNG_WEEKLY_REST_MIN = 48 * 60  # under-18s: 48h
OPT_OUT_LIMIT_MIN = 48 * 60  # over 48h needs a signed opt-out
ADULT_BREAK_AFTER_MIN = 6 * 60  # adults: 20-minute break if working more than 6 hours
ADULT_BREAK_MIN = 20
YOUNG_BREAK_AFTER_MIN = 4 * 60 + 30  # under-18s: 30-minute break if working more than 4.5 hours
YOUNG_BREAK_MIN = 30
CLOSE_FROM = 22 * 60  # a shift ending at/after 22:00 counts as a "close" for fairness


def hm(value: str) -> int:
    h, m = value.split(":")
    return int(h) * 60 + int(m)


# --------------------------------------------------------------------------- constraints

DaySel = Literal["*", "weekend", "weekday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class Filter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal["role", "tenureDays", "isUnder18", "contractedHours", "name"]
    op: Literal["eq", "neq", "lt", "lte", "gt", "gte"]
    value: Union[bool, float, int, str]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MaxCount(_Base):
    type: Literal["max_count"]
    shift: str = "*"
    day: DaySel = "*"
    filter: Filter | None = None
    max: int = Field(ge=0)
    hard: bool = True


class MinCount(_Base):
    type: Literal["min_count"]
    shift: str = "*"
    day: DaySel = "*"
    filter: Filter | None = None
    min: int = Field(ge=0)
    hard: bool = True


class NeverTogether(_Base):
    type: Literal["never_together"]
    employees: list[str] = Field(min_length=2, max_length=2)
    hard: bool = True


class Unavailable(_Base):
    type: Literal["unavailable"]
    employee: str
    shift: str = "*"
    day: DaySel = "*"
    hard: bool = True


class MaxHours(_Base):
    type: Literal["max_hours"]
    employee: str | None = None
    filter: Filter | None = None
    max: float = Field(ge=0)
    hard: bool = True


class MinRestHours(_Base):
    type: Literal["min_rest_hours"]
    employee: str | None = None
    filter: Filter | None = None
    hours: float = Field(ge=0, le=48)
    hard: bool = True


class Prefer(_Base):
    type: Literal["prefer"]
    employee: str | None = None
    filter: Filter | None = None
    shift: str = "*"
    day: DaySel = "*"
    avoid: bool = False
    weight: int = Field(default=3, ge=1, le=10)
    hard: Literal[False] = False


Constraint = Annotated[
    Union[MaxCount, MinCount, NeverTogether, Unavailable, MaxHours, MinRestHours, Prefer],
    Field(discriminator="type"),
]


class RuleIn(BaseModel):
    id: str
    summary: str = ""
    constraint: Constraint


# --------------------------------------------------------------------------- input payload


class Window(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str


class RequirementIn(BaseModel):
    role: str  # role name, e.g. "Back of House"
    min: int = Field(ge=1, le=50)


class TemplateIn(BaseModel):
    id: str
    name: str
    start: str
    end: str
    days: list[str]
    minStaff: int = Field(ge=0)
    maxStaff: int | None = None
    breakMinutes: int = Field(default=0, ge=0, le=180)  # unpaid, not working time
    requirements: list[RequirementIn] = []


class StoreIn(BaseModel):
    id: str | None = None
    name: str = ""
    openingHours: dict[str, dict | None] = {}
    shiftTemplates: list[TemplateIn]


class EmployeeIn(BaseModel):
    id: str
    name: str
    role: str = ""
    roles: list[str] = []
    startDate: date | None = None
    contractedHours: float = 0
    maxHoursPerWeek: float = 48
    isUnder18: bool = False
    optedOut48: bool = False  # signed 48-hour opt-out on file


class AssignmentIn(BaseModel):
    shiftId: str
    employeeId: str


class ExceptionIn(BaseModel):
    """A manager put someone on a shift outside their availability; they must agree."""
    shiftId: str
    employeeId: str
    status: Literal["pending", "agreed", "declined"]


class EdgeShiftIn(BaseModel):
    """A shift this person works elsewhere, in minutes from this week's Monday 00:00:
    before 0 = last week, 0..7 days = this week at another site, after = next week.
    Rest, weekly rest, daily and weekly hour limits and contracts all count them."""
    employeeId: str
    label: str
    start: int
    end: int
    minutes: int | None = None  # paid minutes; defaults to end - start


class ProblemIn(BaseModel):
    weekStart: date
    store: StoreIn
    employees: list[EmployeeIn]
    availability: dict[str, dict[str, list[Window]]] = {}
    rules: list[RuleIn] = []
    assignments: list[AssignmentIn] = []
    exceptions: list[ExceptionIn] = []
    edgeShifts: list[EdgeShiftIn] = []

    @field_validator("weekStart")
    @classmethod
    def monday(cls, v: date) -> date:
        if v.weekday() != 0:
            raise ValueError("weekStart must be a Monday")
        return v


# --------------------------------------------------------------------------- runtime model


@dataclass(frozen=True)
class Shift:
    id: str
    template_id: str
    name: str
    day: str
    day_index: int
    start: int  # minutes from Monday 00:00
    end: int
    min_staff: int
    max_staff: int
    break_min: int = 0
    reqs: tuple[tuple[str, int], ...] = ()

    @property
    def span(self) -> int:
        """Clock time from start to end, breaks included (used for rest and overlap)."""
        return self.end - self.start

    @property
    def minutes(self) -> int:
        """Working time: paid hours, contracts and legal hour limits use this."""
        return self.end - self.start - self.break_min

    @property
    def label(self) -> str:
        return f"{DAY_LABEL[self.day]} {self.name}"

    @property
    def is_close(self) -> bool:
        return self.end - self.day_index * 1440 >= CLOSE_FROM

    @property
    def is_weekend(self) -> bool:
        return self.day in WEEKEND

    def overlaps(self, other: "Shift") -> bool:
        return self.start < other.end and other.start < self.end


@dataclass(frozen=True)
class Emp:
    id: str
    name: str
    role: str
    roles: tuple[str, ...]
    tenure_days: int
    contracted_min: int
    max_min: int
    under18: bool
    opted_out: bool = False

    @property
    def first_name(self) -> str:
        return self.name.split(" ")[0]


class ProblemError(ValueError):
    pass


class Problem:
    def __init__(self, raw: dict):
        try:
            data = ProblemIn.model_validate(raw)
        except ValidationError as exc:  # surfaced as a 422 by the API
            raise ProblemError(str(exc)) from exc
        self.week_start = data.weekStart
        self.shifts: list[Shift] = []
        for t in data.store.shiftTemplates:
            s, e = hm(t.start), hm(t.end)
            if e <= s:
                e += 1440  # runs past midnight
            for day in t.days:
                if day not in DAYS:
                    raise ProblemError(f"unknown day {day!r} in template {t.id}")
                if day in data.store.openingHours and data.store.openingHours[day] is None:
                    continue  # store closed that day
                di = DAYS.index(day)
                self.shifts.append(
                    Shift(
                        id=f"{t.id}:{day}",
                        template_id=t.id,
                        name=t.name,
                        day=day,
                        day_index=di,
                        start=di * 1440 + s,
                        end=di * 1440 + e,
                        min_staff=t.minStaff,
                        max_staff=t.maxStaff if t.maxStaff is not None else max(t.minStaff, 1) + 2,
                        break_min=t.breakMinutes,
                        reqs=tuple((r.role, r.min) for r in t.requirements),
                    )
                )
        self.shifts.sort(key=lambda sh: (sh.start, sh.template_id))
        self.shift_by_id = {s.id: s for s in self.shifts}

        self.employees: list[Emp] = []
        for e in data.employees:
            tenure = (self.week_start - e.startDate).days if e.startDate else 10_000
            self.employees.append(
                Emp(
                    id=e.id,
                    name=e.name,
                    role=e.role,
                    roles=tuple(r.strip().lower() for r in (e.roles or [e.role]) if r.strip()),
                    tenure_days=tenure,
                    contracted_min=round(e.contractedHours * 60),
                    max_min=round(e.maxHoursPerWeek * 60),
                    under18=e.isUnder18,
                    opted_out=e.optedOut48,
                )
            )
        self.emp_by_id = {e.id: e for e in self.employees}

        self.availability: dict[str, dict[str, list[tuple[int, int, bool]]]] = {}
        for emp_id, days in data.availability.items():
            parsed: dict[str, list[tuple[int, int, bool]]] = {}
            for day, windows in days.items():
                out = []
                for w in windows:
                    f, t = hm(w.from_), hm(w.to)
                    whole_day = f == 0 and t >= 23 * 60 + 59
                    if t <= f and not whole_day:
                        t += 1440
                    out.append((f, t, whole_day))
                parsed[day] = out
            self.availability[emp_id] = parsed

        self.rules = data.rules
        for r in self.rules:
            for ref in _employee_refs(r.constraint):
                if ref not in self.emp_by_id:
                    raise ProblemError(f"rule {r.id} references unknown employee {ref}")
        self.assignments = [(a.shiftId, a.employeeId) for a in data.assignments]
        self.exceptions = {(x.shiftId, x.employeeId): x.status for x in data.exceptions}
        # Neighbouring weeks' shifts per person, for rest across Sunday -> Monday.
        self.edge: dict[str, list[EdgeShiftIn]] = {}
        for x in data.edgeShifts:
            self.edge.setdefault(x.employeeId, []).append(x)

    def fixed(self, e: Emp) -> list[EdgeShiftIn]:
        """Shifts this week at other sites (already committed)."""
        return [x for x in self.edge.get(e.id, []) if 0 <= x.start < 7 * 1440]

    def fixed_minutes(self, e: Emp) -> int:
        return sum(x.minutes if x.minutes is not None else x.end - x.start for x in self.fixed(e))

    def fixed_days(self, e: Emp) -> set[int]:
        return {x.start // 1440 for x in self.fixed(e)}

    def clash_with_edges(self, e: Emp, s: Shift) -> str | None:
        """Why this shift can't be added given shifts elsewhere (other site / other week), or None."""
        need = self.rest_min(e)
        for x in self.edge.get(e.id, []):
            if x.start // 1440 == s.day_index and 0 <= x.start < 7 * 1440:
                return f"already working {x.label} that day"
            if s.start < x.end and x.start < s.end:
                return f"overlaps {x.label}"
            gap = s.start - x.end if x.end <= s.start else x.start - s.end
            if gap < need:
                return f"only {gap / 60:g}h rest next to {x.label}"
        return None

    def prev_end(self, e: Emp) -> EdgeShiftIn | None:
        before = [x for x in self.edge.get(e.id, []) if x.start < 0]
        return max(before, key=lambda x: x.end) if before else None

    def next_start(self, e: Emp) -> EdgeShiftIn | None:
        after = [x for x in self.edge.get(e.id, []) if x.start >= 7 * 1440]
        return min(after, key=lambda x: x.start) if after else None

    def has_role(self, e: Emp, role: str) -> bool:
        return role.strip().lower() in e.roles

    @staticmethod
    def break_needed(minutes_working: int, young: bool) -> int:
        if young:
            return YOUNG_BREAK_MIN if minutes_working > YOUNG_BREAK_AFTER_MIN else 0
        return ADULT_BREAK_MIN if minutes_working > ADULT_BREAK_AFTER_MIN else 0

    # ---------------------------------------------------------------- eligibility

    def available(self, e: Emp, s: Shift) -> bool:
        windows = self.availability.get(e.id, {}).get(s.day, [])
        rel_s = s.start - s.day_index * 1440
        rel_e = s.end - s.day_index * 1440
        return any(whole or (f <= rel_s and t >= rel_e) for f, t, whole in windows)

    def young_ok(self, e: Emp, s: Shift) -> str | None:
        """Return a reason if the shift breaks under-18 limits, else None."""
        if not e.under18:
            return None
        if s.minutes > YOUNG_MAX_SHIFT_MIN:
            return f"{e.first_name} is under 18 and can't work more than 8 hours in a day"
        rel_s = s.start - s.day_index * 1440
        rel_e = s.end - s.day_index * 1440
        if rel_s < YOUNG_NIGHT_TO or rel_e > YOUNG_NIGHT_FROM:
            return f"{e.first_name} is under 18 and can't work between 22:00 and 06:00"
        if s.break_min < self.break_needed(s.minutes, True):
            return f"{e.first_name} is under 18 and needs a 30-minute break on shifts over 4.5 hours ({s.name} has {s.break_min} min)"
        return None

    def base_rest_min(self, e: Emp) -> int:
        return YOUNG_REST_MIN if e.under18 else ADULT_REST_MIN

    def weekly_rest_min(self, e: Emp) -> int:
        return YOUNG_WEEKLY_REST_MIN if e.under18 else ADULT_WEEKLY_REST_MIN

    def max_week_min(self, e: Emp) -> int:
        return min(e.max_min, YOUNG_MAX_WEEK_MIN) if e.under18 else e.max_min

    # ---------------------------------------------------------------- rule matching

    @staticmethod
    def matches(e: Emp, flt: Filter | None) -> bool:
        if flt is None:
            return True
        actual: object
        if flt.field == "role":
            # People hold several roles: "eq" = has the role, "neq" = doesn't.
            has = str(flt.value).strip().lower() in e.roles
            return has if flt.op == "eq" else (not has) if flt.op == "neq" else False
        elif flt.field == "name":
            actual = e.name.strip().lower()
        elif flt.field == "tenureDays":
            actual = e.tenure_days
        elif flt.field == "isUnder18":
            actual = e.under18
        else:
            actual = e.contracted_min / 60
        value = flt.value
        if isinstance(actual, str):
            value = str(value).strip().lower()
        elif isinstance(actual, bool):
            value = value if isinstance(value, bool) else str(value).lower() in ("true", "1", "yes")
        else:
            try:
                value = float(value)
            except (TypeError, ValueError):
                return False
        ops = {
            "eq": lambda a, b: a == b,
            "neq": lambda a, b: a != b,
            "lt": lambda a, b: a < b,
            "lte": lambda a, b: a <= b,
            "gt": lambda a, b: a > b,
            "gte": lambda a, b: a >= b,
        }
        try:
            return bool(ops[flt.op](actual, value))
        except TypeError:
            return False

    @staticmethod
    def shift_matches(s: Shift, shift_sel: str, day_sel: str) -> bool:
        if shift_sel not in ("*", s.template_id):
            return False
        if day_sel == "*":
            return True
        if day_sel == "weekend":
            return s.is_weekend
        if day_sel == "weekday":
            return not s.is_weekend
        return s.day == day_sel

    def who(self, employee: str | None, flt: Filter | None) -> list[Emp]:
        if employee:
            return [self.emp_by_id[employee]]
        return [e for e in self.employees if self.matches(e, flt)]

    def rest_min(self, e: Emp, hard_only: bool = True) -> int:
        need = self.base_rest_min(e)
        for r in self.rules:
            c = r.constraint
            if isinstance(c, MinRestHours) and (c.hard or not hard_only):
                if e in self.who(c.employee, c.filter):
                    need = max(need, round(c.hours * 60))
        return need

    def rule_label(self, r: RuleIn) -> str:
        return r.summary or r.constraint.type.replace("_", " ")


def _employee_refs(c) -> list[str]:
    if isinstance(c, NeverTogether):
        return list(c.employees)
    if isinstance(c, Unavailable):
        return [c.employee]
    if isinstance(c, (MaxHours, MinRestHours, Prefer)) and c.employee:
        return [c.employee]
    return []
