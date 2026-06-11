"""Конфигурация комплектации через JSON API Autohome (specId из HTML che168)."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

AUTOHOME_CONFIG_URL = "https://car.m.autohome.com.cn/ashx/car/GetModelConfig2.ashx"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

SPEC_ID_PATTERNS = (
    re.compile(r"""id=["']car_specid["'][^>]*value=["'](\d+)["']""", re.I),
    re.compile(r"""value=["'](\d+)["'][^>]*id=["']car_specid["']""", re.I),
    re.compile(r"""["']spec[Ii]d["']\s*:\s*["']?(\d+)["']?"""),
    re.compile(r"""specid=(\d+)""", re.I),
    re.compile(r"""car_specid["']?\s*,\s*["']?(\d+)""", re.I),
)


@dataclass
class ParsedTrimConfig:
    autohome_spec_id: int
    name_zh: str
    sections: list[dict[str, Any]] = field(default_factory=list)
    fingerprint: str = ""


def extract_autohome_spec_id(html: str | None) -> int | None:
    if not html:
        return None
    for pat in SPEC_ID_PATTERNS:
        m = pat.search(html)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                continue
    return None


def strip_obfuscation(text: str | None) -> str:
    if not text:
        return ""
    s = re.sub(r"<[^>]+>", "", str(text))
    s = s.replace("&nbsp;", " ").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", s).strip()


def _item_value(valueitems: list[dict[str, Any]] | None) -> str:
    if not valueitems:
        return "—"
    vi = valueitems[0] if isinstance(valueitems[0], dict) else {}
    raw = strip_obfuscation(str(vi.get("value") or ""))
    sublist = vi.get("sublist") or []
    if isinstance(sublist, list) and sublist:
        parts: list[str] = []
        for sub in sublist:
            if not isinstance(sub, dict):
                continue
            if str(sub.get("subvalue", "")).strip() in ("", "0"):
                continue
            name = strip_obfuscation(str(sub.get("subname") or ""))
            if name:
                parts.append(name)
        if parts:
            return ", ".join(parts)
    if not raw or raw == "-":
        return "—"
    return raw


def _collect_sections(inner: dict[str, Any]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []

    def add_group(group_name: str, items_key: str, container: dict[str, Any], kind: str) -> None:
        group_label = strip_obfuscation(group_name) or group_name
        raw_items = container.get(items_key) or []
        if not isinstance(raw_items, list):
            return
        items: list[dict[str, str]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            name = strip_obfuscation(str(item.get("name") or ""))
            value = _item_value(item.get("valueitems"))
            if not name:
                continue
            items.append({"name": name, "value": value})
        if items:
            sections.append({"group": group_label, "kind": kind, "items": items})

    for group in inner.get("param") or []:
        if isinstance(group, dict):
            add_group(str(group.get("name") or ""), "paramitems", group, "param")

    for group in inner.get("config") or []:
        if isinstance(group, dict):
            add_group(str(group.get("name") or ""), "configitems", group, "config")

    return sections


def _extract_trim_name(inner: dict[str, Any]) -> str:
    for group in inner.get("param") or []:
        if not isinstance(group, dict):
            continue
        for item in group.get("paramitems") or []:
            if not isinstance(item, dict):
                continue
            if item.get("id") == 113 or "车型" in str(item.get("name") or ""):
                vis = item.get("valueitems") or []
                if vis:
                    return strip_obfuscation(str(vis[0].get("value") or ""))
    specitems = inner.get("specitems") or []
    if specitems and isinstance(specitems[0], dict):
        return strip_obfuscation(str(specitems[0].get("name") or ""))
    return ""


def build_spec_fingerprint(sections: list[dict[str, Any]]) -> str:
    canonical = json.dumps(sections, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_spec_config_payload(outer: dict[str, Any], *, autohome_spec_id: int) -> ParsedTrimConfig:
    raw_data = outer.get("data")
    if isinstance(raw_data, str):
        inner = json.loads(raw_data)
    elif isinstance(raw_data, dict):
        inner = raw_data
    else:
        inner = {}

    sections = _collect_sections(inner)
    name_zh = _extract_trim_name(inner)
    fingerprint = build_spec_fingerprint(sections)
    return ParsedTrimConfig(
        autohome_spec_id=autohome_spec_id,
        name_zh=name_zh,
        sections=sections,
        fingerprint=fingerprint,
    )


def fetch_spec_config(spec_id: int) -> ParsedTrimConfig:
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        r = client.get(
            AUTOHOME_CONFIG_URL,
            params={"ids": str(spec_id)},
            headers={
                "User-Agent": UA,
                "Referer": "https://car.autohome.com.cn/",
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
        )
        r.raise_for_status()
        outer = r.json()
    return parse_spec_config_payload(outer, autohome_spec_id=spec_id)
