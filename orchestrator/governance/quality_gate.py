from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from ..core.specification_resolver import SpecificationResolver
from ..core.state_manager import StateManager


class QualityGate:
    def __init__(self, workflow: dict[str, Any], state: StateManager,
                 resolver: SpecificationResolver, approvals: Any, contract_assessment: Any | None = None,
                 contracts: Any | None = None):
        self.workflow = workflow
        self.state = state
        self.resolver = resolver
        self.approvals = approvals
        self.contract_assessment = contract_assessment
        self.contracts = contracts

    def validate_artifact(self, stage_id: str, artifact_id: str, path: str | Path,
                          spec_reference: str | None, requirement_ids: list[str] | tuple[str, ...] = (),
                          task_ids: list[str] | tuple[str, ...] = (),
                          contract_refs: list[dict[str, str]] | tuple[dict[str, str], ...] = ()) -> tuple[bool, str]:
        stage = self._stage(stage_id)
        declared = {item["id"] for item in stage["deliverables"]}
        if artifact_id not in declared:
            return False, f"Entregável não declarado na etapa: {artifact_id}"
        artifact_path = Path(path)
        if not artifact_path.is_absolute():
            artifact_path = self.resolver.root / artifact_path
        if not artifact_path.is_file():
            return False, f"Arquivo de entrega não encontrado: {artifact_path}"
        if artifact_id == "contract-assessment" and self.contract_assessment is not None:
            assessment, blockers = self.contract_assessment.current()
            if blockers or not assessment or artifact_path.resolve() != self.contract_assessment.path.resolve():
                return False, "Avaliação de contratos ausente, desatualizada ou em caminho incorreto: " + ", ".join(blockers)
            return True, "Avaliação do Tech Lead ligada à especificação aprovada, às tarefas e ao hash registrados."
        artifact_text = artifact_path.read_text(encoding="utf-8")
        if stage["order"] > 1:
            spec = self.resolver.active_specification()
            expected = f"{spec.spec_id}@{spec.version}" if spec else None
            if not expected or spec_reference != expected:
                return False, f"Referência de origem deve ser exatamente {expected or 'uma especificação aprovada'}"
            if not self.approvals.has_approved_product_specification():
                return False, "A especificação de origem ainda não tem aprovação verificável"
            spec_text = spec.path.read_text(encoding="utf-8")
            missing_requirements = [item for item in requirement_ids if item not in spec_text]
            if missing_requirements:
                return False, f"Requisitos não encontrados na especificação de origem: {', '.join(missing_requirements)}"
        if contract_refs:
            if self.contracts is None:
                return False, "Validação de contratos não foi inicializada"
            for reference in contract_refs:
                try:
                    contract = self.contracts.registry.get(reference["contract_id"], reference["version"])
                except (ValueError, KeyError) as exc:
                    return False, f"Referência de contrato inválida: {exc}"
                if contract.get("content_hash") != reference.get("content_hash"):
                    return False, f"Hash divergente para {reference['contract_id']}@{reference['version']}"
                validation = self.contracts.validator.validate_document(
                    contract, path=contract.get("_path"), require_approval=True,
                )
                if not validation["ready"]:
                    return False, f"Contrato inválido ou não aprovado {reference['contract_id']}: {validation['issues']}"
                if task_ids and not set(task_ids).issubset(set(contract.get("task_ids", []))):
                    return False, f"Contrato {reference['contract_id']} não cobre as tarefas declaradas"
                if requirement_ids and not set(requirement_ids).issubset(set(contract.get("requirement_ids", []))):
                    return False, f"Contrato {reference['contract_id']} não cobre os requisitos declarados"
        missing_tasks = [item for item in task_ids if item not in artifact_text and
                         not any((self.resolver.root / "tasks").glob(f"{item}.*"))]
        if missing_tasks:
            return False, f"IDs de tarefa sem referência no artefato ou em tasks/: {', '.join(missing_tasks)}"
        return True, "Arquivo existe, está declarado e mantém a rastreabilidade exigida."

    def stage_gate_digest(self, stage_id: str) -> str:
        stage = self._stage(stage_id)
        spec = self.resolver.active_specification()
        spec_reference = f"{spec.spec_id}@{spec.version}" if spec else None
        records = self.state.artifact_records(
            self.workflow["workflow_id"], stage_id, spec_reference=spec_reference
        )
        required = {item["id"] for item in stage["deliverables"]}
        passed = {item["artifact_id"] for item in records if item["validation_status"] == "PASSED"}
        missing = required - passed
        if missing:
            raise ValueError(f"Entregáveis ausentes ou não aprovados pela validação: {', '.join(sorted(missing))}")
        for record in records:
            if record["artifact_id"] not in required or record["validation_status"] != "PASSED":
                continue
            artifact_path = Path(record["path"])
            if not artifact_path.is_file():
                raise ValueError(f"Entregável registrado não existe mais: {artifact_path}")
            current_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
            if current_hash != record["content_hash"]:
                raise ValueError(f"Entregável mudou após o registro; valide novamente: {artifact_path}")
        from .approval_manager import ApprovalManager
        return ApprovalManager.stage_gate_hash(records, required)

    def validate_stage_completion(self, stage_id: str) -> tuple[bool, str]:
        stage = self._stage(stage_id)
        if stage_id == self.workflow["stages"][0]["id"]:
            increment = self.state.active_discovery_increment(self.workflow["workflow_id"], stage_id)
            if not increment:
                return False, "Inicie um incremento antes de concluir o levantamento de requisitos."
            spec = self.resolver.active_specification()
            if not spec or not spec.complete or not self.approvals.has_approved_product_specification():
                return False, (f"O incremento {increment['increment_order']} ({increment['increment_name']}) "
                               "exige uma especificação completa e aprovada com hash válido.")
            return True, f"A spec {spec.spec_id}@{spec.version} do incremento está aprovada e rastreável."
        if stage_id == "planning" and self.contract_assessment is not None:
            assessment, blockers = self.contract_assessment.current()
            if blockers or not assessment:
                return False, "A etapa Planning exige avaliação atual de contratos: " + ", ".join(blockers)
        if stage_id == "deployment" and self.contracts is not None:
            for task in self.contracts.production_deployment_tasks():
                if not self.state.has_deployment_authorization(
                        self.workflow["workflow_id"], scope=task.get("deployment_scope"),
                        version=task.get("deployment_version")):
                    return False, ("Falta autorização explícita para a publicação em produção planejada: "
                                   f"{task.get('deployment_scope')} versão {task.get('deployment_version')}.")
        try:
            digest = self.stage_gate_digest(stage_id)
        except ValueError as exc:
            return False, str(exc)
        approval = self.state.latest_valid_approval(
            self.workflow["workflow_id"], f"stage-gate:{stage_id}", "1", digest
        )
        if not approval or approval["decision"] != "APPROVED":
            return False, "Falta aprovação humana verificável do gate dos entregáveis desta etapa."
        return True, "Entregáveis e aprovação de gate válidos."

    def _stage(self, stage_id: str) -> dict[str, Any]:
        stage = next((item for item in self.workflow["stages"] if item["id"] == stage_id), None)
        if stage is None:
            raise ValueError(f"Etapa desconhecida: {stage_id}")
        return stage
