#!/usr/bin/env python3
"""CLI для n8n Public API: workflows, executions, синк из deploy/*.workflow.json."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from n8n_env import ROOT, require_n8n_config


def api_request(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    base, key = require_n8n_config()
    url = f"{base}/api/v1{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-N8N-API-KEY", key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {detail[:3000]}") from exc


def list_workflows(limit: int = 100) -> list[dict[str, Any]]:
    payload = api_request("GET", f"/workflows?limit={limit}")
    return payload.get("data", payload if isinstance(payload, list) else [])


def find_workflow_by_name(name: str) -> dict[str, Any] | None:
    for wf in list_workflows():
        if wf.get("name") == name:
            return wf
    return None


def get_workflow(workflow_id: str) -> dict[str, Any]:
    return api_request("GET", f"/workflows/{workflow_id}")


PLACEHOLDER_MARKERS = ("ЗАМЕНИТЕ", "REPLACE_", "your-api-key", "CHANGE_ME")
PRESERVE_ASSIGNMENTS = frozenset({"backendApiSecret"})


def _is_placeholder(value: Any) -> bool:
    text = str(value or "")
    return any(marker in text for marker in PLACEHOLDER_MARKERS)


def _merge_set_assignments(remote_params: dict[str, Any], local_params: dict[str, Any]) -> dict[str, Any]:
    merged = dict(local_params)
    local_assignments = {
        item["name"]: item
        for item in local_params.get("assignments", {}).get("assignments", [])
    }
    remote_assignments = {
        item["name"]: item
        for item in remote_params.get("assignments", {}).get("assignments", [])
    }
    result = []
    for name, local_item in local_assignments.items():
        item = dict(local_item)
        if name in PRESERVE_ASSIGNMENTS and name in remote_assignments:
            remote_value = remote_assignments[name].get("value")
            if _is_placeholder(item.get("value")) and remote_value and not _is_placeholder(remote_value):
                item["value"] = remote_value
        result.append(item)
    merged.setdefault("assignments", {})["assignments"] = result
    return merged


def merge_workflow(remote: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    """Обновить parameters узлов по имени; сохранить id/credentials/webhookId на сервере."""
    remote_by_name = {node["name"]: node for node in remote.get("nodes", [])}

    for local_node in local.get("nodes", []):
        name = local_node["name"]
        if name not in remote_by_name:
            remote_by_name[name] = local_node
            continue
        remote_node = remote_by_name[name]
        local_params = local_node.get("parameters", {})
        remote_params = remote_node.get("parameters", {})
        if local_params.get("assignments") and remote_params.get("assignments"):
            remote_node["parameters"] = _merge_set_assignments(remote_params, local_params)
        else:
            remote_node["parameters"] = local_params or remote_params
        for field in ("typeVersion", "notes", "notesInFlow", "type"):
            if field in local_node:
                remote_node[field] = local_node[field]

    return {
        "name": local.get("name", remote["name"]),
        "nodes": list(remote_by_name.values()),
        "connections": local.get("connections", remote.get("connections", {})),
        "settings": local.get("settings", remote.get("settings", {})),
        "staticData": remote.get("staticData"),
    }


def update_workflow(workflow_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return api_request("PUT", f"/workflows/{workflow_id}", body)


def list_executions(limit: int = 10, workflow_id: str | None = None) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode(
        {"limit": limit, **({"workflowId": workflow_id} if workflow_id else {})}
    )
    payload = api_request("GET", f"/executions?{query}")
    return payload.get("data", payload if isinstance(payload, list) else [])


def get_execution(execution_id: str) -> dict[str, Any]:
    return api_request("GET", f"/executions/{execution_id}")


def sync_workflow(file_path: Path, dry_run: bool = False) -> None:
    local = json.loads(file_path.read_text(encoding="utf-8"))
    name = local.get("name")
    if not name:
        raise SystemExit(f"В {file_path} нет поля name")

    remote_meta = find_workflow_by_name(name)
    if not remote_meta:
        raise SystemExit(
            f"Workflow «{name}» не найден на n8n. "
            "Сначала импортируйте JSON через UI (Import from File)."
        )

    remote = get_workflow(str(remote_meta["id"]))
    merged = merge_workflow(remote, local)

    if dry_run:
        print(json.dumps(merged, ensure_ascii=False, indent=2)[:8000])
        return

    result = update_workflow(str(remote_meta["id"]), merged)
    print(
        json.dumps(
            {
                "ok": True,
                "id": result.get("id"),
                "name": result.get("name"),
                "updatedNodes": [n["name"] for n in local.get("nodes", [])],
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="n8n Public API helper")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list-workflows", help="Список workflow на инстансе")

    p_get = sub.add_parser("get-workflow", help="Получить workflow по имени")
    p_get.add_argument("name")

    p_exec = sub.add_parser("list-executions", help="Последние executions")
    p_exec.add_argument("--limit", type=int, default=10)
    p_exec.add_argument("--workflow-id")

    p_exec_one = sub.add_parser("get-execution", help="Детали execution")
    p_exec_one.add_argument("id")

    p_sync = sub.add_parser("sync-workflow", help="Залить deploy/*.workflow.json на n8n")
    p_sync.add_argument("file", type=Path)
    p_sync.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if args.command == "list-workflows":
        for wf in list_workflows():
            print(f"{wf.get('id')}\t{'active' if wf.get('active') else 'off'}\t{wf.get('name')}")
        return

    if args.command == "get-workflow":
        meta = find_workflow_by_name(args.name)
        if not meta:
            raise SystemExit(f"Не найден: {args.name}")
        print(json.dumps(get_workflow(str(meta["id"])), ensure_ascii=False, indent=2))
        return

    if args.command == "list-executions":
        rows = list_executions(limit=args.limit, workflow_id=args.workflow_id)
        for row in rows:
            print(
                f"{row.get('id')}\t{row.get('status')}\t"
                f"{row.get('workflowId')}\t{row.get('startedAt')}"
            )
        return

    if args.command == "get-execution":
        print(json.dumps(get_execution(args.id), ensure_ascii=False, indent=2))
        return

    if args.command == "sync-workflow":
        path = args.file if args.file.is_absolute() else ROOT / args.file
        sync_workflow(path, dry_run=args.dry_run)
        return

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
