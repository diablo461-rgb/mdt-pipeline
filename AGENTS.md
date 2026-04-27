# AGENTS.md

## Big picture
- System flow: **Tally -> n8n -> Postgres -> Paddle -> pdf-service -> Resend** (`readme.md`, `compose.yml`).
- Runtime services: `postgres` (state), `n8n` (orchestration), `pdf-service` (rendering) in `compose.yml`.
- Treat `n8n/*.json` as source code; they are auto-imported on n8n container start.

## Workflow boundaries (must stay aligned)
- `n8n/working-tally-workflow.json`: `POST /webhook/tally-webhook`, parse Tally fields, normalize profile, `INSERT ... ON CONFLICT (email)`, create Paddle transaction, store `checkout_url` + `paddle_transaction_id`.
- `n8n/get-checkout-workflow.json`: `GET /webhook/checkout-redirect?email=...`, SQL retry (`pg_sleep(2)`) for late checkout URL, redirect to stored `checkout_url` or Paddle fallback.
- `n8n/paddle-payment-workflow.json`: verify `Paddle-Signature` from `rawBody`, reject stale/invalid signatures, idempotency via `payment_events.event_id`, then mark paid, build `program_plan`, send Week 1.
- `n8n/weekly-sender-workflow.json`: cron `0 9 * * *`, find due leads by `next_send_at`, generate/send week N, update `week{N}_sent_at`; set `next_send_at = NULL` after week 4.

## Data model invariants
- Schema source: `init.sh`; backfill migration: `migrations/001_align_schema_with_workflows.sql` (keep both updated together).
- Identity key is `leads.email` (unique); many flows depend on case-insensitive email matching.
- Payment idempotency requires `payment_events(event_id UNIQUE)` + pre-check query before side effects.
- Email templates are DB-driven (`email_templates`), with SQL fallback to `week_1` template when key is missing/inactive.

## PDF service contract
- API: `pdf-service/server.js` exposes `POST /generate-pdf` and `GET /health`.
- Payload shape is produced in both `Build PDF Payload` nodes (`paddle-payment-workflow.json`, `weekly-sender-workflow.json`); change all three places together.
- Renderer `pdf-service/pdf-overlay.js` supports multiple image fields (`image_url`, `imageUrl`, `photo_url`) and normalizes Google Drive/redirect-heavy image URLs with `sharp` preprocessing.

## Dev workflows and known repo quirks
- Local start:
```bash
cp _env.example .env
docker compose up -d
```
- Apply migration on existing DB volume:
```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < migrations/001_align_schema_with_workflows.sql
```
- Health checks:
```bash
curl -s http://localhost:3001/health
curl -s http://localhost:5678
```
- Credential convention: workflows expect n8n credential id `mdt-pg-cred` (imported in `compose.yml` startup command).
- Config drift: `_env.example` uses `N8N_AUTH_PASSWORD`, but `compose.yml` expects `N8N_BASIC_AUTH_PASSWORD`.
- Activation script drift: `Dockerfile.n8n` hardcodes workflow IDs and does not include all IDs from `n8n/*.json`; verify active states in n8n UI after imports.
