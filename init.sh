#!/bin/bash
set -e

# Создаём n8n_db (CREATE DATABASE нельзя в транзакции — только через psql/createdb)
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE n8n_db;" 2>/dev/null || echo "n8n_db already exists, skipping"

# Создаём схему в mdt_db
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" << 'SQL'

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

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_payment_date ON leads(payment_date);

SQL
