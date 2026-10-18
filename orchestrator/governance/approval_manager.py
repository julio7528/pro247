from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from ..core.specification_resolver import SpecificationResolver, parse_specification
from ..core.state_manager import StateManager


class ApprovalManager:
    def __init__(self, root: str | Path, workflow: dict[str, Any], state: StateManager,
                 resolver: SpecificationResolver, decision_log_path: str | Path,
                 contract_registry: Any | None = None, contract_validator: Any | None = None):
        self.root = Path(root)
        self.workflow = workflow
        self.state = state
        self.resolver = resolver
        self.decision_log_path = Path(decision_log_path)
        self.contract_registry = contract_registry
        self.contract_validator = contract_validator

    def review_specification(self, spec_id: str) -> dict[str, Any]:
        spec = self._find_spec(spec_id)
        if not spec.complete:
            raise ValueError(f"A especificação ainda precisa de informações: {', '.join(spec.missing_fields)}")
        text = spec.path.read_text(encoding="utf-8")
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        first_stage_id = min(self.workflow["stages"], key=lambda item: item["order"])["id"]
        move_to_waiting = stage_id == first_stage_id and self.state.stage_status(workflow_id, stage_id) == "IN_PROGRESS"
        if move_to_waiting:
            transitions = self.workflow.get("stage_status_transitions", {}).get("allowed", [])
            if not any(item.get("from") == "IN_PROGRESS" and item.get("to") == "WAITING_FOR_USER" for item in transitions):
                raise ValueError("A transição para WAITING_FOR_USER não está declarada no workflow")
        if spec.status == "IN_REVIEW":
            if move_to_waiting:
                self.state.set_stage_status(workflow_id, stage_id, "IN_PROGRESS", "WAITING_FOR_USER")
            return {"spec_id": spec.spec_id, "version": spec.version, "hash": spec.substantive_hash,
                    "path": str(spec.path), "status": spec.status}
        if spec.status not in {"DRAFT", "APPROVED"}:
            raise ValueError(f"Estado não revisável: {spec.status}")
        decision_id = self._append_decision(
            f"Especificação {spec.spec_id}@{spec.version} apresentada para revisão",
            f"A versão foi marcada como IN_REVIEW pelo comando explícito de revisão. Hash substantivo: {spec.substantive_hash}.",
        )
        updated = self._set_status(text, "IN_REVIEW")
        spec.path.write_text(updated, encoding="utf-8", newline="\n")
        if move_to_waiting:
            self.state.set_stage_status(workflow_id, stage_id, "IN_PROGRESS", "WAITING_FOR_USER")
        self.state.record_event(self.workflow["workflow_id"], "SPECIFICATION_PRESENTED_FOR_REVIEW",
                                artifact_id=spec.spec_id, details={"version": spec.version, "decision_id": decision_id})
        return {"spec_id": spec.spec_id, "version": spec.version, "hash": spec.substantive_hash,
                "path": str(spec.path), "status": "IN_REVIEW", "decision_id": decision_id}

    def approve_specification(self, spec_id: str, evidence: str, *, confirmed: bool,
                              expected_version: str, expected_hash: str) -> dict[str, Any]:
        if not confirmed:
            raise ValueError("A aprovação exige a confirmação explícita --confirm")
        if not evidence.strip():
            raise ValueError("A aprovação exige evidência textual da decisão do usuário")
        spec = self._find_spec(spec_id)
        text = spec.path.read_text(encoding="utf-8")
        if spec.version != expected_version or spec.substantive_hash != expected_hash:
            raise ValueError("A versão ou hash mudou após a revisão; apresente a especificação novamente antes de aprovar")
        if not spec.complete or spec.status != "IN_REVIEW":
            raise ValueError("Só é possível aprovar uma especificação completa apresentada como IN_REVIEW")
        prior = self.state.latest_valid_approval(self.workflow["workflow_id"], spec.spec_id, spec.version, spec.substantive_hash)
        if prior and prior["decision"] == "APPROVED":
            return prior
        decision_id = self._append_decision(
            f"Aprovação explícita de {spec.spec_id}@{spec.version}",
            f"O usuário aprovou a versão identificada pelo hash substantivo {spec.substantive_hash}. "
            "A aprovação não autoriza por si só o início da próxima etapa. "
            f"Evidência registrada: {self._safe_text(evidence)}",
        )
        updated = self._set_status(text, "APPROVED")
        updated = self._append_approval_row(updated, spec.spec_id, spec.version, "APROVADO", evidence, decision_id,
                                            False)
        spec.path.write_text(updated, encoding="utf-8", newline="\n")
        record = self.state.add_approval(
            workflow_id=self.workflow["workflow_id"], artifact_id=spec.spec_id, artifact_version=spec.version,
            substantive_hash=spec.substantive_hash, decision="APPROVED", actor="human_user", evidence=evidence.strip(),
            authorize_next_stage=False, decision_id=decision_id,
        )
        self.state.record_artifact(
            workflow_id=self.workflow["workflow_id"], stage_id=self.workflow["current_stage_id"],
            artifact_id="product-specification", artifact_version=f"{spec.spec_id}@{spec.version}",
            path=spec.path, spec_reference=f"{spec.spec_id}@{spec.version}", validation_status="APPROVED",
        )
        return record

    def review_contract(self, contract_id: str, version: str | None = None) -> dict[str, Any]:
        contract = self._find_contract(contract_id, version)
        validation = self.contract_validator.validate_document(contract, path=contract["_path"])
        if not validation["schema_valid"] or not validation["semantic_valid"] or validation["missing_fields"]:
            raise ValueError("Contrato não pode ser apresentado; corrija sua validação ou esclareça: " +
                             "; ".join(item["message"] for item in validation["issues"]))
        if contract.get("contract_type", "").startswith("operational_"):
            raise ValueError("Contratos operacionais versionados pelo projeto não usam aprovação humana individual")
        spec = self.resolver.active_specification()
        if not spec or not self.has_approved_product_specification():
            raise ValueError("A revisão de contrato exige a especificação de origem atualmente aprovada")
        if contract.get("lifecycle_state") not in {"DRAFT", "REJECTED", "IN_REVIEW"}:
            raise ValueError(f"Contrato não revisável no estado {contract.get('lifecycle_state')}")
        decision_id = self._append_decision(
            f"Contrato {contract_id}@{contract['version']} apresentado para revisão",
            f"Contrato vinculado a {contract['originating_spec_reference']} e hash {contract['content_hash']}; revisão não concede aprovação.",
        )
        contract["lifecycle_state"] = "IN_REVIEW"
        path, digest = self.contract_registry.write(contract, path=contract["_path"])
        self.state.record_contract_validation(
            workflow_id=self.workflow["workflow_id"], contract_id=contract_id, version=contract["version"],
            content_hash=digest, validation_type="review", status="PASSED", details=validation,
        )
        self.state.record_event(self.workflow["workflow_id"], "CONTRACT_PRESENTED_FOR_REVIEW",
                                stage_id=self.state.current_stage_id(self.workflow["workflow_id"]),
                                artifact_id=contract_id,
                                details={"version": contract["version"], "content_hash": digest,
                                         "spec_reference": contract["originating_spec_reference"],
                                         "decision_id": decision_id, "path": str(path)})
        return {"contract_id": contract_id, "version": contract["version"], "hash": digest,
                "path": str(path), "status": "IN_REVIEW", "decision_id": decision_id,
                "validation": validation}

    def approve_contract(self, contract_id: str, evidence: str, *, confirmed: bool,
                         expected_version: str, expected_hash: str) -> dict[str, Any]:
        if not confirmed:
            raise ValueError("A aprovação de contrato exige confirmação explícita (--confirm)")
        if not evidence.strip():
            raise ValueError("A aprovação de contrato exige evidência textual")
        contract = self._find_contract(contract_id, expected_version)
        if contract["version"] != expected_version or contract["content_hash"] != expected_hash:
            raise ValueError("A versão ou hash do contrato mudou após a revisão; revise novamente antes de aprovar")
        if contract.get("lifecycle_state") != "IN_REVIEW":
            raise ValueError("Só é possível aprovar a versão de contrato apresentada como IN_REVIEW")
        if not self.state.has_contract_review(self.workflow["workflow_id"], contract_id, expected_version, expected_hash):
            raise ValueError("Não há evento de revisão persistido para esta versão e hash; use contract review")
        validation = self.contract_validator.validate_document(contract, path=contract["_path"])
        if not validation["schema_valid"] or not validation["semantic_valid"] or validation["missing_fields"]:
            raise ValueError("Contrato inválido ou incompleto: " + "; ".join(item["message"] for item in validation["issues"]))
        prior = self.state.latest_valid_approval(self.workflow["workflow_id"], contract_id,
                                                 expected_version, expected_hash)
        if prior and prior["decision"] == "APPROVED":
            return prior
        decision_id = self._append_decision(
            f"Aprovação explícita de contrato {contract_id}@{expected_version}",
            f"Contrato aprovado para hash {expected_hash} e especificação {contract['originating_spec_reference']}. "
            f"Isso não aprova entregáveis de etapa nem autoriza transições. Evidência: {self._safe_text(evidence)}",
        )
        contract["lifecycle_state"] = "APPROVED"
        record_metadata = {"decision_id": decision_id, "actor": "human_user", "evidence": evidence.strip(),
                           "content_hash": expected_hash, "approved_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        contract["approval_metadata"] = record_metadata
        path, digest = self.contract_registry.write(contract, path=contract["_path"])
        record = self.state.add_approval(
            workflow_id=self.workflow["workflow_id"], artifact_id=contract_id, artifact_version=expected_version,
            substantive_hash=expected_hash, decision="APPROVED", actor="human_user", evidence=evidence.strip(),
            authorize_next_stage=False, decision_id=decision_id, event_type="CONTRACT_APPROVED",
        )
        record_metadata["approval_id"] = record["approval_id"]
        contract["approval_metadata"] = record_metadata
        self.contract_registry.write(contract, path=path)
        self.state.record_contract_validation(
            workflow_id=self.workflow["workflow_id"], contract_id=contract_id, version=expected_version,
            content_hash=digest, validation_type="approval", status="PASSED", details=validation,
        )
        return record

    def reject_contract(self, contract_id: str, reason: str, *, confirmed: bool,
                        expected_version: str, expected_hash: str) -> dict[str, Any]:
        if not confirmed or not reason.strip():
            raise ValueError("Rejeição de contrato exige --confirm e motivo")
        contract = self._find_contract(contract_id, expected_version)
        if contract["version"] != expected_version or contract["content_hash"] != expected_hash:
            raise ValueError("A versão ou hash do contrato mudou após a revisão")
        if contract.get("lifecycle_state") != "IN_REVIEW":
            raise ValueError("Só é possível rejeitar um contrato apresentado para revisão")
        if not self.state.has_contract_review(self.workflow["workflow_id"], contract_id, expected_version, expected_hash):
            raise ValueError("Não há evento de revisão persistido para esta versão e hash")
        decision_id = self._append_decision(f"Revisão solicitada para contrato {contract_id}@{expected_version}",
                                            f"Ajustes solicitados: {self._safe_text(reason)}")
        contract["lifecycle_state"] = "REJECTED"
        contract["approval_metadata"] = {"decision_id": decision_id, "actor": "human_user",
                                          "evidence": self._safe_text(reason), "content_hash": expected_hash}
        path, _ = self.contract_registry.write(contract, path=contract["_path"])
        record = self.state.add_approval(
            workflow_id=self.workflow["workflow_id"], artifact_id=contract_id, artifact_version=expected_version,
            substantive_hash=expected_hash, decision="REJECTED", actor="human_user", evidence=reason.strip(),
            authorize_next_stage=False, decision_id=decision_id, event_type="CONTRACT_REJECTED",
        )
        self.contract_registry.write(contract, path=path)
        return record

    def reject_specification(self, spec_id: str, reason: str, *, confirmed: bool,
                             expected_version: str, expected_hash: str) -> dict[str, Any]:
        if not confirmed:
            raise ValueError("A rejeição exige a confirmação explícita --confirm")
        if not reason.strip():
            raise ValueError("Informe o motivo ou as alterações solicitadas")
        spec = self._find_spec(spec_id)
        if spec.version != expected_version or spec.substantive_hash != expected_hash:
            raise ValueError("A versão ou hash mudou após a revisão; apresente a especificação novamente antes de rejeitar")
        if spec.status not in {"IN_REVIEW", "APPROVED"}:
            raise ValueError("Só é possível rejeitar um documento apresentado para revisão")
        decision_id = self._append_decision(
            f"Revisão solicitada para {spec.spec_id}@{spec.version}",
            f"O usuário não aceitou a versão e solicitou: {self._safe_text(reason)}. A especificação volta a DRAFT.",
        )
        text = spec.path.read_text(encoding="utf-8")
        updated = self._set_status(text, "DRAFT")
        updated = self._append_approval_row(updated, spec.spec_id, spec.version, "REJEITADO", reason, decision_id, False)
        spec.path.write_text(updated, encoding="utf-8", newline="\n")
        record = self.state.add_approval(
            workflow_id=self.workflow["workflow_id"], artifact_id=spec.spec_id, artifact_version=spec.version,
            substantive_hash=spec.substantive_hash, decision="REJECTED", actor="human_user", evidence=reason.strip(),
            authorize_next_stage=False, decision_id=decision_id,
        )
        workflow_id = self.workflow["workflow_id"]
        stage_id = self.state.current_stage_id(workflow_id)
        if stage_id == self.workflow["stages"][0]["id"] and self.state.stage_status(workflow_id, stage_id) == "WAITING_FOR_USER":
            transitions = self.workflow.get("stage_status_transitions", {}).get("allowed", [])
            if any(item.get("from") == "WAITING_FOR_USER" and item.get("to") == "IN_PROGRESS" for item in transitions):
                self.state.set_stage_status(workflow_id, stage_id, "WAITING_FOR_USER", "IN_PROGRESS")
        return record

    def approve_stage_gate(self, stage_id: str, evidence: str, *, confirmed: bool,
                           expected_hash: str) -> dict[str, Any]:
        if not confirmed:
            raise ValueError("A aprovação do gate exige a confirmação explícita --confirm")
        if not evidence.strip():
            raise ValueError("A aprovação do gate exige evidência textual")
        stage = next((item for item in self.workflow["stages"] if item["id"] == stage_id), None)
        if stage is None:
            raise ValueError(f"Etapa desconhecida: {stage_id}")
        spec = self.resolver.active_specification()
        spec_reference = f"{spec.spec_id}@{spec.version}" if spec else None
        records = self.state.artifact_records(
            self.workflow["workflow_id"], stage_id, spec_reference=spec_reference
        )
        required = {item["id"] for item in stage["deliverables"]}
        passed = {item["artifact_id"] for item in records if item["validation_status"] == "PASSED"}
        missing = required - passed
        if missing:
            raise ValueError(f"Entregáveis ausentes ou não validados: {', '.join(sorted(missing))}")
        for row in records:
            if row["artifact_id"] not in required or row["validation_status"] != "PASSED":
                continue
            artifact_path = Path(row["path"])
            if not artifact_path.is_file() or hashlib.sha256(artifact_path.read_bytes()).hexdigest() != row["content_hash"]:
                raise ValueError(f"Entregável alterado desde a validação; registre-o novamente: {artifact_path}")
        digest = self.stage_gate_hash(records, required)
        if digest != expected_hash:
            raise ValueError("Os entregáveis mudaram após a revisão; valide e apresente novamente o gate")
        decision_id = self._append_decision(
            f"Aprovação do gate da etapa {stage_id}",
            f"O usuário aprovou os entregáveis validados com hash agregado {digest}. Evidência: {self._safe_text(evidence)}",
        )
        return self.state.add_approval(
            workflow_id=self.workflow["workflow_id"], artifact_id=f"stage-gate:{stage_id}", artifact_version="1",
            substantive_hash=digest, decision="APPROVED", actor="human_user", evidence=evidence.strip(),
            authorize_next_stage=False, decision_id=decision_id,
        )

    def authorize_deployment(self, scope: str, version: str, evidence: str, *, confirmed: bool) -> dict[str, Any]:
        if not confirmed:
            raise ValueError("Deploy em produção exige confirmação explícita (--confirm)")
        if not scope.strip() or not version.strip() or not evidence.strip():
            raise ValueError("Informe escopo, versão e evidência explícita para o deploy")
        workflow_id = self.workflow["workflow_id"]
        deployment_stage = next((item for item in self.workflow["stages"] if item["id"] == "deployment"), None)
        if deployment_stage is None or self.state.current_stage_id(workflow_id) != "deployment":
            raise ValueError("A autorização de produção só pode ser registrada quando deployment for a etapa atual")
        if self.state.stage_status(workflow_id, "deployment") != "IN_PROGRESS":
            raise ValueError("Inicie explicitamente a etapa deployment antes de autorizar a publicação")
        review_stage = next((item for item in self.workflow["stages"] if item["id"] == "technical-review-approval"), None)
        if review_stage is None or self.state.stage_status(workflow_id, review_stage["id"]) != "COMPLETED":
            raise ValueError("A etapa de revisão técnica e aceite do Product Owner precisa estar concluída")
        if not self.has_current_stage_gate(review_stage["id"]):
            raise ValueError("A revisão técnica e o aceite do Product Owner não têm gate verificável")
        if not self.has_approved_product_specification():
            raise ValueError("A especificação de origem não tem aprovação válida")
        decision_id = self._append_decision(
            f"Autorização de deploy em produção — {version}",
            f"O usuário autorizou explicitamente publicar a versão {self._safe_text(version)} no escopo "
            f"{self._safe_text(scope)}. Evidência: {self._safe_text(evidence)}",
        )
        return self.state.add_deployment_authorization(workflow_id, scope.strip(), version.strip(),
                                                       evidence.strip(), decision_id)

    @staticmethod
    def stage_gate_hash(records: list[dict[str, Any]], required_ids: set[str]) -> str:
        selected = []
        for row in records:
            if row["artifact_id"] not in required_ids or row["validation_status"] != "PASSED":
                continue
            contract_refs = row.get("contract_refs_json", "[]")
            try:
                refs = json.loads(contract_refs) if isinstance(contract_refs, str) else contract_refs
            except json.JSONDecodeError:
                refs = ["invalid-contract-reference-data"]
            base = (row["artifact_id"], row["artifact_version"], row["content_hash"])
            selected.append(base + ((json.dumps(refs, sort_keys=True),) if refs else ()))
        selected.sort()
        return hashlib.sha256(repr(selected).encode("utf-8")).hexdigest()

    def has_approved_product_specification(self) -> bool:
        try:
            spec = self.resolver.active_specification()
        except ValueError:
            return False
        if not spec or not spec.complete:
            return False
        record = self.state.latest_valid_approval(
            self.workflow["workflow_id"], spec.spec_id, spec.version, spec.substantive_hash
        )
        return bool(record and record["decision"] == "APPROVED")

    def has_current_stage_gate(self, stage_id: str) -> bool:
        if stage_id == self.workflow["stages"][0]["id"]:
            return self.has_approved_product_specification()
        stage = next((item for item in self.workflow["stages"] if item["id"] == stage_id), None)
        if not stage:
            return False
        spec = self.resolver.active_specification()
        spec_reference = f"{spec.spec_id}@{spec.version}" if spec else None
        records = self.state.artifact_records(
            self.workflow["workflow_id"], stage_id, spec_reference=spec_reference
        )
        required = {item["id"] for item in stage["deliverables"]}
        passed = {item["artifact_id"] for item in records if item["validation_status"] == "PASSED"}
        if required - passed:
            return False
        for row in records:
            if row["artifact_id"] not in required or row["validation_status"] != "PASSED":
                continue
            artifact_path = Path(row["path"])
            if not artifact_path.is_file() or hashlib.sha256(artifact_path.read_bytes()).hexdigest() != row["content_hash"]:
                return False
        digest = self.stage_gate_hash(records, required)
        approval = self.state.latest_valid_approval(self.workflow["workflow_id"], f"stage-gate:{stage_id}", "1", digest)
        return bool(approval and approval["decision"] == "APPROVED")

    def _find_spec(self, spec_id: str):
        spec = next((item for item in self.resolver.find_specifications() if item.spec_id == spec_id), None)
        if spec is None:
            raise ValueError(f"Especificação não encontrada ou vazia: {spec_id}")
        if self.workflow.get("product_increment_policy", {}).get("execution_model") == "one_increment_per_full_cycle":
            increment = self.state.active_discovery_increment(self.workflow["workflow_id"])
            if not increment or increment.get("spec_id") != spec_id:
                raise ValueError("Neste workflow, apenas a spec do incremento ativo pode ser revisada ou decidida")
        return spec

    def _find_contract(self, contract_id: str, version: str | None = None) -> dict[str, Any]:
        if self.contract_registry is None or self.contract_validator is None:
            raise ValueError("Gerenciamento de contratos não foi inicializado")
        return self.contract_registry.get(contract_id, version)

    def _append_decision(self, title: str, effect: str) -> str:
        if not self.decision_log_path.is_file():
            raise ValueError(f"Registro obrigatório do projeto não encontrado: {self.decision_log_path}")
        content = self.decision_log_path.read_text(encoding="utf-8")
        ids = [int(value) for value in re.findall(r"^### DEC-(\d{3,})\b", content, flags=re.MULTILINE)]
        next_id = f"DEC-{max(ids, default=0) + 1:03d}"
        timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
        block = (f"\n### {next_id} — {title}\n\n"
                 f"- **Registrado em:** {timestamp}\n"
                 f"- **Evento/decisão:** {title}.\n"
                 f"- **Contexto:** Decisão registrada pelo orquestrador em resposta a uma ação explícita do usuário.\n"
                 f"- **Efeito:** {effect}\n")
        self.decision_log_path.write_text(content.rstrip() + "\n" + block, encoding="utf-8", newline="\n")
        return next_id

    @staticmethod
    def _set_status(markdown: str, status: str) -> str:
        pattern = re.compile(r"^(\|\s*Estado\s*\|\s*).*?(\s*\|\s*)$", re.MULTILINE)
        if not pattern.search(markdown):
            raise ValueError("Especificação sem campo de metadados Estado")
        return pattern.sub(lambda match: f"{match.group(1)}`{status}`{match.group(2)}", markdown, count=1)

    @staticmethod
    def _append_approval_row(markdown: str, spec_id: str, version: str, decision: str, evidence: str,
                             decision_id: str, authorize_next: bool) -> str:
        section = re.search(r"(^## Registro de aprovação\s*\n)(.*)\Z", markdown, flags=re.MULTILINE | re.DOTALL)
        if not section:
            return markdown
        body = section.group(2)
        body = re.sub(r"^Nenhuma aprovação registrada\.\s*\n?", "", body, flags=re.MULTILINE)
        rows = list(re.finditer(r"^\|.*\|\s*$", body, flags=re.MULTILINE))
        table_row = (f"| `{spec_id}@{version}` | Usuário humano | {decision} | {datetime.now().astimezone().isoformat(timespec='seconds')} | "
                     f"{ApprovalManager._safe_text(evidence)} | {decision_id} | {'Sim' if authorize_next else 'Não'} |")
        if rows:
            insertion = rows[-1].end()
            body = body[:insertion] + "\n" + table_row + body[insertion:]
        else:
            body = body.rstrip() + "\n\n" + table_row + "\n"
        return markdown[:section.start(2)] + body

    @staticmethod
    def _safe_text(value: str) -> str:
        return " ".join(value.strip().split()).replace("|", "\\|")
