"""SSL verification for outbound HTTP: certifi + Russian Trusted CA."""

from __future__ import annotations

import ssl
from functools import lru_cache
from pathlib import Path

import certifi

_RUSSIAN_TRUSTED_CA = Path(__file__).resolve().parent / "certs" / "russian_trusted_ca.pem"


@lru_cache(maxsize=1)
def http_ssl_context() -> ssl.SSLContext:
    """Trust both public CAs (Let's Encrypt, etc.) and Russian Trusted CA (*.max.ru, VTB)."""
    ctx = ssl.create_default_context(cafile=certifi.where())
    if _RUSSIAN_TRUSTED_CA.is_file():
        ctx.load_verify_locations(cafile=str(_RUSSIAN_TRUSTED_CA))
    return ctx


def http_verify() -> ssl.SSLContext:
    return http_ssl_context()
