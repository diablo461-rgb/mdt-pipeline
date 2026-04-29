# AGENTS.md

## Big picture
- System flow: **Tally -> n8n -> Postgres -> Paddle -> pdf-service -> Resend** (`readme.md`, `compose.yml`).
- Runtime services: `postgres` (state), `n8n` (orchestration), `pdf-service` (rendering), `program-service` (program generation) in `compose.yml`.
- Treat `n8n/*.json` as source code; they are auto-imported on n8n container start.

## Workflow boundaries (must stay aligned)
- `n8n/working-tally-workflow.json`: `POST /webhook/tally-webhook`, parse Tally fields, normalize profile, `INSERT ... ON CONFLICT (email)`, validate Paddle env/key/price config, create Paddle transaction, store `checkout_url` + `paddle_transaction_id`.
- `n8n/get-checkout-workflow.json`: `GET /webhook/checkout-redirect?email=...`, SQL retry (`pg_sleep(2)`) for late checkout URL, redirect to stored `checkout_url` or Paddle fallback.
- `n8n/paddle-payment-workflow.json`: verify `Paddle-Signature` from `rawBody`, reject stale/invalid signatures, idempotency via `payment_events.event_id`, then mark paid, call `program-service` (`Generate Program`) to build `program_plan`, send Week 1, then **insert `email_sequence_jobs`** for the full email sequence (`ON CONFLICT DO NOTHING` for idempotency).
- `n8n/weekly-sender-workflow.json`: cron `0 9 * * *`, atomically claim `email_sequence_jobs` (`status='processing'`, `FOR UPDATE SKIP LOCKED`), per-job load lead + template, conditionally generate PDF if `email_templates.requires_pdf=true`, send via Resend, mark job `status='sent'`, update legacy `week{N}_sent_at` columns on `leads`.

## Data model invariants
- Schema source: `init.sh`; backfill migration: `migrations/001_align_schema_with_workflows.sql` (keep both updated together).
- Identity key is `leads.email` (unique); many flows depend on case-insensitive email matching.
- Payment idempotency requires `payment_events(event_id UNIQUE)` + pre-check query before side effects.
- Email templates are DB-driven (`email_templates`). Field `requires_pdf BOOLEAN` controls whether pdf-service is called: `true` for week_1..week_4, `false` for feedback_day_21 and upsell_day_30.
- **All scheduled email sends must go through `email_sequence_jobs`** — never add new timestamp columns to `leads` for new email types.
- `email_sequence_jobs` has `UNIQUE(lead_id, sequence_key, template_key)` — use `INSERT ... ON CONFLICT DO NOTHING` to avoid duplicates on webhook replay.
- `email_sequence_jobs.status` lifecycle: `pending → processing → sent` (happy path), or `processing → failed` after max 3 attempts.
- Legacy columns `leads.week{1..4}_sent_at` and `leads.next_send_at` are kept for backward compatibility; they are updated when the corresponding jobs are sent, but are not used by the new workflow for scheduling decisions.
- `leads.completed_at` is set when `upsell_day_30` job is successfully sent.

## PDF service contract
- API: `pdf-service/server.js` exposes `POST /generate-pdf` and `GET /health`.
- Payload shape is produced in both `Build PDF Payload` nodes (`paddle-payment-workflow.json`) and `Build Email Payload` node (`weekly-sender-workflow.json`); change all three places together.
- Renderer `pdf-service/pdf-overlay.js` supports multiple image fields (`image_url`, `imageUrl`, `photo_url`) and normalizes Google Drive/redirect-heavy image URLs with `sharp` preprocessing.
- PDF is only generated when `email_templates.requires_pdf = true` (week_1..week_4). feedback_day_21 and upsell_day_30 do NOT call pdf-service.

## Program service contract
- API: `program-service/server.js` exposes `POST /generate-program` and `GET /health`.
- Input: `{ user_profile, email }`; output: `{ program_plan }` with keys `week_1..week_4` and slots `morning/midday/afternoon/evening`.
- Rule sets are in `program-service/rules/*`; keep rule files and `planner.js` aligned with expected `user_profile` mapping from `working-tally-workflow.json`.

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
- Paddle anti-drift: keep `PADDLE_API_KEY` type and `PADDLE_API_URL` environment matched (sandbox vs production) to avoid `403 forbidden` during `Create Paddle Transaction`.
- Activation script drift: `Dockerfile.n8n` hardcodes workflow IDs and does not include all IDs from `n8n/*.json`; verify active states in n8n UI after imports.
