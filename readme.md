# MDT Pipeline

Автоматизация: Tally quiz → n8n → PostgreSQL → pdf-service → Email

## Архитектура

```
mdt-pipeline/
├── compose.yml                      # docker: n8n + postgres + pdf-service
├── init.sql                         # схема БД (создаётся автоматически)
├── .env                             # секреты (не в git)
├── _env.example                     # шаблон .env
├── n8n/
│   └── working-tally-workflow.json  # Tally → PostgreSQL lead capture
├── pdf-service/
│   ├── Dockerfile
│   ├── server.js                    # Express API (POST /generate-pdf)
│   ├── pdf-overlay.js               # pdf-lib: текст поверх reference PDF
│   ├── templates/
│   │   ├── week1.pdf                # Reference PDF — неделя 1
│   │   ├── week2.pdf                # Reference PDF — неделя 2
│   │   ├── week3.pdf                # Reference PDF — неделя 3
│   │   └── week4.pdf                # Reference PDF — неделя 4
│   └── package.json
└── PDF MDT * week..pdf              # Оригинальные reference PDF (дизайн)
```

## Сервисы

| Сервис | Порт | Описание |
|---|---|---|
| n8n | 5678 | Workflow автоматизация |
| PostgreSQL | 5432 | База данных лидов |
| pdf-service | 3001 | Генерация персонализированных PDF |

## Запуск

```bash
# 1. Настрой .env
cp _env.example .env
# Заполни: POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY, N8N_BASIC_AUTH_PASSWORD и т.д.

# 2. Старт
docker compose up -d

# 3. n8n UI
open http://localhost:5678
```

> Если Safari блокирует cookies: установи `N8N_SECURE_COOKIE=false` в `.env`

## Workflow (n8n)

**Tally → PostgreSQL lead capture** (`n8n/working-tally-workflow.json`)
- Webhook: `POST /webhook/tally-webhook`
- Парсит поля Tally формы
- Сохраняет лид в таблицу `leads` (PostgreSQL)

Workflow импортируется автоматически при старте контейнера.

## PDF Service API

```bash
POST http://localhost:3001/generate-pdf
Content-Type: application/json

{
  "name": "Alex",
  "week_number": 1,           # 1–4
  "profile": {
    "focus": "string",
    "level": "string",
    "spaces": ["string"],
    "sensitivity": "string"
  },
  "week_plan": {
    "morning":   { "warmup": { "name", "description", "cues?", "image_url?" }, "main": { ... } },
    "midday":    { ... },
    "afternoon": { ... },
    "evening":   { ... }
  },
  "calendar_url":    "https://...",  # опционально — кликабельная ссылка на стр.1
  "bonus_video_url": "https://..."   # опционально — кликабельная ссылка на стр.6
}

# Response: { "pdf": "<base64>" }
```

Генератор накладывает данные поверх reference PDF шаблона нужной недели (`templates/weekN.pdf`) через `pdf-lib`.

Если `calendar_url` не передан, сервис сам генерирует ссылку на встроенную страницу выбора календаря. На этой странице пользователь может открыть Google Calendar, Outlook или скачать `.ics` для Apple Calendar и выбрать точное время вручную.

Стартовая дата для такого события берётся как день открытия ссылки. Для корректной ссылки в PDF задайте `PUBLIC_BASE_URL` в окружении. Локально это обычно `http://localhost:3001`, а для реальной отправки PDF нужен публичный URL сервиса.

## Тест генерации PDF

```bash
curl -s -X POST http://localhost:3001/generate-pdf \
  -H "Content-Type: application/json" \
  -d '{"name":"Alex","week_number":1,"profile":{"focus":"Energy","level":"beginner","spaces":["home"],"sensitivity":"low"},"week_plan":{"morning":{"warmup":{"name":"Neck Rolls","description":"Slow circles"},"main":{"name":"Cat-Cow","description":"Spinal flow"}},"midday":{"warmup":{"name":"Shoulder Rolls","description":"Loosen back"},"main":{"name":"Seated Twist","description":"Thoracic rotation"}},"afternoon":{"warmup":{"name":"Hip Circles","description":"Hip mobility"},"main":{"name":"Glute Bridge","description":"Hip strength"}},"evening":{"warmup":{"name":"Child Pose","description":"Lumbar stretch"},"main":{"name":"Legs Up Wall","description":"Recovery"}}}}' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); open('/tmp/test.pdf','wb').write(base64.b64decode(d['pdf']))"
open /tmp/test.pdf
```

## Следующие шаги

- [ ] Ручной тест: заполнить Tally форму → проверить лид в PostgreSQL
- [ ] Бизнес-логика: выбор упражнений из NocoDB по профилю лида
- [ ] Интеграция: n8n вызывает pdf-service с реальными упражнениями
- [ ] Email: отправка PDF через SMTP credential в n8n
- [ ] Paddle: webhook после оплаты → генерация PDF
