from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

import yaml

from orchestrator.config import OrchestratorConfig
from orchestrator.core.state_manager import StateManager
from orchestrator.core.workflow_engine import WorkflowEngine
from orchestrator.contracts.registry import ContractRegistry
from orchestrator.cli import main
from orchestrator.workflow import stage_map


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["value"],
    "properties": {"value": {"type": "integer"}},
    "additionalProperties": False,
}


class ContractTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for source, target in (
            ("specs", "specs"), (".codex/agents", ".codex/agents"),
            (".agents/skills", ".agents/skills"), ("orchestrator", "orchestrator"),
            ("contracts", "contracts"),
        ):
            shutil.copytree(PROJECT_ROOT / source, self.root / target)
        (self.root / "docs").mkdir()
        (self.root / "plans").mkdir()
        (self.root / "tasks").mkdir()
        shutil.copy2(PROJECT_ROOT / "docs" / "decision-log.md", self.root / "docs" / "decision-log.md")
        config = {
            "workflow_path": "specs/workflow.yaml",
            "workflow_schema_path": "orchestrator/workflow.schema.json",
            "state_db_path": ".codex/contracts-test.sqlite3",
            "decision_log_path": "docs/decision-log.md",
            "dry_run_by_default": True,
            "allow_real_execution": False,
            "codex_command": [],
            "execution_timeout_seconds": 2,
            "max_captured_output_bytes": 1024,
        }
        self.config_path = self.root / "orchestrator" / "contracts-test-config.json"
        self.config_path.write_text(json.dumps(config), encoding="utf-8")
        self.config = OrchestratorConfig.load(self.config_path)
        self.engine = WorkflowEngine(self.config)

    def tearDown(self) -> None:
        self.engine.close()
        self.temp.cleanup()

    def create_approved_specification(self) -> Path:
        self.engine.discover_questions()
        for field, answer in (
            ("objective", "Resolver a necessidade confirmada pelo usuário."),
            ("scope", "Incluir somente o comportamento confirmado."),
            ("functional_requirement", "O sistema deve apresentar o resultado solicitado."),
        ):
            self.engine.clarification.record_answer("requirements-discovery", field, answer)
        path = self.engine.collect_requirements()
        reviewed = self.engine.approvals.review_specification("SPEC-002")
        self.engine.approvals.approve_specification(
            "SPEC-002", "Aprovo explicitamente a especificação de teste.", confirmed=True,
            expected_version=reviewed["version"], expected_hash=reviewed["hash"],
        )
        return path

    def start_planning(self) -> Path:
        spec_path = self.create_approved_specification()
        self.engine.controller.complete_current(confirmed=True)
        self.engine.controller.advance(authorized=True, evidence="Autorizo iniciar o planejamento.")
        self.engine.controller.start_current()
        return spec_path

    def write_task(self, task_id: str = "TASK-001", *, required_input: str = "specs/generated/SPEC-002.md",
                   contract: dict | None = None, requirement_ids: list[str] | None = None,
                   spec_reference: str = "SPEC-002@0.1.0") -> Path:
        task = {
            "schema_version": 1,
            "task_id": task_id,
            "title": f"Implementar a tarefa {task_id}",
            "originating_spec_reference": spec_reference,
            "requirement_ids": requirement_ids if requirement_ids is not None else ["RF-001"],
            "responsible_agent": "desenvolvedor_frontend",
            "scope": f"Implementar somente o comportamento confirmado para {task_id}.",
        }
        if contract is not None:
            task["contract"] = contract
        path = self.root / "tasks" / f"{task_id}.yaml"
        path.write_text(yaml.safe_dump(task, allow_unicode=True, sort_keys=False), encoding="utf-8")
        return path

    def complete_contract(self, *, required_input: str = "specs/generated/SPEC-002.md",
                          task_id: str = "TASK-001", output_path: str = "src/result.json",
                          allowed_paths: list[str] | None = None, requirement_ids: list[str] | None = None,
                          approve: bool = True) -> dict:
        contract = {
            "type": "product_task",
            "required_inputs": [{"name": "approved-spec", "path": required_input, "required": True}],
            "expected_outputs": [{"name": "result", "path": output_path, "required": True,
                                  "format": "json", "schema": OUTPUT_SCHEMA}],
            "preconditions": ["A especificação de origem está aprovada."],
            "postconditions": ["A saída contém um valor inteiro."],
            "invariants": ["O escopo confirmado não muda."],
            "allowed_paths": allowed_paths if allowed_paths is not None else ["src/"],
            "operations": ["read", "write"],
            "dependencies": [],
            "validation_rules": [{"id": "result-schema", "kind": "schema",
                                  "description": "Validar estrutura da saída.", "schema": OUTPUT_SCHEMA}],
        }
        path = self.write_task(task_id, required_input=required_input, contract=contract,
                               requirement_ids=requirement_ids)
        self.engine.contract_assessment.assess(
            justification="O Tech Lead registrou a necessidade de um contrato para esta tarefa.",
            task_paths=[path], contract_task_ids=[task_id],
        )
        draft = self.engine.contract_generator.generate(path)
        if approve and draft["validation"]["schema_valid"] and draft["validation"]["semantic_valid"] and not draft["validation"]["missing_fields"]:
            review = self.engine.approvals.review_contract(draft["contract_id"], draft["version"])
            self.engine.approvals.approve_contract(
                draft["contract_id"], "Aprovo explicitamente o contrato de teste.", confirmed=True,
                expected_version=review["version"], expected_hash=review["hash"],
            )
        return draft


class ContractLifecycleTests(ContractTestCase):
    def test_operational_contracts_are_schema_valid_and_registered(self) -> None:
        contracts = self.engine.contract_registry.load_all()
        self.assertEqual(len(contracts), 3)
        for contract in contracts:
            result = self.engine.contract_validator.validate_document(contract, path=contract["_path"], require_approval=True)
            self.assertTrue(result["ready"], result["issues"])
            self.assertIsNotNone(self.engine.state.contract_record("arqcalc", contract["contract_id"], contract["version"]))

    def test_explicit_no_contract_assessment_allows_uncontracted_product_tasks(self) -> None:
        self.start_planning()
        record = self.engine.contract_assessment.assess(
            justification="As tarefas planejadas não criam fronteiras contratuais adicionais."
        )
        self.assertEqual(record["assessment"], "NO_PRODUCT_CONTRACTS_REQUIRED")
        result = self.engine.contract_resolver.evaluate("development", "TASK-099", check_inputs=True)
        self.assertEqual(result["status"], "NO_PRODUCT_CONTRACT_REQUIRED")
        self.assertEqual(result["blockers"], [])
        self.assertEqual(self.engine.contract_registry.load_all()[-1]["contract_type"], "operational_agent_handoff")

    def test_required_draft_blocks_only_its_dependent_task(self) -> None:
        self.start_planning()
        required = self.write_task("TASK-001", contract={"type": "product_task"})
        optional = self.write_task("TASK-002", contract={"type": "product_task"})
        self.engine.contract_assessment.assess(
            justification="TASK-001 define uma fronteira; TASK-002 não exige obrigação adicional.",
            task_paths=[required, optional], contract_task_ids=["TASK-001"],
        )
        missing = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(missing["status"], "BLOCKED")
        self.assertTrue(any("required-contract-missing:TASK-001" in item for item in missing["blockers"]))
        draft = self.engine.contract_generator.generate(required)
        self.assertTrue(draft["validation"]["schema_valid"])
        self.assertTrue(draft["missing_fields"])
        self.assertIn("contract.operations", draft["missing_fields"])
        blocked = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        clear = self.engine.contract_resolver.evaluate("development", "TASK-002", check_inputs=True)
        self.assertEqual(blocked["status"], "BLOCKED")
        self.assertTrue(any("APPROVAL_REQUIRED" in item for item in blocked["blockers"]))
        self.assertEqual(clear["status"], "NO_PRODUCT_CONTRACT_REQUIRED")
        self.assertEqual(clear["blockers"], [])

    def test_valid_approved_contract_releases_task_and_binds_prompt_context(self) -> None:
        self.start_planning()
        contract = self.complete_contract()
        resolved = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(resolved["status"], "READY", resolved["blockers"])
        stage = stage_map(self.engine.workflow)["development"]
        prompt = self.engine.executor.prepare_prompt(
            stage, self.root, "SPEC-002@0.1.0", task_id="TASK-001",
            contract_refs=resolved["required_contracts"],
        )
        self.assertIn(contract["contract_id"], prompt)
        self.assertIn(contract["content_hash"], prompt)

    def test_generator_reuses_contract_id_and_version_for_identical_input(self) -> None:
        self.start_planning()
        # The task must exist before the assessment; use an explicit confirmed obligation.
        task_path = self.write_task(contract={
            "type": "product_task", "required_inputs": [{"name": "spec", "path": "specs/generated/SPEC-002.md", "required": True}],
            "expected_outputs": [{"name": "result", "path": "src/result.json", "required": True, "format": "json", "schema": OUTPUT_SCHEMA}],
            "preconditions": ["Specification is approved."], "postconditions": ["Result is structured."],
            "invariants": ["Scope is unchanged."], "allowed_paths": ["src/"], "operations": ["read", "write"],
            "dependencies": [], "validation_rules": [{"id": "result-schema", "kind": "schema", "description": "Validate output.", "schema": OUTPUT_SCHEMA}],
        })
        self.engine.contract_assessment.assess(justification="The planned interface needs a product contract.",
                                               task_paths=[task_path], contract_task_ids=["TASK-001"])
        first = self.engine.contract_generator.generate(task_path)
        second = self.engine.contract_generator.generate(task_path)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["contract_id"], second["contract_id"])
        self.assertEqual(first["version"], second["version"])
        self.assertEqual(len([item for item in self.engine.contract_registry.load_all()
                             if item.get("contract_type") == "product_task"]), 1)

    def test_unapproved_specification_cannot_record_assessment(self) -> None:
        self.engine.controller.start_current()
        self.engine.discover_questions()
        for field, answer in (("objective", "Objetivo."), ("scope", "Escopo."),
                              ("functional_requirement", "O sistema deve apresentar resultado.")):
            self.engine.clarification.record_answer("requirements-discovery", field, answer)
        self.engine.collect_requirements()
        self.engine.state.set_stage_status("arqcalc", "requirements-discovery", "IN_PROGRESS", "COMPLETED")
        self.engine.state.set_current_stage("arqcalc", "planning")
        self.engine.state.set_stage_status("arqcalc", "planning", "PENDING", "IN_PROGRESS")
        with self.assertRaisesRegex(ValueError, "aprovada"):
            self.engine.contract_assessment.assess(justification="Avaliação sem origem aprovada.")

    def test_manual_approved_label_does_not_grant_contract_approval(self) -> None:
        self.start_planning()
        draft = self.complete_contract(approve=False)
        document = self.engine.contract_registry.get(draft["contract_id"], draft["version"])
        document["lifecycle_state"] = "APPROVED"
        document["approval_metadata"] = {"actor": "human_user", "evidence": "forged", "content_hash": document["content_hash"]}
        path, _ = self.engine.contract_registry.write(document, path=document["_path"])
        result = self.engine.contract_validator.validate_path(path, require_approval=True)
        self.assertFalse(result["approval_valid"])
        self.assertFalse(result["ready"])
        with self.assertRaisesRegex(ValueError, "IN_REVIEW"):
            self.engine.approvals.approve_contract(
                draft["contract_id"], "Aprovo.", confirmed=True,
                expected_version=draft["version"], expected_hash=draft["content_hash"],
            )

    def test_contract_approval_requires_matching_persisted_review_and_version_hash(self) -> None:
        self.start_planning()
        task_path = self.write_task(contract={
            "type": "product_task", "required_inputs": [{"name": "spec", "path": "specs/generated/SPEC-002.md", "required": True}],
            "expected_outputs": [{"name": "result", "path": "src/result.json", "required": True, "format": "json", "schema": OUTPUT_SCHEMA}],
            "preconditions": ["Approved spec."], "postconditions": ["Structured output."],
            "invariants": ["Keep scope."], "allowed_paths": ["src/"], "operations": ["read", "write"],
            "dependencies": [], "validation_rules": [{"id": "result-schema", "kind": "schema", "description": "Validate output.", "schema": OUTPUT_SCHEMA}],
        })
        self.engine.contract_assessment.assess(justification="The task shares a structured interface.",
                                               task_paths=[task_path], contract_task_ids=["TASK-001"])
        draft = self.engine.contract_generator.generate(task_path)
        review = self.engine.approvals.review_contract(draft["contract_id"], draft["version"])
        with self.assertRaises(ValueError):
            self.engine.approvals.approve_contract(draft["contract_id"], "Aprovo.", confirmed=True,
                                                   expected_version="9.9.9", expected_hash=review["hash"])
        with self.assertRaisesRegex(ValueError, "hash do contrato mudou"):
            self.engine.approvals.approve_contract(draft["contract_id"], "Aprovo.", confirmed=True,
                                                   expected_version=review["version"], expected_hash="0" * 64)
        record = self.engine.approvals.approve_contract(
            draft["contract_id"], "Aprovo o hash revisado.", confirmed=True,
            expected_version=review["version"], expected_hash=review["hash"],
        )
        self.assertEqual(record["substantive_hash"], review["hash"])

    def test_missing_input_artifact_blocks_only_task_that_requires_it(self) -> None:
        self.start_planning()
        task_path = self.write_task(required_input="docs/not-created.json", contract={
            "type": "product_task", "required_inputs": [{"name": "configuration", "path": "docs/not-created.json", "required": True}],
            "expected_outputs": [{"name": "result", "path": "src/result.json", "required": True, "format": "json", "schema": OUTPUT_SCHEMA}],
            "preconditions": ["Configuration exists."], "postconditions": ["Result is structured."],
            "invariants": ["Scope is unchanged."], "allowed_paths": ["src/"], "operations": ["read", "write"],
            "dependencies": [], "validation_rules": [{"id": "result-schema", "kind": "schema", "description": "Validate output.", "schema": OUTPUT_SCHEMA}],
        })
        self.engine.contract_assessment.assess(justification="The task consumes a required configuration artifact.",
                                               task_paths=[task_path], contract_task_ids=["TASK-001"])
        draft = self.engine.contract_generator.generate(task_path)
        review = self.engine.approvals.review_contract(draft["contract_id"], draft["version"])
        self.engine.approvals.approve_contract(draft["contract_id"], "Aprovo contrato.", confirmed=True,
                                                expected_version=review["version"], expected_hash=review["hash"])
        result = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(any("MISSING_INPUT_ARTIFACT" in item for item in result["blockers"]))

    def test_unsafe_scope_paths_are_rejected_as_nonisolating_and_not_executable(self) -> None:
        self.start_planning()
        task_path = self.write_task(contract={
            "type": "product_task", "required_inputs": [{"name": "spec", "path": "specs/generated/SPEC-002.md", "required": True}],
            "expected_outputs": [{"name": "result", "path": "src/result.json", "required": True, "format": "json", "schema": OUTPUT_SCHEMA}],
            "preconditions": ["Approved spec."], "postconditions": ["Structured output."],
            "invariants": ["Keep scope."], "allowed_paths": ["../outside"], "operations": ["read", "write"],
            "dependencies": [], "validation_rules": [{"id": "result-schema", "kind": "schema", "description": "Validate output.", "schema": OUTPUT_SCHEMA}],
        })
        self.engine.contract_assessment.assess(justification="The task requests a bounded code change.",
                                               task_paths=[task_path], contract_task_ids=["TASK-001"])
        draft = self.engine.contract_generator.generate(task_path)
        self.assertTrue(any(item["code"] == "UNSAFE_DECLARED_PATH" for item in draft["validation"]["issues"]))
        with self.assertRaises(ValueError):
            self.engine.approvals.review_contract(draft["contract_id"], draft["version"])

    def test_modified_contract_hash_invalidates_existing_approval(self) -> None:
        self.start_planning()
        draft = self.complete_contract()
        document = self.engine.contract_registry.get(draft["contract_id"], draft["version"])
        document["postconditions"] = ["A saída modificada não foi aprovada."]
        self.engine.contract_registry.write(document, path=document["_path"])
        result = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(any("APPROVAL_REQUIRED" in item for item in result["blockers"]))

    def test_modified_origin_specification_invalidates_contract_and_assessment(self) -> None:
        spec_path = self.start_planning()
        draft = self.complete_contract()
        text = spec_path.read_text(encoding="utf-8").replace("necessidade confirmada", "necessidade alterada")
        spec_path.write_text(text, encoding="utf-8")
        result = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(any("spec-hash-stale" in item or "SPECIFICATION_NOT_APPROVED" in item for item in result["blockers"]))

    def test_malformed_specification_reference_or_requirement_is_rejected(self) -> None:
        self.start_planning()
        wrong_spec = self.write_task("TASK-101", spec_reference="SPEC-999@0.1.0")
        with self.assertRaisesRegex(ValueError, "não referencia"):
            self.engine.contract_assessment.assess(justification="Tarefa aponta para uma origem incorreta.",
                                                   task_paths=[wrong_spec])
        wrong_requirement = self.write_task("TASK-102", requirement_ids=["RF-999"])
        with self.assertRaisesRegex(ValueError, "requisitos ausentes"):
            self.engine.contract_assessment.assess(justification="Tarefa aponta para requisito inexistente.",
                                                   task_paths=[wrong_requirement])

    def test_schema_invalid_contract_is_blocked(self) -> None:
        self.start_planning()
        draft = self.complete_contract()
        document = self.engine.contract_registry.get(draft["contract_id"], draft["version"])
        document["expected_outputs"][0].pop("format")
        path, _ = self.engine.contract_registry.write(document, path=document["_path"])
        validation = self.engine.contract_validator.validate_path(path)
        self.assertFalse(validation["schema_valid"])
        result = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(result["status"], "BLOCKED")

    def test_result_output_schema_validation_does_not_claim_functional_success(self) -> None:
        self.start_planning()
        draft = self.complete_contract()
        output_path = self.root / "src" / "result.json"
        output_path.parent.mkdir()
        output_path.write_text('{"value": 42}', encoding="utf-8")
        document = self.engine.contract_registry.get(draft["contract_id"], draft["version"])
        result = self.engine.contract_validator.validate_output(document, output_path)
        self.assertTrue(result["valid"], result["issues"])
        self.assertTrue(result["schema_valid"])
        self.assertFalse(result["functional_tests_performed"])
        output_path.write_text('{"value": "wrong"}', encoding="utf-8")
        invalid = self.engine.contract_validator.validate_output(document, output_path)
        self.assertFalse(invalid["valid"])
        self.assertFalse(invalid["schema_valid"])

    def test_invalid_output_schema_is_reported_without_crashing(self) -> None:
        self.start_planning()
        draft = self.complete_contract()
        document = self.engine.contract_registry.get(draft["contract_id"], draft["version"])
        document["expected_outputs"][0]["schema"] = {"type": "not-a-json-schema-type"}
        self.engine.contract_registry.write(document, path=document["_path"])
        output_path = self.root / "src" / "result.json"
        output_path.parent.mkdir()
        output_path.write_text('{"value": 1}', encoding="utf-8")
        current = self.engine.contract_registry.get(draft["contract_id"], draft["version"])
        result = self.engine.contract_validator.validate_output(current, output_path)
        self.assertFalse(result["valid"])
        self.assertTrue(any(item["code"] == "SCHEMA_DEFINITION_INVALID" for item in result["issues"]))

    def test_handoff_schema_and_contract_reference_are_validated_and_persisted(self) -> None:
        self.create_approved_specification()
        handoff_contract = self.engine.contract_registry.get("CONTRACT-003")
        handoff = {
            "schema_version": 1,
            "handoff_id": "HANDOFF-001",
            "task_id": "TASK-001",
            "originating_spec_reference": "SPEC-002@0.1.0",
            "from_agent": "tech_lead",
            "to_agent": "desenvolvedor_frontend",
            "contract_refs": [{"contract_id": handoff_contract["contract_id"], "version": handoff_contract["version"],
                               "content_hash": handoff_contract["content_hash"]}],
            "inputs": ["tasks/TASK-001.yaml"],
            "outputs": ["plans/implementation-plan.md"],
            "decisions": ["Manter a dependência existente."],
            "open_questions": [],
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        handoff_path = self.root / "tasks" / "TASK-001-handoff.yaml"
        handoff_path.write_text(yaml.safe_dump(handoff, allow_unicode=True, sort_keys=False), encoding="utf-8")
        validation = self.engine.contract_validator.validate_handoff(handoff)
        self.assertTrue(validation["valid"], validation["issues"])
        output = StringIO()
        with redirect_stdout(output):
            result = main(["--config", str(self.config_path), "contract", "validate-handoff", str(handoff_path)])
        self.assertEqual(result, 0, output.getvalue())
        stored = self.engine.state.connection.execute("SELECT * FROM contract_handoffs WHERE handoff_id='HANDOFF-001'").fetchone()
        self.assertIsNotNone(stored)
        self.assertEqual(stored["validation_status"], "PASSED")

    def test_planning_completion_requires_a_current_assessment_artifact(self) -> None:
        self.start_planning()
        passed, reason = self.engine.quality_gate.validate_stage_completion("planning")
        self.assertFalse(passed)
        self.assertIn("avaliação atual", reason.lower())
        self.engine.contract_assessment.assess(justification="Nenhuma tarefa exige contrato de produto adicional.")
        self.assertIn("contract-assessment", [item["artifact_id"] for item in
                                              self.engine.state.artifact_records("arqcalc", "planning")])
        passed, reason = self.engine.quality_gate.validate_stage_completion("planning")
        self.assertFalse(passed)
        self.assertIn("implementation-plan", reason)

    def test_ux_ui_contract_revision_creates_new_version_and_invalidates_planning_gate(self) -> None:
        self.start_planning()
        original = self.complete_contract()
        spec = self.engine.resolver.active_specification()
        for artifact_id, relative_path, content, task_ids in (
            ("implementation-plan", "plans/implementation-plan.md", "Plano aprovado.", []),
            ("work-items", "tasks/work-items.md", "TASK-001: tarefa planejada.", ["TASK-001"]),
        ):
            path = self.root / relative_path
            path.write_text(content, encoding="utf-8")
            valid, reason = self.engine.quality_gate.validate_artifact(
                "planning", artifact_id, path, f"{spec.spec_id}@{spec.version}",
                requirement_ids=["RF-001"], task_ids=task_ids,
            )
            self.assertTrue(valid, reason)
            self.engine.state.record_artifact(
                workflow_id="arqcalc", stage_id="planning", artifact_id=artifact_id,
                artifact_version="1", path=path, spec_reference=f"{spec.spec_id}@{spec.version}",
                validation_status="PASSED", requirement_ids=["RF-001"], task_ids=task_ids,
            )
        old_gate_hash = self.engine.quality_gate.stage_gate_digest("planning")
        self.engine.approvals.approve_stage_gate(
            "planning", "Aprovo o plano, tarefas e avaliação de contratos.",
            confirmed=True, expected_hash=old_gate_hash,
        )
        self.engine.controller.present_for_review()
        self.engine.controller.complete_current(confirmed=True)
        self.engine.controller.advance(authorized=True, evidence="Autorizo iniciar UX/UI.")
        self.engine.controller.start_current()

        task_path = self.root / "tasks" / "TASK-001.yaml"
        task = yaml.safe_load(task_path.read_text(encoding="utf-8"))
        task["contract"]["postconditions"] = ["The interface behavior confirmed during design is produced."]
        task_path.write_text(yaml.safe_dump(task, allow_unicode=True, sort_keys=False), encoding="utf-8")
        self.engine.contract_assessment.assess(
            justification="UX/UI confirmou um detalhe de interface que altera a saída da tarefa.",
            task_paths=[task_path], contract_task_ids=["TASK-001"],
        )
        revised = self.engine.contract_generator.generate(task_path)
        self.assertEqual(revised["contract_id"], original["contract_id"])
        self.assertNotEqual(revised["version"], original["version"])
        self.assertFalse(self.engine.approvals.has_current_stage_gate("planning"))

        review = self.engine.approvals.review_contract(revised["contract_id"], revised["version"])
        self.engine.approvals.approve_contract(
            revised["contract_id"], "Aprovo a versão revisada após UX/UI.", confirmed=True,
            expected_version=review["version"], expected_hash=review["hash"],
        )
        new_gate_hash = self.engine.quality_gate.stage_gate_digest("planning")
        self.assertNotEqual(new_gate_hash, old_gate_hash)
        self.engine.approvals.approve_stage_gate(
            "planning", "Reaprovo o gate após revisar os contratos.",
            confirmed=True, expected_hash=new_gate_hash,
        )
        self.assertTrue(self.engine.approvals.has_current_stage_gate("planning"))
        resolved = self.engine.contract_resolver.evaluate("development", "TASK-001", check_inputs=True)
        self.assertEqual(resolved["status"], "READY", resolved["blockers"])

    def test_execution_idempotency_changes_when_contract_version_changes(self) -> None:
        self.start_planning()
        self.complete_contract()
        self.engine.state.set_current_stage("arqcalc", "development")
        self.engine.state.set_stage_status("arqcalc", "development", "PENDING", "IN_PROGRESS")
        first_ref = {"contract_id": "CONTRACT-101", "version": "0.1.0", "content_hash": "a" * 64}
        first_context = {
            "status": "READY", "blockers": [], "required_contracts": [first_ref],
            "contract_fingerprint": self.engine.contract_resolver.fingerprint([first_ref]),
        }
        with patch.object(self.engine.dependencies, "blockers", return_value=()), \
                patch.object(self.engine.contract_resolver, "evaluate", return_value=first_context):
            first = self.engine.controller.run_current(task_id="TASK-001")
            reused = self.engine.controller.run_current(task_id="TASK-001")
        self.assertEqual(first.run_id, reused.run_id)
        self.assertTrue(first.dry_run)
        revised_ref = {"contract_id": "CONTRACT-101", "version": "0.2.0", "content_hash": "b" * 64}
        revised_context = {
            "status": "READY", "blockers": [], "required_contracts": [revised_ref],
            "contract_fingerprint": self.engine.contract_resolver.fingerprint([revised_ref]),
        }
        with patch.object(self.engine.dependencies, "blockers", return_value=()), \
                patch.object(self.engine.contract_resolver, "evaluate", return_value=revised_context):
            second = self.engine.controller.run_current(task_id="TASK-001")
        self.assertNotEqual(first.run_id, second.run_id)
        self.assertEqual(second.status.value, "PENDING")

    def test_contract_state_and_approvals_persist_after_engine_reopen(self) -> None:
        self.start_planning()
        draft = self.complete_contract()
        contract_id = draft["contract_id"]
        self.engine.close()
        self.engine = WorkflowEngine(self.config)
        contract = self.engine.contract_registry.get(contract_id, draft["version"])
        self.assertTrue(self.engine.contract_validator.approval_valid(contract))
        self.assertEqual(self.engine.state.contract_record("arqcalc", contract_id, draft["version"])["content_hash"],
                         draft["content_hash"])


class ContractMigrationTests(unittest.TestCase):
    def test_additive_migration_preserves_legacy_execution_and_approval(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "legacy.sqlite3"
            connection = sqlite3.connect(database)
            connection.executescript("""
                CREATE TABLE executions (
                    run_id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,workflow_id TEXT NOT NULL,
                    stage_id TEXT NOT NULL,status TEXT NOT NULL,prompt_hash TEXT NOT NULL,command_json TEXT NOT NULL,
                    attempt INTEGER NOT NULL DEFAULT 1,started_at TEXT,finished_at TEXT,exit_code INTEGER,
                    stdout TEXT NOT NULL DEFAULT '',stderr TEXT NOT NULL DEFAULT '',error TEXT
                );
                CREATE TABLE artifacts (
                    artifact_key TEXT PRIMARY KEY,workflow_id TEXT NOT NULL,stage_id TEXT NOT NULL,artifact_id TEXT NOT NULL,
                    artifact_version TEXT NOT NULL,spec_reference TEXT,path TEXT NOT NULL,content_hash TEXT NOT NULL,
                    requirement_ids_json TEXT NOT NULL DEFAULT '[]',task_ids_json TEXT NOT NULL DEFAULT '[]',
                    validation_summary TEXT NOT NULL DEFAULT '',validation_status TEXT NOT NULL,recorded_at TEXT NOT NULL
                );
                CREATE TABLE approval_records (
                    approval_id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL,artifact_id TEXT NOT NULL,
                    artifact_version TEXT NOT NULL,substantive_hash TEXT NOT NULL,
                    decision TEXT NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),actor TEXT NOT NULL,
                    evidence TEXT NOT NULL,authorize_next_stage INTEGER NOT NULL CHECK(authorize_next_stage IN (0,1)),
                    decision_id TEXT NOT NULL,recorded_at TEXT NOT NULL
                );
                INSERT INTO executions(run_id,idempotency_key,workflow_id,stage_id,status,prompt_hash,command_json,started_at)
                VALUES('legacy-run','legacy-key','landing-page','requirements-discovery','COMPLETED','p','[]','2026-01-01T00:00:00Z');
                INSERT INTO approval_records(approval_id,workflow_id,artifact_id,artifact_version,substantive_hash,decision,
                    actor,evidence,authorize_next_stage,decision_id,recorded_at)
                VALUES('legacy-approval','landing-page','SPEC-002','0.1.0',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','APPROVED',
                    'human_user','legacy approval',0,'DEC-001','2026-01-01T00:00:00Z');
            """)
            connection.commit()
            connection.close()
            state = StateManager(database)
            try:
                execution = state.execution("legacy-run")
                approval = state.latest_valid_approval(
                    "landing-page", "SPEC-002", "0.1.0", "a" * 64,
                )
                self.assertEqual(execution["status"], "COMPLETED")
                self.assertEqual(json.loads(execution["contract_refs_json"]), [])
                self.assertEqual(approval["approval_id"], "legacy-approval")
                migrations = {row["migration_id"] for row in state.connection.execute("SELECT migration_id FROM schema_migrations")}
                self.assertIn("contracts-v1", migrations)
                self.assertIn("contract_refs_json", {row["name"] for row in state.connection.execute("PRAGMA table_info(artifacts)")})
            finally:
                state.close()


if __name__ == "__main__":
    unittest.main()
