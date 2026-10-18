from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ..core.specification_resolver import SpecificationResolver, parse_specification, substantive_fingerprint
from ..core.state_manager import StateManager


class RequirementsCollector:
    """Creates one traceable product specification for each user-defined increment."""

    def __init__(self, root: str | Path, workflow: dict[str, Any], state: StateManager,
                 resolver: SpecificationResolver, clarification: Any | None = None):
        self.root = Path(root)
        self.workflow = workflow
        self.state = state
        self.resolver = resolver
        self.clarification = clarification

    def generate_or_update(self, stage_id: str, *, revise: bool = False) -> Path:
        workflow_id = self.workflow["workflow_id"]
        rules = self.workflow["clarification_rules"]
        increment = self.state.active_discovery_increment(workflow_id, stage_id)
        after_id = int(increment["start_answer_id"]) if increment else 0
        answer_records = self.state.confirmed_answer_records(workflow_id, stage_id, after_id=after_id)
        recorded_answers = {field: record["answer"] for field, record in answer_records.items()}
        answers = self.clarification.known_answers(stage_id) if self.clarification else dict(recorded_answers)
        missing = [field for field in rules["minimum_confirmed_fields"] if not answers.get(field, "").strip()]
        if missing:
            raise ValueError(f"Ainda faltam confirmações: {', '.join(missing)}")

        if increment and increment.get("spec_id"):
            existing = next((spec for spec in self.resolver.find_specifications()
                             if spec.spec_id == increment["spec_id"]), None)
            if existing is None:
                raise ValueError(f"A spec do incremento {increment['increment_order']} não foi encontrada")
        elif increment:
            # A nova sessão começa vazia mesmo quando outro incremento continua selecionado.
            existing = None
        else:
            existing = self.resolver.active_specification()
        if existing and existing.status == "APPROVED":
            raise ValueError(f"Especificação aprovada é imutável pelo coletor: {existing.spec_id}")
        if existing and existing.status == "IN_REVIEW":
            raise ValueError("A especificação está em revisão; registre uma rejeição antes de alterá-la.")
        if existing and existing.complete and not revise:
            # A complete specification must be reviewed; discovery must not restart or rewrite it.
            return existing.path

        target = existing.path if existing else self._next_specification_path(rules["spec_output_directory"])
        increment = increment or {
            "increment_order": 1,
            "increment_name": answers.get("increment_name", "Incremento 1"),
        }
        template = (self.root / rules["spec_template"]).read_text(encoding="utf-8")
        source = target.read_text(encoding="utf-8") if target.exists() and target.stat().st_size else template
        updated = self._render(source, recorded_answers, target, existing is None,
                               {field: record["id"] for field, record in answer_records.items()}, increment)
        if existing:
            before = substantive_fingerprint(source)
            after = substantive_fingerprint(updated)
            if before != after:
                next_version = self._bump_patch(existing.version)
                updated = self._replace_meta(updated, "Versão", f"`{next_version}`")
                updated = self._append_history(updated, next_version, "Atualização com respostas confirmadas.")
            else:
                updated = self._replace_meta(updated, "Versão", f"`{existing.version}`")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(updated, encoding="utf-8", newline="\n")
        parsed = parse_specification(target)
        if parsed:
            self.state.set_active_specification(workflow_id, parsed.spec_id, target)
            if self.state.active_discovery_increment(workflow_id, stage_id):
                session = self.state.active_discovery_increment(workflow_id, stage_id)
            else:
                session = self.state.ensure_initial_discovery_increment(
                    workflow_id, stage_id, str(increment.get("increment_name") or "Incremento 1")
                )
            self.state.set_discovery_increment_specification(int(session["increment_id"]), parsed.spec_id)
            self.state.record_artifact(
                workflow_id=workflow_id,
                stage_id=stage_id,
                artifact_id="product-specification",
                artifact_version=f"{parsed.spec_id}@{parsed.version}",
                path=target,
                spec_reference=f"{parsed.spec_id}@{parsed.version}",
                validation_status="DRAFT" if not parsed.complete else "AWAITING_REVIEW",
                requirement_ids=re.findall(r"\bRF-\d{3,}\b", target.read_text(encoding="utf-8")),
            )
        self.state.record_event(workflow_id, "SPECIFICATION_DRAFT_UPDATED", stage_id=stage_id,
                                artifact_id=parsed.spec_id if parsed else None,
                                details={"path": str(target), "created": existing is None,
                                         "increment_order": increment.get("increment_order"),
                                         "increment_name": increment.get("increment_name")})
        return target

    def _next_specification_path(self, relative_directory: str) -> Path:
        highest = 0
        for path in (self.root / "specs").rglob("SPEC-*.md"):
            match = re.search(r"SPEC-(\d{3,})", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
        new_id = f"SPEC-{highest + 1:03d}"
        return self.root / relative_directory / f"{new_id}.md"

    def _render(self, markdown: str, answers: dict[str, str], path: Path, is_new: bool,
                answer_ids: dict[str, int], increment: dict[str, Any]) -> str:
        today = datetime.now().astimezone().isoformat(timespec="seconds")
        spec_id = re.search(r"SPEC-\d{3,}", path.name).group(0)  # target is generated with this name
        increment_name = self._md(str(increment.get("increment_name") or "Incremento 1")).strip()
        increment_order = int(increment.get("increment_order", 1))
        if is_new:
            markdown = self._replace_meta(markdown, "Identificador", f"`{spec_id}`")
            markdown = self._replace_meta(markdown, "Título", increment_name)
            markdown = self._replace_meta(markdown, "Versão", "`0.1.0`")
            markdown = self._replace_meta(markdown, "Criado em", today)
            markdown = self._replace_meta(markdown, "Origem", "Descoberta progressiva; respostas confirmadas registradas pelo orquestrador.")
        markdown = self._replace_meta(markdown, "Incremento", increment_name)
        markdown = self._replace_meta(markdown, "Ordem incremental", str(increment_order))
        markdown = self._replace_meta(markdown, "Estado", "`DRAFT`")
        markdown = self._replace_meta(markdown, "Atualizado em", today)

        if answers.get("objective"):
            markdown = self._replace_section(markdown, "Objetivo", self._md(answers["objective"]))
        markdown = self._replace_section(
            markdown, "Forma do produto",
            self._md(answers.get("product_form", "Ainda não definida nesta etapa.")),
        )
        markdown = self._replace_section(
            markdown, "Preferências tecnológicas",
            self._md(answers.get("technology_preferences", "Nenhuma preferência confirmada.")),
        )
        markdown = self._replace_section(
            markdown, "Agentes e recuperação de informação",
            self._md(answers.get("ai_relevance", "Não confirmada; nenhum componente de IA/RAG deve ser presumido.")),
        )
        if answers.get("scope"):
            markdown = self._replace_subsection(markdown, "Escopo", "Incluído", f"- {self._md(answers['scope'])}")
        markdown = self._replace_subsection(markdown, "Escopo", "Excluído", "- Nenhum item foi explicitamente excluído até o momento.")

        audience = answers.get("audience", "")
        actors_text = f"- {self._md(audience)}" if audience else "- Ainda não confirmado; mantido como pergunta em aberto."
        markdown = self._replace_section(markdown, "Atores e contexto", actors_text)

        requirements = self._requirement_rows(
            answers.get("functional_requirement", ""),
            answer_id=answer_ids.get("functional_requirement"))
        if requirements:
            markdown = self._replace_table_rows(markdown, "Requisitos funcionais", "RF", requirements)
        else:
            markdown = self._replace_table_rows(markdown, "Requisitos funcionais", "RF",
                                                 ["| `RF-001` | [Requisito a confirmar.] | [Prioridade ou não definida] | [Evidência] |"])

        markdown = self._replace_table_rows(markdown, "Requisitos não funcionais", "RNF",
                                             ["| — | Nenhum requisito não funcional foi confirmado. | — |"])
        constraints = answers.get("constraints", "")
        constraint_lines = [f"- {self._md(line)}" for line in self._split_items(constraints)]
        markdown = self._replace_section(markdown, "Restrições", "\n".join(constraint_lines) if constraint_lines
                                         else "- Nenhuma restrição foi confirmada até o momento.")
        criteria = self._requirement_rows(answers.get("acceptance_criteria", ""), prefix="CA")
        if not criteria:
            criteria = ["| — | Nenhum critério específico foi confirmado; permanece em aberto. | — |"]
        markdown = self._replace_table_rows(markdown, "Critérios de aceitação", "CA", criteria, columns=3)

        answer_trace = "; ".join(
            f"{field}=answer:{answer_ids[field]}" if field in answer_ids else f"{field}=conteúdo existente"
            for field in ("objective", "scope", "functional_requirement", "product_form",
                          "technology_preferences", "ai_relevance", "increment_dependencies")
        )
        related_specs = self._md(answers.get("increment_dependencies", "Nenhuma dependência confirmada."))
        markdown = self._replace_section(markdown, "Dependências e rastreabilidade",
                                         f"- **Especificações relacionadas:** {related_specs}\n"
                                         "- **Planos e tarefas:** Ainda não produzidos.\n"
                                         "- **Contratos, designs e testes:** Ainda não produzidos.\n"
                                         f"- **Respostas confirmadas:** {answer_trace}.\n"
                                         "- **Decisões:** A aprovação, se concedida, será registrada em `docs/decision-log.md`.")
        open_questions = self._open_question_rows(answers)
        markdown = self._replace_table_rows(markdown, "Perguntas em aberto", "Q", open_questions, columns=4)
        return markdown

    @staticmethod
    def _md(text: str) -> str:
        return " ".join(text.strip().split()).replace("|", "\\|")

    @staticmethod
    def _split_items(text: str) -> list[str]:
        return [line.strip().lstrip("-•* ") for line in text.splitlines() if line.strip()]

    def _requirement_rows(self, text: str, prefix: str = "RF", answer_id: int | None = None) -> list[str]:
        rows = []
        for item in self._split_items(text):
            source = f"SQLite answer {answer_id}" if answer_id else "Existing confirmed specification"
            rows.append(f"| `{prefix}-{len(rows) + 1:03d}` | {self._md(item)} | Não definida | {source} |" if prefix == "RF"
                        else f"| `{prefix}-{len(rows) + 1:03d}` | {self._md(item)} | `RF-001` |")
        return rows

    def _open_question_rows(self, answers: dict[str, str]) -> list[str]:
        labels = {
            "audience": ("Quem é o público ou ator principal?", "Pode influenciar conteúdo e linguagem."),
            "constraints": ("Há restrições de negócio, tecnologia ou operação?", "Pode limitar soluções."),
            "acceptance_criteria": ("Quais critérios observáveis definem a conclusão?", "Orienta validação e aceite."),
            "product_form": ("O usuário já definiu a forma do produto?", "Ajuda o Planejamento; pode permanecer em aberto."),
            "technology_preferences": ("Há preferência ou restrição tecnológica confirmada?", "Pode orientar a comparação de alternativas."),
            "ai_relevance": ("IA, agente ou RAG é uma necessidade confirmada?", "Só incluir esses componentes quando houver necessidade aprovada."),
            "increment_dependencies": ("Este incremento depende de outro incremento?", "Afeta a ordem e a rastreabilidade entre specs."),
        }
        rows = [f"| `Q-{index:03d}` | {question} | {impact} | PO + Analista; confirmar com o usuário. |"
                for index, (field, (question, impact)) in enumerate(labels.items(), 1) if not answers.get(field)]
        return rows or ["| — | Nenhuma pergunta em aberto registrada. | — | — |"]

    @staticmethod
    def _replace_meta(markdown: str, label: str, value: str) -> str:
        pattern = re.compile(rf"^(\|\s*{re.escape(label)}\s*\|\s*).*?(\s*\|\s*)$", re.MULTILINE)
        return pattern.sub(lambda match: f"{match.group(1)}{value}{match.group(2)}", markdown, count=1)

    @staticmethod
    def _replace_section(markdown: str, heading: str, replacement: str) -> str:
        pattern = re.compile(rf"(^## {re.escape(heading)}\s*\n).*?(?=^## |\Z)", re.MULTILINE | re.DOTALL)
        if not pattern.search(markdown):
            return markdown
        return pattern.sub(lambda match: match.group(1) + replacement.strip() + "\n\n", markdown, count=1)

    @staticmethod
    def _replace_subsection(markdown: str, parent: str, heading: str, replacement: str) -> str:
        parent_pattern = re.compile(rf"(^## {re.escape(parent)}\s*\n)(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL)
        match = parent_pattern.search(markdown)
        if not match:
            return markdown
        section_body = match.group(2)
        sub_pattern = re.compile(rf"(^### {re.escape(heading)}\s*\n).*?(?=^### |\Z)", re.MULTILINE | re.DOTALL)
        if sub_pattern.search(section_body):
            section_body = sub_pattern.sub(lambda sub: sub.group(1) + replacement.strip() + "\n\n", section_body, count=1)
        return markdown[:match.start(2)] + section_body + markdown[match.end(2):]

    @staticmethod
    def _replace_table_rows(markdown: str, heading: str, prefix: str, rows: list[str], columns: int = 4) -> str:
        section_pattern = re.compile(rf"(^## {re.escape(heading)}\s*\n)(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL)
        match = section_pattern.search(markdown)
        if not match:
            return markdown
        body = match.group(2)
        table_line = re.search(r"^\|.*\n\|[- |]+\|\s*$", body, flags=re.MULTILINE)
        if not table_line:
            return markdown
        existing_rows = list(re.finditer(r"^\|.*\|\s*$", body, flags=re.MULTILINE))
        header_idx = next((i for i, row in enumerate(existing_rows) if row.group(0).startswith("| ID")), None)
        if header_idx is None:
            return markdown
        start = existing_rows[header_idx + 1].end() if len(existing_rows) > header_idx + 1 else table_line.end()
        if body[start:start + 1] == "\n":
            start += 1
        end = existing_rows[-1].end() if existing_rows else start
        new_body = body[:start] + "\n".join(rows) + "\n" + body[end:]
        return markdown[:match.start(2)] + new_body + markdown[match.end(2):]

    @staticmethod
    def _bump_patch(version: str) -> str:
        match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
        if not match:
            raise ValueError(f"Versão de especificação inválida: {version}")
        return f"{match.group(1)}.{match.group(2)}.{int(match.group(3)) + 1}"

    @staticmethod
    def _append_history(markdown: str, version: str, summary: str) -> str:
        marker = "## Histórico de versões"
        index = markdown.find(marker)
        if index < 0:
            return markdown
        table_end = markdown.find("\n\n", markdown.find("| Versão |", index))
        if table_end < 0:
            table_end = len(markdown)
        row = f"\n| `{version}` | {datetime.now().astimezone().date().isoformat()} | {summary} | Respostas confirmadas pelo usuário. |"
        return markdown[:table_end] + row + markdown[table_end:]
