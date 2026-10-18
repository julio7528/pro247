from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml


class ContractError(ValueError):
    pass


def contract_content_hash(document: dict[str, Any]) -> str:
    """Hash contract meaning while excluding mutable display/approval metadata."""
    canonical = deepcopy(document)
    canonical.pop("content_hash", None)
    canonical.pop("lifecycle_state", None)
    canonical.pop("approval_metadata", None)
    canonical.pop("_path", None)
    encoded = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class ContractRegistry:
    def __init__(self, root: str | Path, state: Any | None = None, workflow_id: str = "arqcalc"):
        self.root = Path(root).resolve()
        self.contract_root = self.root / "contracts"
        self.state = state
        self.workflow_id = workflow_id

    def safe_path(self, path: str | Path, *, base: str | Path | None = None) -> Path:
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = (Path(base).resolve() if base else self.root) / candidate
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self.root):
            raise ContractError(f"Caminho fora da raiz do projeto: {path}")
        return resolved

    def contract_paths(self) -> list[Path]:
        paths: list[Path] = []
        for directory in (self.contract_root / "operational", self.contract_root / "generated"):
            if directory.is_dir():
                paths.extend(directory.rglob("CONTRACT-*.yaml"))
        return sorted(paths, key=lambda item: item.as_posix())

    def read_document(self, path: str | Path) -> tuple[dict[str, Any], Path]:
        resolved = self.safe_path(path)
        if not resolved.is_file():
            raise ContractError(f"Contrato não encontrado: {resolved}")
        try:
            document = yaml.safe_load(resolved.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            raise ContractError(f"YAML de contrato inválido em {resolved}: {exc}") from exc
        if not isinstance(document, dict):
            raise ContractError(f"Contrato deve ser um objeto YAML: {resolved}")
        return document, resolved

    def load_all(self) -> list[dict[str, Any]]:
        records = []
        for path in self.contract_paths():
            document, resolved = self.read_document(path)
            document["_path"] = resolved
            records.append(document)
        return records

    def get(self, contract_id: str, version: str | None = None) -> dict[str, Any]:
        matches = [item for item in self.load_all() if item.get("contract_id") == contract_id]
        if version is not None:
            matches = [item for item in matches if item.get("version") == version]
        if not matches:
            suffix = f"@{version}" if version else ""
            raise ContractError(f"Contrato não encontrado: {contract_id}{suffix}")
        if version is not None and len(matches) > 1:
            raise ContractError(f"Versão duplicada para contrato {contract_id}@{version}")
        return max(matches, key=lambda item: self._version_key(str(item.get("version", "0.0.0"))))

    @staticmethod
    def _version_key(version: str) -> tuple[int, int, int]:
        match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
        if not match:
            return (0, 0, 0)
        return tuple(int(part) for part in match.groups())  # type: ignore[return-value]

    def next_id(self) -> str:
        highest = 0
        for path in self.contract_paths():
            match = re.search(r"CONTRACT-(\d{3,})", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
            try:
                document, _ = self.read_document(path)
            except ContractError:
                continue
            id_match = re.fullmatch(r"CONTRACT-(\d{3,})", str(document.get("contract_id", "")))
            if id_match:
                highest = max(highest, int(id_match.group(1)))
        return f"CONTRACT-{highest + 1:03d}"

    def write(self, document: dict[str, Any], *, path: str | Path | None = None) -> tuple[Path, str]:
        if path:
            target = self.safe_path(path)
        else:
            generated_root = self.contract_root / "generated"
            source = re.match(r"^(SPEC-\d{3,})@", str(document.get("originating_spec_reference", "")))
            if document.get("contract_type", "").startswith("product_") and source:
                generated_root = generated_root / source.group(1)
            target = generated_root / f"{document['contract_id']}-v{document['version']}.yaml"
        if not target.is_relative_to(self.contract_root.resolve()):
            raise ContractError(f"Contrato só pode ser gravado em contracts/: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        data = deepcopy(document)
        data.pop("_path", None)
        digest = contract_content_hash(data)
        data["content_hash"] = digest
        target.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=100), encoding="utf-8", newline="\n")
        if self.state is not None:
            self.state.register_contract(data, target, workflow_id=self.workflow_id)
        return target, digest
