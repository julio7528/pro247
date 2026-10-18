from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import yaml

from .config import OrchestratorConfig
from .core.workflow_engine import WorkflowEngine
from .models import ExecutionResult


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="orchestrator", description="Orquestrador progressivo com aprovações humanas.")
    parser.add_argument("--config", help="Caminho para orchestrator/config.json.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Mostra a etapa atual, estados e a execução mais recente.")

    evaluate = sub.add_parser("evaluate", help="Avalia a especificação e os gates da etapa.")
    evaluate.add_argument("stage_id", nargs="?")
    evaluate.add_argument("--json", action="store_true")

    discover = sub.add_parser("discover", help="Conduz requisitos do incremento ativo; um novo ciclo exige --new-increment.")
    discover.add_argument("--interactive", action=argparse.BooleanOptionalAction, default=True)
    discover.add_argument("--new-increment", action="store_true",
                          help="Inicia outra spec independente para um incremento definido pelo usuário.")
    discover.add_argument("--name", help="Nome do incremento; obrigatório com --new-increment.")

    answer = sub.add_parser("answer", help="Registra uma resposta confirmada para um campo de descoberta.")
    answer.add_argument("field")
    answer.add_argument("text")

    spec = sub.add_parser("spec", help="Inspeciona e governa especificações de produto.")
    spec_commands = spec.add_subparsers(dest="spec_command", required=True)
    spec_commands.add_parser("list", help="Lista especificações existentes.")
    show = spec_commands.add_parser("show", help="Mostra o conteúdo exato de uma especificação.")
    show.add_argument("spec_id")
    select = spec_commands.add_parser("select", help="Seleciona a especificação de origem deste workflow.")
    select.add_argument("spec_id")
    review = spec_commands.add_parser("review", help="Marca uma especificação completa para revisão humana.")
    review.add_argument("spec_id")
    approve = spec_commands.add_parser("approve", help="Registra aprovação humana explícita.")
    approve.add_argument("spec_id")
    approve.add_argument("--version", required=True)
    approve.add_argument("--hash", required=True)
    approve.add_argument("--confirm", action="store_true", required=True)
    approve.add_argument("--evidence", required=True)
    reject = spec_commands.add_parser("reject", help="Rejeita a versão em revisão e devolve o documento a DRAFT.")
    reject.add_argument("spec_id")
    reject.add_argument("--version", required=True)
    reject.add_argument("--hash", required=True)
    reject.add_argument("--confirm", action="store_true", required=True)
    reject.add_argument("--reason", required=True)

    sub.add_parser("start", help="Inicia explicitamente a etapa atual.")
    sub.add_parser("present", help="Apresenta o entregável atual e aguarda orientação humana.")
    complete = sub.add_parser("complete", help="Conclui a etapa atual depois dos gates.")
    complete.add_argument("--confirm", action="store_true", required=True)
    advance = sub.add_parser("advance", help="Avança uma etapa após aprovação e autorização explícita.")
    advance.add_argument("--authorize", action="store_true", required=True)
    advance.add_argument("--evidence", required=True)

    run = sub.add_parser("run", help="Prepara execução em dry-run; execução real exige configuração e autorização.")
    run.add_argument("--execute", action="store_true", help="Solicita executar o comando configurado.")
    run.add_argument("--authorize", action="store_true", help="Confirma explicitamente a execução real.")
    run.add_argument("--task", help="TASK-NNN para resolver contratos de tarefa aplicáveis.")
    resume = sub.add_parser("resume", help="Recupera execução interrompida e reavalia antes de retomar.")
    resume.add_argument("--execute", action="store_true")
    resume.add_argument("--authorize", action="store_true")

    artifact = sub.add_parser("artifact", help="Registra um artefato de etapa.")
    artifact_commands = artifact.add_subparsers(dest="artifact_command", required=True)
    register = artifact_commands.add_parser("register", help="Valida e registra um arquivo de entrega.")
    register.add_argument("stage_id")
    register.add_argument("artifact_id")
    register.add_argument("path")
    register.add_argument("--version", default="1")
    register.add_argument("--spec-ref")
    register.add_argument("--requirement", action="append", default=[], help="RF-00X relacionado (repetível).")
    register.add_argument("--task", action="append", default=[], help="TASK-00X relacionado (repetível).")
    register.add_argument("--contract", action="append", default=[], help="CONTRACT-NNN@versão@hash relacionado (repetível).")

    gate = sub.add_parser("gate", help="Registra a decisão humana para os entregáveis de uma etapa.")
    gate_commands = gate.add_subparsers(dest="gate_command", required=True)
    gate_review = gate_commands.add_parser("review", help="Mostra hash agregado e arquivos validados para revisão.")
    gate_review.add_argument("stage_id")
    gate_approve = gate_commands.add_parser("approve", help="Aprova os artefatos validados da etapa.")
    gate_approve.add_argument("stage_id")
    gate_approve.add_argument("--hash", required=True)
    gate_approve.add_argument("--confirm", action="store_true", required=True)
    gate_approve.add_argument("--evidence", required=True)

    deployment = sub.add_parser("deployment", help="Registra autorização explícita para deploy de produção.")
    deployment_commands = deployment.add_subparsers(dest="deployment_command", required=True)
    deploy_authorize = deployment_commands.add_parser("authorize", help="Autoriza escopo e versão de produção.")
    deploy_authorize.add_argument("--confirm", action="store_true", required=True)
    deploy_authorize.add_argument("--scope", required=True)
    deploy_authorize.add_argument("--version", required=True)
    deploy_authorize.add_argument("--evidence", required=True)

    contract = sub.add_parser("contract", aliases=["contracts"], help="Avalia, gera e governa contratos de tarefa e interface.")
    contract_commands = contract.add_subparsers(dest="contract_command", required=True)
    contract_commands.add_parser("list", help="Lista contratos operacionais e de produto.")
    contract_show = contract_commands.add_parser("show", help="Mostra o documento de contrato exato.")
    contract_show.add_argument("contract_id")
    contract_show.add_argument("--version")
    contract_evaluate = contract_commands.add_parser("evaluate", help="Avalia contratos aplicáveis ao estágio/tarefa.")
    contract_evaluate.add_argument("--stage")
    contract_evaluate.add_argument("--task")
    contract_evaluate.add_argument("--json", action="store_true")
    contract_assess = contract_commands.add_parser("assess", help="Avalia contratos no Planning ou registra revisão explícita após o desenho da solução.")
    contract_assess.add_argument("--justification", required=True)
    contract_assess.add_argument("--task-file", action="append", default=[])
    contract_assess.add_argument("--contract-task", action="append", default=[], help="TASK-NNN que exige contrato de produto.")
    contract_generate = contract_commands.add_parser("generate", help="Gera/reaproveita rascunho a partir de tarefa planejada confirmada.")
    contract_generate.add_argument("--task-file", required=True)
    contract_validate = contract_commands.add_parser("validate", help="Valida schema, origem, escopo e aprovação de um contrato.")
    contract_validate.add_argument("contract_id")
    contract_validate.add_argument("--version")
    contract_validate.add_argument("--check-inputs", action="store_true")
    contract_review = contract_commands.add_parser("review", help="Apresenta uma versão de contrato para revisão humana.")
    contract_review.add_argument("contract_id")
    contract_review.add_argument("--version")
    contract_approve = contract_commands.add_parser("approve", help="Aprova explicitamente uma versão/hash de contrato.")
    contract_approve.add_argument("contract_id")
    contract_approve.add_argument("--version", required=True)
    contract_approve.add_argument("--hash", required=True)
    contract_approve.add_argument("--confirm", action="store_true", required=True)
    contract_approve.add_argument("--evidence", required=True)
    contract_reject = contract_commands.add_parser("reject", help="Rejeita uma versão/hash de contrato apresentada.")
    contract_reject.add_argument("contract_id")
    contract_reject.add_argument("--version", required=True)
    contract_reject.add_argument("--hash", required=True)
    contract_reject.add_argument("--confirm", action="store_true", required=True)
    contract_reject.add_argument("--reason", required=True)
    contract_output = contract_commands.add_parser("validate-output", help="Valida saída declarada contra schema e obrigação aprovada.")
    contract_output.add_argument("contract_id")
    contract_output.add_argument("file")
    contract_output.add_argument("--version")
    contract_handoff = contract_commands.add_parser("validate-handoff", help="Valida e registra um registro de handoff.")
    contract_handoff.add_argument("file")
    return parser


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def _format_status(snapshot: dict[str, Any]) -> str:
    lines = [f"Workflow: {snapshot['workflow_id']}", f"Etapa atual: {snapshot['current_stage_id']}"]
    increment = snapshot.get("active_increment")
    if increment:
        lines.append(f"Incremento atual: {increment['increment_order']} — {increment['increment_name']}")
    lines.append("")
    lines.append("Ordem | Etapa | Estado da etapa | Execução | Agentes")
    for number, stage in enumerate(snapshot["stages"], 1):
        current = " *" if stage["is_current"] else ""
        lines.append(f"{number} | {stage['id']}{current} | {stage['stage_status']} | {stage['execution_status']} | {', '.join(stage['assigned_agents'])}")
    spec = snapshot["active_specification"]
    lines.extend(["", f"Especificação ativa: {spec['id']}@{spec['version']} ({spec['status']}) — {'completa' if spec['complete'] else 'incompleta'}" if spec else "Especificação ativa: nenhuma"])
    if snapshot.get("specification_resolution_issue"):
        lines.append("Ação necessária: " + snapshot["specification_resolution_issue"])
    return "\n".join(lines)


def _format_execution(result: ExecutionResult) -> str:
    lines = [f"Execução: {result.status.value}", f"ID: {result.run_id}"]
    if result.dry_run:
        lines.append(f"Comando configurado: {result.stdout}")
        lines.append("Nenhum processo foi iniciado (dry-run). Para executar, habilite a configuração e passe --execute --authorize.")
    if result.exit_code is not None:
        lines.append(f"Código de saída: {result.exit_code}")
    if result.stdout:
        lines.append(f"stdout:\n{result.stdout}")
    if result.stderr:
        lines.append(f"stderr:\n{result.stderr}")
    if result.error:
        lines.append(f"Erro: {result.error}")
    return "\n".join(lines)


def _handle(args: argparse.Namespace, engine: WorkflowEngine) -> int:
    workflow_id = engine.workflow["workflow_id"]
    if args.command == "status":
        snapshot = engine.inspect()
        print(_format_status(snapshot))
        return 0

    if args.command in {"contract", "contracts"}:
        command = args.contract_command
        if command == "list":
            rows = []
            for document in engine.contract_registry.load_all():
                validation = engine.contract_validator.validate_document(
                    document, path=document.get("_path"),
                    require_approval=document.get("approval_required", True),
                )
                rows.append({"contract_id": document.get("contract_id"), "version": document.get("version"),
                             "type": document.get("contract_type"), "state": document.get("lifecycle_state"),
                             "content_hash": document.get("content_hash"),
                             "spec_reference": document.get("originating_spec_reference"),
                             "task_ids": document.get("task_ids", []), "ready": validation["ready"],
                             "approval_valid": validation["approval_valid"], "path": str(document.get("_path"))})
            _print_json(rows)
            return 0
        if command == "show":
            document = engine.contract_registry.get(args.contract_id, args.version)
            _print_json({key: str(value) if key == "_path" else value for key, value in document.items()})
            return 0
        if command == "evaluate":
            stage_id = args.stage or engine.state.current_stage_id(workflow_id)
            result = engine.contract_resolver.evaluate(stage_id, args.task, check_inputs=True)
            if args.json:
                _print_json(result)
            else:
                print(f"Etapa: {result['stage_id']}\nTarefa: {result['task_id'] or '(não informada)'}\nEstado: {result['status']}")
                print("Contratos obrigatórios: " + (", ".join(f"{item['contract_id']}@{item['version']}#{item['content_hash']}" for item in result["required_contracts"]) or "nenhum"))
                if result["blockers"]:
                    print("Bloqueios: " + "; ".join(result["blockers"]))
            return 0 if not result["blockers"] else 2
        if command == "assess":
            result = engine.contract_assessment.assess(
                justification=args.justification, task_paths=args.task_file,
                contract_task_ids=args.contract_task,
            )
            _print_json(result)
            return 0
        if command == "generate":
            result = engine.contract_generator.generate(args.task_file)
            _print_json({key: str(value) if key in {"_path", "path"} else value for key, value in result.items()})
            return 0 if result["validation"]["schema_valid"] and result["validation"]["semantic_valid"] else 2
        if command == "validate":
            document = engine.contract_registry.get(args.contract_id, args.version)
            result = engine.contract_validator.validate_document(
                document, path=document["_path"], require_approval=True, check_inputs=args.check_inputs,
            )
            engine.state.record_contract_validation(
                workflow_id=workflow_id, contract_id=document["contract_id"], version=document["version"],
                content_hash=document["content_hash"], validation_type="cli-validation",
                status="PASSED" if result["ready"] else "FAILED", details=result,
            )
            _print_json(result)
            return 0 if result["ready"] else 2
        if command == "review":
            _print_json(engine.approvals.review_contract(args.contract_id, args.version))
            return 0
        if command == "approve":
            _print_json(engine.approvals.approve_contract(
                args.contract_id, args.evidence, confirmed=args.confirm,
                expected_version=args.version, expected_hash=args.hash,
            ))
            return 0
        if command == "reject":
            _print_json(engine.approvals.reject_contract(
                args.contract_id, args.reason, confirmed=args.confirm,
                expected_version=args.version, expected_hash=args.hash,
            ))
            return 0
        if command == "validate-output":
            document = engine.contract_registry.get(args.contract_id, args.version)
            result = engine.contract_validator.validate_output(document, args.file)
            engine.state.record_contract_validation(
                workflow_id=workflow_id, contract_id=document["contract_id"], version=document["version"],
                content_hash=document["content_hash"], validation_type="contract-output",
                status="PASSED" if result["valid"] else "FAILED", details=result,
            )
            _print_json(result)
            return 0 if result["valid"] else 2
        if command == "validate-handoff":
            handoff_path = engine.contract_registry.safe_path(args.file)
            try:
                handoff = yaml.safe_load(handoff_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, yaml.YAMLError) as exc:
                raise ValueError(f"Handoff não pôde ser lido: {exc}") from exc
            result = engine.contract_validator.validate_handoff(handoff)
            digest = hashlib.sha256(handoff_path.read_bytes()).hexdigest()
            engine.state.record_contract_validation(
                workflow_id=workflow_id, contract_id="CONTRACT-003", version="1.0.0",
                content_hash=next((item["content_hash"] for item in engine.contract_resolver.for_handoff()
                                   if item["contract_id"] == "CONTRACT-003"), ""),
                validation_type="handoff", status="PASSED" if result["valid"] else "FAILED",
                details={**result, "file": str(handoff_path), "file_hash": digest},
            )
            if result["valid"] and isinstance(handoff, dict) and handoff.get("handoff_id"):
                engine.state.record_contract_handoff(
                    workflow_id=workflow_id, handoff_id=str(handoff["handoff_id"]),
                    task_id=handoff.get("task_id"), spec_reference=handoff.get("originating_spec_reference"),
                    path=handoff_path, content_hash=digest, contract_refs=handoff.get("contract_refs", []),
                    validation_status="PASSED" if result["valid"] else "FAILED",
                )
            _print_json(result)
            return 0 if result["valid"] else 2

    if args.command == "evaluate":
        evaluation = engine.evaluate(args.stage_id)
        if args.json:
            _print_json(evaluation.to_dict())
        else:
            print(f"Etapa: {evaluation.stage_id}\nResultado: {evaluation.status.value}\nMotivo: {evaluation.reason}")
            if evaluation.missing_information:
                print("Informações pendentes: " + ", ".join(evaluation.missing_information))
            if evaluation.blocked_by:
                print("Bloqueios: " + ", ".join(evaluation.blocked_by))
            if evaluation.specification:
                spec = evaluation.specification
                print(f"Especificação: {spec.spec_id}@{spec.version} — {spec.path}")
            if evaluation.agents:
                print("Agentes responsáveis: " + ", ".join(evaluation.agents))
            if evaluation.skill:
                print("Skill: " + evaluation.skill)
        return 0

    if args.command == "discover":
        if args.new_increment and not args.name:
            raise ValueError("Informe --name ao iniciar um novo incremento")
        questions = engine.discover_questions(new_increment=args.new_increment, increment_name=args.name)
        if not questions:
            increment = engine.state.active_discovery_increment(workflow_id, "requirements-discovery")
            spec = None
            if increment and increment.get("spec_id"):
                spec = next((item for item in engine.resolver.find_specifications()
                             if item.spec_id == increment["spec_id"]), None)
            elif not increment:
                spec = engine.resolver.active_specification()
            if spec and spec.complete:
                print(f"Nenhuma pergunta obrigatória pendente. Revise {spec.spec_id}@{spec.version}: {spec.path}")
                return 0
            path = engine.collect_requirements()
            print(f"Rascunho de incremento criado/atualizado: {path}")
            return 0
        for question in questions:
            if not args.interactive:
                print(f"{question.field}: {question.prompt}")
                continue
            answer = input(f"{question.prompt}\n> ").strip()
            if answer:
                engine.clarification.record_answer(engine.state.current_stage_id(workflow_id), question.field, answer)
            else:
                print(f"Sem resposta para '{question.field}'; permanecerá pendente.")
        remaining = engine.clarification.questions(engine.state.current_stage_id(workflow_id))
        if remaining:
            print("Ainda há confirmações obrigatórias pendentes: " + ", ".join(question.field for question in remaining))
            return 0
        path = engine.collect_requirements()
        print(f"Rascunho de incremento criado/atualizado: {path}")
        return 0

    if args.command == "answer":
        stage_id = engine.state.current_stage_id(workflow_id)
        engine.controller.start_current()
        engine.clarification.record_answer(stage_id, args.field, args.text)
        if not engine.clarification.questions(stage_id):
            path = engine.collector.generate_or_update(stage_id, revise=True)
            print(f"Resposta confirmada registrada e especificação criada/atualizada: {path}")
        else:
            print(f"Resposta confirmada registrada para {args.field}. Execute 'discover' para continuar.")
        return 0

    if args.command == "spec":
        if args.spec_command == "list":
            increments = {
                item.get("spec_id"): {
                    "increment_order": item["increment_order"],
                    "increment_name": item["increment_name"],
                }
                for item in engine.state.discovery_increments(workflow_id, "requirements-discovery")
                if item.get("spec_id")
            }
            _print_json([{
                "id": spec.spec_id, "version": spec.version, "status": spec.status,
                "complete": spec.complete, "path": str(spec.path), "content_hash": spec.content_hash,
                **increments.get(spec.spec_id, {}),
            } for spec in engine.resolver.find_specifications()])
            return 0
        if args.spec_command == "show":
            spec = next((item for item in engine.resolver.find_specifications() if item.spec_id == args.spec_id), None)
            if not spec:
                raise ValueError(f"Especificação não encontrada: {args.spec_id}")
            print(spec.path.read_text(encoding="utf-8"))
            return 0
        if args.spec_command == "select":
            spec = engine.resolver.select_specification(args.spec_id)
            print(f"Especificação ativa do workflow: {spec.spec_id}@{spec.version} — {spec.path}")
            return 0
        if args.spec_command == "review":
            result = engine.approvals.review_specification(args.spec_id)
            _print_json(result)
            print("Documento apresentado para revisão; a etapa aguarda o usuário.")
            return 0
        if args.spec_command == "approve":
            record = engine.approvals.approve_specification(
                args.spec_id, args.evidence, confirmed=args.confirm,
                expected_version=args.version, expected_hash=args.hash)
            _print_json(record)
            print("Aprovação persistida para esta versão e hash. Concluir a etapa e avançar continuam sendo ações separadas.")
            return 0
        if args.spec_command == "reject":
            record = engine.approvals.reject_specification(
                args.spec_id, args.reason, confirmed=args.confirm,
                expected_version=args.version, expected_hash=args.hash)
            _print_json(record)
            return 0

    if args.command == "start":
        print(engine.controller.start_current())
        return 0
    if args.command == "present":
        print(engine.controller.present_for_review())
        return 0
    if args.command == "complete":
        print(engine.controller.complete_current(confirmed=args.confirm))
        return 0
    if args.command == "advance":
        print(engine.controller.advance(authorized=args.authorize, evidence=args.evidence))
        return 0
    if args.command == "run":
        result = engine.controller.run_current(execute=args.execute, authorized=args.authorize,
                                               task_id=getattr(args, "task", None))
        print(_format_execution(result))
        return 0
    if args.command == "resume":
        result = engine.controller.resume(execute=args.execute, authorized=args.authorize)
        print(_format_execution(result) if isinstance(result, ExecutionResult) else result)
        return 0

    if args.command == "artifact" and args.artifact_command == "register":
        import re
        if any(not re.fullmatch(r"RF-\d{3,}", value) for value in args.requirement):
            raise ValueError("IDs de requisito devem usar o formato RF-00X")
        if any(not re.fullmatch(r"TASK-\d{3,}", value) for value in args.task):
            raise ValueError("IDs de tarefa devem usar o formato TASK-00X")
        if args.spec_ref and not re.fullmatch(r"SPEC-\d{3,}@\d+\.\d+\.\d+", args.spec_ref):
            raise ValueError("Referência de origem deve usar SPEC-NNN@MAJOR.MINOR.PATCH")
        contract_refs = []
        for reference in args.contract:
            parts = reference.split("@")
            if len(parts) != 3:
                raise ValueError("Referência de contrato deve usar CONTRACT-NNN@MAJOR.MINOR.PATCH@sha256")
            contract_id, contract_version, digest = parts
            contract = engine.contract_registry.get(contract_id, contract_version)
            if contract.get("content_hash") != digest:
                raise ValueError(f"Hash atual diverge para {contract_id}@{contract_version}")
            contract_refs.append({"contract_id": contract_id, "version": contract_version, "content_hash": digest})
        valid, reason = engine.quality_gate.validate_artifact(
            args.stage_id, args.artifact_id, args.path, args.spec_ref,
            requirement_ids=args.requirement, task_ids=args.task, contract_refs=contract_refs)
        if not valid:
            raise ValueError(reason)
        path = Path(args.path)
        if not path.is_absolute():
            path = engine.config.root / path
        digest = engine.state.record_artifact(workflow_id=workflow_id, stage_id=args.stage_id,
                                              artifact_id=args.artifact_id, artifact_version=args.version,
                                              path=path, spec_reference=args.spec_ref, validation_status="PASSED",
                                              requirement_ids=args.requirement, task_ids=args.task,
                                              validation_summary=reason, contract_refs=contract_refs)
        _print_json({"stage_id": args.stage_id, "artifact_id": args.artifact_id, "version": args.version,
                     "path": str(path), "content_hash": digest, "validation": reason})
        return 0
    if args.command == "gate" and args.gate_command == "review":
        digest = engine.quality_gate.stage_gate_digest(args.stage_id)
        spec = engine.resolver.active_specification()
        spec_reference = f"{spec.spec_id}@{spec.version}" if spec else None
        _print_json({"stage_id": args.stage_id, "hash": digest,
                     "artifacts": engine.state.artifact_records(
                         workflow_id, args.stage_id, spec_reference=spec_reference)})
        return 0
    if args.command == "gate" and args.gate_command == "approve":
        record = engine.approvals.approve_stage_gate(
            args.stage_id, args.evidence, confirmed=args.confirm, expected_hash=args.hash)
        _print_json(record)
        return 0
    if args.command == "deployment" and args.deployment_command == "authorize":
        record = engine.approvals.authorize_deployment(args.scope, args.version, args.evidence, confirmed=args.confirm)
        _print_json(record)
        return 0
    raise ValueError("Comando não implementado")


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        config = OrchestratorConfig.load(args.config)
        engine = WorkflowEngine(config)
    except (ValueError, OSError) as exc:
        print(f"Erro de inicialização: {exc}", file=sys.stderr)
        return 2
    try:
        return _handle(args, engine)
    except (ValueError, PermissionError, OSError) as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 2
    finally:
        engine.close()
