# scripts

Вспомогательные скрипты для тестирования и симуляции.

## simulate-10-programs.js

Интеграционный тест: генерирует 10 планов для 10 разных профилей через `program-service`,
сохраняет в `leads` и проверяет генерацию PDF.

**Требования:**
- `program-service` запущен на `http://localhost:3002`
- `pdf-service` запущен на `http://localhost:3001`
- Postgres доступен (через переменные `POSTGRES_*`)

```bash
# Все сервисы уже запущены через docker compose up -d
node scripts/simulate-10-programs.js
```

**Ожидаемый вывод:**
```
Leads inserted/updated:          10/10
Program plans saved to leads:    10/10
Program plan contract valid:     10/10
Unique program plans (hashes):   10/10
PDF generated (base64 %PDF):     10/10
```

Переменные окружения:
- `PROGRAM_SERVICE_URL` — URL program-service (по умолчанию `http://localhost:3002`)
- `PDF_SERVICE_URL`     — URL pdf-service (по умолчанию `http://localhost:3001`)
- `POSTGRES_*`          — параметры Postgres из `.env`

## simulate-10-e2e.js

Попытка полного webhook-прогона через n8n: отправляет Tally-webhook и Paddle-webhook для 10 профилей.

**Требования:**
- Все сервисы запущены: `docker compose up -d`
- Workflows активированы в n8n UI (`http://localhost:5678`)

> **Известное ограничение:** `Dockerfile.n8n` может не активировать все workflow при первом старте.
> Если webhooks возвращают 404, активируй workflows вручную в n8n UI.

```bash
N8N_BASE_URL=http://localhost:5678 \
PADDLE_WEBHOOK_SECRET=your_secret \
node scripts/simulate-10-e2e.js
```
