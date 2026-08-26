#!/usr/bin/env python3
"""
Получить user access_token VK ID (OAuth 2.1 + PKCE) для публикации на стену группы.

Нужны права (scope): photos wall groups (и offline, если кабинет отдаёт).

Шаги:
  1) В кабинете приложения (id.vk.ru) добавьте Trusted redirect URL
     (например https://oauth.vk.com/blank.html или https://avtovozom.com/).
  2) Запустите этот скрипт — откроется/напечатается URL авторизации.
  3) Войдите аккаунтом админа/редактора группы, разрешите доступ.
  4) Скопируйте полный URL после редиректа (в нём payload/code/device_id)
     и вставьте в терминал.
  5) Скрипт обменяет code → access_token и напечатает строки для .env.

Примеры:
  PYTHONPATH=. python -m scripts.vk_oauth_user_token --client-id 54689021
  PYTHONPATH=. python -m scripts.vk_oauth_user_token \\
    --client-id 54689021 \\
    --redirect-uri https://oauth.vk.com/blank.html \\
    --scope "vkid.personal_info photos wall groups"
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.parse
import webbrowser
from typing import Any

import httpx

AUTHORIZE_URL = "https://id.vk.ru/authorize"
TOKEN_URL = "https://id.vk.ru/oauth2/auth"
DEFAULT_REDIRECT = "https://oauth.vk.com/blank.html"
DEFAULT_SCOPE = "vkid.personal_info photos wall groups"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def make_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def build_authorize_url(
    *,
    client_id: str,
    redirect_uri: str,
    scope: str,
    state: str,
    code_challenge: str,
) -> str:
    q = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "scope": scope,
        }
    )
    return f"{AUTHORIZE_URL}?{q}"


def parse_redirect(raw: str) -> dict[str, str]:
    """Разбирает URL после редиректа VK ID (query или fragment, payload JSON)."""
    s = (raw or "").strip()
    if not s:
        raise ValueError("пустой URL")
    parsed = urllib.parse.urlparse(s)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
    fragment = urllib.parse.parse_qs(parsed.fragment, keep_blank_values=False)

    def first(bag: dict[str, list[str]], key: str) -> str:
        vals = bag.get(key) or []
        return (vals[0] if vals else "").strip()

    payload_raw = first(query, "payload") or first(fragment, "payload")
    if payload_raw:
        try:
            payload = json.loads(urllib.parse.unquote(payload_raw))
        except json.JSONDecodeError as e:
            raise ValueError(f"не удалось разобрать payload: {e}") from e
        if not isinstance(payload, dict):
            raise ValueError("payload не объект")
        out = {
            "code": str(payload.get("code") or "").strip(),
            "state": str(payload.get("state") or "").strip(),
            "device_id": str(payload.get("device_id") or "").strip(),
        }
        if out["code"]:
            return out

    out = {
        "code": first(query, "code") or first(fragment, "code"),
        "state": first(query, "state") or first(fragment, "state"),
        "device_id": first(query, "device_id") or first(fragment, "device_id"),
    }
    if not out["code"]:
        raise ValueError(
            "в URL нет code/payload. Скопируйте полный адрес после редиректа."
        )
    return out


def exchange_code(
    *,
    client_id: str,
    redirect_uri: str,
    code: str,
    code_verifier: str,
    device_id: str,
    state: str,
    client_secret: str | None,
) -> dict[str, Any]:
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "client_id": client_id,
        "device_id": device_id or "avtovozom-cli",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    if client_secret:
        data["client_secret"] = client_secret
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(TOKEN_URL, data=data)
        try:
            body = resp.json()
        except Exception:
            body = {"raw": resp.text[:800]}
        if resp.status_code >= 400:
            raise RuntimeError(
                f"HTTP {resp.status_code}: {json.dumps(body, ensure_ascii=False)[:800]}"
            )
        if not isinstance(body, dict) or not body.get("access_token"):
            raise RuntimeError(
                f"нет access_token в ответе: {json.dumps(body, ensure_ascii=False)[:800]}"
            )
        return body


def main() -> int:
    parser = argparse.ArgumentParser(
        description="VK ID: получить user access_token (photos+wall) через PKCE"
    )
    parser.add_argument("--client-id", required=True, help="App ID приложения VK ID")
    parser.add_argument(
        "--client-secret",
        default="",
        help="Защищённый ключ (опционально; для PKCE часто не нужен)",
    )
    parser.add_argument(
        "--redirect-uri",
        default=DEFAULT_REDIRECT,
        help=f"Тот же Trusted redirect URL, что в кабинете (default {DEFAULT_REDIRECT})",
    )
    parser.add_argument(
        "--scope",
        default=DEFAULT_SCOPE,
        help=f'Scopes через пробел (default: "{DEFAULT_SCOPE}")',
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Не открывать браузер, только напечатать URL",
    )
    parser.add_argument(
        "--group-id",
        default="",
        help="Если указан — напечатать готовый блок VK_* для .env",
    )
    args = parser.parse_args()

    client_id = str(args.client_id).strip()
    redirect_uri = str(args.redirect_uri).strip()
    scope = str(args.scope).strip()
    if not client_id:
        print("Нужен --client-id", file=sys.stderr)
        return 2

    code_verifier, code_challenge = make_pkce()
    state = secrets.token_urlsafe(24)
    auth_url = build_authorize_url(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=scope,
        state=state,
        code_challenge=code_challenge,
    )

    print("1) Откройте ссылку под аккаунтом админа группы и разрешите доступ:\n")
    print(auth_url)
    print()
    if not args.no_browser:
        try:
            webbrowser.open(auth_url)
        except Exception:
            pass

    print(
        "2) После редиректа скопируйте полный URL из адресной строки "
        "(даже если страница blank/ошибка) и вставьте ниже.\n"
    )
    redirect_back = input("Redirect URL: ").strip()
    try:
        parsed = parse_redirect(redirect_back)
    except ValueError as e:
        print(f"Ошибка разбора URL: {e}", file=sys.stderr)
        return 1

    if parsed.get("state") and parsed["state"] != state:
        print(
            f"state не совпал (ожидали {state}, получили {parsed['state']}). "
            "Возможно, подмена ответа — прерываю.",
            file=sys.stderr,
        )
        return 1

    try:
        token_body = exchange_code(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code=parsed["code"],
            code_verifier=code_verifier,
            device_id=parsed.get("device_id") or "",
            state=state,
            client_secret=(args.client_secret or "").strip() or None,
        )
    except Exception as e:
        print(f"Обмен code→token не удался: {e}", file=sys.stderr)
        print(
            "Проверьте: Trusted redirect URL в кабинете совпадает с --redirect-uri; "
            "scopes photos/wall доступны приложению; аккаунт — админ группы.",
            file=sys.stderr,
        )
        return 1

    access_token = str(token_body.get("access_token") or "")
    granted = str(token_body.get("scope") or "")
    expires_in = token_body.get("expires_in")
    refresh = token_body.get("refresh_token")

    print("\nOK: access_token получен.")
    if granted:
        print(f"scope в ответе: {granted}")
        missing = [s for s in ("photos", "wall") if s not in granted.split()]
        if missing:
            print(
                f"ВНИМАНИЕ: в ответе нет {', '.join(missing)}. "
                "Публикация на стену может не работать — проверьте права приложения в VK ID.",
                file=sys.stderr,
            )
    if expires_in is not None:
        print(f"expires_in: {expires_in}")
    if refresh:
        print("refresh_token: есть (сохраните отдельно, если нужен refresh)")

    print("\n# --- вставьте в /opt/avtovozom/.env ---")
    if args.group_id:
        print(f"VK_GROUP_ID={str(args.group_id).strip()}")
    else:
        print("VK_GROUP_ID=XXXXXXXX  # id клуба без минуса")
    print(f"VK_USER_ACCESS_TOKEN={access_token}")
    print("VK_API_VERSION=5.199")
    print("# -------------------------------------\n")
    print(
        "Дальше: docker compose -f docker-compose.prod.yml up -d backend\n"
        "Проверка: PYTHONPATH=. python -m scripts.test_vk_wall_post --message 'Тест avtovozom'"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
