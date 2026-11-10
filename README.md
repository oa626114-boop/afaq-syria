# AFAQ SYRIA — Financial API Gateway (starter)

This is a **technical intake prototype**, not a bank, payment institution, SWIFT connection, or settlement system. It receives files/messages for controlled review. It does not move money, authenticate bank-originated funds, or establish that a payment has settled.

## Included
- FastAPI JSON/XML intake API with bearer-token protection
- Basic ISO 20022 message-family detection for selected message versions
- Encrypted-at-rest payload storage (Fernet) and SQLite metadata
- SFTP drop folder isolated from automatic processing
- Docker Compose setup

## Before use
1. Copy .env.example to .env.
2. Generate unique secrets:
   - ADMIN_TOKEN: python -c "import secrets; print(secrets.token_urlsafe(48))"
   - FERNET_KEY: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   - Set a unique SFTP_USERNAME and strong SFTP_PASSWORD.
3. Set ALLOWED_ORIGINS to the exact HTTPS origins that should call the API. Keep it empty if browser access is not needed.
4. Keep ports bound to localhost. Put a TLS reverse proxy and firewall/VPN in front before remote use.
5. Back up both the SQLite database and encrypted payload directory. Keep the Fernet key in a separate secret store; losing it makes stored payloads unreadable.
6. Have a qualified banking/ISO 20022 specialist validate message versions, schemas, market practice and bank-specific rules.

## Run locally
```bash
cp .env.example .env
# Edit .env and replace every placeholder.
docker compose config
docker compose up --build
```

API docs (local only): http://127.0.0.1:8000/docs

## API
All routes except GET /health require Authorization: Bearer ADMIN_TOKEN.

- GET /health — service health; does not disclose configuration secrets.
- POST /v1/intake/json — receive a JSON envelope.
- POST /v1/intake/file — receive an XML or JSON multipart upload.
- GET /v1/messages — list intake metadata.
- GET /v1/messages/{message_id} — decrypt and return a stored payload to an authenticated operator.

Example JSON envelope:
```json
{
  "message_type": "pain.001",
  "sender_id": "SENDER-ORG-ID",
  "reference": "UNIQUE-REFERENCE",
  "payload": { "note": "Example only — not a payment order" }
}
```

## SFTP handling
The SFTP container places files in ./sftp/incoming. The API does **not** automatically trust, execute, or import dropped files. An operator must review and submit a file through the authenticated API. Do not put live customer or banking data in this folder until legal, compliance, security and operational controls have been independently reviewed.

## Important production gaps
This starter does not implement bank connectivity, SWIFT connectivity, sender certificate/signature verification, official XSD validation, sanctions screening, AML case management, transaction execution, customer onboarding, or settlement confirmation. Receiving a pacs.008 or pacs.009 document is not proof that a transfer exists or that funds are available. Never use this intake API to claim that funds have been received or to release goods/services.
