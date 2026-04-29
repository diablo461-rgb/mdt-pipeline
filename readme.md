# MDT Pipeline

Полная автоматизация доставки персонализированных PDF-планов тренировок:
**Tally quiz → n8n → PostgreSQL → Paddle Checkout → pdf-service → Resend → Email**

---

## Архитектура

```
mdt-pipeline/
├── compose.yml                          # Docker: n8n + PostgreSQL + pdf-service + program-service
├── init.sh                              # Инициализация БД: n8n_db + схема mdt_db
├── migrations/
│   └── 001_align_schema_with_workflows.sql # Миграция для уже существующих БД
├── Dockerfile.n8n                       # n8n с автоимпортом workflow и кредешналов
├── .env                                 # Секреты (не в git)
├── _env.example                         # Шаблон .env
├── n8n/
│   ├── working-tally-workflow.json      # Tally → PostgreSQL + Paddle transaction creation
│   ├── get-checkout-workflow.json       # GET /checkout-redirect → DB lookup + HTTP redirect на checkout URL
│   ├── paddle-payment-workflow.json     # Paddle webhook → payment verification → week1 send
│   └── weekly-sender-workflow.json      # MDT Email Sequence Sender
├── pdf-service/
│   ├── Dockerfile
│   ├── server.js                        # Express API: POST /generate-pdf, GET /health
│   ├── pdf-overlay.js                   # pdf-lib: персонализированные PDF поверх шаблонов
│   ├── fonts/                           # Work Sans Bold + Regular (TTF)
│   ├── templates/
│   │   ├── week1.pdf                    # Reference PDF — неделя 1 (светлая тема)
│   │   ├── week2.pdf                    # Reference PDF — неделя 2 (светлая тема)
│   │   ├── week3.pdf                    # Reference PDF — неделя 3 (тёмная тема)
│   │   └── week4.pdf                    # Reference PDF — неделя 4 (тёмная тема)
│   └── package.json
├── program-service/
│   ├── Dockerfile
│   ├── server.js                        # Express API: POST /generate-program, GET /health
│   ├── planner.js                       # Логика подбора упражнений (вынесена из n8n)
│   ├── nocodb.js                        # Пагинированная загрузка упражнений из NocoDB
│   ├── rules/                           # Таблицы и фильтры правил подбора
│   └── package.json
└── PDF MDT * week..pdf                  # Оригинальные дизайн-шаблоны
```

---

## Сервисы

| Сервис      | Порт | Описание                             |
|-------------|------|--------------------------------------|
| n8n         | 5678 | Workflow-автоматизация               |
| PostgreSQL  | 5432 | База данных лидов и email-шаблонов   |
| pdf-service | 3001 | Генерация персонализированных PDF    |
| program-service | 3002 | Генерация `program_plan` для 4 недель |

---

## Запуск

```bash
# 1. Скопируй и заполни .env
cp _env.example .env
# Обязательно: POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY, N8N_BASIC_AUTH_PASSWORD,
#              RESEND_API_KEY, RESEND_FROM, PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET

# 2. Старт
docker compose up -d

# 3. n8n UI
open http://localhost:5678
```

> Если Safari блокирует cookies: поставь `N8N_SECURE_COOKIE=false` в `.env`

При первом старте:
- Контейнер PostgreSQL применяет `init.sh` (создаёт `n8n_db`, таблицы, индексы, email-шаблоны по умолчанию)
- Контейнер n8n импортирует кредешнал MDT Postgres и все 4 workflow, активирует их автоматически

---

## Переменные окружения (`.env`)

| Переменная              | Описание                                                 |
|-------------------------|----------------------------------------------------------|
| `POSTGRES_USER`         | Пользователь PostgreSQL                                  |
| `POSTGRES_PASSWORD`     | Пароль PostgreSQL                                        |
| `POSTGRES_DB`           | База данных приложения (`mdt_db`)                        |
| `N8N_DB`                | База данных n8n (`n8n_db`)                               |
| `N8N_AUTH_USER`         | Логин n8n Basic Auth                                     |
| `N8N_BASIC_AUTH_PASSWORD` | Пароль n8n Basic Auth                                  |
| `N8N_ENCRYPTION_KEY`    | Ключ шифрования n8n (`openssl rand -hex 16`)             |
| `N8N_SECURE_COOKIE`     | `false` для HTTP / `true` для HTTPS                      |
| `N8N_HOST`              | Хост n8n (`localhost` или домен)                         |
| `N8N_PROTOCOL`          | `http` или `https`                                       |
| `WEBHOOK_URL`           | Публичный URL для вебхуков n8n                           |
| `TIMEZONE`              | Временная зона (`Europe/Berlin` и т.д.)                  |
| `RESEND_API_KEY`        | API-ключ Resend (для отправки email)                     |
| `RESEND_FROM`           | Адрес отправителя (`MDT <plan@microdosing-training.com>`) |
| `LEVEL2_OFFER_URL`      | Ссылка на оффер Level 2 (для `upsell_day_30`)             |
| `FEEDBACK_FORM_URL`     | Ссылка на форму фидбэка (для `feedback_day_21`)           |
| `MDT_BLOG_URL`          | Ссылка на блог MDT (для `bounce_no_payment_72h`)          |
| `NOCODB_API_TOKEN`      | Токен NocoDB (для загрузки данных упражнений)            |
| `NOCODB_BASE_ID`        | ID базы в NocoDB                                         |
| `NOCODB_TABLE_ID`       | ID таблицы упражнений в NocoDB                           |
| `PUBLIC_BASE_URL`       | Публичный URL pdf-service (для calendar-страницы в PDF)  |
| `CALENDAR_DEFAULT_URL`  | Fallback-ссылка на календарь                             |
| `CALENDAR_WEEK1_URL`    | Ссылка на календарь для недели 1                         |
| `CALENDAR_WEEK2_URL`    | Ссылка на календарь для недели 2                         |
| `CALENDAR_WEEK3_URL`    | Ссылка на календарь для недели 3                         |
| `CALENDAR_WEEK4_URL`    | Ссылка на календарь для недели 4                         |
| `PADDLE_API_KEY`        | API-ключ Paddle (для создания транзакций через API)      |
| `PADDLE_API_URL`        | `https://sandbox-api.paddle.com` или `https://api.paddle.com` |
| `PADDLE_PRICE_ID`       | ID прайса Paddle (`pri_xxxxxxxxxxxxxxxxxx`)              |
| `PADDLE_WEBHOOK_SECRET` | Секрет для верификации подписи Paddle вебхуков (обязательно) |

---

## Поток оплаты (Paddle Billing v2)

```
Tally (квиз) → POST /webhook/tally-webhook
  → n8n: сохраняет лида в leads (status = pending_payment)
  → n8n: создаёт Paddle transaction через API → получает checkout_url + transaction_id
  → n8n: сохраняет checkout_url и paddle_transaction_id в leads
    → Tally: редиректит пользователя на GET /webhook/checkout-redirect?email=...
      → n8n: Extract Email
      → n8n: Fetch Checkout URL With Retry (первый SELECT, при пустом результате ждёт 2с и делает повторный SELECT)
      → n8n: Build Redirect URL (checkout_url, fallback на /checkout/{paddle_transaction_id})
      → HTTP 307 redirect на финальный URL оплаты
        → Пользователь оплачивает
          → Paddle: POST /webhook/paddle-webhook (transaction.completed)
            → n8n: верифицирует подпись, обновляет лида (status = paid)
            → n8n: запрашивает `program-service` для program_plan, создаёт Week 1 PDF
            → n8n: отправляет email через Resend
```

> **Важно:** Paddle Billing v2 не поддерживает прямые URL на checkout по `price_id`.
> Необходимо создавать транзакцию через API и использовать полученный `_ptxn` токен.

---

## Workflow (n8n)

### 1. Tally → PostgreSQL + Paddle transaction (`working-tally-workflow.json`)

- **Триггер:** `POST /webhook/tally-webhook`
- Парсит ответы квиза, сохраняет/обновляет лида в `leads` со статусом `pending_payment`
- Валидирует Paddle-конфиг перед API вызовом (`Validate Paddle Config`)
- Создаёт транзакцию Paddle через API (`POST /transactions` к `PADDLE_API_URL`)
- Сохраняет `checkout_url` и `paddle_transaction_id` в запись лида
- Создаёт no-payment jobs в `email_sequence_jobs` (`sequence_key='no_payment_bounce'`): 30m, 24h, 48h, 72h, 96h, 120h
- Узлы: Webhook → Parse Tally → Build DB Record → Save Lead → Validate Paddle Config → Create Paddle Transaction → Save Checkout URL → Enqueue No Payment Bounce Jobs

### 2. Checkout redirect (`get-checkout-workflow.json`)

- **Триггер:** `GET /webhook/checkout-redirect?email=xxx`
- Из query извлекается email
- В Postgres выполняется retry-запрос:
  - первая попытка получить `checkout_url`/`paddle_transaction_id`
  - если пусто, `pg_sleep(2)` и вторая попытка
- Если `checkout_url` пустой, строится fallback URL:
  - sandbox: `https://sandbox-buy.paddle.com/checkout/{transaction_id}`
  - production: `https://buy.paddle.com/checkout/{transaction_id}`
- Если нет обоих полей, редирект на:
  - `https://www.microdosing-training.com/payment-error?reason=missing_checkout`
- Узлы: GET Webhook → Extract Email → Fetch Checkout URL With Retry → Build Redirect URL → Redirect to Paddle

### 3. Paddle payment → Program + Email (`paddle-payment-workflow.json`)

- **Триггер:** `POST /webhook/paddle-webhook`
- Проверяет подпись Paddle (`Paddle-Signature`) через `PADDLE_WEBHOOK_SECRET` и отклоняет невалидные/нерелевантные события
- На подтверждённом событии оплаты:
  - обновляет лида (`status = paid`, `payment_date`, `paid_amount`, `paddle_transaction_id`, `paddle_customer_id`)
  - генерирует персональный `program_plan` через `program-service` (`Generate Program`)
  - собирает и отправляет Week 1 PDF по email
  - ставит `week1_sent_at = NOW()` (и `next_send_at` для обратной совместимости)
  - планирует future sequence jobs в `email_sequence_jobs` через `INSERT ... ON CONFLICT DO NOTHING`:
    - `week_2` (+7d), `week_3` (+14d), `feedback_day_21` (+21d), `week_4` (+21d), `upsell_day_30` (+30d)
  - отменяет pending `no_payment_bounce` jobs (`status='skipped'`, `metadata.skip_reason='paid'`)

**Важно для `Generate Program`:** `user_profile` из `Mark Lead as Paid` может прийти как `jsonb`-object, JSON-string, `null` или пустое значение. Workflow теперь безопасно нормализует его в object и не делает прямой `JSON.parse(undefined)`.

### 4. MDT Email Sequence Sender (`weekly-sender-workflow.json`)

**Расписание:** каждые 10 минут (`*/10 * * * *`)

**Цепочка узлов:**

```
Daily 9am Trigger
  → Claim Due Jobs          (PostgreSQL: atomically claim `pending` jobs with `scheduled_at <= NOW()`)
  → Skip Paid No-Payment?   (для `sequence_key='no_payment_bounce'`, если лид уже paid -> `status='skipped'`)
  → Build Job Payload       (Code: рендер переменных и решение нужен ли PDF)
  → Requires PDF?           (IF)
      ├─ yes → Generate PDF → Send Email With PDF
      └─ no  → Send Email Without PDF
  → Send OK?                (IF)
      ├─ yes → Mark Job Sent (status=`sent`, `sent_at=NOW()`, compatibility update in `leads`)
      └─ no  → Mark Job Failed (attempts-driven `pending`/`failed`, `last_error`)
```

**Критерии выборки jobs:**

```sql
status = 'pending'
scheduled_at <= NOW()
template.is_active = TRUE
AND (
  sequence_key = 'no_payment_bounce'
  OR (sequence_key <> 'no_payment_bounce' AND lead.status = 'paid')
)
```

`next_send_at` и `week2_sent_at..week4_sent_at` остаются для обратной совместимости и обновляются при отправке week email.

### No-payment bounce sequence

- `sequence_key='no_payment_bounce'` создается сразу после генерации checkout в `working-tally-workflow.json`.
- Timings: `30m`, `24h`, `48h`, `72h`, `96h`, `120h`.
- Письма уходят только если пользователь еще не оплатил.
- При оплате через `paddle-payment-workflow.json` все pending bounce jobs переводятся в `skipped`.
- Bounce emails не вызывают `pdf-service` и не добавляют attachments.

---

## Ошибка 403 в `Create Paddle Transaction`

Если в n8n видно `403 forbidden` от Paddle, обычно это проблема конфигурации ключей/окружения, а не формат JSON body.

Проверить обязательно:
- `PADDLE_API_KEY` = server-side API key (`pdl_sdbx_*` или `pdl_live_*`)
- `PADDLE_API_URL` соответствует ключу:
  - `pdl_sdbx_*` -> `https://sandbox-api.paddle.com`
  - `pdl_live_*` -> `https://api.paddle.com`
- `PADDLE_PRICE_ID` начинается с `pri_` и создан в том же окружении, что и ключ

Что уже сделано в workflow:
- Добавлен узел `Validate Paddle Config` перед `Create Paddle Transaction`.
- Узел валидирует формат ключа, URL, `price_id` и sandbox/live соответствие.
- `Create Paddle Transaction` использует только провалидированные значения.

Быстрый smoke test Paddle API:

```bash
cd /Users/aleksejkazakov/mdt-pipeline
set -a
source .env
set +a

curl -sS -o /tmp/paddle_txn_check.json -w "%{http_code}\n" \
  -X POST "${PADDLE_API_URL%/}/transactions" \
  -H "Authorization: Bearer $PADDLE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Paddle-Version: 1" \
  -d '{
    "items":[{"price_id":"'"$PADDLE_PRICE_ID"'","quantity":1}],
    "customer":{"email":"smoke-test@example.com"},
    "custom_data":{"source":"manual-smoke-test"}
  }'

cat /tmp/paddle_txn_check.json
```

Ожидаемо: HTTP `201` и поля `data.id` + `data.checkout.url`.

---

## База данных

### Таблица `leads`

| Поле                  | Тип          | Описание                              |
|-----------------------|--------------|---------------------------------------|
| `id`                  | SERIAL PK    |                                       |
| `name`                | VARCHAR(255) | Имя клиента                           |
| `email`               | VARCHAR(255) | Email (уникальный)                    |
| `user_profile`        | JSONB        | Данные из Tally-квиза                 |
| `program_plan`        | JSONB        | 4-недельный план (`week_1..week_4`)   |
| `tally_payload`       | JSONB        | Сырые данные Tally                    |
| `payment_date`        | TIMESTAMP    | Дата оплаты                           |
| `paddle_transaction_id` | VARCHAR    | ID транзакции Paddle                  |
| `paddle_customer_id`  | VARCHAR      | ID клиента Paddle                     |
| `checkout_url`        | TEXT         | Paddle checkout URL (`?_ptxn=txn_xxx`) |
| `paid_amount`         | DECIMAL      | Сумма оплаты (в основной единице валюты) |
| `week1_sent_at`       | TIMESTAMP    | Дата отправки письма недели 1         |
| `week2_sent_at`       | TIMESTAMP    | Дата отправки письма недели 2         |
| `week3_sent_at`       | TIMESTAMP    | Дата отправки письма недели 3         |
| `week4_sent_at`       | TIMESTAMP    | Дата отправки письма недели 4         |
| `next_send_at`        | TIMESTAMP    | Следующая запланированная отправка    |
| `completed_at`        | TIMESTAMP    | Время завершения Level 1 (после `upsell_day_30`) |
| `status`              | VARCHAR(50)  | Статус лида (default: `new`)          |
| `created_at`          | TIMESTAMP    | Время создания записи                 |
| `updated_at`          | TIMESTAMP    | Время последнего обновления           |

Индексы/ограничения, используемые workflow:
- `UNIQUE (email)` для `ON CONFLICT (email)`
- `idx_leads_email` на `leads(email)`
- `idx_leads_next_send_at` на `leads(next_send_at)`
- `idx_leads_paddle_transaction_id` на `leads(paddle_transaction_id)`

### Таблица `payment_events`

Используется для idempotency и аудита Paddle webhook событий.

| Поле               | Тип          | Описание                                  |
|--------------------|--------------|-------------------------------------------|
| `id`               | SERIAL PK    |                                           |
| `event_id`         | VARCHAR(255) | Уникальный ID события Paddle              |
| `event_type`       | VARCHAR(100) | Тип события                               |
| `lead_id`          | INTEGER      | FK на `leads(id)`                         |
| `email`            | VARCHAR(255) | Email из payload                          |
| `transaction_id`   | VARCHAR(255) | ID транзакции Paddle                      |
| `processed_at`     | TIMESTAMP    | Время обработки события                   |
| `raw_payload`      | JSONB        | Полный raw payload webhook события        |

Индексы/ограничения:
- `UNIQUE (event_id)`
- `idx_payment_events_event_id` на `payment_events(event_id)`
- `idx_payment_events_transaction_id` на `payment_events(transaction_id)`
- `idx_payment_events_email` на `payment_events(email)`

### Таблица `email_templates`

Хранит HTML-шаблоны писем для sequence-рассылки.

| `template_key`  | Описание                        |
|-----------------|---------------------------------|
| `week_1`        | Письмо при старте (неделя 1)    |
| `week_2`        | Напоминание — неделя 2          |
| `week_3`        | Напоминание — неделя 3          |
| `feedback_day_21` | Check-in на 21-й день         |
| `week_4`          | Финальная неделя              |
| `upsell_day_30`   | Upsell после завершения курса |
| `bounce_no_payment_30m`  | Bounce через 30 минут после checkout |
| `bounce_no_payment_24h`  | Bounce через 24 часа |
| `bounce_no_payment_48h`  | Bounce через 48 часов |
| `bounce_no_payment_72h`  | Bounce через 72 часа |
| `bounce_no_payment_96h`  | Bounce через 96 часов |
| `bounce_no_payment_120h` | Финальный bounce через 120 часов |

Дополнительно: `requires_pdf BOOLEAN NOT NULL DEFAULT FALSE`.

- `week_1..week_4` -> `requires_pdf=true`
- `feedback_day_21`, `upsell_day_30`, `bounce_no_payment_*` -> `requires_pdf=false`

**Переменные в шаблонах:**

| Переменная          | Значение                       |
|---------------------|--------------------------------|
| `{{name}}`          | Имя клиента                    |
| `{{Name}}`          | Имя клиента (вариант с заглавной буквой) |
| `{{goal}}`          | Цель из `user_profile.primary_goal` / `user_profile.goal` |
| `{{week_number}}`   | Номер текущей недели           |
| `{{calendar_url}}`  | Ссылка на добавление в календарь |
| `{{week_pdf_url}}`  | Зарезервировано для будущего использования |
| `{{level2_offer_url}}` | Ссылка на Level 2 upsell    |
| `{{feedback_url}}`  | Ссылка на feedback форму       |
| `{{checkout_url}}`  | Ссылка на Paddle checkout (из `leads.checkout_url`, есть fallback) |
| `{{mdt_blog_url}}`  | Ссылка на блог MDT (`MDT_BLOG_URL`) |

### Таблица `email_sequence_jobs`

Универсальная очередь запланированных писем.

Ключевые поля:
- `lead_id`, `email`, `template_key`, `sequence_key`
- `status` (`pending`, `processing`, `sent`, `failed`, `skipped`)
- `scheduled_at`, `sent_at`, `attempts`, `last_error`, `metadata`

Индексы/ограничения:
- `idx_email_sequence_jobs_status_scheduled_at`
- `idx_email_sequence_jobs_lead_id`
- `UNIQUE (lead_id, sequence_key, template_key)` для антидублей

```sql
SELECT lead_id, template_key, sequence_key, status, scheduled_at, sent_at
FROM email_sequence_jobs
WHERE sequence_key = 'no_payment_bounce'
ORDER BY scheduled_at;
```

### Управление шаблонами (SQL)

```sql
-- Просмотр всех шаблонов
SELECT * FROM email_templates_admin;

-- Создать или обновить шаблон
SELECT upsert_email_template(
  'week_2',
  'MDT Plan - Week 2: Keep It Going',
  '<div><p>Hi {{name}}, welcome to Week 2...</p></div>',
  TRUE,  -- is_active
  TRUE   -- requires_pdf
);

-- Выключить шаблон
SELECT set_email_template_active('week_3', FALSE);

-- Включить обратно
SELECT set_email_template_active('week_3', TRUE);
```

### Как добавить новую кампанию (например, `bounce_upsell`)

1. Добавь/обнови шаблон в `email_templates` с новым `template_key`.
2. Создай `pending` job в `email_sequence_jobs` с нужным `scheduled_at` и `sequence_key`.
3. `weekly-sender-workflow.json` автоматически подхватит job без изменения JSON workflow.

---

## PDF Service

### API

```
GET  /health          → { ok: true, service: "mdt-pdf-service" }
POST /generate-pdf    → { pdf: "<base64>" }
```

### Тело запроса `/generate-pdf`

```json
{
  "name": "Alex",
  "week_number": 1,
  "profile": {
    "focus": "Energy",
    "level": "beginner",
    "spaces": ["home"],
    "sensitivity": "low",
    "primary_goal": "mobility"
  },
  "week_plan": {
    "morning": {
      "warmup": { "name": "Neck Rolls", "description": "Slow circles", "image_url": "https://...", "cues": ["Keep shoulders relaxed"] },
      "main":   { "name": "Cat-Cow",    "description": "Spinal flow",  "image_url": "https://...", "cues": ["Breathe in on arch"] }
    },
    "midday":    { "warmup": { ... }, "main": { ... } },
    "afternoon": { "warmup": { ... }, "main": { ... } },
    "evening":   { "warmup": { ... }, "main": { ... } }
  },
  "calendar_url": "https://...",
  "bonus_video_url": "https://..."
}
```

Ответ: `{ "pdf": "<base64 encoded PDF>" }`

### Структура сгенерированного PDF (6 страниц)

| Страница | Содержание                                    |
|----------|-----------------------------------------------|
| 1        | Обложка: имя клиента, ссылка на календарь     |
| 2        | Профиль клиента из квиза                      |
| 3        | Weekly plan (таблица сессий)                  |
| 4        | Упражнения: Morning + Midday                  |
| 5        | Упражнения: Afternoon + Evening               |
| 6        | Бонусная страница / ссылка на видео           |

### Темизация по неделям

| Недели | Тема           | Цвет текста                    |
|--------|----------------|--------------------------------|
| 1–2    | Светлая        | Тёмный (`rgb(0.05, 0.05, 0.05)`) |
| 3–4    | Тёмная         | Белый (`rgb(1, 1, 1)`)          |

### Типографика

| Элемент                        | Шрифт       | Размер |
|-------------------------------|-------------|--------|
| Имя клиента (стр. 1)          | Work Sans Bold    | 17pt |
| Параметры профиля (стр. 2)    | Work Sans Bold    | 17pt |
| Weekly plan таблица (стр. 3)  | Work Sans Regular | 13pt |
| Название упражнения (стр. 4–5)| Work Sans Bold    | 11pt |
| Описание упражнения           | Work Sans Regular | 11pt |
| Кью-советы (cues)             | Work Sans Regular | 11pt |

### Изображения упражнений

Загружаются по URL из NocoDB. Обрабатываются через `sharp`:
- `fit: 'cover'` — заполняет фрейм без белых полей (кадрирование по центру)
- `flatten({ background: '#ffffff' })` — убирает прозрачность

### Тест генерации PDF

```bash
curl -s -X POST http://localhost:3001/generate-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alex",
    "week_number": 1,
    "profile": { "focus": "Energy", "level": "beginner", "spaces": ["home"], "sensitivity": "low" },
    "week_plan": {
      "morning":   { "warmup": { "name": "Neck Rolls",    "description": "Slow circles" },    "main": { "name": "Cat-Cow",      "description": "Spinal flow" } },
      "midday":    { "warmup": { "name": "Shoulder Rolls","description": "Loosen back" },    "main": { "name": "Seated Twist", "description": "Thoracic rotation" } },
      "afternoon": { "warmup": { "name": "Hip Circles",   "description": "Hip mobility" },   "main": { "name": "Glute Bridge", "description": "Hip strength" } },
      "evening":   { "warmup": { "name": "Child Pose",    "description": "Lumbar stretch" }, "main": { "name": "Legs Up Wall", "description": "Recovery" } }
    }
  }' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); open('/tmp/test.pdf','wb').write(base64.b64decode(d['pdf']))"
open /tmp/test.pdf
```

---

## Деплой (Hostinger / VPS)

В `.env` замени на продакшн-значения:

```env
N8N_HOST=n8n.yourdomain.com
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.yourdomain.com/
N8N_SECURE_COOKIE=true
PUBLIC_BASE_URL=https://pdf.yourdomain.com
```

---

## Настройка Paddle Billing v2 (Sandbox → Prod)

### Шаг 1 — Создать продукт и прайс

1. Войди в [sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com)
2. **Catalog → Products → New product** — создай продукт (например, "MDT 30-Day Plan")
3. **Add price** — укажи сумму (например, €29.00), валюту, тип `One-time`
4. Скопируй **`price_id`** (формат `pri_xxxxxxxxxxxxxxxxxx`) → вставь в `.env` как `PADDLE_PRICE_ID`

### Шаг 2 — Получить API-ключ

1. **Developer Tools → Authentication → API keys → New API key**
2. Назови ключ (например, "n8n integration"), дай права `Read + Write`
3. Скопируй ключ → вставь в `.env` как `PADDLE_API_KEY`

### Шаг 3 — Настроить Default Payment Link (домен для checkout)

Paddle Billing v2 создаёт checkout URL вида `https://YOUR_DOMAIN?_ptxn=txn_xxx`.
Домен берётся из настройки **Default Payment Link**.

1. **Checkout → Checkout settings** (или **Settings → Checkout**)
2. В поле **Payment Link domain** укажи домен сайта: `microdosing-training.com`
3. Нажми **Save**

> После этого все транзакции будут создаваться с URL `https://microdosing-training.com?_ptxn=txn_xxx`.
> Paddle.js на этом домене автоматически перехватит параметр `_ptxn` и откроет checkout overlay.

### Шаг 4 — Настроить webhook

1. **Notifications → New notification**
2. **URL:** `https://YOUR_N8N_DOMAIN/webhook/paddle-webhook`
   - Локально через ngrok: `https://grandma-exact-carport.ngrok-free.dev/webhook/paddle-webhook`
3. **Events:** `transaction.completed` (обязательно)
4. Нажми **Save** и скопируй **Webhook secret key**
5. Вставь в `.env`:
   ```
   PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxxxxxxxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### Шаг 5 — Настроить Squarespace для работы Paddle

**Paddle checkout overlay работает только если Paddle.js загружен на странице.**
Без этого параметр `?_ptxn=txn_xxx` игнорируется и открывается просто главная страница сайта.

#### 5.1 — Добавить Paddle.js через Code Injection

1. Войди в панель управления Squarespace сайта `microdosing-training.com`
2. Перейди: **Settings → Advanced → Code Injection**
3. В блок **Header** добавь следующий код:

   **Для Sandbox (тестирование):**
   ```html
   <!-- Paddle.js Checkout -->
   <script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
   <script>
     Paddle.Environment.set("sandbox");
     Paddle.Initialize({ token: "test_0f34da003002a073c06db49e5a1" });
   </script>
   ```

   **Для Production:**
   ```html
   <!-- Paddle.js Checkout -->
   <script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
   <script>
     Paddle.Initialize({ token: "live_YOUR_CLIENT_SIDE_TOKEN" });
   </script>
   ```
   > Client-side token (начинается на `live_`) находится в Paddle Dashboard → **Developer Tools → Authentication → Client-side tokens**

4. Нажми **Save** в верхнем правом углу

#### 5.2 — Проверить, что Paddle.js загружается

1. Открой `https://microdosing-training.com` в браузере
2. Открой DevTools (F12) → Console
3. Введи `Paddle` — должен вернуть объект (не `undefined`)
4. Или: открой `https://microdosing-training.com?_ptxn=txn_xxx` (с реальным ID транзакции) — должен появиться checkout overlay

#### 5.3 — Важные нюансы Squarespace

- **Code Injection** доступен только на планах **Business и выше** (не Personal)
- Если плана нет — как обходной путь используй страницу с Custom HTML Block: Pages → New Page → Add Block → Code
- Код из Header применяется ко **всем страницам** сайта — это правильное поведение
- Squarespace может кешировать изменения; при проблемах открой сайт в режиме инкогнито

### Шаг 6 — Настроить редирект в Tally

После того как Paddle.js установлен на Squarespace, настрой редирект из Tally:

1. Tally → форма → **Settings → On submit → Redirect to URL**
2. Нажми **+** для вставки переменной поля, выбери поле email из выпадающего списка
3. Итоговый URL должен выглядеть так:
   ```
   https://YOUR_N8N_DOMAIN/webhook/checkout-redirect?email={question_jyBjN1}
   ```
   - Замени `YOUR_N8N_DOMAIN` на ngrok URL или продакшн-домен n8n
   - `question_jyBjN1` — ID поля email в твоей форме (видно в Tally webhook payload)
   - Переменную поля **обязательно** вставляй через пикер Tally (не печатай вручную)

**Что происходит после сабмита:**
- Tally отправляет webhook в n8n → n8n сохраняет лида и создаёт Paddle транзакцию
- Tally редиректит пользователя на `/checkout-redirect?email=...`
- n8n достаёт `checkout_url` из БД и делает 307 redirect на `microdosing-training.com?_ptxn=txn_xxx`
- Paddle.js на Squarespace автоматически открывает checkout overlay

### Шаг 7 — Заполнить `.env`

```env
# Paddle Billing v2
PADDLE_API_KEY=pdl_sdbx_apikey_xxxxxxxxxxxxxxxxxxxxxxxx
PADDLE_API_URL=https://sandbox-api.paddle.com
PADDLE_PRICE_ID=pri_xxxxxxxxxxxxxxxxxx
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxxxxxxxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Шаг 8 — Применить миграцию БД (если нужно)

```bash
# Для уже существующей БД (где volume уже инициализирован):
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < migrations/001_align_schema_with_workflows.sql
```

### Шаг 9 — Перезапустить стек

```bash
docker compose restart n8n
```

### Проверка e2e (sandbox)

```bash
# 1. Отправь тестовый Tally webhook (создаёт лида + Paddle транзакцию):
curl -s -X POST http://localhost:5678/webhook/tally-webhook \
  -H "Content-Type: application/json" \
  -d '{"data":{"eventId":"test","eventType":"FORM_RESPONSE","data":{"fields":[
    {"key":"question_R0XR0l","type":"INPUT_TEXT","value":"Test User"},
    {"key":"question_jyBjN1","type":"INPUT_EMAIL","value":"test@example.com"}
  ]}}}'

# 2. Проверь что checkout_url сохранился в БД:
docker compose exec postgres psql -U mdt_user -d mdt_db -c \
  "SELECT email, status, checkout_url, paddle_transaction_id FROM leads WHERE email='test@example.com';"

# 3. Открой checkout-redirect endpoint:
curl -v "http://localhost:5678/webhook/checkout-redirect?email=test@example.com"
# Должен вернуть HTML с Paddle.js или 307 redirect на microdosing-training.com?_ptxn=...

# 4. Протестируй оплату через Paddle sandbox карту: 4242 4242 4242 4242, любой CVV, любая дата

# 5. Проверь что Paddle отправил webhook (Paddle Dashboard → Notifications → Logs)

# 6. Проверь лида в БД:
docker compose exec postgres psql -U mdt_user -d mdt_db -c \
  "SELECT email, status, payment_date, week1_sent_at FROM leads WHERE email='test@example.com';"
```

---

## Следующие шаги

- [x] Разделить поток на `lead capture` и `payment success`
- [x] Добавить верификацию подписи Paddle webhook
- [x] Генерировать программу и отправлять Week 1 только после подтверждённой оплаты
- [x] Добавить idempotency на уровне БД (таблица `payment_events` + проверка в workflow)
- [x] Создать Paddle транзакцию через API и сохранять `checkout_url` в БД
- [x] Создать n8n endpoint `/checkout-redirect` для перехода на Paddle checkout
- [ ] Установить Paddle.js на Squarespace через Code Injection (шаг 5 выше)
- [ ] E2E-тест с Paddle sandbox картой `4242 4242 4242 4242`
- [ ] Проверить PDF генерируется и приходит на email
- [ ] Перевести Paddle на production (убрать `Paddle.Environment.set("sandbox")`, сменить ключи)
- [x] Перевести post-payment рассылку на универсальную очередь `email_sequence_jobs`
- [x] Добавить шаблоны `feedback_day_21` и `upsell_day_30`
- [ ] Добавить bounce-сценарии (`bounce_upsell_no_payment`, `bounce_upsell`) как отдельные jobs
