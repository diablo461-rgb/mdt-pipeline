-- Схема БД для MDT Pipeline

-- Создаем отдельную базу для n8n, чтобы n8n хранит свои таблицы отдельно от бизнес-данных
DO
$$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n_db') THEN
        CREATE DATABASE n8n_db;
    END IF;
END
$$;

-- Таблица для лидов из Tally
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'new',
    tally_payload JSONB,
    user_profile JSONB,
    program_plan JSONB,
    paddle_transaction_id VARCHAR(255),
    paddle_customer_id VARCHAR(255),
    paid_amount DECIMAL(10,2),
    payment_date TIMESTAMP,
    week1_sent_at TIMESTAMP,
    week2_sent_at TIMESTAMP,
    week3_sent_at TIMESTAMP,
    week4_sent_at TIMESTAMP
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_payment_date ON leads(payment_date);