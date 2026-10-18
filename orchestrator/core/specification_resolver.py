from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from ..models import Evaluation, ResolutionStatus, Specification
from .state_manager import StateManager

SPEC_ID_RE = re.compile(r"\bSPEC-(\d{3,})\b")


class AmbiguousSpecificationError(ValueError):
    pass


class InvalidSpecificationError(ValueError):
    pass


def metadata_value(markdown: str, label: str) -> str | None:
    pattern = re.compile(rf"^\|\s*{re.escape(label)}\s*\|\s*(.*?)\s*\|\s*$", re.MULTILINE)
    match = pattern.search(markdown)
    if not match:
        return None
    value = match.group(1).strip()
    return value.strip("`").strip() or None


def substantive_fingerprint(markdown: str) -> str:
    """Hash the reviewed requirements while excluding mutable approval metadata."""
    content = re.sub(r"^\|\s*Estado\s*\|.*$", "| Estado | [lifecycle] |", markdown, flags=re.MULTILINE)
    approval_heading = re.search(r"^## Registro de aprovação\s*$", content, flags=re.MULTILINE)
    if approval_heading:
        content = content[:approval_heading.start()]
    canonical = "\n".join(line.rstrip() for line in content.strip().splitlines()).strip()
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def content_hash(markdown: str) -> str:
    return hashlib.sha256(markdown.encode("utf-8")).hexdigest()


def parse_specification(path: Path) -> Specification | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    if not text.strip():
        return None
    id_match = SPEC_ID_RE.search(path.name)
    file_spec_id = id_match.group(0) if id_match else None
    metadata_spec_id = metadata_value(text, "Identificador")
    if not metadata_spec_id:
        return None
    if file_spec_id and metadata_spec_id and file_spec_id != metadata_spec_id:
        return None
    spec_id = file_spec_id or metadata_spec_id
    if not spec_id or not re.fullmatch(r"SPEC-\d{3,}", spec_id):
        return None
    version = metadata_value(text, "Versão")
    status = metadata_value(text, "Estado")
    if not version or not status:
        return None
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        return None
    status = status.upper()
    if status not in {"DRAFT", "IN_REVIEW", "APPROVED"}:
        return None
    objective = _section(text, "Objetivo")
    scope = _section(text, "Escopo")
    included_scope = _subsection(scope, "Incluído")
    requirements = _section(text, "Requisitos funcionais")
    missing: list[str] = []
    if not _has_confirmed_text(objective):
        missing.append("objective")
    if not _has_confirmed_text(included_scope):
        missing.append("scope")
    if not _has_verifiable_requirement(requirements):
        missing.append("functional_requirement")
    return Specification(
        spec_id=spec_id,
        version=version,
        status=status,
        path=path,
        content_hash=content_hash(text),
        substantive_hash=substantive_fingerprint(text),
        complete=not missing,
        missing_fields=tuple(missing),
    )


def extract_spec_values(markdown: str) -> dict[str, str]:
    """Read existing user-authored facts so discovery asks only about absent fields."""
    values: dict[str, str] = {}
    objective = _section(markdown, "Objetivo")
    if _has_confirmed_text(objective):
        values["objective"] = objective
    scope = _subsection(_section(markdown, "Escopo"), "Incluído")
    if _has_confirmed_text(scope):
        values["scope"] = "\n".join(line.strip().lstrip("-•* ") for line in scope.splitlines() if line.strip())
    functional = _table_values(_section(markdown, "Requisitos funcionais"), "RF", require_evidence=True)
    if functional:
        values["functional_requirement"] = "\n".join(functional)
    product_form = _section(markdown, "Forma do produto")
    if _has_confirmed_text(product_form) and "Ainda não definida nesta etapa" not in product_form:
        values["product_form"] = product_form
    technology_preferences = _section(markdown, "Preferências tecnológicas")
    if _has_confirmed_text(technology_preferences) and "Nenhuma preferência confirmada" not in technology_preferences:
        values["technology_preferences"] = technology_preferences
    ai_relevance = _section(markdown, "Agentes e recuperação de informação")
    if _has_confirmed_text(ai_relevance) and "Não confirmada" not in ai_relevance:
        values["ai_relevance"] = ai_relevance
    traceability = _section(markdown, "Dependências e rastreabilidade")
    related_specs = re.search(r"^- \*\*Especificações relacionadas:\*\*\s*(.*?)\s*$",
                              traceability, flags=re.MULTILINE)
    if related_specs and _has_confirmed_text(related_specs.group(1)):
        values["increment_dependencies"] = related_specs.group(1)
    actors = _section(markdown, "Atores e contexto")
    if _has_confirmed_text(actors) and "Ainda não confirmado" not in actors:
        values["audience"] = "\n".join(line.strip().lstrip("-•* ") for line in actors.splitlines() if line.strip())
    constraints = _section(markdown, "Restrições")
    if _has_confirmed_text(constraints) and "Nenhuma restrição foi confirmada" not in constraints:
        values["constraints"] = "\n".join(line.strip().lstrip("-•* ") for line in constraints.splitlines() if line.strip())
    criteria = _table_values(_section(markdown, "Critérios de aceitação"), "CA")
    if criteria:
        values["acceptance_criteria"] = "\n".join(criteria)
    return values


def _table_values(section: str, prefix: str, *, require_evidence: bool = False) -> list[str]:
    values = []
    if require_evidence:
        rows = re.findall(r"^\|\s*`?" + re.escape(prefix) +
                          r"-\d+`?\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$",
                          section, flags=re.MULTILINE)
        for requirement, _priority, evidence in rows:
            if _has_confirmed_text(requirement) and _has_confirmed_text(evidence):
                values.append(requirement)
        return values
    for row in re.findall(r"^\|\s*`?" + re.escape(prefix) + r"-\d+`?\s*\|(.*?)\|", section, flags=re.MULTILINE):
        cells = [cell.strip() for cell in row.split("|")]
        if cells and _has_confirmed_text(cells[0]):
            values.append(cells[0])
    return values


def _section(markdown: str, heading: str) -> str:
    match = re.search(rf"^## {re.escape(heading)}\s*$\n(.*?)(?=^## |\Z)", markdown, flags=re.MULTILINE | re.DOTALL)
    return match.group(1).strip() if match else ""


def _subsection(markdown: str, heading: str) -> str:
    match = re.search(rf"^### {re.escape(heading)}\s*$\n(.*?)(?=^### |\Z)", markdown,
                      flags=re.MULTILINE | re.DOTALL)
    return match.group(1).strip() if match else ""


def _has_confirmed_text(value: str) -> bool:
    text = re.sub(r"<!--.*?-->", "", value, flags=re.DOTALL).strip()
    return bool(text) and not bool(re.fullmatch(r"\[.*?\]", text, flags=re.DOTALL)) and "[" not in text


def _has_verifiable_requirement(value: str) -> bool:
    rows = re.findall(r"^\|\s*`?RF-\d+`?\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$",
                      value, flags=re.MULTILINE)
    return any(_has_confirmed_text(requirement) and _has_confirmed_text(evidence)
               for requirement, _priority, evidence in rows)


class SpecificationResolver:
    def __init__(self, root: str | Path, workflow: dict[str, Any], state: StateManager):
        self.root = Path(root)
        self.workflow = workflow
        self.state = state

    def find_specifications(self) -> list[Specification]:
        specs_root = self.root / "specs"
        found: list[Specification] = []
        for path in specs_root.rglob("SPEC-*.md"):
            if path == specs_root / "templates" / "SPEC-TEMPLATE.md":
                continue
            parsed = parse_specification(path)
            if parsed:
                found.append(parsed)
        return sorted(found, key=lambda spec: (int(spec.spec_id.removeprefix("SPEC-")), str(spec.path)))

    def active_specification(self) -> Specification | None:
        found = self.find_specifications()
        invalid = self.invalid_specification_paths()
        if invalid:
            raise InvalidSpecificationError(
                "Especificação não vazia tem ID, versão ou metadados inválidos: " + ", ".join(map(str, invalid)))
        increment = self.state.active_discovery_increment(self.workflow["workflow_id"])
        if increment is not None:
            spec_id = increment.get("spec_id")
            if not spec_id:
                return None
            selected = next((spec for spec in found if spec.spec_id == spec_id), None)
            if selected is None:
                raise AmbiguousSpecificationError(
                    f"A spec do incremento ativo {increment['increment_order']} foi removida ou está inconsistente: {spec_id}")
            return selected
        if self.workflow.get("product_increment_policy", {}).get("execution_model") == "one_increment_per_full_cycle":
            return None
        selection = self.state.active_specification_selection(self.workflow["workflow_id"])
        if selection:
            selected = next((spec for spec in found if spec.spec_id == selection["spec_id"]
                             and str(spec.path.resolve()) == selection["path"]), None)
            if selected is None:
                raise AmbiguousSpecificationError(
                    f"Especificação ativa removida ou inconsistente: {selection['spec_id']} ({selection['path']})")
            return selected
        if len(found) > 1:
            ids = ", ".join(f"{spec.spec_id} ({spec.path})" for spec in found)
            raise AmbiguousSpecificationError(
                f"Há várias especificações e nenhuma foi selecionada para este workflow: {ids}. Use 'spec select'.")
        return found[0] if found else None

    def invalid_specification_paths(self) -> list[Path]:
        invalid: list[Path] = []
        for path in (self.root / "specs").rglob("SPEC-*.md"):
            if not SPEC_ID_RE.search(path.name) or path.stat().st_size == 0:
                continue
            if parse_specification(path) is None:
                invalid.append(path)
        return invalid

    def select_specification(self, spec_id: str) -> Specification:
        matches = [spec for spec in self.find_specifications() if spec.spec_id == spec_id]
        if len(matches) != 1:
            raise ValueError(f"Esperada uma especificação não vazia com ID {spec_id}; encontradas: {len(matches)}")
        selected = matches[0]
        if self.workflow.get("product_increment_policy", {}).get("execution_model") == "one_increment_per_full_cycle":
            increment = self.state.active_discovery_increment(self.workflow["workflow_id"])
            if not increment or increment.get("spec_id") != selected.spec_id:
                raise ValueError("Neste workflow, somente a especifica\u00e7\u00e3o do incremento ativo pode ser selecionada")
        self.state.set_active_specification(self.workflow["workflow_id"], selected.spec_id, selected.path)
        self.state.record_event(self.workflow["workflow_id"], "ACTIVE_SPECIFICATION_SELECTED",
                                artifact_id=selected.spec_id, details={"path": str(selected.path)})
        return selected

    def resolve(self, stage_id: str, blocked_by: tuple[str, ...] = ()) -> Evaluation:
        stage = next((item for item in self.workflow["stages"] if item["id"] == stage_id), None)
        if stage is None:
            return Evaluation(stage_id, ResolutionStatus.BLOCKED, "Etapa não declarada no workflow.", blocked_by=("unknown-stage",))
        if blocked_by:
            return Evaluation(stage_id, ResolutionStatus.BLOCKED, "Dependências ou gates ainda não satisfeitos.",
                              blocked_by=blocked_by, agents=tuple(stage["agents"]), skill=stage["skill"])
        try:
            specification = self.active_specification()
        except (AmbiguousSpecificationError, InvalidSpecificationError) as exc:
            return Evaluation(stage_id, ResolutionStatus.BLOCKED, str(exc), blocked_by=("ambiguous-specification-selection",),
                              agents=tuple(stage["agents"]), skill=stage["skill"])
        if specification is None:
            return Evaluation(stage_id, ResolutionStatus.MISSING, "Nenhuma especificação de produto não vazia foi encontrada.",
                              missing_information=tuple(self.workflow["clarification_rules"]["minimum_confirmed_fields"]),
                              agents=tuple(stage["agents"]), skill=stage["skill"])
        if not specification.complete:
            return Evaluation(stage_id, ResolutionStatus.DRAFT, "Uma especificação existente precisa ser completada.",
                              missing_information=specification.missing_fields, specification=specification,
                              agents=tuple(stage["agents"]), skill=stage["skill"])
        approval = self.state.latest_valid_approval(
            self.workflow["workflow_id"], specification.spec_id, specification.version, specification.substantive_hash
        )
        if approval is None or approval["decision"] != "APPROVED":
            return Evaluation(stage_id, ResolutionStatus.AWAITING_APPROVAL,
                              "A especificação está completa, mas falta aprovação humana verificável da versão atual.",
                              specification=specification, agents=tuple(stage["agents"]), skill=stage["skill"])
        return Evaluation(stage_id, ResolutionStatus.READY, "Especificação aprovada e sem dependências pendentes.",
                          specification=specification, agents=tuple(stage["agents"]), skill=stage["skill"])
