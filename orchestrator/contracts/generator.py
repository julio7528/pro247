from __future__ import annotations

import hashlib
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

from .assessment import ContractAssessmentManager
from .registry import ContractError, ContractRegistry, contract_content_hash
from .validator import ContractValidator


class ContractGenerator:
    def __init__(self, root: str | Path, workflow: dict[str, Any], registry: ContractRegistry,
                 validator: ContractValidator, assessment: ContractAssessmentManager,
                 specification_resolver: Any, approvals: Any, state: Any):
        self.root = Path(root).resolve()
        self.workflow = workflow
        self.registry = registry
        self.validator = validator
        self.assessment = assessment
        self.specification_resolver = specification_resolver
        self.approvals = approvals
        self.state = state

    def generate(self, task_path: str | Path) -> dict[str, Any]:
        task_file = self.registry.safe_path(task_path)
        if not task_file.is_file():
            raise ValueError(f"Arquivo de tarefa não encontrado: {task_file}")
        try:
            task = yaml.safe_load(task_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            raise ValueError(f"Não foi possível ler tarefa {task_file}: {exc}") from exc
        task_errors = self.validator.validate_planned_task(task)
        if task_errors:
            raise ValueError("Tarefa não permite gerar contrato: " + "; ".join(task_errors))
        # A solution-design revision must be generated before the invalidated Planning gate can be reviewed again.
        # Runtime resolution continues to require that gate; only generation may inspect the refreshed assessment first.
        current_assessment, assessment_blockers = self.assessment.current(require_stage_gate=False)
        if assessment_blockers or not current_assessment:
            raise ValueError("Avaliação de contratos ausente ou desatualizada: " + ", ".join(assessment_blockers))
        task_assessment = next((item for item in current_assessment["tasks"] if item["task_id"] == task["task_id"]), None)
        if task_assessment is None:
            raise ValueError(f"Tech Lead ainda não avaliou a tarefa {task['task_id']}")
        if not task_assessment["contract_required"]:
            raise ValueError(f"A avaliação do Tech Lead determinou que {task['task_id']} não exige contrato de produto")

        spec = self.specification_resolver.active_specification()
        if not spec or not self.approvals.has_approved_product_specification():
            raise ValueError("Contrato de produto exige uma especificação de origem aprovada e atual")
        reference = f"{spec.spec_id}@{spec.version}"
        if task["originating_spec_reference"] != reference or task_assessment["task_hash"] != hashlib.sha256(task_file.read_bytes()).hexdigest():
            raise ValueError("Tarefa mudou ou não referencia a especificação aprovada atual; atualize e reaprove a avaliação")
        requirement_ids = task["requirement_ids"]
        if not requirement_ids:
            raise ValueError("Tarefa de produto deve apontar pelo menos um requisito confirmado antes de gerar contrato")
        spec_text = spec.path.read_text(encoding="utf-8")
        absent = [item for item in requirement_ids if not re.search(rf"\b{re.escape(item)}\b", spec_text)]
        if absent:
            raise ValueError("Requisitos não encontrados na especificação aprovada: " + ", ".join(absent))

        contract_inputs = deepcopy(task.get("contract", {}))
        contract_type = contract_inputs.get("type", "product_task")
        if contract_type not in {"product_task", "product_interface"}:
            raise ValueError("Tipo de contrato de produto inválido na tarefa")
        raw_inputs = contract_inputs.get("required_inputs", [])
        raw_outputs = contract_inputs.get("expected_outputs", [])
        raw_dependencies = contract_inputs.get("dependencies", [])
        raw_rules = contract_inputs.get("validation_rules", [])
        required_inputs = self._valid_records(raw_inputs, {"name", "path", "required", "schema", "schema_path"})
        expected_outputs = self._valid_records(raw_outputs, {"name", "path", "required", "format", "schema", "schema_path"})
        preconditions = contract_inputs.get("preconditions", [])
        postconditions = contract_inputs.get("postconditions", [])
        invariants = contract_inputs.get("invariants", [])
        allowed_paths = contract_inputs.get("allowed_paths", [])
        operations = contract_inputs.get("operations", [])
        dependencies = self._valid_records(raw_dependencies, {"kind", "id", "version"})
        validation_rules = self._valid_records(raw_rules, {"id", "kind", "description", "target", "schema", "schema_path"})
        missing_fields = []
        for field, raw, cleaned in (
            ("contract.required_inputs", raw_inputs, required_inputs),
            ("contract.expected_outputs", raw_outputs, expected_outputs),
            ("contract.dependencies", raw_dependencies, dependencies),
            ("contract.validation_rules", raw_rules, validation_rules),
        ):
            if isinstance(raw, list) and len(raw) != len(cleaned):
                missing_fields.append(f"{field}[invalid-item]")
        for field, value in (
            ("contract.required_inputs", required_inputs),
            ("contract.expected_outputs", expected_outputs),
            ("contract.preconditions", preconditions),
            ("contract.postconditions", postconditions),
            ("contract.invariants", invariants),
            ("contract.allowed_paths", allowed_paths),
            ("contract.operations", operations),
            ("contract.validation_rules", validation_rules),
        ):
            if not value:
                missing_fields.append(field)
        existing = self._existing_for_task(task["task_id"], contract_type)
        if existing:
            contract_id = existing["contract_id"]
            version = existing["version"]
        else:
            contract_id = self.registry.next_id()
            version = "0.1.0"
        document = {
            "schema_version": 1,
            "contract_id": contract_id,
            "version": version,
            "contract_type": contract_type,
            "title": f"{task['title']} — contract",
            "originating_spec_reference": reference,
            "originating_spec_hash": spec.substantive_hash,
            "requirement_ids": requirement_ids,
            "task_ids": [task["task_id"]],
            "responsible_agent": task["responsible_agent"],
            "required_inputs": required_inputs,
            "expected_outputs": expected_outputs,
            "preconditions": preconditions,
            "postconditions": postconditions,
            "invariants": invariants,
            "allowed_scope": {
                "summary": task["scope"],
                "paths": allowed_paths,
                "operations": operations,
            },
            "dependencies": dependencies,
            "validation_rules": validation_rules,
            "approval_required": True,
            "lifecycle_state": "DRAFT",
            "missing_fields": missing_fields,
            "content_hash": "",
            "approval_metadata": {},
        }
        document["content_hash"] = contract_content_hash(document)
        if existing and existing["content_hash"] == document["content_hash"]:
            return {**existing, "validation": self.validator.validate_document(existing, path=existing["_path"]),
                    "created": False}
        if existing:
            document["version"] = self._bump_patch(existing["version"])
            document["content_hash"] = contract_content_hash(document)
        path, digest = self.registry.write(document)
        saved, _ = self.registry.read_document(path)
        validation = self.validator.validate_document(saved, path=path)
        self.state.record_contract_validation(
            workflow_id=self.workflow["workflow_id"], contract_id=contract_id, version=document["version"],
            content_hash=digest, validation_type="draft-generation", status="PASSED" if validation["schema_valid"] and validation["semantic_valid"] else "FAILED",
            details=validation,
        )
        self.state.record_event(self.workflow["workflow_id"], "PRODUCT_CONTRACT_DRAFT_GENERATED",
                                stage_id="planning", artifact_id=contract_id,
                                details={"version": document["version"], "content_hash": digest,
                                         "spec_reference": reference, "task_id": task["task_id"],
                                         "requirement_ids": requirement_ids, "missing_fields": missing_fields})
        return {**saved, "_path": path, "validation": validation, "created": True}

    @staticmethod
    def _valid_records(values: Any, allowed_keys: set[str]) -> list[dict[str, Any]]:
        if not isinstance(values, list):
            return []
        valid = []
        required_keys = ({"kind", "id"} if {"kind", "id", "version"}.issuperset(allowed_keys) else
                         {"id", "kind", "description"} if "description" in allowed_keys else
                         {"name", "path", "required", "format"} if "format" in allowed_keys else
                         {"name", "path", "required"})
        for item in values:
            if not isinstance(item, dict) or not set(item).issubset(allowed_keys) or not required_keys.issubset(item):
                continue
            valid.append(item)
        return valid

    def _existing_for_task(self, task_id: str, contract_type: str) -> dict[str, Any] | None:
        matches = [item for item in self.registry.load_all()
                   if item.get("contract_type") == contract_type and task_id in item.get("task_ids", [])]
        if not matches:
            return None
        return max(matches, key=lambda item: ContractRegistry._version_key(item["version"]))

    @staticmethod
    def _bump_patch(version: str) -> str:
        match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
        if not match:
            raise ContractError(f"Versão de contrato inválida: {version}")
        return f"{match.group(1)}.{match.group(2)}.{int(match.group(3)) + 1}"
