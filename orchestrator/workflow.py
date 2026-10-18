from __future__ import annotations

import json
import tomllib
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from .models import WorkflowStage


class WorkflowValidationError(ValueError):
    pass


def load_workflow(path: str | Path, schema_path: str | Path, root: str | Path) -> dict[str, Any]:
    workflow_path = Path(path)
    schema_file = Path(schema_path)
    project_root = Path(root)
    try:
        data = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        schema = json.loads(schema_file.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError, json.JSONDecodeError) as exc:
        raise WorkflowValidationError(f"Não foi possível carregar workflow/schema: {exc}") from exc

    issues = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda issue: list(issue.path))
    if issues:
        detail = "; ".join(f"{'.'.join(map(str, issue.path)) or '<raiz>'}: {issue.message}" for issue in issues)
        raise WorkflowValidationError(f"Workflow não corresponde ao schema: {detail}")

    stages = data["stages"]
    ids = [stage["id"] for stage in stages]
    orders = [stage["order"] for stage in stages]
    if len(set(ids)) != len(ids):
        raise WorkflowValidationError("IDs de etapa duplicados")
    if len(set(orders)) != len(orders):
        raise WorkflowValidationError("Números de ordem de etapa duplicados")
    if data["current_stage_id"] not in ids:
        raise WorkflowValidationError("current_stage_id não existe em stages")
    known = set(ids)
    for stage in stages:
        unknown = set(stage["depends_on"]) - known
        if unknown:
            raise WorkflowValidationError(f"Dependências desconhecidas em {stage['id']}: {sorted(unknown)}")
        skill_path = project_root / stage["skill"]
        if not skill_path.is_file():
            raise WorkflowValidationError(f"Skill ausente para {stage['id']}: {stage['skill']}")
        for agent_id in stage["agents"]:
            profile_name = agent_id.replace("_", "-")
            profile = project_root / ".codex" / "agents" / f"{profile_name}.toml"
            if not profile.is_file():
                raise WorkflowValidationError(f"Perfil de agente ausente para {stage['id']}: {agent_id}")
            try:
                profile_data = tomllib.loads(profile.read_text(encoding="utf-8"))
            except (OSError, tomllib.TOMLDecodeError) as exc:
                raise WorkflowValidationError(f"Perfil TOML inválido para {stage['id']}: {profile}: {exc}") from exc
            if profile_data.get("name") != agent_id:
                raise WorkflowValidationError(
                    f"ID do perfil {profile_data.get('name')!r} diverge do agente declarado {agent_id!r}")
        for deliverable in stage["deliverables"]:
            if not isinstance(deliverable, dict) or not isinstance(deliverable.get("id"), str):
                raise WorkflowValidationError(f"Entregável inválido em {stage['id']}")
    return data


def stage_map(workflow: dict[str, Any]) -> dict[str, WorkflowStage]:
    return {
        raw["id"]: WorkflowStage(
            id=raw["id"],
            order=raw["order"],
            name=raw["name"],
            status=raw["status"],
            agents=tuple(raw["agents"]),
            skill=raw["skill"],
            inputs=tuple(raw["inputs"]),
            deliverables=tuple(raw["deliverables"]),
            depends_on=tuple(raw["depends_on"]),
            approval_gate=raw["approval_gate"],
        )
        for raw in workflow["stages"]
    }
