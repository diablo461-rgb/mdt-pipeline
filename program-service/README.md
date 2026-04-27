# program-service

Микросервис генерации персонализированных 4-недельных планов тренировок MDT.

## API

```
GET  /health              → { ok: true, service: "mdt-program-service" }
POST /generate-program    → { program_plan: { week_1..week_4 }, email }
```

### Тело запроса `/generate-program`

```json
{
  "user_profile": {
    "primary_goal": "energy",
    "level": "beginner",
    "space": "indoor",
    "equipment": "none",
    "movement_type": "mix",
    "contraindications": [],
    "sleep_bucket": "normal",
    "sex": "female",
    "cycle_phase": "follicular"
  },
  "email": "user@example.com"
}
```

### Формат ответа

```json
{
  "program_plan": {
    "week_1": {
      "morning":   { "warmup": { "name": "...", ... }, "main": { "name": "...", ... } },
      "midday":    { "warmup": {...}, "main": {...} },
      "afternoon": { "warmup": {...}, "main": {...} },
      "evening":   { "warmup": {...}, "main": {...} }
    },
    "week_2": { ... },
    "week_3": { ... },
    "week_4": { ... }
  },
  "email": "user@example.com"
}
```

Каждый объект упражнения содержит поля:
`ex_id`, `name`, `description`, `body_focus`, `level`, `intensity`,
`movement_type`, `primary_goal`, `image_url`, `cues`, `space`, `equipment`.

## Переменные окружения

| Переменная          | Описание                            |
|---------------------|-------------------------------------|
| `NOCODB_API_TOKEN`  | Токен NocoDB для загрузки упражнений|
| `NOCODB_TABLE_ID`   | ID таблицы упражнений в NocoDB      |
| `PORT`              | Порт сервиса (по умолчанию `3002`)  |

## Запуск локально

```bash
cd program-service
npm install
NOCODB_API_TOKEN=... NOCODB_TABLE_ID=... node server.js
```

## Структура

```
program-service/
├── server.js          # Express API
├── planner.js         # Логика подбора упражнений
├── nocodb.js          # Загрузка упражнений из NocoDB
├── rules/
│   ├── slot-body-focus.js      # Приоритеты body_focus по слотам
│   ├── goal-fallbacks.js       # Fallback-цепочки для primary_goal
│   ├── level-progression.js    # Прогрессия уровней по неделям
│   ├── space-equipment-maps.js # Маппинг space/equipment из Tally
│   └── contra-filters.js       # Фильтрация по contraindications
├── Dockerfile
└── package.json
```
