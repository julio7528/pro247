from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import yaml

from .assessment import ContractAssessmentManager
from .registry import ContractError, ContractRegistry
from .validator import ContractValidator


class ContractResolver:
    def __init__(self, root: str | Path, workflow: dict[str, Any], state: Any,
                 specification_resolver: Any, approvals: Any, registry: ContractRegistry,
                 validator: ContractValidator, assessment: ContractAssessmentManager):
        self.root = Path(root).resolve()
        self.workflow = workflow
        self.state = state
        self.specification_resolver = specification_resolver
        self.approvals = approvals
        self.registry = registry
        self.validator = validator
        self.assessment = assessment

    def evaluate(self, stage_id: str, task_id: str | None = None, *, check_inputs: bool = False) -> dict[str, Any]:
        stage = next((item for item in self.workflow["stages"] if item["id"] == stage_id), None)
        if stage is None:
            return self._result("BLOCKED", [f"unknown-stage:{stage_id}"])
        required: list[dict[str, Any]] = []
        optional: list[dict[str, Any]] = []
        blockers: list[str] = []

        operational_types = {"operational_task_execution", "operational_execution_result"}
        if task_id:
            operational_types.add("operational_agent_handoff")
        for contract in self.registry.load_all():
            if contract.get("contract_type") not in operational_types:
                continue
            result = self.validator.validate_document(contract, path=contract.get("_path"))
            if not result["schema_valid"] or not result["semantic_valid"]:
                blockers.append(f"invalid-operational-contract:{contract.get('contract_id')}")
            else:
                required.append(self._reference(contract))

        assessment_data: dict[str, Any] | None = None
        task_assessment: dict[str, Any] | None = None
        if stage["order"] >= 4:
            assessment_data, assessment_blockers = self.assessment.current()
            if assessment_blockers:
                blockers.extend(assessment_blockers)
            elif assessment_data:
                required_task_ids = [item["task_id"] for item in assessment_data["tasks"] if item["contract_required"]]
                if task_id is None:
                    if required_task_ids:
                        blockers.append("task-id-required-for-contract-dependent-execution")
                else:
                    task_assessment = next((item for item in assessment_data["tasks"] if item["task_id"] == task_id), None)
                    if task_assessment is None and assessment_data["assessment"] == "NO_PRODUCT_CONTRACTS_REQUIRED" and not assessment_data["tasks"]:
                        task_assessment = {"task_id": task_id, "contract_required": False}
                    elif task_assessment is None:
                        blockers.append(f"task-not-assessed:{task_id}")
                    elif task_assessment["contract_required"]:
                        task_contracts = [item for item in self.registry.load_all()
                                          if item.get("contract_type") in {"product_task", "product_interface"}
                                          and task_id in item.get("task_ids", [])]
                        if not task_contracts:
                            blockers.append(f"required-contract-missing:{task_id}")
                        else:
                            current = max(task_contracts, key=lambda item: ContractRegistry._version_key(item["version"]))
                            result = self.validator.validate_document(current, path=current.get("_path"),
                                                                      require_approval=True, check_inputs=check_inputs)
                            self.state.record_contract_validation(
                                workflow_id=self.workflow["workflow_id"], contract_id=current["contract_id"],
                                version=current["version"], content_hash=current["content_hash"],
                                validation_type="task-resolution",
                                status="PASSED" if result["ready"] else "FAILED", details=result,
                            )
                            if not result["ready"]:
                                blockers.extend(f"{item['code']}:{current.get('contract_id')}:{item['message']}"
                                                for item in result["issues"])
                            consistency = self._task_consistency(current, task_assessment)
                            blockers.extend(consistency)
                            persisted = self.state.contract_record(
                                self.workflow["workflow_id"], current["contract_id"], current["version"])
                            if not persisted or persisted["content_hash"] != current["content_hash"]:
                                blockers.append(f"contract-not-persisted-or-changed:{current['contract_id']}")
                            for dependency in current.get("dependencies", []):
                                if dependency.get("kind") == "task":
                                    if self.state.task_status(self.workflow["workflow_id"], dependency["id"]) != "COMPLETED":
                                        blockers.append(f"contract-task-dependency-not-completed:{dependency['id']}")
                                elif dependency.get("kind") == "contract":
                                    try:
                                        upstream = self.registry.get(dependency["id"], dependency.get("version"))
                                        upstream_result = self.validator.validate_document(
                                            upstream, path=upstream.get("_path"), require_approval=True,
                                        )
                                        if not upstream_result["ready"]:
                                            blockers.append(f"contract-dependency-invalid:{dependency['id']}")
                                    except (ContractError, KeyError) as exc:
                                        blockers.append(f"contract-dependency-missing:{dependency.get('id')}:{exc}")
                            required.append(self._reference(current))
                    else:
                        optional.extend(self._reference(item) for item in self.registry.load_all()
                                        if item.get("contract_type") in {"product_task", "product_interface"}
                                        and task_id in item.get("task_ids", []))

        fingerprint = self.fingerprint(required)
        if blockers:
            status = "BLOCKED"
        elif task_assessment and not task_assessment["contract_required"]:
            status = "NO_PRODUCT_CONTRACT_REQUIRED"
        else:
            status = "READY"
        return {
            "stage_id": stage_id,
            "task_id": task_id,
            "status": status,
            "blockers": sorted(set(blockers)),
            "required_contracts": required,
            "optional_contracts": optional,
            "contract_fingerprint": fingerprint,
            "assessment": assessment_data.get("assessment") if assessment_data else None,
        }

    def for_handoff(self) -> list[dict[str, Any]]:
        refs = []
        for contract in self.registry.load_all():
            if contract.get("contract_type") != "operational_agent_handoff":
                continue
            validation = self.validator.validate_document(contract, path=contract.get("_path"))
            if not validation["ready"]:
                raise ValueError(f"Contrato operacional de handoff inválido: {contract['contract_id']}")
            refs.append(self._reference(contract))
        return refs

    def planned_task(self, task_id: str) -> dict[str, Any] | None:
        """Return the approved Planning task document for a task ID, if present."""
        assessment, blockers = self.assessment.current()
        if blockers or not assessment:
            return None
        item = next((row for row in assessment["tasks"] if row["task_id"] == task_id), None)
        if not item:
            return None
        try:
            path = self.registry.safe_path(item["path"])
            task = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (ContractError, OSError, UnicodeError, yaml.YAMLError):
            return None
        return task if isinstance(task, dict) and task.get("task_id") == task_id else None

    def production_deployment_tasks(self) -> list[dict[str, Any]]:
        assessment, blockers = self.assessment.current()
        if blockers or not assessment:
            return []
        tasks = []
        for item in assessment["tasks"]:
            task = self.planned_task(item["task_id"])
            if task and task.get("delivery_target") == "production":
                tasks.append(task)
        return tasks

    @staticmethod
    def _reference(document: dict[str, Any]) -> dict[str, str]:
        return {"contract_id": document["contract_id"], "version": document["version"],
                "content_hash": document["content_hash"]}

    @staticmethod
    def fingerprint(references: list[dict[str, Any]]) -> str:
        canonical = sorted((item["contract_id"], item["version"], item["content_hash"]) for item in references)
        return hashlib.sha256(repr(canonical).encode("utf-8")).hexdigest()

    def _task_consistency(self, contract: dict[str, Any], assessment_item: dict[str, Any]) -> list[str]:
        blockers: list[str] = []
        try:
            task_path = self.registry.safe_path(assessment_item["path"])
            task = yaml.safe_load(task_path.read_text(encoding="utf-8"))
        except (ContractError, OSError, UnicodeError, yaml.YAMLError) as exc:
            return [f"contract-task-artifact-invalid:{assessment_item['task_id']}:{exc}"]
        if assessment_item["task_id"] not in contract.get("task_ids", []):
            blockers.append(f"contract-task-id-mismatch:{contract['contract_id']}:{assessment_item['task_id']}")
        if not set(contract.get("requirement_ids", [])).issubset(set(task.get("requirement_ids", []))):
            blockers.append(f"contract-requirement-scope-mismatch:{contract['contract_id']}")
        if contract.get("allowed_scope", {}).get("summary") != task.get("scope"):
            blockers.append(f"contract-scope-mismatch:{contract['contract_id']}")
        declared = task.get("contract", {})
        declared_paths = set(declared.get("allowed_paths", []))
        contract_paths = set(contract.get("allowed_scope", {}).get("paths", []))
        if declared_paths != contract_paths:
            blockers.append(f"contract-path-scope-mismatch:{contract['contract_id']}")
        if set(declared.get("operations", [])) != set(contract.get("allowed_scope", {}).get("operations", [])):
            blockers.append(f"contract-operation-scope-mismatch:{contract['contract_id']}")
        for field in ("required_inputs", "expected_outputs", "preconditions", "postconditions", "invariants",
                      "dependencies", "validation_rules"):
            if declared.get(field, []) != contract.get(field, []):
                blockers.append(f"contract-task-{field}-mismatch:{contract['contract_id']}")
        declared_type = declared.get("type", "product_task")
        if declared_type != contract.get("contract_type"):
            blockers.append(f"contract-task-type-mismatch:{contract['contract_id']}")
        return blockers
