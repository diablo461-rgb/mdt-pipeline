-- Align database schema with n8n workflows.
-- Safe for existing databases: no DROP/TRUNCATE and only additive/idempotent changes.

BEGIN;

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
    checkout_url TEXT,
    paddle_transaction_id VARCHAR(255),
    paddle_customer_id VARCHAR(255),
    paid_amount DECIMAL(10,2),
    payment_date TIMESTAMP,
    week1_sent_at TIMESTAMP,
    week2_sent_at TIMESTAMP,
    week3_sent_at TIMESTAMP,
    week4_sent_at TIMESTAMP,
    next_send_at TIMESTAMP
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'new';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tally_payload JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_profile JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS program_plan JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS paddle_transaction_id VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS paddle_customer_id VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS week1_sent_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS week2_sent_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS week3_sent_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS week4_sent_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_email_key'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_email_key UNIQUE (email);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_payment_date ON leads(payment_date);
CREATE INDEX IF NOT EXISTS idx_leads_next_send_at ON leads(next_send_at);
CREATE INDEX IF NOT EXISTS idx_leads_paddle_transaction_id ON leads(paddle_transaction_id);

CREATE TABLE IF NOT EXISTS payment_events (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) UNIQUE NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    email VARCHAR(255),
    transaction_id VARCHAR(255),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    raw_payload JSONB
);

ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS event_id VARCHAR(255);
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(100);
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS lead_id INTEGER;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255);
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS raw_payload JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_events_event_id_key'
  ) THEN
    ALTER TABLE payment_events ADD CONSTRAINT payment_events_event_id_key UNIQUE (event_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_events_lead_id_fkey'
  ) THEN
    ALTER TABLE payment_events
    ADD CONSTRAINT payment_events_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_payment_events_event_id ON payment_events(event_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_transaction_id ON payment_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_email ON payment_events(email);

CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    template_key VARCHAR(100) UNIQUE NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_templates_key ON email_templates(template_key);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);

CREATE OR REPLACE VIEW email_templates_admin AS
SELECT
  id,
  template_key,
  subject,
  html,
  is_active,
  created_at,
  updated_at
FROM email_templates
ORDER BY template_key;

CREATE OR REPLACE FUNCTION upsert_email_template(
  p_template_key VARCHAR,
  p_subject TEXT,
  p_html TEXT,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS email_templates
LANGUAGE plpgsql
AS $$
DECLARE
  v_row email_templates;
BEGIN
  INSERT INTO email_templates (template_key, subject, html, is_active, updated_at)
  VALUES (p_template_key, p_subject, p_html, p_is_active, NOW())
  ON CONFLICT (template_key)
  DO UPDATE SET
    subject = EXCLUDED.subject,
    html = EXCLUDED.html,
    is_active = EXCLUDED.is_active,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION set_email_template_active(
  p_template_key VARCHAR,
  p_is_active BOOLEAN
)
RETURNS email_templates
LANGUAGE plpgsql
AS $$
DECLARE
  v_row email_templates;
BEGIN
  UPDATE email_templates
  SET is_active = p_is_active,
      updated_at = NOW()
  WHERE template_key = p_template_key
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMIT;
