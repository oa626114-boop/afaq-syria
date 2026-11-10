from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

APP_NAME = "AFAQ SYRIA API Intake"
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data")).resolve()
MAX_UPLOAD_MB = max(1, min(int(os.getenv("MAX_UPLOAD_MB", "10")), 25))
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
DB_PATH = DATA_DIR / "intake.sqlite3"
PAYLOAD_DIR = DATA_DIR / "messages"
ALLOWED_TYPES = {"pacs.008", "pacs.009", "pain.001", "camt.053"}
XML_NS = {
    "pacs.008": "urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08",
    "pacs.009": "urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08",
    "pain.001": "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09",
    "camt.053": "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_fernet() -> Fernet:
    key = os.getenv("FERNET_KEY", "").strip()
    if not key or key == "REPLACE_WITH_FERNET_KEY":
        raise RuntimeError("FERNET_KEY is not configured")
    try:
        return Fernet(key.encode("ascii"))
    except Exception as exc:
        raise RuntimeError("FERNET_KEY is invalid; generate a Fernet key") from exc


def get_admin_token() -> str:
    token = os.getenv("ADMIN_TOKEN", "")
    if len(token) < 32 or token == "REPLACE_WITH_LONG_RANDOM_SECRET":
        raise RuntimeError("ADMIN_TOKEN must be a unique secret of at least 32 characters")
    return token


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def initialize_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PAYLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id TEXT PRIMARY KEY,
                message_type TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                reference TEXT NOT NULL,
                content_type TEXT NOT NULL,
                encrypted_file TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'RECEIVED_PENDING_REVIEW',
                received_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at)")
        conn.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_fernet()
    get_admin_token()
    initialize_storage()
    yield


app = FastAPI(
    title=APP_NAME,
    description=(
        "Secure intake and review queue for JSON/XML messages. "
        "This service does not connect to SWIFT, move funds, or confirm settlement."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()]
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )


class JsonEnvelope(BaseModel):
    message_type: str = Field(min_length=1, max_length=40)
    sender_id: str = Field(min_length=1, max_length=120)
    reference: str = Field(min_length=1, max_length=140)
    payload: dict[str, Any]


def require_admin(authorization: str | None = Header(default=None)) -> None:
    expected = get_admin_token()
    supplied = authorization[7:].strip() if authorization and authorization.startswith("Bearer ") else ""
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Valid Bearer token required")


def safe_identifier(value: str, field: str) -> str:
    value = value.strip()
    if not value or len(value) > 140 or not re.fullmatch(r"[A-Za-z0-9._:-]+", value):
        raise HTTPException(status_code=400, detail=f"Invalid {field}")
    return value


def inspect_xml(raw: bytes) -> tuple[str, str, str]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail="Malformed XML") from exc

    local_name = root.tag.rsplit("}", 1)[-1]
    namespace = root.tag[1:].split("}", 1)[0] if root.tag.startswith("{") else ""
    message_type = next((kind for kind, ns in XML_NS.items()
                         if namespace == ns and local_name == {"pacs.008": "Document", "pacs.009": "Document", "pain.001": "Document", "camt.053": "Document"}[kind]), "")
    if not message_type:
        raise HTTPException(status_code=400, detail="Unsupported ISO 20022 root namespace/version")

    all_nodes = list(root.iter())
    msg_id = next((node.text.strip() for node in all_nodes
                   if node.tag.rsplit("}", 1)[-1] == "MsgId" and node.text and node.text.strip()), "")
    if not msg_id:
        raise HTTPException(status_code=400, detail="ISO 20022 GrpHdr/MsgId is required")
    tx_count = sum(1 for node in all_nodes if node.tag.rsplit("}", 1)[-1] in {"CdtTrfTxInf", "DrctDbtTxInf"})
    if message_type in {"pacs.008", "pacs.009", "pain.001"} and tx_count < 1:
        raise HTTPException(status_code=400, detail="At least one transaction element is required")
    return message_type, safe_identifier(msg_id, "MsgId"), namespace


def store_message(message_id: str, message_type: str, sender_id: str, reference: str,
                  content_type: str, raw: bytes) -> dict[str, str]:
    message_id = safe_identifier(message_id, "message_id")
    sender_id = safe_identifier(sender_id, "sender_id")
    reference = safe_identifier(reference, "reference")
    digest = hashlib.sha256(raw).hexdigest()
    encrypted = get_fernet().encrypt(raw)
    filename = hashlib.sha256(message_id.encode("utf-8")).hexdigest() + ".fernet"
    destination = PAYLOAD_DIR / filename
    if not destination.resolve().is_relative_to(PAYLOAD_DIR):
        raise HTTPException(status_code=400, detail="Invalid storage path")

    with connect_db() as conn:
        if conn.execute("SELECT 1 FROM messages WHERE message_id=?", (message_id,)).fetchone():
            raise HTTPException(status_code=409, detail="Duplicate message_id")
        # Write encrypted payload before inserting metadata. A failed DB insert leaves
        # only an encrypted orphan file, never an unencrypted payload.
        destination.write_bytes(encrypted)
        try:
            conn.execute(
                """INSERT INTO messages
                   (message_id,message_type,sender_id,reference,content_type,encrypted_file,sha256,status,received_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (message_id, message_type, sender_id, reference, content_type, filename,
                 digest, "RECEIVED_PENDING_REVIEW", utc_now()),
            )
            conn.commit()
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    return {"message_id": message_id, "status": "RECEIVED_PENDING_REVIEW", "sha256": digest}


@app.get("/health")
def health():
    return {"service": APP_NAME, "status": "ok", "mode": "intake_only"}


@app.post("/v1/intake/json", status_code=201, dependencies=[Depends(require_admin)])
async def intake_json(envelope: JsonEnvelope):
    if envelope.message_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported message_type")
    message_id = safe_identifier(str(envelope.payload.get("message_id") or envelope.reference), "message_id")
    raw = json.dumps(envelope.model_dump(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Payload exceeds configured size limit")
    return store_message(message_id, envelope.message_type, envelope.sender_id,
                         envelope.reference, "application/json", raw)


@app.post("/v1/intake/file", status_code=201, dependencies=[Depends(require_admin)])
async def intake_file(file: UploadFile = File(...), sender_id: str = "UNVERIFIED_SENDER",
                      reference: str = "UNASSIGNED_REFERENCE"):
    content_type = (file.content_type or "").lower()
    if content_type not in {"application/xml", "text/xml", "application/json"}:
        raise HTTPException(status_code=415, detail="Only XML or JSON uploads are accepted")
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds configured size limit")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    if content_type in {"application/xml", "text/xml"}:
        message_type, message_id, _namespace = inspect_xml(raw)
    else:
        try:
            document = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Malformed JSON") from exc
        if not isinstance(document, dict):
            raise HTTPException(status_code=400, detail="JSON root must be an object")
        message_type = str(document.get("message_type", ""))
        if message_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported message_type")
        message_id = safe_identifier(str(document.get("message_id", "")), "message_id")

    return store_message(message_id, message_type, sender_id, reference, content_type, raw)


@app.get("/v1/messages", dependencies=[Depends(require_admin)])
def list_messages(limit: int = 50):
    limit = max(1, min(limit, 200))
    with connect_db() as conn:
        rows = conn.execute(
            """SELECT message_id,message_type,sender_id,reference,content_type,sha256,status,received_at
               FROM messages ORDER BY received_at DESC LIMIT ?""", (limit,)
        ).fetchall()
    return {"items": [dict(row) for row in rows], "count": len(rows)}


@app.get("/v1/messages/{message_id}", dependencies=[Depends(require_admin)])
def get_message(message_id: str):
    message_id = safe_identifier(message_id, "message_id")
    with connect_db() as conn:
        row = conn.execute("SELECT * FROM messages WHERE message_id=?", (message_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")
    path = PAYLOAD_DIR / row["encrypted_file"]
    try:
        payload = get_fernet().decrypt(path.read_bytes())
    except (OSError, InvalidToken) as exc:
        raise HTTPException(status_code=500, detail="Stored payload cannot be decrypted") from exc
    return {
        "message_id": row["message_id"],
        "message_type": row["message_type"],
        "sender_id": row["sender_id"],
        "reference": row["reference"],
        "content_type": row["content_type"],
        "sha256": row["sha256"],
        "status": row["status"],
        "received_at": row["received_at"],
        "payload": payload.decode("utf-8", errors="replace"),
    }


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception):
    # Do not leak tokens, filesystem paths, SQL, or exception details to clients.
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
