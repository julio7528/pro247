from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import OrchestratorConfig
from ..contracts import ContractAssessmentManager, ContractGenerator, ContractRegistry, ContractResolver, ContractValidator
from ..discovery.clarification_manager import ClarificationManager
from ..discovery.requirements_collector import RequirementsCollector
from ..executors.codex_executor import CodexExecutor
from ..governance.approval_manager import ApprovalManager
from ..governance.quality_gate import QualityGate
from ..models import Evaluation
from ..workflow import load_workflow
from .dependency_validator import DependencyValidator
from .specification_resolver import (
    AmbiguousSpecificationError, InvalidSpecificationError, SpecificationResolver,
)
from .stage_controller import StageController
from .state_manager import StateManager


class WorkflowEngine:
    def __init__(self, config: OrchestratorConfig):
        self.config = config
        self.workflow = load_workflow(config.workflow_path, config.workflow_schema_path, config.root)
        bootstrap = self.workflow.get("initialization", {}).get("bootstrap_path", "specs/INIT.md")
        bootstrap_path = config.root / bootstrap
        if not bootstrap_path.is_file():
            raise ValueError(f"Bootstrap de requisitos ausente: {bootstrap_path}")
        self.bootstrap_text = bootstrap_path.read_text(encoding="utf-8")
        if not self.bootstrap_text.strip():
            raise ValueError("Bootstrap specs/INIT.md está vazio")
        first_stage = min(self.workflow["stages"], key=lambda item: item["order"])
        initialization = self.workflow.get("initialization", {})
        if first_stage["id"] != self.workflow["current_stage_id"]:
            raise ValueError("O bootstrap inicial deve apontar para a primeira etapa declarada")
        if first_stage["status"] != initialization.get("stage_1_status"):
            raise ValueError("O estado inicial da primeira etapa diverge de specs/INIT.md/workflow.yaml")
        if initialization.get("subsequent_stage_status") != "PENDING":
            raise ValueError("O estado inicial das etapas seguintes precisa permanecer PENDING")
        for marker in ("Etapa atual:", "NOT_STARTED", "PENDING", "Especificações de produto aprovadas:** nenhuma", "Gates de aprovação:** nenhum"):
            if marker not in self.bootstrap_text:
                raise ValueError(f"specs/INIT.md não confirma o estado inicial esperado: {marker}")
        self.state = StateManager(config.state_db_path)
        for legacy_workflow_id in self.workflow.get("legacy_workflow_ids", []):
            self.state.migrate_workflow_id(legacy_workflow_id, self.workflow["workflow_id"])
        self.state.initialize_workflow(self.workflow)
        self.resolver = SpecificationResolver(config.root, self.workflow, self.state)
        self.clarification = ClarificationManager(self.workflow, self.state, self.resolver)
        self.collector = RequirementsCollector(config.root, self.workflow, self.state, self.resolver, self.clarification)
        self.contract_registry = ContractRegistry(config.root, self.state, self.workflow["workflow_id"])
        self.approvals = ApprovalManager(config.root, self.workflow, self.state, self.resolver, config.decision_log_path,
                                         self.contract_registry)
        self.contract_validator = ContractValidator(config.root, self.contract_registry, self.state,
                                                    self.resolver, self.approvals)
        self.approvals.contract_validator = self.contract_validator
        self.contract_assessment = ContractAssessmentManager(
            config.root, self.workflow, self.state, self.resolver, self.approvals,
            self.contract_registry, self.contract_validator,
        )
        self.contract_generator = ContractGenerator(
            config.root, self.workflow, self.contract_registry, self.contract_validator,
            self.contract_assessment, self.resolver, self.approvals, self.state,
        )
        self.contract_resolver = ContractResolver(
            config.root, self.workflow, self.state, self.resolver, self.approvals,
            self.contract_registry, self.contract_validator, self.contract_assessment,
        )
        for operational in self.contract_registry.load_all():
            if operational.get("contract_type", "").startswith("operational_"):
                self.state.register_contract(operational, operational["_path"], workflow_id=self.workflow["workflow_id"])
                result = self.contract_validator.validate_document(operational, path=operational.get("_path"))
                if not result["schema_valid"] or not result["semantic_valid"]:
                    raise ValueError(f"Contrato operacional inválido {operational.get('contract_id')}: {result['issues']}")
        self.quality_gate = QualityGate(self.workflow, self.state, self.resolver, self.approvals,
                                        contract_assessment=self.contract_assessment,
                                        contracts=self.contract_resolver)
        self.dependencies = DependencyValidator(self.workflow, self.state, self.approvals,
                                                contracts=self.contract_resolver)
        self.executor = CodexExecutor(config)
        self.controller = StageController(str(config.root), self.workflow, self.state, self.resolver,
                                         self.dependencies, self.quality_gate, self.approvals, self.executor,
                                         contracts=self.contract_resolver, contract_validator=self.contract_validator)

    def close(self) -> None:
        self.state.close()

    def evaluate(self, stage_id: str | None = None) -> Evaluation:
        selected = stage_id or self.state.current_stage_id(self.workflow["workflow_id"])
        return self.resolver.resolve(selected, self.dependencies.blockers(selected))

    def inspect(self) -> dict[str, Any]:
        workflow_id = self.workflow["workflow_id"]
        current_stage = self.state.current_stage_id(workflow_id)
        statuses = self.state.stage_statuses(workflow_id)
        rows = []
        for stage in sorted(self.workflow["stages"], key=lambda item: item["order"]):
            execution = self.state.latest_execution(workflow_id, stage["id"])
            rows.append({
                "id": stage["id"],
                "name": stage["name"],
                "stage_status": statuses[stage["id"]],
                "execution_status": execution["status"] if execution else "PENDING",
                "assigned_agents": stage["agents"],
                "skill": stage["skill"],
                "is_current": stage["id"] == current_stage,
            })
        try:
            spec = self.resolver.active_specification()
            selection_required = False
            selection_issue = None
        except AmbiguousSpecificationError:
            spec = None
            selection_required = True
            selection_issue = "Várias especificações precisam de seleção explícita."
        except InvalidSpecificationError as exc:
            spec = None
            selection_required = False
            selection_issue = str(exc)
        increment = self.state.active_discovery_increment(workflow_id)
        return {
            "workflow_id": workflow_id,
            "current_stage_id": current_stage,
            "workflow_definition_state": self.workflow["state"],
            "active_increment": increment,
            "stages": rows,
            "active_specification": None if not spec else {
                "id": spec.spec_id, "version": spec.version, "status": spec.status,
                "path": str(spec.path), "complete": spec.complete,
                "content_hash": spec.content_hash, "substantive_hash": spec.substantive_hash,
            },
            "specification_selection_required": selection_required,
            "specification_resolution_issue": selection_issue,
            "recent_events": self.state.events(workflow_id)[-10:],
        }

    def discover_questions(self, *, new_increment: bool = False,
                           increment_name: str | None = None) -> list[Any]:
        stage_id = self.state.current_stage_id(self.workflow["workflow_id"])
        if stage_id != self.workflow["stages"][0]["id"]:
            raise ValueError("A descoberta de requisitos só é suportada na etapa Requirements Discovery")
        workflow_id = self.workflow["workflow_id"]
        active = self.state.active_discovery_increment(workflow_id, stage_id)
        latest = self.state.current_discovery_increment(workflow_id, stage_id)
        if new_increment:
            if not increment_name or not increment_name.strip():
                raise ValueError("--new-increment exige um nome em --name")
            if active:
                raise ValueError("Conclua e aprove o ciclo completo do incremento atual antes de iniciar outro")
            if latest:
                final_stage_id = max(self.workflow["stages"], key=lambda item: item["order"])["id"]
                final_status = self.state.increment_stage_status(int(latest["increment_id"]), final_stage_id)
                if final_status != "COMPLETED":
                    raise ValueError("O incremento anterior ainda não concluiu todas as etapas do ciclo")
            current = self.state.start_discovery_increment(workflow_id, stage_id, increment_name)
        else:
            if active:
                current = active
            elif latest:
                raise ValueError("O último incremento já foi encerrado; use --new-increment --name para abrir o próximo")
            else:
                current = self.state.ensure_initial_discovery_increment(
                    workflow_id, stage_id, increment_name or "Incremento 1"
                )

        stage_status = self.state.stage_status(workflow_id, stage_id)
        if stage_status in {"NOT_STARTED", "PENDING"}:
            self.controller.start_current()
        elif stage_status == "WAITING_FOR_USER":
            self.controller.resume_current()
        elif stage_status != "IN_PROGRESS":
            raise ValueError(f"O incremento não pode iniciar requisitos no estado {stage_status}")

        spec = None
        if current and current.get("spec_id"):
            spec = next((item for item in self.resolver.find_specifications()
                         if item.spec_id == current["spec_id"]), None)
        if spec and spec.complete:
            return []
        return self.clarification.questions(stage_id)

    def collect_requirements(self) -> Path:
        stage_id = self.state.current_stage_id(self.workflow["workflow_id"])
        return self.collector.generate_or_update(stage_id)
