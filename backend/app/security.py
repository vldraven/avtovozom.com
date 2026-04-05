import os
import secrets
from datetime import datetime, timedelta, timezone
from hashlib import pbkdf2_hmac
import hmac

from jose import JWTError, jwt


SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-secret-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        algorithm, iterations_str, salt_hex, hash_hex = hashed_password.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_str)
        candidate = pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            iterations,
        ).hex()
        return hmac.compare_digest(candidate, hash_hex)
    except Exception:
        return False


def hash_password(password: str) -> str:
    iterations = 200_000
    salt = secrets.token_bytes(16)
    digest = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest}"


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        subject = payload.get("sub")
        if subject is None:
            return None
        return str(subject)
    except JWTError:
        return None
