# Test scripts

## simulate-10-e2e.js

Simulates 10 questionnaire submissions and 10 paid Paddle webhook events, then validates:

- lead rows in `leads`
- `payment_events` idempotency records
- `program_plan` structure for all 10 leads
- PDF generation for each lead via `pdf-service`

### Run

```bash
node scripts/simulate-10-e2e.js
```

Optional env vars:

- `N8N_BASE_URL` (default: `http://localhost:5678`)
- `PDF_BASE_URL` (default: `http://localhost:3001`)
- `PADDLE_WEBHOOK_SECRET` (if not set, read from `.env`)

## simulate-10-programs.js

Simulates 10 questionnaire answers, maps them to `user_profile`, then validates:

- save/update in `leads`
- generation of 10 `program_plan` via `program-service`
- save `program_plan` in `leads` + simulated `payment_events`
- PDF generation for week 1 via `pdf-service`

Run:

```bash
node scripts/simulate-10-programs.js
```

Optional env vars:

- `PROGRAM_BASE_URL` (default: `http://localhost:3002`)
- `PDF_BASE_URL` (default: `http://localhost:3001`)

