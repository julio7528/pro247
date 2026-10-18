from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..models import ExecutionStatus


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class StateManager:
    """Persists mutable runtime state separately from the YAML workflow."""

    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)
        if str(database_path) != ":memory:":
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(database_path), timeout=15)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self._create_schema()

    def close(self) -> None:
        self.connection.close()

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS workflow_state (
                workflow_id TEXT PRIMARY KEY,
                current_stage_id TEXT NOT NULL,
                active_increment_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_specifications (
                workflow_id TEXT PRIMARY KEY,
                spec_id TEXT NOT NULL,
                path TEXT NOT NULL,
                selected_at TEXT NOT NULL,
                FOREIGN KEY (workflow_id) REFERENCES workflow_state(workflow_id)
            );
            CREATE TABLE IF NOT EXISTS stage_states (
                workflow_id TEXT NOT NULL,
                stage_id TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (workflow_id, stage_id),
                FOREIGN KEY (workflow_id) REFERENCES workflow_state(workflow_id)
            );
            CREATE TABLE IF NOT EXISTS answers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id TEXT NOT NULL,
                stage_id TEXT NOT NULL,
                field TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_answers_latest
                ON answers(workflow_id, stage_id, field, id DESC);
            CREATE TABLE IF NOT EXISTS discovery_increments (
                increment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id TEXT NOT NULL,
                stage_id TEXT NOT NULL,
                increment_order INTEGER NOT NULL,
                increment_name TEXT NOT NULL,
                start_answer_id INTEGER NOT NULL DEFAULT 0,
                spec_id TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(workflow_id, stage_id, increment_order),
                FOREIGN KEY (workflow_id) REFERENCES workflow_state(workflow_id)
            );
            CREATE TABLE IF NOT EXISTS increment_stage_states (
                increment_id INTEGER NOT NULL,
                stage_id TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (increment_id, stage_id),
                FOREIGN KEY (increment_id) REFERENCES discovery_increments(increment_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS approval_records (
                approval_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                artifact_version TEXT NOT NULL,
                substantive_hash TEXT NOT NULL,
                decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
                actor TEXT NOT NULL,
                evidence TEXT NOT NULL,
                authorize_next_stage INTEGER NOT NULL CHECK (authorize_next_stage IN (0, 1)),
                decision_id TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_approvals_artifact
                ON approval_records(workflow_id, artifact_id, artifact_version, recorded_at DESC);
            CREATE TABLE IF NOT EXISTS transition_authorizations (
                authorization_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                from_stage_id TEXT NOT NULL,
                to_stage_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                artifact_version TEXT NOT NULL,
                substantive_hash TEXT NOT NULL,
                evidence TEXT NOT NULL,
                decision_id TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                UNIQUE(workflow_id, from_stage_id, to_stage_id, artifact_id, artifact_version, substantive_hash)
            );
            CREATE TABLE IF NOT EXISTS deployment_authorizations (
                authorization_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                deployment_scope TEXT NOT NULL,
                deployment_version TEXT NOT NULL,
                evidence TEXT NOT NULL,
                decision_id TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS executions (
                run_id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                workflow_id TEXT NOT NULL,
                increment_id INTEGER,
                stage_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
                prompt_hash TEXT NOT NULL,
                command_json TEXT NOT NULL,
                attempt INTEGER NOT NULL DEFAULT 1,
                started_at TEXT,
                finished_at TEXT,
                exit_code INTEGER,
                stdout TEXT NOT NULL DEFAULT '',
                stderr TEXT NOT NULL DEFAULT '',
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS artifacts (
                artifact_key TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                stage_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                artifact_version TEXT NOT NULL,
                spec_reference TEXT,
                path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                requirement_ids_json TEXT NOT NULL DEFAULT '[]',
                task_ids_json TEXT NOT NULL DEFAULT '[]',
                validation_summary TEXT NOT NULL DEFAULT '',
                validation_status TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                stage_id TEXT,
                artifact_id TEXT,
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS contract_records (
                contract_key TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                contract_id TEXT NOT NULL,
                contract_version TEXT NOT NULL,
                contract_type TEXT NOT NULL,
                origin_spec_reference TEXT,
                origin_spec_hash TEXT,
                requirement_ids_json TEXT NOT NULL,
                task_ids_json TEXT NOT NULL,
                path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                lifecycle_state TEXT NOT NULL,
                approval_required INTEGER NOT NULL CHECK (approval_required IN (0,1)),
                recorded_at TEXT NOT NULL,
                UNIQUE(workflow_id, contract_id, contract_version)
            );
            CREATE TABLE IF NOT EXISTS contract_assessments (
                assessment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id TEXT NOT NULL,
                spec_reference TEXT NOT NULL,
                spec_hash TEXT NOT NULL,
                assessment TEXT NOT NULL,
                path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                task_ids_json TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_contract_assessment_latest
                ON contract_assessments(workflow_id, assessment_id DESC);
            CREATE TABLE IF NOT EXISTS contract_validations (
                validation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id TEXT NOT NULL,
                contract_id TEXT NOT NULL,
                contract_version TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                validation_type TEXT NOT NULL,
                status TEXT NOT NULL,
                details_json TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS contract_handoffs (
                handoff_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                task_id TEXT,
                spec_reference TEXT,
                path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                contract_refs_json TEXT NOT NULL,
                validation_status TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_states (
                workflow_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(workflow_id, task_id)
            );
            """
        )
        self._migrate_contract_columns()
        workflow_columns = {row["name"] for row in self.connection.execute("PRAGMA table_info(workflow_state)")}
        if "active_increment_id" not in workflow_columns:
            self.connection.execute("ALTER TABLE workflow_state ADD COLUMN active_increment_id INTEGER")
        with self.connection:
            self.connection.execute("INSERT OR IGNORE INTO schema_migrations(migration_id,applied_at) VALUES(?,?)",
                                    ("contracts-v1", utc_now()))
        self.connection.commit()

    def _migrate_contract_columns(self) -> None:
        execution_columns = {row["name"] for row in self.connection.execute("PRAGMA table_info(executions)")}
        for name, definition in (
            ("task_id", "TEXT"),
            ("contract_refs_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("contract_fingerprint", "TEXT NOT NULL DEFAULT ''"),
        ):
            if name not in execution_columns:
                self.connection.execute(f"ALTER TABLE executions ADD COLUMN {name} {definition}")
        artifact_columns = {row["name"] for row in self.connection.execute("PRAGMA table_info(artifacts)")}
        if "contract_refs_json" not in artifact_columns:
            self.connection.execute("ALTER TABLE artifacts ADD COLUMN contract_refs_json TEXT NOT NULL DEFAULT '[]'")
        if "increment_id" not in execution_columns:
            self.connection.execute("ALTER TABLE executions ADD COLUMN increment_id INTEGER")

    def migrate_workflow_id(self, old_workflow_id: str, new_workflow_id: str) -> bool:
        """Rename a legacy workflow key without discarding any recorded project state."""
        if old_workflow_id == new_workflow_id:
            return False
        old_state = self.connection.execute(
            "SELECT * FROM workflow_state WHERE workflow_id = ?", (old_workflow_id,)
        ).fetchone()
        if old_state is None:
            return False
        if self.connection.execute(
            "SELECT 1 FROM workflow_state WHERE workflow_id = ?", (new_workflow_id,)
        ).fetchone():
            raise ValueError(
                f"Workflows antigo e novo já coexistem ({old_workflow_id}, {new_workflow_id}); "
                "reconcilie os registros antes de inicializar."
            )

        tables = [row["name"] for row in self.connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )]
        workflow_tables: list[str] = []
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            columns = {row["name"] for row in self.connection.execute(f"PRAGMA table_info({quoted})")}
            if "workflow_id" not in columns or table == "workflow_state":
                continue
            if self.connection.execute(
                f"SELECT 1 FROM {quoted} WHERE workflow_id = ? LIMIT 1", (new_workflow_id,)
            ).fetchone():
                raise ValueError(
                    f"Há registros de {new_workflow_id} em {table}; a migração de {old_workflow_id} "
                    "foi interrompida para evitar mesclar estados."
                )
            workflow_tables.append(table)

        with self.connection:
            self.connection.execute(
                "INSERT INTO workflow_state(workflow_id,current_stage_id,active_increment_id,created_at,updated_at) "
                "VALUES(?,?,?,?,?)",
                (new_workflow_id, old_state["current_stage_id"], old_state["active_increment_id"],
                 old_state["created_at"], old_state["updated_at"]),
            )
            for table in workflow_tables:
                quoted = '"' + table.replace('"', '""') + '"'
                self.connection.execute(
                    f"UPDATE {quoted} SET workflow_id = ? WHERE workflow_id = ?",
                    (new_workflow_id, old_workflow_id),
                )
                for key_column in ("artifact_key", "contract_key"):
                    columns = {row["name"] for row in self.connection.execute(f"PRAGMA table_info({quoted})")}
                    if key_column in columns:
                        self.connection.execute(
                            f"UPDATE {quoted} SET {key_column} = ? || substr({key_column}, ?) "
                            f"WHERE {key_column} LIKE ?",
                            (new_workflow_id, len(old_workflow_id) + 1, old_workflow_id + ":%"),
                        )
            self.connection.execute("DELETE FROM workflow_state WHERE workflow_id = ?", (old_workflow_id,))
        self.record_event(new_workflow_id, "WORKFLOW_ID_MIGRATED", details={
            "from_workflow_id": old_workflow_id, "to_workflow_id": new_workflow_id,
        })
        return True

    def initialize_workflow(self, workflow: dict[str, Any]) -> None:
        workflow_id = workflow["workflow_id"]
        now = utc_now()
        with self.connection:
            self.connection.execute(
                "INSERT OR IGNORE INTO workflow_state(workflow_id,current_stage_id,active_increment_id,created_at,updated_at) VALUES (?, ?, NULL, ?, ?)",
                (workflow_id, workflow["current_stage_id"], now, now),
            )
            for stage in workflow["stages"]:
                self.connection.execute(
                    "INSERT OR IGNORE INTO stage_states VALUES (?, ?, ?, ?)",
                    (workflow_id, stage["id"], stage["status"], now),
                )
        for row in self.connection.execute("SELECT 1 FROM events WHERE workflow_id = ? LIMIT 1", (workflow_id,)):
            break
        else:
            self.record_event(workflow_id, "WORKFLOW_INITIALIZED", details={"current_stage_id": workflow["current_stage_id"]})

    def current_stage_id(self, workflow_id: str) -> str:
        row = self.connection.execute(
            "SELECT current_stage_id FROM workflow_state WHERE workflow_id = ?", (workflow_id,)
        ).fetchone()
        if row is None:
            raise ValueError(f"Workflow ainda não inicializado: {workflow_id}")
        return str(row["current_stage_id"])

    def set_current_stage(self, workflow_id: str, stage_id: str) -> None:
        with self.connection:
            self.connection.execute(
                "UPDATE workflow_state SET current_stage_id = ?, updated_at = ? WHERE workflow_id = ?",
                (stage_id, utc_now(), workflow_id),
            )

    def stage_status(self, workflow_id: str, stage_id: str) -> str:
        increment_id = self.active_increment_id(workflow_id)
        if increment_id is not None:
            row = self.connection.execute(
                "SELECT status FROM increment_stage_states WHERE increment_id = ? AND stage_id = ?",
                (increment_id, stage_id),
            ).fetchone()
            if row is not None:
                return str(row["status"])
        row = self.connection.execute(
            "SELECT status FROM stage_states WHERE workflow_id = ? AND stage_id = ?", (workflow_id, stage_id)
        ).fetchone()
        if row is None:
            raise ValueError(f"Etapa não inicializada: {stage_id}")
        return str(row["status"])

    def set_stage_status(self, workflow_id: str, stage_id: str, expected: str, new: str) -> None:
        increment_id = self.active_increment_id(workflow_id)
        if increment_id is not None:
            with self.connection:
                cursor = self.connection.execute(
                    "UPDATE increment_stage_states SET status = ?, updated_at = ? "
                    "WHERE increment_id = ? AND stage_id = ? AND status = ?",
                    (new, utc_now(), increment_id, stage_id, expected),
                )
                if cursor.rowcount == 1:
                    return
            actual = self.stage_status(workflow_id, stage_id)
            raise ValueError(f"Transição concorrente/inválida para {stage_id}: esperado {expected}, atual {actual}")
        with self.connection:
            cursor = self.connection.execute(
                "UPDATE stage_states SET status = ?, updated_at = ? WHERE workflow_id = ? AND stage_id = ? AND status = ?",
                (new, utc_now(), workflow_id, stage_id, expected),
            )
            if cursor.rowcount != 1:
                actual = self.stage_status(workflow_id, stage_id)
                raise ValueError(f"Transição concorrente/inválida para {stage_id}: esperado {expected}, atual {actual}")

    def stage_statuses(self, workflow_id: str) -> dict[str, str]:
        increment_id = self.active_increment_id(workflow_id)
        if increment_id is not None:
            rows = self.connection.execute(
                "SELECT stage_id, status FROM increment_stage_states WHERE increment_id = ?",
                (increment_id,),
            )
            increment_statuses = {row["stage_id"]: row["status"] for row in rows}
            if increment_statuses:
                return increment_statuses
        return {
            row["stage_id"]: row["status"]
            for row in self.connection.execute("SELECT stage_id, status FROM stage_states WHERE workflow_id = ?", (workflow_id,))
        }

    def set_active_specification(self, workflow_id: str, spec_id: str, path: str | Path) -> None:
        with self.connection:
            self.connection.execute(
                """INSERT INTO active_specifications(workflow_id,spec_id,path,selected_at) VALUES(?,?,?,?)
                ON CONFLICT(workflow_id) DO UPDATE SET spec_id=excluded.spec_id,path=excluded.path,selected_at=excluded.selected_at""",
                (workflow_id, spec_id, str(Path(path).resolve()), utc_now()),
            )

    def active_specification_selection(self, workflow_id: str) -> dict[str, str] | None:
        row = self.connection.execute(
            "SELECT spec_id,path FROM active_specifications WHERE workflow_id=?", (workflow_id,)
        ).fetchone()
        return dict(row) if row else None

    def active_increment_id(self, workflow_id: str) -> int | None:
        row = self.connection.execute(
            "SELECT active_increment_id FROM workflow_state WHERE workflow_id = ?", (workflow_id,)
        ).fetchone()
        if row is None or row["active_increment_id"] is None:
            return None
        return int(row["active_increment_id"])

    def set_active_increment(self, workflow_id: str, increment_id: int | None) -> None:
        if increment_id is not None:
            exists = self.connection.execute(
                "SELECT 1 FROM discovery_increments WHERE workflow_id = ? AND increment_id = ?",
                (workflow_id, increment_id),
            ).fetchone()
            if exists is None:
                raise ValueError(f"Incremento não encontrado neste workflow: {increment_id}")
            self._initialize_increment_stage_states(workflow_id, increment_id)
        with self.connection:
            if increment_id is None:
                self.connection.execute(
                    "DELETE FROM active_specifications WHERE workflow_id = ?", (workflow_id,)
                )
            self.connection.execute(
                "UPDATE workflow_state SET active_increment_id = ?, updated_at = ? WHERE workflow_id = ?",
                (increment_id, utc_now(), workflow_id),
            )

    def _initialize_increment_stage_states(self, workflow_id: str, increment_id: int) -> None:
        with self.connection:
            self.connection.execute(
                "INSERT OR IGNORE INTO increment_stage_states(increment_id,stage_id,status,updated_at) "
                "SELECT ?,stage_id,status,? FROM stage_states WHERE workflow_id = ?",
                (increment_id, utc_now(), workflow_id),
            )

    def record_answer(self, workflow_id: str, stage_id: str, field: str, question: str, answer: str,
                      confirmed: bool = True) -> int:
        text = answer.strip()
        if not field.strip() or not text:
            raise ValueError("Campo e resposta não podem ficar vazios")
        with self.connection:
            cursor = self.connection.execute(
                "INSERT INTO answers(workflow_id, stage_id, field, question, answer, confirmed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (workflow_id, stage_id, field, question, text, int(confirmed), utc_now()),
            )
            answer_id = int(cursor.lastrowid)
        self.record_event(workflow_id, "CLARIFICATION_ANSWER_RECORDED", stage_id=stage_id,
                          details={"field": field, "answer_id": answer_id, "confirmed": confirmed})
        return answer_id

    def confirmed_answers(self, workflow_id: str, stage_id: str) -> dict[str, str]:
        return {field: record["answer"] for field, record in
                self.confirmed_answer_records(workflow_id, stage_id).items()}

    def confirmed_answer_records(self, workflow_id: str, stage_id: str,
                                 *, after_id: int = 0) -> dict[str, dict[str, Any]]:
        rows = self.connection.execute(
            "SELECT id, field, answer, question, created_at FROM answers "
            "WHERE workflow_id = ? AND stage_id = ? AND confirmed = 1 AND id > ? ORDER BY id",
            (workflow_id, stage_id, after_id),
        )
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            latest[str(row["field"])] = dict(row)
        return latest

    def start_discovery_increment(self, workflow_id: str, stage_id: str,
                                  increment_name: str) -> dict[str, Any]:
        name = increment_name.strip()
        if not name:
            raise ValueError("O nome do incremento não pode ficar vazio")
        current = self.current_discovery_increment(workflow_id, stage_id)
        if current and not current.get("spec_id"):
            raise ValueError("Conclua a spec do incremento atual antes de iniciar outro")
        row = self.connection.execute(
            "SELECT COALESCE(MAX(increment_order), 0) AS last_order FROM discovery_increments "
            "WHERE workflow_id=? AND stage_id=?", (workflow_id, stage_id),
        ).fetchone()
        answer_row = self.connection.execute(
            "SELECT COALESCE(MAX(id), 0) AS last_answer_id FROM answers "
            "WHERE workflow_id=? AND stage_id=?", (workflow_id, stage_id),
        ).fetchone()
        increment_order = int(row["last_order"]) + 1
        start_answer_id = int(answer_row["last_answer_id"])
        with self.connection:
            cursor = self.connection.execute(
                "INSERT INTO discovery_increments "
                "(workflow_id,stage_id,increment_order,increment_name,start_answer_id,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (workflow_id, stage_id, increment_order, name, start_answer_id, utc_now()),
            )
            increment_id = int(cursor.lastrowid)
        self.set_active_increment(workflow_id, increment_id)
        self.record_event(workflow_id, "PRODUCT_INCREMENT_DISCOVERY_STARTED", stage_id=stage_id,
                          details={"increment_id": increment_id, "increment_order": increment_order,
                                   "increment_name": name, "start_answer_id": start_answer_id})
        return self.current_discovery_increment(workflow_id, stage_id) or {}

    def ensure_initial_discovery_increment(self, workflow_id: str, stage_id: str,
                                           increment_name: str,
                                           spec_id: str | None = None) -> dict[str, Any]:
        current = self.current_discovery_increment(workflow_id, stage_id)
        if current:
            return current
        with self.connection:
            cursor = self.connection.execute(
                "INSERT INTO discovery_increments "
                "(workflow_id,stage_id,increment_order,increment_name,start_answer_id,spec_id,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (workflow_id, stage_id, 1, increment_name.strip() or "Incremento 1", 0, spec_id, utc_now()),
            )
            increment_id = int(cursor.lastrowid)
        self.set_active_increment(workflow_id, increment_id)
        increment = self.current_discovery_increment(workflow_id, stage_id) or {}
        self.record_event(workflow_id, "PRODUCT_INCREMENT_DISCOVERY_STARTED", stage_id=stage_id,
                          details={"increment_id": increment.get("increment_id"), "increment_order": 1,
                                   "increment_name": increment.get("increment_name"),
                                   "start_answer_id": 0, "initial_increment": True})
        return increment

    def current_discovery_increment(self, workflow_id: str, stage_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT * FROM discovery_increments WHERE workflow_id=? AND stage_id=? "
            "ORDER BY increment_order DESC LIMIT 1", (workflow_id, stage_id),
        ).fetchone()
        return dict(row) if row else None

    def active_discovery_increment(self, workflow_id: str, stage_id: str | None = None) -> dict[str, Any] | None:
        increment_id = self.active_increment_id(workflow_id)
        if increment_id is None:
            return None
        query = "SELECT * FROM discovery_increments WHERE workflow_id = ? AND increment_id = ?"
        params: tuple[Any, ...] = (workflow_id, increment_id)
        if stage_id is not None:
            query += " AND stage_id = ?"
            params += (stage_id,)
        row = self.connection.execute(query, params).fetchone()
        return dict(row) if row else None

    def increment_stage_status(self, increment_id: int, stage_id: str) -> str | None:
        row = self.connection.execute(
            "SELECT status FROM increment_stage_states WHERE increment_id = ? AND stage_id = ?",
            (increment_id, stage_id),
        ).fetchone()
        return str(row["status"]) if row else None

    def discovery_increments(self, workflow_id: str, stage_id: str) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute(
            "SELECT * FROM discovery_increments WHERE workflow_id=? AND stage_id=? ORDER BY increment_order",
            (workflow_id, stage_id),
        )]

    def set_discovery_increment_specification(self, increment_id: int, spec_id: str) -> None:
        with self.connection:
            cursor = self.connection.execute(
                "UPDATE discovery_increments SET spec_id=? WHERE increment_id=?",
                (spec_id, increment_id),
            )
            if cursor.rowcount != 1:
                raise ValueError(f"Incremento de descoberta não encontrado: {increment_id}")

    def add_approval(self, *, workflow_id: str, artifact_id: str, artifact_version: str,
                     substantive_hash: str, decision: str, actor: str, evidence: str,
                     authorize_next_stage: bool, decision_id: str,
                     event_type: str | None = None) -> dict[str, Any]:
        approval_id = str(uuid.uuid4())
        recorded_at = utc_now()
        with self.connection:
            self.connection.execute(
                """INSERT INTO approval_records
                (approval_id, workflow_id, artifact_id, artifact_version, substantive_hash, decision, actor, evidence,
                 authorize_next_stage, decision_id, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (approval_id, workflow_id, artifact_id, artifact_version, substantive_hash, decision, actor, evidence,
                 int(authorize_next_stage), decision_id, recorded_at),
            )
        record = {"approval_id": approval_id, "workflow_id": workflow_id, "artifact_id": artifact_id,
                  "artifact_version": artifact_version, "substantive_hash": substantive_hash, "decision": decision,
                  "actor": actor, "evidence": evidence, "authorize_next_stage": authorize_next_stage,
                  "decision_id": decision_id, "recorded_at": recorded_at}
        self.record_event(workflow_id, event_type or f"SPEC_{decision}", artifact_id=artifact_id,
                          details={key: record[key] for key in ("approval_id", "artifact_version", "substantive_hash", "decision_id")})
        return record

    def latest_valid_approval(self, workflow_id: str, artifact_id: str, artifact_version: str,
                              substantive_hash: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            """SELECT * FROM approval_records WHERE workflow_id = ? AND artifact_id = ? AND artifact_version = ?
            AND substantive_hash = ? ORDER BY recorded_at DESC LIMIT 1""",
            (workflow_id, artifact_id, artifact_version, substantive_hash),
        ).fetchone()
        return dict(row) if row else None

    def authorize_transition(self, *, workflow_id: str, from_stage_id: str, to_stage_id: str,
                             artifact_id: str, artifact_version: str, substantive_hash: str,
                             evidence: str, decision_id: str) -> dict[str, Any]:
        authorization_id = str(uuid.uuid4())
        recorded_at = utc_now()
        with self.connection:
            self.connection.execute(
                """INSERT INTO transition_authorizations
                (authorization_id, workflow_id, from_stage_id, to_stage_id, artifact_id, artifact_version,
                 substantive_hash, evidence, decision_id, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(workflow_id, from_stage_id, to_stage_id, artifact_id, artifact_version, substantive_hash)
                DO UPDATE SET evidence=excluded.evidence, decision_id=excluded.decision_id, recorded_at=excluded.recorded_at""",
                (authorization_id, workflow_id, from_stage_id, to_stage_id, artifact_id, artifact_version,
                 substantive_hash, evidence, decision_id, recorded_at),
            )
        self.record_event(workflow_id, "STAGE_TRANSITION_AUTHORIZED", stage_id=from_stage_id,
                          artifact_id=artifact_id, details={"to_stage_id": to_stage_id, "decision_id": decision_id})
        return {"authorization_id": authorization_id, "decision_id": decision_id, "recorded_at": recorded_at}

    def has_transition_authorization(self, *, workflow_id: str, from_stage_id: str, to_stage_id: str,
                                     artifact_id: str, artifact_version: str, substantive_hash: str) -> bool:
        return self.connection.execute(
            """SELECT 1 FROM transition_authorizations WHERE workflow_id=? AND from_stage_id=? AND to_stage_id=?
            AND artifact_id=? AND artifact_version=? AND substantive_hash=? LIMIT 1""",
            (workflow_id, from_stage_id, to_stage_id, artifact_id, artifact_version, substantive_hash),
        ).fetchone() is not None

    def add_deployment_authorization(self, workflow_id: str, scope: str, version: str,
                                     evidence: str, decision_id: str) -> dict[str, Any]:
        record = {
            "authorization_id": str(uuid.uuid4()), "workflow_id": workflow_id,
            "deployment_scope": scope, "deployment_version": version, "evidence": evidence,
            "decision_id": decision_id, "recorded_at": utc_now(),
        }
        with self.connection:
            self.connection.execute(
                """INSERT INTO deployment_authorizations
                (authorization_id,workflow_id,deployment_scope,deployment_version,evidence,decision_id,recorded_at)
                VALUES (?,?,?,?,?,?,?)""",
                (record["authorization_id"], workflow_id, scope, version, evidence, decision_id, record["recorded_at"]),
            )
        self.record_event(workflow_id, "PRODUCTION_DEPLOYMENT_AUTHORIZED", stage_id="deployment",
                          details={key: record[key] for key in ("authorization_id", "deployment_scope", "deployment_version", "decision_id")})
        return record

    def has_deployment_authorization(self, workflow_id: str, *, scope: str | None = None,
                                     version: str | None = None) -> bool:
        query = "SELECT 1 FROM deployment_authorizations WHERE workflow_id=?"
        params: list[str] = [workflow_id]
        if scope is not None:
            query += " AND deployment_scope=?"
            params.append(scope)
        if version is not None:
            query += " AND deployment_version=?"
            params.append(version)
        query += " LIMIT 1"
        return self.connection.execute(query, params).fetchone() is not None

    def deployment_authorizations(self, workflow_id: str) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute(
            "SELECT * FROM deployment_authorizations WHERE workflow_id=? ORDER BY recorded_at", (workflow_id,)
        )]

    def record_artifact(self, *, workflow_id: str, stage_id: str, artifact_id: str, artifact_version: str,
                        path: str | Path, spec_reference: str | None, validation_status: str,
                        requirement_ids: list[str] | tuple[str, ...] = (),
                        task_ids: list[str] | tuple[str, ...] = (), validation_summary: str = "",
                        contract_refs: list[dict[str, str]] | tuple[dict[str, str], ...] = ()) -> str:
        artifact_path = Path(path)
        digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
        key = f"{workflow_id}:{stage_id}:{artifact_id}:{artifact_version}:{spec_reference or 'unscoped'}"
        with self.connection:
            self.connection.execute(
                """INSERT INTO artifacts
                (artifact_key,workflow_id,stage_id,artifact_id,artifact_version,spec_reference,path,content_hash,
                 requirement_ids_json,task_ids_json,validation_summary,validation_status,recorded_at,contract_refs_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(artifact_key) DO UPDATE SET path=excluded.path, content_hash=excluded.content_hash,
                requirement_ids_json=excluded.requirement_ids_json, task_ids_json=excluded.task_ids_json,
                validation_summary=excluded.validation_summary, validation_status=excluded.validation_status,
                recorded_at=excluded.recorded_at,contract_refs_json=excluded.contract_refs_json""",
                (key, workflow_id, stage_id, artifact_id, artifact_version, spec_reference, str(artifact_path), digest,
                 json.dumps(list(requirement_ids)), json.dumps(list(task_ids)), validation_summary,
                 validation_status, utc_now(), json.dumps(list(contract_refs))),
            )
        return digest

    def artifact_records(self, workflow_id: str, stage_id: str,
                         spec_reference: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM artifacts WHERE workflow_id = ? AND stage_id = ?"
        params: tuple[Any, ...] = (workflow_id, stage_id)
        if spec_reference is not None:
            query += " AND spec_reference = ?"
            params += (spec_reference,)
        query += " ORDER BY recorded_at"
        return [dict(row) for row in self.connection.execute(query, params)]

    def register_contract(self, document: dict[str, Any], path: str | Path,
                          *, workflow_id: str = "arqcalc") -> None:
        key = f"{workflow_id}:{document['contract_id']}:{document['version']}"
        with self.connection:
            self.connection.execute(
                """INSERT INTO contract_records
                (contract_key,workflow_id,contract_id,contract_version,contract_type,origin_spec_reference,
                 origin_spec_hash,requirement_ids_json,task_ids_json,path,content_hash,lifecycle_state,
                 approval_required,recorded_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(contract_key) DO UPDATE SET contract_type=excluded.contract_type,
                origin_spec_reference=excluded.origin_spec_reference,origin_spec_hash=excluded.origin_spec_hash,
                requirement_ids_json=excluded.requirement_ids_json,task_ids_json=excluded.task_ids_json,
                path=excluded.path,content_hash=excluded.content_hash,lifecycle_state=excluded.lifecycle_state,
                approval_required=excluded.approval_required,recorded_at=excluded.recorded_at""",
                (key, workflow_id, document["contract_id"], document["version"], document["contract_type"],
                 document.get("originating_spec_reference"), document.get("originating_spec_hash"),
                 json.dumps(document.get("requirement_ids", [])), json.dumps(document.get("task_ids", [])),
                 str(Path(path).resolve()), document["content_hash"], document["lifecycle_state"],
                 int(document["approval_required"]), utc_now()),
            )

    def contract_record(self, workflow_id: str, contract_id: str, version: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT * FROM contract_records WHERE workflow_id=? AND contract_id=? AND contract_version=?",
            (workflow_id, contract_id, version),
        ).fetchone()
        return dict(row) if row else None

    def contract_records(self, workflow_id: str) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute(
            "SELECT * FROM contract_records WHERE workflow_id=? ORDER BY contract_id,contract_version", (workflow_id,)
        )]

    def record_contract_assessment(self, *, workflow_id: str, spec_reference: str, spec_hash: str,
                                   assessment: str, path: str | Path, content_hash: str,
                                   task_ids: list[str]) -> None:
        with self.connection:
            self.connection.execute(
                """INSERT INTO contract_assessments
                (workflow_id,spec_reference,spec_hash,assessment,path,content_hash,task_ids_json,recorded_at)
                VALUES(?,?,?,?,?,?,?,?)""",
                (workflow_id, spec_reference, spec_hash, assessment, str(Path(path).resolve()), content_hash,
                 json.dumps(task_ids), utc_now()),
            )
        self.record_event(workflow_id, "CONTRACT_ASSESSMENT_STORED", stage_id="planning",
                          artifact_id="contract-assessment", details={"spec_reference": spec_reference,
                          "spec_hash": spec_hash, "assessment": assessment, "task_ids": task_ids,
                          "content_hash": content_hash})

    def latest_contract_assessment(self, workflow_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT * FROM contract_assessments WHERE workflow_id=? ORDER BY assessment_id DESC LIMIT 1", (workflow_id,)
        ).fetchone()
        return dict(row) if row else None

    def record_contract_validation(self, *, workflow_id: str, contract_id: str, version: str,
                                   content_hash: str, validation_type: str, status: str,
                                   details: dict[str, Any]) -> None:
        with self.connection:
            self.connection.execute(
                """INSERT INTO contract_validations
                (workflow_id,contract_id,contract_version,content_hash,validation_type,status,details_json,recorded_at)
                VALUES(?,?,?,?,?,?,?,?)""",
                (workflow_id, contract_id, version, content_hash, validation_type, status,
                 json.dumps(details, ensure_ascii=False, default=str), utc_now()),
            )
        self.record_event(workflow_id, "CONTRACT_VALIDATION_RECORDED", artifact_id=contract_id,
                          details={"version": version, "content_hash": content_hash,
                                   "validation_type": validation_type, "status": status})

    def has_contract_review(self, workflow_id: str, contract_id: str, version: str, content_hash: str) -> bool:
        for row in self.connection.execute(
            "SELECT details_json FROM events WHERE workflow_id=? AND artifact_id=? AND event_type='CONTRACT_PRESENTED_FOR_REVIEW' ORDER BY event_id DESC",
            (workflow_id, contract_id),
        ):
            try:
                details = json.loads(row["details_json"])
            except json.JSONDecodeError:
                continue
            if details.get("version") == version and details.get("content_hash") == content_hash:
                return True
        return False

    def record_contract_handoff(self, *, workflow_id: str, handoff_id: str, task_id: str | None,
                                spec_reference: str | None, path: str | Path, content_hash: str,
                                contract_refs: list[dict[str, str]], validation_status: str) -> None:
        with self.connection:
            self.connection.execute(
                """INSERT INTO contract_handoffs
                (handoff_id,workflow_id,task_id,spec_reference,path,content_hash,contract_refs_json,validation_status,recorded_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(handoff_id) DO UPDATE SET path=excluded.path,content_hash=excluded.content_hash,
                contract_refs_json=excluded.contract_refs_json,validation_status=excluded.validation_status,
                recorded_at=excluded.recorded_at""",
                (handoff_id, workflow_id, task_id, spec_reference, str(Path(path).resolve()), content_hash,
                 json.dumps(contract_refs), validation_status, utc_now()),
            )
        self.record_event(workflow_id, "AGENT_HANDOFF_VALIDATED", stage_id=self.current_stage_id(workflow_id),
                          artifact_id=handoff_id, details={"task_id": task_id, "spec_reference": spec_reference,
                          "content_hash": content_hash, "contract_refs": contract_refs,
                          "validation_status": validation_status})

    def set_task_status(self, workflow_id: str, task_id: str, status: str) -> None:
        with self.connection:
            self.connection.execute(
                """INSERT INTO task_states(workflow_id,task_id,status,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(workflow_id,task_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at""",
                (workflow_id, task_id, status, utc_now()),
            )

    def task_status(self, workflow_id: str, task_id: str) -> str | None:
        row = self.connection.execute(
            "SELECT status FROM task_states WHERE workflow_id=? AND task_id=?", (workflow_id, task_id)
        ).fetchone()
        return str(row["status"]) if row else None

    def begin_execution(self, workflow_id: str, stage_id: str, idempotency_key: str, prompt: str,
                        command: list[str], *, task_id: str | None = None,
                        contract_refs: list[dict[str, str]] | None = None,
                        contract_fingerprint: str = "") -> dict[str, Any]:
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        now = utc_now()
        increment_id = self.active_increment_id(workflow_id)
        with self.connection:
            row = self.connection.execute("SELECT * FROM executions WHERE idempotency_key = ?", (idempotency_key,)).fetchone()
            if row:
                existing = dict(row)
                if existing["status"] == ExecutionStatus.COMPLETED.value:
                    return existing
                if existing["status"] == ExecutionStatus.RUNNING.value:
                    raise ValueError(f"Execução {existing['run_id']} já está em andamento")
                if existing["status"] == ExecutionStatus.PENDING.value:
                    return existing
                self.connection.execute(
                    """UPDATE executions SET status='RUNNING', attempt=attempt+1, started_at=?, finished_at=NULL,
                    exit_code=NULL, stdout='', stderr='', error=NULL, command_json=?, task_id=?,
                    contract_refs_json=?,contract_fingerprint=? WHERE run_id=?""",
                    (now, json.dumps(command), task_id, json.dumps(contract_refs or []), contract_fingerprint, existing["run_id"]),
                )
                return dict(self.connection.execute("SELECT * FROM executions WHERE run_id=?", (existing["run_id"],)).fetchone())
            run_id = str(uuid.uuid4())
            self.connection.execute(
                """INSERT INTO executions(run_id,idempotency_key,workflow_id,increment_id,stage_id,status,prompt_hash,
                command_json,started_at,task_id,contract_refs_json,contract_fingerprint)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (run_id, idempotency_key, workflow_id, increment_id, stage_id, ExecutionStatus.RUNNING.value,
                 prompt_hash, json.dumps(command), now, task_id, json.dumps(contract_refs or []), contract_fingerprint),
            )
            return dict(self.connection.execute("SELECT * FROM executions WHERE run_id=?", (run_id,)).fetchone())

    def restart_pending_execution(self, run_id: str) -> dict[str, Any]:
        with self.connection:
            cursor = self.connection.execute(
                """UPDATE executions SET status='RUNNING', attempt=attempt+1, started_at=?, finished_at=NULL,
                exit_code=NULL, stdout='', stderr='', error=NULL WHERE run_id=? AND status='PENDING'""",
                (utc_now(), run_id),
            )
            if cursor.rowcount != 1:
                raise ValueError(f"Execução não está pendente para retomada: {run_id}")
            return dict(self.connection.execute("SELECT * FROM executions WHERE run_id=?", (run_id,)).fetchone())

    def finish_execution(self, run_id: str, status: ExecutionStatus, *, exit_code: int | None = None,
                         stdout: str = "", stderr: str = "", error: str | None = None) -> None:
        with self.connection:
            self.connection.execute(
                """UPDATE executions SET status=?, finished_at=?, exit_code=?, stdout=?, stderr=?, error=?
                WHERE run_id=?""",
                (status.value, utc_now(), exit_code, stdout, stderr, error, run_id),
            )

    def execution(self, run_id: str) -> dict[str, Any] | None:
        row = self.connection.execute("SELECT * FROM executions WHERE run_id = ?", (run_id,)).fetchone()
        return dict(row) if row else None

    def latest_execution(self, workflow_id: str, stage_id: str) -> dict[str, Any] | None:
        increment_id = self.active_increment_id(workflow_id)
        if increment_id is None:
            row = self.connection.execute(
                "SELECT * FROM executions WHERE workflow_id = ? AND stage_id = ? AND increment_id IS NULL "
                "ORDER BY started_at DESC LIMIT 1", (workflow_id, stage_id),
            ).fetchone()
        else:
            row = self.connection.execute(
                "SELECT * FROM executions WHERE workflow_id = ? AND stage_id = ? AND increment_id = ? "
                "ORDER BY started_at DESC LIMIT 1", (workflow_id, stage_id, increment_id),
            ).fetchone()
        return dict(row) if row else None

    def recover_interrupted_executions(self, workflow_id: str) -> int:
        rows = list(self.connection.execute(
            "SELECT run_id, stage_id FROM executions WHERE workflow_id = ? AND status = 'RUNNING'", (workflow_id,)
        ))
        if not rows:
            return 0
        with self.connection:
            for row in rows:
                self.connection.execute(
                    "UPDATE executions SET status='FAILED', finished_at=?, error=? WHERE run_id=?",
                    (utc_now(), "Execution interrupted; resume requires re-evaluation and authorization.", row["run_id"]),
                )
        for row in rows:
            self.record_event(workflow_id, "EXECUTION_RECOVERED_AS_FAILED", stage_id=row["stage_id"], details={"run_id": row["run_id"]})
        return len(rows)

    def record_event(self, workflow_id: str, event_type: str, *, stage_id: str | None = None,
                     artifact_id: str | None = None, details: dict[str, Any] | None = None) -> None:
        with self.connection:
            self.connection.execute(
                "INSERT INTO events(workflow_id,event_type,stage_id,artifact_id,details_json,created_at) VALUES(?,?,?,?,?,?)",
                (workflow_id, event_type, stage_id, artifact_id, json.dumps(details or {}, ensure_ascii=False), utc_now()),
            )

    def events(self, workflow_id: str) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute(
            "SELECT * FROM events WHERE workflow_id = ? ORDER BY event_id", (workflow_id,)
        )]
