from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from orchestrator.config import OrchestratorConfig
from orchestrator.core.dependency_validator import DependencyValidator
from orchestrator.core.workflow_engine import WorkflowEngine
from orchestrator.cli import main
from orchestrator.executors.codex_executor import CodexExecutor, ExecutionAuthorizationError
from orchestrator.models import ExecutionStatus, ResolutionStatus


PROJECT_ROOT = Path(__file__).resolve().parent.parent


class OrchestratorTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        shutil.copytree(PROJECT_ROOT / "specs", self.root / "specs")
        shutil.copytree(PROJECT_ROOT / ".codex" / "agents", self.root / ".codex" / "agents")
        shutil.copytree(PROJECT_ROOT / ".agents" / "skills", self.root / ".agents" / "skills")
        shutil.copytree(PROJECT_ROOT / "orchestrator", self.root / "orchestrator")
        shutil.copytree(PROJECT_ROOT / "contracts", self.root / "contracts")
        (self.root / "plans").mkdir()
        (self.root / "tasks").mkdir()
        (self.root / "docs").mkdir()
        shutil.copy2(PROJECT_ROOT / "docs" / "decision-log.md", self.root / "docs" / "decision-log.md")
        config = {
            "workflow_path": "specs/workflow.yaml",
            "workflow_schema_path": "orchestrator/workflow.schema.json",
            "state_db_path": ".codex/test-state.sqlite3",
            "decision_log_path": "docs/decision-log.md",
            "dry_run_by_default": True,
            "allow_real_execution": False,
            "codex_command": [],
            "execution_timeout_seconds": 2,
            "max_captured_output_bytes": 128,
        }
        config_path = self.root / "orchestrator" / "test-config.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        self.config = OrchestratorConfig.load(config_path)
        self.engine = WorkflowEngine(self.config)

    def tearDown(self) -> None:
        self.engine.close()
        self.temp.cleanup()

    def add_minimum_answers(self, *, functional_requirement: str = "O sistema deve mostrar o resultado calculado.") -> None:
        for field, answer in (
            ("objective", "Resolver a necessidade confirmada pelo usuário."),
            ("scope", "Incluir somente o comportamento descrito pelo usuário."),
            ("functional_requirement", functional_requirement),
        ):
            self.engine.clarification.record_answer("requirements-discovery", field, answer)

    def create_draft(self, *, incomplete: bool = False, custom_note: bool = False) -> Path:
        template = (self.root / "specs" / "templates" / "SPEC-TEMPLATE.md").read_text(encoding="utf-8")
        text = template.replace("SPEC-NNN", "SPEC-002", 1)
        text = text.replace("[Título curto e estável]", "Especificação de teste", 1)
        if not incomplete:
            text = text.replace("[Problema ou necessidade confirmada e resultado que esta funcionalidade deve produzir.]",
                                "Resolver a necessidade confirmada pelo usuário.")
            text = text.replace("- [Comportamento ou área confirmado.]", "- Incluir somente o comportamento descrito pelo usuário.")
            text = text.replace("[Uma condição ou comportamento observável.]", "O sistema deve mostrar o resultado calculado.")
            text = text.replace("[Prioridade ou não definida]", "Não definida")
            text = text.replace("[Referência à conversa/decisão]", "Resposta confirmada pelo usuário")
        if custom_note:
            text += "\n## Nota preservada\n\nConteúdo local que deve continuar no mesmo documento.\n"
        path = self.root / "specs" / "generated" / "SPEC-002.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def create_approved_spec(self) -> Path:
        self.engine.discover_questions()
        self.add_minimum_answers()
        path = self.engine.collect_requirements()
        spec_id = path.stem
        reviewed = self.engine.approvals.review_specification(spec_id)
        self.engine.approvals.approve_specification(
            spec_id, "Aprovo explicitamente a versão apresentada.", confirmed=True,
            expected_version=reviewed["version"], expected_hash=reviewed["hash"]
        )
        return path


class ResolutionTests(OrchestratorTestCase):
    def test_all_five_specification_outcomes(self) -> None:
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.MISSING)

        draft_path = self.create_draft(incomplete=True)
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.DRAFT)

        self.add_minimum_answers()
        updated = self.engine.collector.generate_or_update("requirements-discovery", revise=True)
        self.assertEqual(updated, draft_path)
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)

        backtick = chr(96)
        text = draft_path.read_text(encoding="utf-8").replace(
            f"| Estado | {backtick}DRAFT{backtick} |", f"| Estado | {backtick}APPROVED{backtick} |")
        draft_path.write_text(text, encoding="utf-8")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)

        reviewed = self.engine.approvals.review_specification("SPEC-002")
        self.engine.approvals.approve_specification(
            "SPEC-002", "Aprovação humana da versão exata.", confirmed=True,
            expected_version=reviewed["version"], expected_hash=reviewed["hash"]
        )
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.READY)
        self.assertEqual(self.engine.evaluate("planning").status, ResolutionStatus.BLOCKED)

    def test_missing_answers_are_requested_without_creating_spec(self) -> None:
        questions = self.engine.discover_questions()
        self.assertEqual([question.field for question in questions],
                         ["objective", "scope", "functional_requirement"])
        self.engine.clarification.record_answer("requirements-discovery", "objective", "Objetivo confirmado.")
        self.engine.clarification.record_answer("requirements-discovery", "scope", "Escopo confirmado.")
        self.assertEqual([question.field for question in self.engine.clarification.questions("requirements-discovery")],
                         ["functional_requirement"])
        with self.assertRaisesRegex(ValueError, "functional_requirement"):
            self.engine.collect_requirements()
        self.assertEqual(list((self.root / "specs" / "generated").glob("SPEC-*.md")), [])

        self.engine.clarification.record_answer(
            "requirements-discovery", "functional_requirement", "O sistema deve responder com um valor observável."
        )
        path = self.engine.collect_requirements()
        self.assertEqual(path.name, "SPEC-002.md")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)
        self.assertEqual((self.root / "specs" / "SPEC-001.md").read_text(encoding="utf-8"), "")
        self.assertIn("SQLite answer", path.read_text(encoding="utf-8"))
        artifact = self.engine.state.artifact_records("arqcalc", "requirements-discovery")[0]
        self.assertEqual(json.loads(artifact["requirement_ids_json"]), ["RF-001"])

    def test_existing_document_is_updated_in_place_and_preserved(self) -> None:
        path = self.create_draft(incomplete=True, custom_note=True)
        self.add_minimum_answers()
        updated_path = self.engine.collector.generate_or_update("requirements-discovery")
        self.assertEqual(updated_path, path)
        text = path.read_text(encoding="utf-8")
        self.assertIn("## Nota preservada", text)
        self.assertIn("Conteúdo local que deve continuar no mesmo documento.", text)
        self.assertNotIn("[Problema ou necessidade", text)
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)

    def test_discovery_reuses_existing_confirmed_sections_and_asks_only_missing_requirement(self) -> None:
        path = self.create_draft(incomplete=True)
        text = path.read_text(encoding="utf-8")
        text = text.replace("[Problema ou necessidade confirmada e resultado que esta funcionalidade deve produzir.]",
                            "Objetivo já registrado no documento.")
        text = text.replace("- [Comportamento ou área confirmado.]", "- Escopo já registrado no documento.")
        path.write_text(text, encoding="utf-8")
        questions = self.engine.discover_questions()
        self.assertEqual([question.field for question in questions], ["functional_requirement"])
        self.engine.clarification.record_answer(
            "requirements-discovery", "functional_requirement", "O sistema deve exibir um valor calculado."
        )
        updated = self.engine.collect_requirements()
        self.assertEqual(updated, path)
        contents = path.read_text(encoding="utf-8")
        self.assertIn("Objetivo já registrado no documento.", contents)
        self.assertIn("Escopo já registrado no documento.", contents)

    def test_manual_approved_status_does_not_grant_approval(self) -> None:
        path = self.create_draft(incomplete=False)
        backtick = chr(96)
        text = path.read_text(encoding="utf-8").replace(
            f"| Estado | {backtick}DRAFT{backtick} |", f"| Estado | {backtick}APPROVED{backtick} |")
        path.write_text(text, encoding="utf-8")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)
        self.assertFalse(self.engine.approvals.has_approved_product_specification())

    def test_functional_requirement_needs_confirmed_evidence(self) -> None:
        path = self.create_draft(incomplete=False)
        text = path.read_text(encoding="utf-8").replace(
            "Resposta confirmada pelo usuário", "[Referência à conversa/decisão]")
        path.write_text(text, encoding="utf-8")
        evaluation = self.engine.evaluate()
        self.assertEqual(evaluation.status, ResolutionStatus.DRAFT)
        self.assertEqual(evaluation.missing_information, ("functional_requirement",))

    def test_editing_approved_requirements_invalidates_the_approval(self) -> None:
        path = self.create_draft(incomplete=False)
        reviewed = self.engine.approvals.review_specification("SPEC-002")
        self.engine.approvals.approve_specification(
            "SPEC-002", "Aprovado.", confirmed=True,
            expected_version=reviewed["version"], expected_hash=reviewed["hash"])
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.READY)
        path.write_text(path.read_text(encoding="utf-8").replace("necessidade confirmada", "necessidade alterada"), encoding="utf-8")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)

    def test_approval_rejects_a_version_changed_after_review(self) -> None:
        path = self.create_draft(incomplete=False)
        reviewed = self.engine.approvals.review_specification("SPEC-002")
        path.write_text(path.read_text(encoding="utf-8").replace(
            "necessidade confirmada", "necessidade modificada"), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "mudou após a revisão"):
            self.engine.approvals.approve_specification(
                "SPEC-002", "Aprovo a versão revisada.", confirmed=True,
                expected_version=reviewed["version"], expected_hash=reviewed["hash"])

    def test_invalid_dependency_is_reported_as_blocker(self) -> None:
        changed = json.loads(json.dumps(self.engine.workflow))
        planning = next(stage for stage in changed["stages"] if stage["id"] == "planning")
        planning["depends_on"] = ["does-not-exist"]
        validator = DependencyValidator(changed, self.engine.state, self.engine.approvals)
        self.assertIn("unknown-dependency:does-not-exist", validator.blockers("planning"))

    def test_multiple_specifications_require_an_explicit_active_selection(self) -> None:
        first = self.create_draft(incomplete=False)
        second = self.root / "specs" / "generated" / "SPEC-003.md"
        second.write_text(first.read_text(encoding="utf-8").replace("SPEC-002", "SPEC-003"), encoding="utf-8")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.BLOCKED)
        selected = self.engine.resolver.select_specification("SPEC-002")
        self.assertEqual(selected.spec_id, "SPEC-002")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.AWAITING_APPROVAL)

    def test_malformed_nonempty_specification_blocks_discovery(self) -> None:
        malformed = self.root / "specs" / "generated" / "SPEC-002.md"
        malformed.parent.mkdir(parents=True, exist_ok=True)
        malformed.write_text("invalid metadata", encoding="utf-8")
        self.assertEqual(self.engine.evaluate().status, ResolutionStatus.BLOCKED)


class PersistenceAndExecutionTests(OrchestratorTestCase):
    def test_runtime_state_persists_and_running_task_is_recovered(self) -> None:
        self.engine.clarification.record_answer("requirements-discovery", "objective", "Persistir resposta confirmada.")
        run = self.engine.state.begin_execution("arqcalc", "requirements-discovery", "stable-key",
                                                "prompt", ["not-launched"])
        self.assertEqual(run["status"], "RUNNING")
        self.engine.close()
        self.engine = WorkflowEngine(self.config)
        self.assertEqual(self.engine.state.confirmed_answers("arqcalc", "requirements-discovery")["objective"],
                         "Persistir resposta confirmada.")
        self.assertEqual(self.engine.state.recover_interrupted_executions("arqcalc"), 1)
        latest = self.engine.state.latest_execution("arqcalc", "requirements-discovery")
        self.assertEqual(latest["status"], "FAILED")
        self.assertIn("interrupted", latest["error"])

    def test_unauthorized_real_execution_never_starts_a_process(self) -> None:
        self.engine.discover_questions()
        executor = self.engine.executor
        with patch("orchestrator.executors.codex_executor.subprocess.Popen",
                   side_effect=AssertionError("no process should start")):
            with self.assertRaises(ExecutionAuthorizationError):
                executor.execute("task", command=["codex", "exec", "-"], dry_run=False,
                                 authorized=False, stage_ready=True)
            preview = executor.execute("task", dry_run=True)
        self.assertTrue(preview.dry_run)
        self.assertEqual(preview.status, ExecutionStatus.PENDING)

    def test_dry_run_and_execution_history_are_idempotent(self) -> None:
        self.engine.discover_questions()
        first = self.engine.controller.run_current()
        second = self.engine.controller.run_current()
        self.assertEqual(first.status, ExecutionStatus.PENDING)
        self.assertTrue(first.dry_run)
        self.assertEqual(first.run_id, second.run_id)
        self.assertEqual(self.engine.state.latest_execution("arqcalc", "requirements-discovery")["status"], "PENDING")

    def test_only_a_fake_python_child_is_used_to_verify_adapter_limits(self) -> None:
        from dataclasses import replace
        config = replace(self.config, allow_real_execution=True, codex_command=(sys.executable, "-c",
                         "import sys; value=sys.stdin.read(); print(value); print('x'*200)"))
        executor = CodexExecutor(config)
        result = executor.execute("safe test prompt", dry_run=False, authorized=True, stage_ready=True)
        self.assertEqual(result.status, ExecutionStatus.COMPLETED)
        self.assertLessEqual(len(result.stdout.encode("utf-8")), config.max_captured_output_bytes)
        self.assertIn("safe test prompt", result.stdout)

    def test_timeout_is_bounded(self) -> None:
        from dataclasses import replace
        config = replace(self.config, allow_real_execution=True, execution_timeout_seconds=1,
                         codex_command=(sys.executable, "-c", "import time; time.sleep(5)"))
        result = CodexExecutor(config).execute("safe test", dry_run=False, authorized=True, stage_ready=True)
        self.assertEqual(result.status, ExecutionStatus.FAILED)
        self.assertIn("excedeu", result.error or "")

    def test_cli_status_evaluate_and_noninteractive_discovery(self) -> None:
        output = StringIO()
        with redirect_stdout(output):
            status_code = main(["--config", str(self.root / "orchestrator" / "test-config.json"), "status"])
        self.assertEqual(status_code, 0)
        self.assertIn("requirements-discovery", output.getvalue())
        output = StringIO()
        with redirect_stdout(output):
            evaluate_code = main(["--config", str(self.root / "orchestrator" / "test-config.json"), "evaluate"])
        self.assertEqual(evaluate_code, 0)
        self.assertIn("MISSING", output.getvalue())
        output = StringIO()
        with redirect_stdout(output):
            discover_code = main(["--config", str(self.root / "orchestrator" / "test-config.json"),
                                  "discover", "--no-interactive"])
        self.assertEqual(discover_code, 0)
        self.assertIn("functional_requirement", output.getvalue())

    def test_stage_gate_approval_is_invalidated_when_output_changes(self) -> None:
        self.create_approved_spec()
        self.engine.controller.complete_current(confirmed=True)
        self.engine.controller.advance(authorized=True, evidence="Autorizo iniciar o planejamento.")
        self.engine.controller.start_current()
        self.engine.contract_assessment.assess(
            justification="As tarefas deste planejamento não exigem contrato de produto adicional."
        )
        plans = self.root / "plans"
        tasks = self.root / "tasks"
        plans.mkdir(exist_ok=True)
        tasks.mkdir(exist_ok=True)
        plan_file = plans / "test-plan.md"
        tasks_file = tasks / "TASK-001.md"
        plan_file.write_text("Plano aprovado.", encoding="utf-8")
        tasks_file.write_text("TASK-001: Tarefa aprovada.", encoding="utf-8")
        spec = self.engine.resolver.active_specification()
        for artifact_id, path, task_ids in (
            ("implementation-plan", plan_file, []),
            ("work-items", tasks_file, ["TASK-001"]),
        ):
            valid, _ = self.engine.quality_gate.validate_artifact(
                "planning", artifact_id, path, f"{spec.spec_id}@{spec.version}",
                task_ids=task_ids,
            )
            self.assertTrue(valid)
            self.engine.state.record_artifact(
                workflow_id="arqcalc", stage_id="planning", artifact_id=artifact_id, artifact_version="1",
                path=path, spec_reference=f"{spec.spec_id}@{spec.version}", validation_status="PASSED",
                task_ids=task_ids,
            )
        digest = self.engine.quality_gate.stage_gate_digest("planning")
        self.engine.approvals.approve_stage_gate(
            "planning", "Aprovo plano e tarefas.", confirmed=True, expected_hash=digest)
        self.assertTrue(self.engine.approvals.has_current_stage_gate("planning"))
        plan_file.write_text("Plano alterado depois da aprovação.", encoding="utf-8")
        self.assertFalse(self.engine.approvals.has_current_stage_gate("planning"))

    def test_production_authorization_is_separate_from_delivery_readiness(self) -> None:
        self.create_approved_spec()
        review_output = self.root / "docs" / "review.md"
        review_output.write_text("Tech Lead review and PO acceptance.", encoding="utf-8")
        spec = self.engine.resolver.active_specification()
        valid, _ = self.engine.quality_gate.validate_artifact(
            "technical-review-approval", "technical-review-and-product-decision", review_output,
            f"{spec.spec_id}@{spec.version}")
        self.assertTrue(valid)
        self.engine.state.record_artifact(
            workflow_id="arqcalc", stage_id="technical-review-approval",
            artifact_id="technical-review-and-product-decision", artifact_version="1", path=review_output,
            spec_reference=f"{spec.spec_id}@{spec.version}", validation_status="PASSED")
        digest = self.engine.quality_gate.stage_gate_digest("technical-review-approval")
        self.engine.approvals.approve_stage_gate(
            "technical-review-approval", "Revisão aprovada pelo PO.", confirmed=True, expected_hash=digest)
        self.engine.state.set_stage_status("arqcalc", "technical-review-approval", "PENDING", "COMPLETED")
        self.engine.state.set_current_stage("arqcalc", "deployment")
        self.engine.state.set_stage_status("arqcalc", "deployment", "PENDING", "IN_PROGRESS")

        blockers = self.engine.dependencies.blockers("deployment")
        self.assertNotIn("explicit-production-deployment-authorization", blockers)
        record = self.engine.approvals.authorize_deployment(
            "produção: ambiente aprovado", "1.0.0", "Autorizo publicar essa versão.",
            confirmed=True)
        self.assertEqual(record["deployment_version"], "1.0.0")
        self.assertNotIn("explicit-production-deployment-authorization",
                         self.engine.dependencies.blockers("deployment"))


class WorkflowTransitionTests(OrchestratorTestCase):
    def test_stage_advances_only_after_spec_approval_acceptance_and_explicit_authorization(self) -> None:
        path = self.create_approved_spec()
        self.assertEqual(self.engine.state.stage_status("arqcalc", "requirements-discovery"), "WAITING_FOR_USER")
        self.engine.controller.present_for_review()
        with self.assertRaisesRegex(ValueError, "Avanço exige"):
            self.engine.controller.advance(authorized=False, evidence="")
        self.engine.controller.complete_current(confirmed=True)
        self.assertEqual(self.engine.state.stage_status("arqcalc", "requirements-discovery"), "COMPLETED")
        message = self.engine.controller.advance(authorized=True, evidence="Autorizo iniciar o planejamento.")
        self.assertIn("planning", message)
        self.assertEqual(self.engine.state.current_stage_id("arqcalc"), "planning")
        self.assertEqual(self.engine.state.stage_status("arqcalc", "planning"), "PENDING")
        self.assertTrue(path.is_file())

    def test_advance_fails_if_spec_or_stage_is_not_approved(self) -> None:
        with self.assertRaisesRegex(ValueError, "não foi concluída"):
            self.engine.controller.advance(authorized=True, evidence="Pode avançar.")


if __name__ == "__main__":
    unittest.main()
