from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class ResolutionStatus(StrEnum):
    MISSING = "MISSING"
    DRAFT = "DRAFT"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    READY = "READY"
    BLOCKED = "BLOCKED"


class ExecutionStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


@dataclass(frozen=True)
class Specification:
    spec_id: str
    version: str
    status: str
    path: Path
    content_hash: str
    substantive_hash: str
    complete: bool
    missing_fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class Evaluation:
    stage_id: str
    status: ResolutionStatus
    reason: str
    missing_information: tuple[str, ...] = ()
    blocked_by: tuple[str, ...] = ()
    specification: Specification | None = None
    agents: tuple[str, ...] = ()
    skill: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["status"] = self.status.value
        if self.specification:
            result["specification"]["path"] = str(self.specification.path)
        return result


@dataclass(frozen=True)
class ClarificationQuestion:
    field: str
    prompt: str


@dataclass(frozen=True)
class ExecutionResult:
    status: ExecutionStatus
    run_id: str
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    error: str | None = None
    dry_run: bool = False


@dataclass(frozen=True)
class WorkflowStage:
    id: str
    order: int
    name: str
    status: str
    agents: tuple[str, ...]
    skill: str
    inputs: tuple[Any, ...] = field(default_factory=tuple)
    deliverables: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    depends_on: tuple[str, ...] = field(default_factory=tuple)
    approval_gate: dict[str, Any] = field(default_factory=dict)
