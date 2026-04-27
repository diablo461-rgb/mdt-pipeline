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

INSERT INTO email_templates (template_key, subject, html, is_active)
VALUES
  (
    'week_1',
    'MicroDosing Training Plan is Ready - Start Here',
    '<div><p>Hi {{name}},</p><p>Your 30-day MicroDosing Training plan is ready.</p><p>Before you open it, one thing to know:</p><p>This is not a typical workout program. It is a personal movement system designed to fit directly into your day, helping you improve both mental clarity and how your body feels.</p><p>Your plan is divided into 4 weeks.</p><p>Each week builds on the previous one.</p><p>Inside your Week 1 plan, everything is designed to be frictionless and easy to follow.</p><p>Your only job this week:</p><p>- Start</p><p>- Follow the prompts</p><p>- Do not overthink it</p><p>The goal is simple: build movement into your day without disrupting your life.</p><p>- Open your Week 1 plan (PDF)</p><p>- <a href="{{calendar_url}}">Add Week 1 to your calendar (optional)</a></p><p>- Do your first session now</p><p>Motivation fades. Structure does not. That is the point.</p><p>We have already built it for you.</p><p>Your Week 2 MicroDosing Training plan will arrive in 7 days.</p><p>Archie and Elizabeth</p></div>',
    TRUE
  ),
  (
    'week_2',
    'MicroDosing Training Plan - Week 2: Keep It Going',
    '<div><p>Hi {{name}},</p><p>Welcome to Week 2.</p><p>You have already done the hardest part - you started. Now the focus shifts.</p><p>Same system with slightly new exercises. Less thinking. More automatic movement.</p><p>At this stage, you may notice:</p><p>- It is easier to begin each session</p><p>- Transitions feel smoother</p><p>- Your body responds faster</p><p>That is exactly what we want.</p><p>This week is about strengthening the habit while gradually building on it.</p><p>- Open your Week 2 plan (PDF)</p><p>- <a href="{{calendar_url}}">Add Week 2 to your calendar (optional)</a></p><p>- Do your next session within the next 2 hours</p><p>Let the system run in the background of your day.</p><p>Your Week 3 MicroDosing Training plan will arrive in 7 days.</p><p>Archie and Elizabeth</p></div>',
    TRUE
  ),
  (
    'week_3',
    'MicroDosing Training Plan - Week 3: You''re Adapting',
    '<div><p>Hi {{name}},</p><p>Welcome to Week 3.</p><p>At this point, something starts to change.</p><p>Your body is no longer reacting to movement - it is beginning to expect it.</p><p>With repeated daily micro-sessions, you are maintaining:</p><p>- Circulation</p><p>- Muscle activation</p><p>- Energy regulation throughout the day</p><p>That is why even short sessions create real difference.</p><p>This week introduces subtle progression:</p><p>- More control</p><p>- Slightly longer effort</p><p>- Better coordination</p><p>You may notice:</p><p>- Less stiffness during the day</p><p>- Smoother, more natural movement</p><p>- Faster recovery between sessions</p><p>Focus on quality. Stay relaxed. Move with control.</p><p>- Open your Week 3 plan (PDF)</p><p>- <a href="{{calendar_url}}">Add Week 3 to your calendar (optional)</a></p><p>- Notice one moment today where you move without thinking</p><p>This is where the system starts working for you.</p><p>Your Week 4 MicroDosing Training plan will arrive in 7 days.</p><p>Archie and Elizabeth</p></div>',
    TRUE
  ),
  (
    'week_4',
    'MicroDosing Training Plan - Week 4: This Is Your Rhythm',
    '<div><p>Hi {{name}},</p><p>Welcome to Week 4.</p><p>You are no longer starting.</p><p>You are no longer adjusting.</p><p>You are using it.</p><p>At this stage, MicroDosing Training is not something you fit into your day - it becomes something that supports your day.</p><p>You have already built:</p><p>- Consistency</p><p>- Movement awareness</p><p>- The ability to reset your body anytime</p><p>This week is about integration.</p><p>Move without overthinking.</p><p>Use your environment.</p><p>Let the sessions feel natural, not scheduled.</p><p>You may notice:</p><p>- You move more without planning it</p><p>- Your body resets faster during the day</p><p>- Less buildup of stiffness and fatigue</p><p>- Open your Week 4 plan (PDF)</p><p>- <a href="{{calendar_url}}">Add Week 4 to your calendar (optional)</a></p><p>- Keep one MDT session as a permanent daily anchor</p><p>This is your final week of the 30-day plan.</p><p>Stay with the rhythm you have built.</p><p>Archie and Elizabeth</p></div>',
    TRUE
  ),
  (
    'upsell_day_30',
    'Congrats, You Completed MDT Level 1. What''s Next?',
    '<div><p>Hi {{name}},</p><p>You did it - you completed your 30-day MicroDosing Training plan.</p><p>Take a moment to recognize that.</p><p>Because this was not just about workouts.</p><p>You changed how your day works. You created consistency.</p><p><strong>You focused on {{goal}} - and now you are ready for the next step.</strong></p><p>Right now, you have two options:</p><p>- Stop here and slowly lose the rhythm you built</p><p>- Continue and turn this into a long-term advantage</p><p>Because what you have built is not finished. It is just getting started.</p><p>So we prepared your next step.</p><p>Level 2 is not a repeat.</p><p>It builds on your progress with new movement patterns and a more adaptive structure, so you keep improving without adding complexity.</p><p><a href="{{level2_offer_url}}">Continue to Level 2 and keep building &gt;&gt;&gt;</a></p><p>You have already done the hard part.</p><p>Now it is about not losing it.</p><p>Archie and Elizabeth</p></div>',
    TRUE
  )
ON CONFLICT (template_key) DO UPDATE
SET
  subject = EXCLUDED.subject,
  html = EXCLUDED.html,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

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

SQL
