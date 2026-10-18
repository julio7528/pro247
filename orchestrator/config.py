from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class OrchestratorConfig:
    root: Path
    workflow_path: Path
    workflow_schema_path: Path
    state_db_path: Path
    decision_log_path: Path
    dry_run_by_default: bool
    allow_real_execution: bool
    codex_command: tuple[str, ...]
    execution_timeout_seconds: int
    max_captured_output_bytes: int

    @classmethod
    def load(cls, config_path: str | Path | None = None) -> "OrchestratorConfig":
        default_root = Path(__file__).resolve().parent.parent
        path = Path(config_path).resolve() if config_path else default_root / "orchestrator" / "config.json"
        try:
            raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise ValueError(f"Arquivo de configuração não encontrado: {path}") from exc
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON inválido em {path}: {exc}") from exc

        configured_root = Path(str(raw.get("project_root", ""))) if raw.get("project_root") else None
        if configured_root:
            root = configured_root.resolve() if configured_root.is_absolute() else (path.parent / configured_root).resolve()
        elif config_path:
            root = path.parent.parent.resolve()
        else:
            root = default_root

        def project_path(key: str, default: str) -> Path:
            value = Path(str(raw.get(key, default)))
            return value.resolve() if value.is_absolute() else (root / value).resolve()

        command = raw.get("codex_command", [])
        if not isinstance(command, list) or any(not isinstance(part, str) for part in command):
            raise ValueError("codex_command deve ser uma lista de strings")
        dry_run = raw.get("dry_run_by_default", True)
        allow_real = raw.get("allow_real_execution", False)
        if not isinstance(dry_run, bool) or not isinstance(allow_real, bool):
            raise ValueError("dry_run_by_default e allow_real_execution devem ser booleanos JSON")
        timeout = int(raw.get("execution_timeout_seconds", 120))
        output_limit = int(raw.get("max_captured_output_bytes", 65536))
        if timeout <= 0 or output_limit <= 0:
            raise ValueError("Timeout e limite de saída precisam ser maiores que zero")
        return cls(
            root=root,
            workflow_path=project_path("workflow_path", "specs/workflow.yaml"),
            workflow_schema_path=project_path("workflow_schema_path", "orchestrator/workflow.schema.json"),
            state_db_path=project_path("state_db_path", ".codex/orchestrator-state.sqlite3"),
            decision_log_path=project_path("decision_log_path", "docs/decision-log.md"),
            dry_run_by_default=dry_run,
            allow_real_execution=allow_real,
            codex_command=tuple(command),
            execution_timeout_seconds=timeout,
            max_captured_output_bytes=output_limit,
        )
