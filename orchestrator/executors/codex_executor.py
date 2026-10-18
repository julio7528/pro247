from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path
from typing import Any

from ..config import OrchestratorConfig
from ..models import ExecutionResult, ExecutionStatus, WorkflowStage


class ExecutionAuthorizationError(PermissionError):
    pass


class CodexExecutor:
    """Runs one configured CLI command, with explicit authorization and bounded logs."""

    def __init__(self, config: OrchestratorConfig):
        self.config = config

    @staticmethod
    def prepare_prompt(stage: WorkflowStage, root: str | Path, specification_reference: str | None,
                       task_id: str | None = None,
                       contract_refs: list[dict[str, str]] | None = None) -> str:
        project_root = Path(root)
        inputs = [str(item) for item in stage.inputs]
        context = [
            f"Workflow stage: {stage.id} — {stage.name}",
            f"Assigned Codex agent profiles: {', '.join(stage.agents)}",
            f"Assigned Skill: {stage.skill}",
            f"Project root: {project_root}",
            f"Declared inputs: {', '.join(inputs) if inputs else '(none)' }",
            f"Originating specification: {specification_reference or '(not yet available)'}",
            f"Task identifier: {task_id or '(stage-level task; no product task contract)'}",
            "Applicable contract references (immutable identifiers, versions, hashes): " +
            (json.dumps(contract_refs, ensure_ascii=False, sort_keys=True) if contract_refs else "[]"),
            "Follow these contract obligations within the task scope. Scope declarations are not filesystem isolation.",
            f"Declared deliverables: {', '.join(item['id'] for item in stage.deliverables)}",
            "Read the assigned agent profiles, Skill, workflow, and declared inputs directly before acting.",
            "Use only confirmed user decisions; preserve unanswered questions and do not advance workflow stages.",
            "Return a concise summary of outputs, validation evidence, and unresolved items.",
        ]
        return "\n".join(context)

    def execute(self, prompt: str, *, command: tuple[str, ...] | list[str] | None = None,
                dry_run: bool = True, authorized: bool = False, stage_ready: bool = False,
                cwd: str | Path | None = None) -> ExecutionResult:
        selected_command = tuple(command if command is not None else self.config.codex_command)
        preview = " ".join(selected_command) if selected_command else "<no command configured>"
        if dry_run:
            return ExecutionResult(ExecutionStatus.PENDING, "dry-run", stdout=preview, dry_run=True)
        if not authorized:
            raise ExecutionAuthorizationError("Execução real exige autorização explícita (--authorize)")
        if not stage_ready:
            raise ExecutionAuthorizationError("A etapa não passou pela avaliação de prontidão")
        if not self.config.allow_real_execution:
            raise ExecutionAuthorizationError("Execução real está desabilitada em orchestrator/config.json")
        if not selected_command:
            raise ExecutionAuthorizationError("Nenhum comando Codex está configurado")

        try:
            process = subprocess.Popen(
                list(selected_command), cwd=str(cwd or self.config.root), stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
                shell=False, bufsize=0,
            )
        except OSError as exc:
            return ExecutionResult(ExecutionStatus.FAILED, "process-start-failed", error=f"Falha ao iniciar executor: {exc}")

        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        output_limit = self.config.max_captured_output_bytes

        def drain(stream: Any, collected: list[str]) -> None:
            retained = 0
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                encoded_size = len(chunk.encode("utf-8", errors="replace"))
                if retained < output_limit:
                    remaining = output_limit - retained
                    if encoded_size > remaining:
                        chunk = chunk.encode("utf-8", errors="replace")[:remaining].decode("utf-8", errors="ignore")
                    collected.append(chunk)
                    retained += min(encoded_size, remaining)

        stdout_thread = threading.Thread(target=drain, args=(process.stdout, stdout_parts), daemon=True)
        stderr_thread = threading.Thread(target=drain, args=(process.stderr, stderr_parts), daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        try:
            assert process.stdin is not None
            process.stdin.write(prompt)
            process.stdin.close()
            exit_code = process.wait(timeout=self.config.execution_timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            exit_code = process.wait()
            stdout_thread.join(timeout=2)
            stderr_thread.join(timeout=2)
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()
            return ExecutionResult(ExecutionStatus.FAILED, "process-timeout", exit_code=exit_code,
                                   stdout="".join(stdout_parts), stderr="".join(stderr_parts),
                                   error=f"Executor excedeu {self.config.execution_timeout_seconds} segundos")
        except OSError as exc:
            process.kill()
            process.wait()
            stdout_thread.join(timeout=2)
            stderr_thread.join(timeout=2)
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()
            return ExecutionResult(ExecutionStatus.FAILED, "process-input-failed", error=f"Falha ao enviar contexto: {exc}")

        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()
        status = ExecutionStatus.COMPLETED if exit_code == 0 else ExecutionStatus.FAILED
        return ExecutionResult(status, "process-completed", exit_code=exit_code,
                               stdout="".join(stdout_parts), stderr="".join(stderr_parts),
                               error=None if exit_code == 0 else f"Executor encerrou com código {exit_code}")
