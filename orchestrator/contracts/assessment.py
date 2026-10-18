from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .registry import ContractError, ContractRegistry
from .validator import ContractValidator


class ContractAssessmentManager:
    ARTIFACT_ID = "contract-assessment"
    RELATIVE_PATH = Path("plans/contract-assessment.yaml")

    def __init__(self, root: str | Path, workflow: dict[str, Any], state: Any,
                 specification_resolver: Any, approvals: Any, registry: ContractRegistry,
                 validator: ContractValidator):
        self.root = Path(root).resolve()
        self.workflow = workflow
        self.state = state
        self.specification_resolver = specification_resolver
        self.approvals = approvals
        self.registry = registry
        self.validator = validator
        self.schema_path = self.root / "contracts" / "schemas" / "contract-assessment.schema.json"

    @property
    def path(self) -> Path:
        spec = self.specification_resolver.active_specification()
        if spec:
            return self.root / "plans" / "increments" / spec.spec_id / "contract-assessment.yaml"
        return self.root / self.RELATIVE_PATH

    def assess(self, *, justification: str, task_paths: list[str | Path] | None = None,
               contract_task_ids: list[str] | None = None) -> dict[str, Any]:
        if not justification.strip() or len(justification.strip()) < 10:
            raise ValueError("A avaliação do Tech Lead exige justificativa específica com pelo menos 10 caracteres")
        workflow_id = self.workflow["workflow_id"]
        current_stage = self.state.current_stage_id(workflow_id)
        if current_stage not in {"planning", "ux-ui-design"}:
            raise ValueError("A avaliação inicial ocorre em Planning; revisões explícitas também podem ocorrer no desenho da solução")
        if self.state.stage_status(workflow_id, current_stage) != "IN_PROGRESS":
            raise ValueError(f"Inicie explicitamente {current_stage} antes de registrar a avaliação de contratos")
        spec = self.specification_resolver.active_specification()
        if not spec or not self.approvals.has_approved_product_specification():
            raise ValueError("A avaliação exige uma especificação de origem aprovada e atual")

        required_ids = set(contract_task_ids or [])
        tasks: list[dict[str, Any]] = []
        seen: set[str] = set()
        for task_path in task_paths or []:
            resolved = self.registry.safe_path(task_path)
            if not resolved.is_file():
                raise ValueError(f"Arquivo de tarefa não encontrado: {resolved}")
            try:
                task = yaml.safe_load(resolved.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, yaml.YAMLError) as exc:
                raise ValueError(f"Não foi possível ler a tarefa {resolved}: {exc}") from exc
            errors = self.validator.validate_planned_task(task)
            if errors:
                raise ValueError("Tarefa de planejamento inválida: " + "; ".join(errors))
            task_id = task["task_id"]
            if task_id in seen:
                raise ValueError(f"Tarefa repetida na avaliação: {task_id}")
            seen.add(task_id)
            if task["originating_spec_reference"] != f"{spec.spec_id}@{spec.version}":
                raise ValueError(f"Tarefa {task_id} não referencia a especificação aprovada ativa")
            missing_requirements = [item for item in task["requirement_ids"]
                                    if item not in spec.path.read_text(encoding="utf-8")]
            if missing_requirements:
                raise ValueError(f"Tarefa {task_id} aponta requisitos ausentes: {', '.join(missing_requirements)}")
            tasks.append({
                "task_id": task_id,
                "path": resolved.relative_to(self.root).as_posix(),
                "task_hash": hashlib.sha256(resolved.read_bytes()).hexdigest(),
                "requirement_ids": task["requirement_ids"],
                "contract_required": task_id in required_ids,
                "justification": justification.strip(),
            })
        unknown_required = required_ids - seen
        if unknown_required:
            raise ValueError("Tarefas marcadas como dependentes de contrato não foram incluídas: " + ", ".join(sorted(unknown_required)))
        if required_ids and not tasks:
            raise ValueError("Inclua os artefatos de tarefa antes de exigir contratos de produto")

        assessment = {
            "schema_version": 1,
            "workflow_id": workflow_id,
            "spec_reference": f"{spec.spec_id}@{spec.version}",
            "spec_hash": spec.substantive_hash,
            "assessment": "PRODUCT_CONTRACTS_REQUIRED" if required_ids else "NO_PRODUCT_CONTRACTS_REQUIRED",
            "justification": justification.strip(),
            "assessed_by": "tech_lead",
            "tasks": tasks,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        schema_errors = self.validator.validate_schema(assessment, self.schema_path)
        if schema_errors:
            raise ValueError("Avaliação de contratos inválida: " + "; ".join(schema_errors))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(yaml.safe_dump(assessment, allow_unicode=True, sort_keys=False, width=100),
                             encoding="utf-8", newline="\n")
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        task_ids = [item["task_id"] for item in tasks]
        requirement_ids = sorted({requirement for task in tasks for requirement in task["requirement_ids"]})
        self.state.record_contract_assessment(
            workflow_id=workflow_id, spec_reference=assessment["spec_reference"], spec_hash=spec.substantive_hash,
            assessment=assessment["assessment"], path=self.path, content_hash=digest, task_ids=task_ids,
        )
        self.state.record_artifact(
            workflow_id=workflow_id, stage_id="planning", artifact_id=self.ARTIFACT_ID, artifact_version="1",
            path=self.path, spec_reference=assessment["spec_reference"], validation_status="PASSED",
            requirement_ids=requirement_ids, task_ids=task_ids,
            validation_summary="Tech Lead contract assessment schema and approved-origin traceability passed.",
        )
        self.state.record_event(workflow_id, "CONTRACT_ASSESSMENT_RECORDED", stage_id=current_stage,
                                artifact_id=self.ARTIFACT_ID,
                                details={"spec_reference": assessment["spec_reference"], "spec_hash": spec.substantive_hash,
                                         "assessment": assessment["assessment"], "task_ids": task_ids,
                                         "content_hash": digest,
                                         "assessment_kind": "design-revision" if current_stage == "ux-ui-design" else "planning"})
        return {**assessment, "path": str(self.path), "content_hash": digest}

    def current(self, *, require_stage_gate: bool = True) -> tuple[dict[str, Any] | None, list[str]]:
        if not self.path.is_file():
            return None, ["contract-assessment-missing"]
        try:
            assessment = yaml.safe_load(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            return None, [f"contract-assessment-invalid:{exc}"]
        errors = self.validator.validate_schema(assessment, self.schema_path)
        if errors:
            return None, ["contract-assessment-schema-invalid", *errors]
        has_required_tasks = any(item["contract_required"] for item in assessment["tasks"])
        expected_assessment = "PRODUCT_CONTRACTS_REQUIRED" if has_required_tasks else "NO_PRODUCT_CONTRACTS_REQUIRED"
        if assessment["assessment"] != expected_assessment:
            return assessment, ["contract-assessment-decision-task-mismatch"]
        try:
            spec = self.specification_resolver.active_specification()
        except ValueError as exc:
            return assessment, [f"contract-assessment-specification-unavailable:{exc}"]
        blockers: list[str] = []
        if not spec or assessment["spec_reference"] != f"{spec.spec_id}@{spec.version}":
            blockers.append("contract-assessment-spec-reference-stale")
        elif assessment["spec_hash"] != spec.substantive_hash:
            blockers.append("contract-assessment-spec-hash-stale")
        elif not self.approvals.has_approved_product_specification():
            blockers.append("contract-assessment-source-spec-not-approved")
        for task in assessment["tasks"]:
            try:
                task_path = self.registry.safe_path(task["path"])
            except ContractError:
                blockers.append(f"contract-assessment-task-path-unsafe:{task['task_id']}")
                continue
            if not task_path.is_file() or hashlib.sha256(task_path.read_bytes()).hexdigest() != task["task_hash"]:
                blockers.append(f"contract-assessment-task-changed:{task['task_id']}")
        stored = self.state.latest_contract_assessment(self.workflow["workflow_id"])
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        if (not stored or stored["content_hash"] != digest or stored["spec_hash"] != assessment["spec_hash"]
                or stored["spec_reference"] != assessment["spec_reference"]):
            blockers.append("contract-assessment-not-persisted-or-changed")
        if require_stage_gate and not self.approvals.has_current_stage_gate("planning") and self.state.stage_status(self.workflow["workflow_id"], "planning") in {"COMPLETED", "WAITING_FOR_USER"}:
            blockers.append("contract-assessment-planning-gate-not-approved")
        return assessment, blockers

    def task_assessment(self, task_id: str) -> dict[str, Any] | None:
        assessment, blockers = self.current()
        if blockers or not assessment:
            return None
        return next((item for item in assessment["tasks"] if item["task_id"] == task_id), None)
