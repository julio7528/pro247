from __future__ import annotations

from typing import Any

from ..core.specification_resolver import extract_spec_values
from ..core.state_manager import StateManager
from ..models import ClarificationQuestion


class ClarificationManager:
    def __init__(self, workflow: dict[str, Any], state: StateManager, resolver: Any | None = None):
        self.workflow = workflow
        self.state = state
        self.resolver = resolver

    def unanswered_fields(self, stage_id: str) -> tuple[str, ...]:
        rules = self.workflow["clarification_rules"]
        answers = self.known_answers(stage_id)
        return tuple(field for field in rules["minimum_confirmed_fields"] if not answers.get(field, "").strip())

    def questions(self, stage_id: str) -> list[ClarificationQuestion]:
        rules = self.workflow["clarification_rules"]
        prompts = rules["question_prompts"]
        answers = self.known_answers(stage_id)
        fields = rules["minimum_confirmed_fields"]
        return [ClarificationQuestion(field, prompts.get(field, f"Confirme {field}."))
                for field in fields if not answers.get(field, "").strip()]

    def known_answers(self, stage_id: str) -> dict[str, str]:
        answers: dict[str, str] = {}
        workflow_id = self.workflow["workflow_id"]
        increment = self.state.active_discovery_increment(workflow_id, stage_id)
        after_id = int(increment["start_answer_id"]) if increment else 0
        spec = None
        if self.resolver:
            if increment and increment.get("spec_id"):
                spec = next((item for item in self.resolver.find_specifications()
                             if item.spec_id == increment["spec_id"]), None)
            elif not increment:
                spec = self.resolver.active_specification()
        if spec:
            answers.update(extract_spec_values(spec.path.read_text(encoding="utf-8")))
        answer_records = self.state.confirmed_answer_records(workflow_id, stage_id, after_id=after_id)
        answers.update({field: record["answer"] for field, record in answer_records.items()})
        return answers

    def record_answer(self, stage_id: str, field: str, answer: str) -> None:
        prompts = self.workflow["clarification_rules"]["question_prompts"]
        allowed = set(prompts)
        if field not in allowed:
            raise ValueError(f"Campo de esclarecimento desconhecido: {field}")
        self.state.record_answer(self.workflow["workflow_id"], stage_id, field, prompts[field], answer, confirmed=True)
