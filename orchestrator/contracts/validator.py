from __future__ import annotations

import json
import re
from pathlib import Path, PureWindowsPath
from typing import Any

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from .registry import ContractError, ContractRegistry, contract_content_hash


class ContractValidator:
    def __init__(self, root: str | Path, registry: ContractRegistry, state: Any,
                 specification_resolver: Any, approvals: Any):
        self.root = Path(root).resolve()
        self.registry = registry
        self.state = state
        self.specification_resolver = specification_resolver
        self.approvals = approvals
        self.schema_root = self.root / "contracts" / "schemas"

    def validate_document(self, document: dict[str, Any], *, path: str | Path | None = None,
                          require_approval: bool = False, check_inputs: bool = False) -> dict[str, Any]:
        issues: list[dict[str, str]] = []
        contract_path = Path(path).resolve() if path else None
        schema_document = dict(document)
        schema_document.pop("_path", None)
        schema_valid = self._schema_issues(schema_document, self.schema_root / "task-contract.schema.json", issues)
        semantic_valid = True
        expected_hash = contract_content_hash(document)
        if document.get("content_hash") != expected_hash:
            semantic_valid = False
            issues.append({"code": "CONTENT_HASH_MISMATCH", "message": "content_hash não corresponde ao conteúdo sem metadados mutáveis."})
        persisted = self.state.contract_record(
            self.approvals.workflow["workflow_id"], document.get("contract_id", ""), document.get("version", ""),
        )
        if not persisted or persisted["content_hash"] != document.get("content_hash"):
            semantic_valid = False
            issues.append({"code": "CONTRACT_STATE_MISMATCH", "message": "Contrato não está registrado no SQLite com o hash atual."})

        contract_type = document.get("contract_type")
        product = contract_type in {"product_task", "product_interface"}
        if product:
            if not self._current_specification_matches(document, issues):
                semantic_valid = False
            if not self._requirement_traceability(document, issues):
                semantic_valid = False
            if contract_path and not contract_path.is_relative_to((self.root / "contracts" / "generated").resolve()):
                semantic_valid = False
                issues.append({"code": "PRODUCT_CONTRACT_LOCATION", "message": "Contrato de produto deve estar em contracts/generated/."})
        elif contract_type in {"operational_task_execution", "operational_execution_result", "operational_agent_handoff"}:
            if document.get("lifecycle_state") != "ACTIVE" or document.get("approval_required") is not False:
                semantic_valid = False
                issues.append({"code": "OPERATIONAL_CONTRACT_POLICY", "message": "Contrato operacional deve ser ACTIVE e não exigir aprovação individual."})
            if contract_path and not contract_path.is_relative_to((self.root / "contracts" / "operational").resolve()):
                semantic_valid = False
                issues.append({"code": "OPERATIONAL_CONTRACT_LOCATION", "message": "Contrato operacional deve estar em contracts/operational/."})
        else:
            semantic_valid = False
            issues.append({"code": "UNKNOWN_CONTRACT_TYPE", "message": "Tipo de contrato não reconhecido."})

        if not self._validate_paths(document, issues, check_inputs=check_inputs):
            semantic_valid = False
        if not self._validate_schema_references(document, contract_path, issues):
            semantic_valid = False
        missing_fields = list(document.get("missing_fields", []))
        if missing_fields:
            issues.append({"code": "CONTRACT_INCOMPLETE", "message": "Campos aguardam esclarecimento: " + ", ".join(missing_fields)})
        approval_valid = self.approval_valid(document)
        if require_approval and document.get("approval_required", True) and not approval_valid:
            issues.append({"code": "APPROVAL_REQUIRED", "message": "Não há aprovação SQLite válida para esta versão e hash."})
        approval_satisfied = (approval_valid if require_approval else True) if document.get("approval_required", True) else True
        ready = schema_valid and semantic_valid and not missing_fields and approval_satisfied and not (
            check_inputs and any(item["code"] == "MISSING_INPUT_ARTIFACT" for item in issues)
        )
        return {
            "contract_id": document.get("contract_id"),
            "version": document.get("version"),
            "content_hash": document.get("content_hash"),
            "schema_valid": schema_valid,
            "semantic_valid": semantic_valid,
            "approval_valid": approval_valid,
            "ready": ready,
            "missing_fields": missing_fields,
            "issues": issues,
        }

    def validate_path(self, path: str | Path, *, require_approval: bool = False,
                      check_inputs: bool = False) -> dict[str, Any]:
        document, resolved = self.registry.read_document(path)
        return self.validate_document(document, path=resolved, require_approval=require_approval,
                                      check_inputs=check_inputs)

    def validate_schema(self, value: Any, schema_path: str | Path) -> list[str]:
        issues: list[dict[str, str]] = []
        self._schema_issues(value, Path(schema_path), issues)
        return [item["message"] for item in issues]

    def validate_planned_task(self, value: Any) -> list[str]:
        return self.validate_schema(value, self.schema_root / "planned-task.schema.json")

    def approval_valid(self, document: dict[str, Any]) -> bool:
        if document.get("approval_required") is False:
            return document.get("contract_type", "").startswith("operational_") and document.get("lifecycle_state") == "ACTIVE"
        record = self.state.latest_valid_approval(
            self.approvals.workflow["workflow_id"], document.get("contract_id", ""),
            document.get("version", ""), document.get("content_hash", ""),
        )
        return bool(record and record["decision"] == "APPROVED" and record.get("actor") == "human_user"
                    and record.get("evidence", "").strip() and record.get("decision_id", "").startswith("DEC-"))

    def validate_execution_result(self, result: dict[str, Any]) -> dict[str, Any]:
        issues: list[dict[str, str]] = []
        valid = self._schema_issues(result, self.schema_root / "execution-result.schema.json", issues)
        return {"valid": valid, "schema_valid": valid, "functional_tests_performed": False, "issues": issues}

    def validate_output(self, document: dict[str, Any], output_path: str | Path) -> dict[str, Any]:
        validation = self.validate_document(document, require_approval=True, check_inputs=True)
        issues = list(validation["issues"])
        try:
            resolved = self.registry.safe_path(output_path)
        except ContractError as exc:
            return {"valid": False, "schema_valid": False, "functional_tests_performed": False,
                    "issues": issues + [{"code": "UNSAFE_OUTPUT_PATH", "message": str(exc)}]}
        if not resolved.is_file():
            return {"valid": False, "schema_valid": False, "functional_tests_performed": False,
                    "issues": issues + [{"code": "OUTPUT_NOT_FOUND", "message": f"Saída não encontrada: {resolved}"}]}
        relative = resolved.relative_to(self.root).as_posix()
        output = next((item for item in document.get("expected_outputs", [])
                       if self._normalized_project_path(item.get("path", "")) == relative), None)
        if output is None:
            return {"valid": False, "schema_valid": False, "functional_tests_performed": False,
                    "issues": issues + [{"code": "OUTPUT_NOT_DECLARED", "message": "Arquivo não está declarado entre as saídas do contrato."}]}
        schema = output.get("schema")
        if output.get("schema_path"):
            try:
                schema_path = self.registry.safe_path(output["schema_path"], base=Path(document.get("_path", self.root)).parent)
                schema = json.loads(schema_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, ContractError) as exc:
                return {"valid": False, "schema_valid": False, "functional_tests_performed": False,
                        "issues": issues + [{"code": "OUTPUT_SCHEMA_LOAD_FAILED", "message": str(exc)}]}
        try:
            output_format = output.get("format")
            if output_format == "json":
                value = json.loads(resolved.read_text(encoding="utf-8"))
            elif output_format == "yaml":
                value = yaml.safe_load(resolved.read_text(encoding="utf-8"))
            elif output_format == "binary":
                if schema:
                    return {"valid": False, "schema_valid": False, "functional_tests_performed": False,
                            "issues": issues + [{"code": "BINARY_SCHEMA_UNSUPPORTED", "message": "Schema JSON não valida saídas binárias."}]}
                value = None
            else:
                value = resolved.read_text(encoding="utf-8", errors="strict")
        except (OSError, UnicodeError, json.JSONDecodeError, yaml.YAMLError) as exc:
            return {"valid": False, "schema_valid": False, "functional_tests_performed": False,
                    "issues": issues + [{"code": "OUTPUT_PARSE_FAILED", "message": str(exc)}]}
        schema_valid = True
        if schema:
            schema_valid = self._schema_issues(value, schema, issues, display=f"output:{relative}")
        return {"valid": schema_valid and validation["ready"], "schema_valid": schema_valid,
                "functional_tests_performed": False, "issues": issues}

    def validate_handoff(self, handoff: dict[str, Any]) -> dict[str, Any]:
        issues: list[dict[str, str]] = []
        schema_valid = self._schema_issues(handoff, self.schema_root / "handoff.schema.json", issues)
        if not isinstance(handoff, dict):
            return {"valid": False, "schema_valid": False, "semantic_valid": False, "issues": issues}
        semantic_valid = True
        try:
            spec = self.specification_resolver.active_specification()
        except ValueError as exc:
            spec = None
            issues.append({"code": "SPECIFICATION_UNAVAILABLE", "message": str(exc)})
        expected_ref = f"{spec.spec_id}@{spec.version}" if spec else None
        if not expected_ref or handoff.get("originating_spec_reference") != expected_ref:
            semantic_valid = False
            issues.append({"code": "HANDOFF_SPEC_MISMATCH", "message": f"Handoff deve referenciar {expected_ref or 'uma especificação ativa'}."})
        if not self.approvals.has_approved_product_specification():
            semantic_valid = False
            issues.append({"code": "SPECIFICATION_NOT_APPROVED", "message": "A especificação de origem não tem aprovação válida."})
        raw_refs = handoff.get("contract_refs", [])
        refs = {(item.get("contract_id"), item.get("version"), item.get("content_hash"))
                for item in raw_refs if isinstance(item, dict)} if isinstance(raw_refs, list) else set()
        try:
            handoff_contract = self.registry.get("CONTRACT-003")
            required_handoff_ref = (handoff_contract["contract_id"], handoff_contract["version"],
                                    handoff_contract["content_hash"])
            if required_handoff_ref not in refs:
                semantic_valid = False
                issues.append({"code": "HANDOFF_CONTRACT_REQUIRED", "message": "Handoff deve incluir CONTRACT-003 e seu hash atual."})
        except ContractError as exc:
            semantic_valid = False
            issues.append({"code": "HANDOFF_CONTRACT_MISSING", "message": str(exc)})
        for contract_id, version, digest in refs:
            try:
                contract = self.registry.get(str(contract_id), str(version))
            except ContractError as exc:
                semantic_valid = False
                issues.append({"code": "HANDOFF_CONTRACT_MISSING", "message": str(exc)})
                continue
            if contract.get("content_hash") != digest or not self.validate_document(contract, path=contract.get("_path"), require_approval=True)["ready"]:
                semantic_valid = False
                issues.append({"code": "HANDOFF_CONTRACT_INVALID", "message": f"Referência de contrato inválida: {contract_id}@{version}."})
            elif contract.get("contract_type", "").startswith("product_") and handoff.get("task_id") not in contract.get("task_ids", []):
                semantic_valid = False
                issues.append({"code": "HANDOFF_TASK_CONTRACT_MISMATCH", "message": f"Contrato {contract_id} não cobre a tarefa do handoff."})
        return {"valid": schema_valid and semantic_valid, "schema_valid": schema_valid,
                "semantic_valid": semantic_valid, "issues": issues}

    def _current_specification_matches(self, document: dict[str, Any], issues: list[dict[str, str]]) -> bool:
        try:
            spec = self.specification_resolver.active_specification()
        except ValueError as exc:
            issues.append({"code": "SPECIFICATION_UNAVAILABLE", "message": str(exc)})
            return False
        if not spec:
            issues.append({"code": "SPECIFICATION_MISSING", "message": "Contrato de produto precisa de especificação de origem."})
            return False
        reference = f"{spec.spec_id}@{spec.version}"
        if document.get("originating_spec_reference") != reference:
            issues.append({"code": "SPECIFICATION_REFERENCE_STALE", "message": f"Contrato aponta para {document.get('originating_spec_reference')}; origem ativa é {reference}."})
            return False
        if document.get("originating_spec_hash") != spec.substantive_hash:
            issues.append({"code": "SPECIFICATION_HASH_STALE", "message": "A especificação de origem mudou depois da criação do contrato."})
            return False
        if not self.approvals.has_approved_product_specification():
            issues.append({"code": "SPECIFICATION_NOT_APPROVED", "message": "A especificação de origem não tem aprovação válida."})
            return False
        return True

    def _requirement_traceability(self, document: dict[str, Any], issues: list[dict[str, str]]) -> bool:
        try:
            spec = self.specification_resolver.active_specification()
        except ValueError:
            return False
        if not spec:
            return False
        content = spec.path.read_text(encoding="utf-8")
        missing = [item for item in document.get("requirement_ids", []) if not re.search(rf"\b{re.escape(item)}\b", content)]
        if missing:
            issues.append({"code": "REQUIREMENT_TRACEABILITY", "message": "Requisitos ausentes na especificação: " + ", ".join(missing)})
            return False
        return True

    def _validate_paths(self, document: dict[str, Any], issues: list[dict[str, str]], *, check_inputs: bool) -> bool:
        valid = True
        paths = [item.get("path", "") for item in document.get("required_inputs", [])]
        paths += [item.get("path", "") for item in document.get("expected_outputs", [])]
        paths += list(document.get("allowed_scope", {}).get("paths", []))
        for value in paths:
            if not self._safe_relative_path(value):
                valid = False
                issues.append({"code": "UNSAFE_DECLARED_PATH", "message": f"Caminho deve ser relativo e não conter '..': {value}"})
        if check_inputs:
            for item in document.get("required_inputs", []):
                if item.get("required", True):
                    try:
                        input_path = self.registry.safe_path(item.get("path", ""))
                    except ContractError:
                        continue
                    if not input_path.is_file():
                        valid = False
                        issues.append({"code": "MISSING_INPUT_ARTIFACT", "message": f"Entrada obrigatória ausente: {item.get('path')}"})
        return valid

    def _validate_schema_references(self, document: dict[str, Any], contract_path: Path | None,
                                    issues: list[dict[str, str]]) -> bool:
        valid = True
        base = contract_path.parent if contract_path else self.root
        declarations = [*document.get("required_inputs", []), *document.get("expected_outputs", []),
                        *document.get("validation_rules", [])]
        for index, declaration in enumerate(declarations):
            inline_schema = declaration.get("schema")
            schema_path = declaration.get("schema_path")
            if inline_schema is not None:
                try:
                    Draft202012Validator.check_schema(inline_schema)
                except Exception as exc:
                    valid = False
                    issues.append({"code": "INLINE_SCHEMA_INVALID", "message": f"Schema inline #{index + 1}: {exc}"})
            if schema_path:
                try:
                    resolved = self.registry.safe_path(schema_path, base=base)
                    schema_value = json.loads(resolved.read_text(encoding="utf-8"))
                    Draft202012Validator.check_schema(schema_value)
                except (ContractError, OSError, UnicodeError, json.JSONDecodeError, SchemaError, TypeError) as exc:
                    valid = False
                    issues.append({"code": "REFERENCED_SCHEMA_INVALID", "message": f"{schema_path}: {exc}"})
        return valid

    @staticmethod
    def _safe_relative_path(value: str) -> bool:
        if not isinstance(value, str) or not value.strip():
            return False
        win = PureWindowsPath(value)
        path = Path(value)
        return not path.is_absolute() and not win.is_absolute() and not win.drive and ".." not in path.parts and ".." not in win.parts

    def _normalized_project_path(self, value: str) -> str:
        try:
            return self.registry.safe_path(value).relative_to(self.root).as_posix()
        except ContractError:
            return ""

    @staticmethod
    def _schema_issues(value: Any, schema_or_path: dict[str, Any] | Path, issues: list[dict[str, str]], *, display: str = "contract") -> bool:
        try:
            schema = json.loads(schema_or_path.read_text(encoding="utf-8")) if isinstance(schema_or_path, Path) else schema_or_path
        except (OSError, json.JSONDecodeError) as exc:
            issues.append({"code": "SCHEMA_LOAD_FAILED", "message": f"{display}: {exc}"})
            return False
        try:
            Draft202012Validator.check_schema(schema)
        except (SchemaError, TypeError) as exc:
            issues.append({"code": "SCHEMA_DEFINITION_INVALID", "message": f"{display}: {exc}"})
            return False
        errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(value),
                        key=lambda error: list(error.absolute_path))
        if errors:
            for error in errors:
                location = ".".join(str(item) for item in error.absolute_path) or "<root>"
                issues.append({"code": "SCHEMA_INVALID", "message": f"{display}.{location}: {error.message}"})
            return False
        return True
