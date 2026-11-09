# AFAQ SYRIA — Financial API Gateway (starter)

This is a **technical intake prototype**, not a bank, payment institution, SWIFT connection, or settlement system.
It receives files/messages for controlled review. It does not move money, authenticate bank-originated funds, or establish that a payment has settled.

## Included
- FastAPI JSON/XML intake API with bearer-token protection
- Basic ISO 20022 XML well-formedness and message-family detection (`pacs.008`, `pacs.009`, `pain.001`, `camt.053`)
- Encrypted-at-rest file storage (Fernet)
- SQLite intake/audit metadata
- SFTP drop folder using an OpenSSH-based container
- Docker Compose setup

## Before use
1. Copy `.env.example` to `.env`.
2. Generate strong secrets:
   - `ADMIN_TOKEN`: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   - `FERNET_KEY`: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
3. Replace all demo SFTP credentials in `docker-compose.yml`.
4. Restrict network access with firewall/VPN, TLS reverse proxy, backups, monitoring, and key rotation.
5. Have a qualified banking/ISO 20022 specialist validate the exact message versions, market practice, schemas and bank-specific rules.

## Run
```bash
cp .env.example .env
# edit .env and docker-compose.yml before exposing anything
docker compose up --build
```
API docs (local only): http://localhost:8000/docs

## API
- `GET /health` — service health
- `POST /v1/intake/json` — receive a JSON instruction envelope
- `POST /v1/intake/file` — receive XML/JSON file as multipart upload
- `GET /v1/messages` — list intake records
- `GET /v1/messages/{message_id}` — metadata for one record

All protected endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.

### JSON envelope example
```json
{
  "message_type": "pain.001",
  "sender_id": "SENDER-ORG-ID",
  "reference": "UNIQUE-REFERENCE",
  "payload": {
    "note": "Example only — not a payment order"
  }
}
```

## SFTP
The SFTP container places files in `./sftp/incoming`. The API does **not** automatically trust or execute files dropped there. An operator must review and submit a file through the authenticated API or a future controlled ingestion worker. Do not place live customer data here until compliance, security and operational controls are independently reviewed.

## Production gaps
This starter deliberately does not implement bank connectivity, SWIFT connectivity, cryptographic signature verification, XSD validation, sanctions screening, AML case management, transaction execution, customer onboarding, or settlement confirmation. Those require institution-specific agreements, approved infrastructure, and independent security/compliance review.
