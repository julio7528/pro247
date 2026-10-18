from __future__ import annotations

from typing import Any

from .state_manager import StateManager
from ..governance.approval_manager import ApprovalManager


class DependencyValidator:
    def __init__(self, workflow: dict[str, Any], state: StateManager, approvals: ApprovalManager,
                 contracts: Any | None = None):
        self.workflow = workflow
        self.state = state
        self.approvals = approvals
        self.contracts = contracts

    def blockers(self, stage_id: str, task_id: str | None = None) -> tuple[str, ...]:
        stage_map = {item["id"]: item for item in self.workflow["stages"]}
        stage = stage_map.get(stage_id)
        if stage is None:
            return ("unknown-stage",)
        status_map = self.state.stage_statuses(self.workflow["workflow_id"])
        blockers: list[str] = []
        for dependency in stage["depends_on"]:
            if dependency not in stage_map:
                blockers.append(f"unknown-dependency:{dependency}")
                continue
            current_status = status_map.get(dependency)
            if current_status != "COMPLETED":
                blockers.append(f"stage:{dependency}:{current_status or 'MISSING'}")
                continue
            if not self.approvals.has_current_stage_gate(dependency):
                blockers.append(f"approval-gate:{dependency}")
        if stage["order"] > 1 and not self.approvals.has_approved_product_specification():
            blockers.append("approved-originating-specification")
        if (stage_id == "deployment" and self.contracts is not None
                and self.state.current_stage_id(self.workflow["workflow_id"]) == stage_id
                and self.state.stage_status(self.workflow["workflow_id"], stage_id) == "IN_PROGRESS"):
            production_tasks = self.contracts.production_deployment_tasks()
            if task_id is None and production_tasks:
                blockers.append("production-deployment-task-id-required")
            elif task_id:
                task = self.contracts.planned_task(task_id)
                if task is None:
                    blockers.append(f"delivery-task-not-in-approved-plan:{task_id}")
                elif task.get("delivery_target") == "production":
                    scope = task.get("deployment_scope")
                    version = task.get("deployment_version")
                    if not scope or not version:
                        blockers.append("production-deployment-scope-or-version-missing-from-planned-task")
                    elif not self.state.has_deployment_authorization(
                            self.workflow["workflow_id"], scope=scope, version=version):
                        blockers.append("explicit-production-deployment-authorization")
        if self.contracts is not None and stage["order"] >= 4:
            contract_result = self.contracts.evaluate(stage_id, task_id)
            blockers.extend(contract_result["blockers"])
        return tuple(blockers)
