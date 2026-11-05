AFAQ MINING — USDT TRC20 implementation pack

What is included
- mining.html: navy/gold mining dashboard design shell (bee mascot, points, session, withdrawal request).
- mining-migration.sql: Cloudflare D1 schema migration for sessions, points ledger, wallet and withdrawal requests.
- IMPLEMENTATION-PLAN-AR.txt: safe rollout and backend contract.

IMPORTANT
This package is an implementation starter, not a live mining service. The UI intentionally does not award points or submit withdrawals until authenticated server endpoints are implemented and tested. No real USDT is held or sent by this package.

Apply only after backing up the existing D1 database. The migration creates tables with mining disabled and all conversion rates set to zero. Admin must explicitly configure rates and terms. Do not place private keys, seed phrases or payout secrets in GitHub or browser code. Use a licensed/qualified payout provider or a controlled treasury wallet with approvals, reconciliation, compliance screening and transaction monitoring. A points-based app session is not proof of blockchain mining; describe rewards accurately.
