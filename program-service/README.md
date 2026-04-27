# mdt-program-service

Generates `program_plan` for MDT from `user_profile` and NocoDB exercises.

## Endpoints

- `GET /health` -> `{ "ok": true, "service": "mdt-program-service" }`
- `POST /generate-program` -> `{ "program_plan": { ... } }`

## Run locally

```bash
npm install
npm start
```

Default port: `3002`.

Required env vars:

- `NOCODB_API_TOKEN`
- `NOCODB_TABLE_ID`

