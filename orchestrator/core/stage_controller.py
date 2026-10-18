from __future__ import annotations

import hashlib
import json
from typing import Any

from ..executors.codex_executor import CodexExecutor
from ..governance.approval_manager import ApprovalManager
from ..governance.quality_gate import QualityGate
from ..models import ExecutionResult, ExecutionStatus
from .dependency_validator import DependencyValidator
from .specification_resolver import SpecificationResolver
from .state_manager import StateManager


class StageController:
    def __init__(self, root: str, workflow: dict[str, Any], state: StateManager,
                 resolver: SpecificationResolver, dependencies: DependencyValidator,
                 quality_gate: QualityGate, approvals: ApprovalManager, executor: CodexExecutor,
                 contracts: Any | None = None, contract_validator: Any | None = None):
        self.root = root
        self.workflow = workflow
        self.state = state
        self.resolver = resolver
        self.dependencies = dependencies
        self.quality_gate = quality_gate
        self.approvals = approvals
        self.executor = executor
        self.contracts = contracts
        self.contract_validator = contract_validator

    def start_current(self) -> str:
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        status = self.state.stage_status(workflow_id, stage_id)
        if status in {"NOT_STARTED", "PENDING"}:
            self._transition_stage(workflow_id, stage_id, status, "IN_PROGRESS")
            self.state.record_event(workflow_id, "STAGE_STARTED", stage_id=stage_id,
                                    details={"authorization": "explicit CLI action"})
            return f"Etapa {stage_id} iniciada."
        if status == "IN_PROGRESS":
            return f"Etapa {stage_id} já está em andamento."
        raise ValueError(f"A etapa atual não pode ser iniciada no estado {status}")

    def resume_current(self) -> str:
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        status = self.state.stage_status(workflow_id, stage_id)
        if status == "IN_PROGRESS":
            return f"Etapa {stage_id} já está em andamento."
        if status != "WAITING_FOR_USER":
            raise ValueError(f"A etapa atual não pode retomar descoberta no estado {status}")
        transitions = self.workflow.get("stage_status_transitions", {}).get("allowed", [])
        if not any(item.get("from") == "WAITING_FOR_USER" and item.get("to") == "IN_PROGRESS"
                   for item in transitions):
            raise ValueError("A retomada de WAITING_FOR_USER para IN_PROGRESS não está declarada no workflow")
        self.state.set_stage_status(workflow_id, stage_id, "WAITING_FOR_USER", "IN_PROGRESS")
        self.state.record_event(workflow_id, "STAGE_RESUMED_FOR_PRODUCT_INCREMENT", stage_id=stage_id)
        return f"Etapa {stage_id} retomada para continuar o incremento ativo."

    def present_for_review(self) -> str:
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        status = self.state.stage_status(workflow_id, stage_id)
        if status == "IN_PROGRESS":
            self._transition_stage(workflow_id, stage_id, "IN_PROGRESS", "WAITING_FOR_USER")
            self.state.record_event(workflow_id, "STAGE_DELIVERABLE_PRESENTED", stage_id=stage_id)
        elif status != "WAITING_FOR_USER":
            raise ValueError(f"Só uma etapa em andamento pode ser apresentada; estado atual: {status}")
        return f"Etapa {stage_id} aguardando orientação do usuário."

    def complete_current(self, *, confirmed: bool) -> str:
        if not confirmed:
            raise ValueError("Conclusão exige confirmação explícita (--confirm)")
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        status = self.state.stage_status(workflow_id, stage_id)
        if status != "WAITING_FOR_USER":
            raise ValueError("Apresente o entregável para revisão antes de concluir a etapa")
        passed, reason = self.quality_gate.validate_stage_completion(stage_id)
        if not passed:
            raise ValueError(reason)
        self._transition_stage(workflow_id, stage_id, "WAITING_FOR_USER", "COMPLETED")
        self.state.record_event(workflow_id, "STAGE_COMPLETED", stage_id=stage_id,
                                details={"quality_gate": reason})
        return f"Etapa {stage_id} concluída. A próxima etapa ainda exige autorização explícita."

    def advance(self, *, authorized: bool, evidence: str) -> str:
        if not authorized:
            raise ValueError("Avanço exige autorização explícita (--authorize)")
        if not evidence.strip():
            raise ValueError("Informe a evidência textual da autorização para avançar")
        workflow_id = self.workflow["workflow_id"]
        current_id = self.state.current_stage_id(workflow_id)
        if self.state.stage_status(workflow_id, current_id) != "COMPLETED":
            raise ValueError("A etapa atual ainda não foi concluída e aprovada")
        stages = sorted(self.workflow["stages"], key=lambda item: item["order"])
        current_index = next((index for index, item in enumerate(stages) if item["id"] == current_id), None)
        if current_index is None:
            raise ValueError("A etapa atual não está declarada no workflow")
        completes_increment = current_index + 1 >= len(stages)
        if completes_increment:
            policy = self.workflow.get("product_increment_policy", {})
            increment = self.state.active_discovery_increment(workflow_id)
            if policy.get("execution_model") != "one_increment_per_full_cycle" or not increment:
                raise ValueError("Não há próxima etapa declarada para este workflow")
            next_id = stages[0]["id"]
        else:
            next_id = stages[current_index + 1]["id"]
        blockers = self.dependencies.blockers(next_id)
        if blockers:
            raise ValueError(f"Próxima etapa bloqueada: {', '.join(blockers)}")
        passed, reason = self.quality_gate.validate_stage_completion(current_id)
        if not passed:
            raise ValueError(f"Gate atual inválido: {reason}")
        spec = self.resolver.active_specification()
        artifact_id = spec.spec_id if spec else f"stage-gate:{current_id}"
        artifact_version = spec.version if spec else "1"
        digest = spec.substantive_hash if spec else self.quality_gate.stage_gate_digest(current_id)
        decision_id = self.approvals._append_decision(
            f"Autorização para avançar de {current_id} para {next_id}",
            f"O usuário autorizou explicitamente a transição. Entregável: {artifact_id}@{artifact_version}, hash {digest}. "
            f"Evidência: {self.approvals._safe_text(evidence)}",
        )
        self.state.authorize_transition(workflow_id=workflow_id, from_stage_id=current_id, to_stage_id=next_id,
                                        artifact_id=artifact_id, artifact_version=artifact_version,
                                        substantive_hash=digest, evidence=evidence.strip(), decision_id=decision_id)
        completed_increment = self.state.active_discovery_increment(workflow_id) if completes_increment else None
        if completes_increment:
            self.state.set_active_increment(workflow_id, None)
        self.state.set_current_stage(workflow_id, next_id)
        self.state.record_event(workflow_id, "WORKFLOW_STAGE_ADVANCED", stage_id=next_id,
                                details={"from_stage_id": current_id, "decision_id": decision_id,
                                         "completed_increment_id": (completed_increment or {}).get("increment_id")})
        if completes_increment:
            return (f"Ciclo do incremento {(completed_increment or {}).get('increment_name')} concluído. "
                    "O workflow voltou a Requirements Discovery; abra o próximo incremento explicitamente.")
        return f"Workflow avançado para {next_id}; a etapa aguarda início explícito."

    def run_current(self, *, execute: bool = False, authorized: bool = False,
                    command: list[str] | None = None, task_id: str | None = None) -> ExecutionResult:
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        if self.state.stage_status(workflow_id, stage_id) != "IN_PROGRESS":
            raise ValueError("Inicie explicitamente a etapa atual antes de executar")
        if execute and stage_id == "deployment" and task_id is None:
            raise ValueError("Execução real de entrega exige o ID de uma tarefa aprovada no Planejamento")
        blocked_by = self.dependencies.blockers(stage_id, task_id)
        if blocked_by:
            raise ValueError(f"Execução bloqueada: {', '.join(blocked_by)}")
        contract_context = self.contracts.evaluate(stage_id, task_id, check_inputs=True) if self.contracts else {
            "status": "READY", "blockers": [], "required_contracts": [], "contract_fingerprint": ""
        }
        if contract_context["blockers"]:
            raise ValueError(f"Execução bloqueada por contratos: {', '.join(contract_context['blockers'])}")
        from ..workflow import stage_map
        stage = stage_map(self.workflow)[stage_id]
        spec = self.resolver.active_specification()
        evaluation = self.resolver.resolve(stage_id)
        stage_ready = stage.order == 1 or evaluation.status.value == "READY"
        contract_refs = contract_context["required_contracts"]
        prompt = self.executor.prepare_prompt(stage, self.root, f"{spec.spec_id}@{spec.version}" if spec else None,
                                              task_id=task_id, contract_refs=contract_refs)
        selected_command = command if command is not None else list(self.executor.config.codex_command)
        dry_run = not execute
        increment_id = self.state.active_increment_id(workflow_id)
        key_material = f"{workflow_id}|{increment_id or 'no-increment'}|{stage_id}|{task_id or 'stage'}|{spec.substantive_hash if spec else 'no-spec'}|{contract_context['contract_fingerprint']}|{hashlib.sha256(prompt.encode()).hexdigest()}|{selected_command!r}"
        idempotency_key = hashlib.sha256(key_material.encode()).hexdigest()
        record = self.state.begin_execution(workflow_id, stage_id, idempotency_key, prompt, selected_command,
                                            task_id=task_id, contract_refs=contract_refs,
                                            contract_fingerprint=contract_context["contract_fingerprint"])
        if record["status"] == "COMPLETED":
            return ExecutionResult(ExecutionStatus.COMPLETED, record["run_id"], exit_code=record["exit_code"],
                                   stdout=record["stdout"], stderr=record["stderr"])
        if record["status"] == "PENDING" and not execute:
            return ExecutionResult(ExecutionStatus.PENDING, record["run_id"], stdout=record["stdout"], dry_run=True)
        if record["status"] == "PENDING" and execute:
            record = self.state.restart_pending_execution(record["run_id"])
        try:
            result = self.executor.execute(prompt, command=selected_command, dry_run=dry_run,
                                           authorized=authorized, stage_ready=stage_ready, cwd=self.root)
        except PermissionError as exc:
            self.state.finish_execution(record["run_id"], ExecutionStatus.FAILED, error=str(exc))
            raise
        final_status = ExecutionStatus.PENDING if result.dry_run else result.status
        result_payload = {
            "schema_version": 1,
            "run_id": record["run_id"],
            "workflow_id": workflow_id,
            "stage_id": stage_id,
            "task_id": task_id,
            "contract_refs": contract_refs,
            "status": final_status.value,
            "dry_run": result.dry_run,
            "exit_code": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "error": result.error,
            "outputs": [],
            "validation": {"schema_valid": True, "functional_tests_performed": False,
                           "messages": ["Schema validation does not assert functional requirements."]},
        }
        validation_record = self.contract_validator.validate_execution_result(result_payload) if self.contract_validator else {
            "valid": True, "schema_valid": True, "functional_tests_performed": False, "issues": []
        }
        if not validation_record["valid"]:
            final_status = ExecutionStatus.FAILED
            result_payload["status"] = final_status.value
            result_payload["validation"]["schema_valid"] = False
            result_payload["validation"]["messages"] = [item["message"] for item in validation_record["issues"]]
        if execute and not result.dry_run and final_status == ExecutionStatus.COMPLETED and self.contracts:
            output_issues: list[str] = []
            for reference in contract_refs:
                contract = self.contracts.registry.get(reference["contract_id"], reference["version"])
                if not contract.get("contract_type", "").startswith("product_"):
                    continue
                for output in contract.get("expected_outputs", []):
                    if not output.get("required", True):
                        continue
                    validation = self.contract_validator.validate_output(contract, output["path"])
                    if not validation["valid"]:
                        output_issues.extend(item["message"] for item in validation["issues"])
                    else:
                        output_path = self.contracts.registry.safe_path(output["path"])
                        result_payload["outputs"].append({
                            "path": output_path.relative_to(self.contracts.root).as_posix(),
                            "content_hash": hashlib.sha256(output_path.read_bytes()).hexdigest(),
                            "schema_valid": True,
                            "functional_status": "NOT_TESTED",
                        })
            if output_issues:
                final_status = ExecutionStatus.FAILED
                result_payload["status"] = final_status.value
                result_payload["error"] = "; ".join(output_issues)
                result = ExecutionResult(final_status, result.run_id, result.exit_code, result.stdout,
                                         result.stderr, result_payload["error"], result.dry_run)
        if self.contract_validator:
            final_validation = self.contract_validator.validate_execution_result(result_payload)
            if not final_validation["valid"]:
                final_status = ExecutionStatus.FAILED
                result_payload["status"] = final_status.value
            result_payload["validation"]["schema_valid"] = final_validation["schema_valid"]
            self.state.record_contract_validation(
                workflow_id=workflow_id, contract_id="CONTRACT-002", version="1.0.0",
                content_hash=next((item["content_hash"] for item in contract_refs
                                   if item["contract_id"] == "CONTRACT-002"), ""),
                validation_type="execution-result", status="PASSED" if final_validation["valid"] else "FAILED",
                details={**final_validation, "functional_tests_performed": False, "result": result_payload},
            )
        if task_id and not result.dry_run:
            self.state.set_task_status(workflow_id, task_id, "COMPLETED" if final_status == ExecutionStatus.COMPLETED else "FAILED")
        self.state.finish_execution(record["run_id"], final_status, exit_code=result.exit_code,
                                    stdout=result.stdout, stderr=result.stderr, error=result.error)
        self.state.record_event(workflow_id, "STAGE_EXECUTION_RECORDED", stage_id=stage_id,
                                details={"run_id": record["run_id"], "status": final_status.value,
                                         "dry_run": result.dry_run})
        return ExecutionResult(final_status, record["run_id"], result.exit_code, result.stdout,
                               result.stderr, result.error, result.dry_run)

    def resume(self, *, execute: bool = False, authorized: bool = False) -> ExecutionResult | str:
        workflow_id = self.workflow["workflow_id"]
        recovered = self.state.recover_interrupted_executions(workflow_id)
        stage_id = self.state.current_stage_id(workflow_id)
        latest = self.state.latest_execution(workflow_id, stage_id)
        if not latest:
            return f"Nenhuma execução anterior para retomar. Execuções interrompidas recuperadas: {recovered}."
        if latest["status"] == "COMPLETED":
            return f"A última execução {latest['run_id']} já foi concluída; nenhuma repetição necessária."
        if latest["status"] == "RUNNING":
            return f"A execução {latest['run_id']} ainda está em andamento."
        if latest["status"] in {"FAILED", "PENDING"}:
            return self.run_current(execute=execute, authorized=authorized, task_id=latest.get("task_id"))
        return f"Estado da execução não retomável: {latest['status']}"

    def _transition_stage(self, workflow_id: str, stage_id: str, old: str, new: str) -> None:
        transitions = self.workflow.get("stage_status_transitions", {}).get("allowed", [])
        if not any(item.get("from") == old and item.get("to") == new for item in transitions):
            raise ValueError(f"Transição não declarada no workflow: {old} -> {new}")
        self.state.set_stage_status(workflow_id, stage_id, old, new)
