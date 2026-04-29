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
ALTER TABLE leads ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

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
    requires_pdf BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS requires_pdf BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_email_templates_key ON email_templates(template_key);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);

INSERT INTO email_templates (template_key, subject, html, requires_pdf, is_active)
VALUES
  (
    'week_1',
    'MicroDosing Training Plan is Ready - Start Here',
    '<div><p>Hi {{Name}},</p><p>Your 30-day MicroDosing Training plan is ready.</p><p>Before you open it, one thing to know:</p><p>This is not a typical workout program. It is a personal movement system designed to fit directly into your day, helping you improve both mental clarity and how your body feels.</p><p>Your plan is divided into 4 weeks.</p><p>Each week builds on the previous one.</p><p>Inside your Week 1 plan, everything is designed to be frictionless and easy to follow.</p><p>Your only job this week:</p><p>&rarr; Start</p><p>&rarr; Follow the prompts</p><p>&rarr; Do not overthink it</p><p>The goal is simple: build movement into your day without disrupting your life.</p><p>&#128073; Open your Week 1 plan (PDF)</p><p>&#128073; <a href="{{calendar_url}}">Add Week 1 to your calendar (optional)</a></p><p>&#128073; Do your first session now</p><p>Motivation fades. Structure does not. That is the point.</p><p>We have already built it for you.</p><p>Your Week 2 MicroDosing Training plan will arrive in 7 days.</p><p>Archie &amp; Elizabeth</p></div>',
    TRUE,
    TRUE
  ),
  (
    'week_2',
    'MicroDosing Training Plan - Week 2: Keep It Going',
    '<div><p>Hi {{Name}},</p><p>Welcome to Week 2.</p><p>You have already done the hardest part - you started. Now the focus shifts.</p><p>Same system with slightly new exercises. Less thinking. More automatic movement.</p><p>At this stage, you may notice:</p><p>&rarr; It is easier to begin each session</p><p>&rarr; Transitions feel smoother</p><p>&rarr; Your body responds faster</p><p>That is exactly what we want.</p><p>This week is about strengthening the habit while gradually building on it.</p><p>&#128073; Open your Week 2 plan (PDF)</p><p>&#128073; <a href="{{calendar_url}}">Add Week 2 to your calendar (optional)</a></p><p>&#128073; Do your next session within the next 2 hours</p><p>Let the system run in the background of your day.</p><p>Your Week 3 MicroDosing Training plan will arrive in 7 days.</p><p>Archie &amp; Elizabeth</p></div>',
    TRUE,
    TRUE
  ),
  (
    'week_3',
    'MicroDosing Training Plan - Week 3: You''re Adapting',
    '<div><p>Hi {{Name}},</p><p>Welcome to Week 3.</p><p>At this point, something starts to change.</p><p>Your body is no longer reacting to movement - it is beginning to expect it.</p><p>With repeated daily micro-sessions, you are maintaining:</p><p>&rarr; Circulation</p><p>&rarr; Muscle activation</p><p>&rarr; Energy regulation throughout the day</p><p>That is why even short sessions create real difference.</p><p>This week introduces subtle progression:</p><p>&rarr; More control</p><p>&rarr; Slightly longer effort</p><p>&rarr; Better coordination</p><p>You may notice:</p><p>&rarr; Less stiffness during the day</p><p>&rarr; Smoother, more natural movement</p><p>&rarr; Faster recovery between sessions</p><p>Focus on quality. Stay relaxed. Move with control.</p><p>&#128073; Open your Week 3 plan (PDF)</p><p>&#128073; <a href="{{calendar_url}}">Add Week 3 to your calendar (optional)</a></p><p>&#128073; Notice one moment today where you move without thinking</p><p>This is where the system starts working for you.</p><p>Your Week 4 MicroDosing Training plan will arrive in 7 days.</p><p>In a few days, we will ask you for a quick check-in. This helps us refine your next plan and make the system work better for you.</p><p>Archie &amp; Elizabeth</p></div>',
    TRUE,
    TRUE
  ),
  (
    'feedback_day_21',
    'MicroDosing Training - Quick check-in (30 sec)',
    '<div><p>Hi {{Name}},</p><p>You are about 3 weeks into your MicroDosing Training system.</p><p>Before you move into your final week, I want to check one thing:</p><p>How is your body responding?</p><p>This takes approximately 30 seconds:</p><p>&#128073; <a href="{{feedback_url}}">Click here for a quick check-in</a></p><p>Your input helps us understand your experience and refine your next plan so it fits you better in real life.</p><p>Stay consistent.</p><p>Archie Kabalkin</p><p>Founder, MDT</p></div>',
    FALSE,
    TRUE
  ),
  (
    'week_4',
    'MicroDosing Training Plan - Week 4: This Is Your Rhythm',
    '<div><p>Hi {{Name}},</p><p>Welcome to Week 4.</p><p>You are no longer starting.</p><p>You are no longer adjusting.</p><p>You are using it.</p><p>At this stage, MicroDosing Training is not something you fit into your day - it becomes something that supports your day.</p><p>You have already built:</p><p>&rarr; Consistency</p><p>&rarr; Movement awareness</p><p>&rarr; The ability to reset your body anytime</p><p>This week is about integration.</p><p>Move without overthinking.</p><p>Use your environment.</p><p>Let the sessions feel natural, not scheduled.</p><p>You may notice:</p><p>&rarr; You move more without planning it</p><p>&rarr; Your body resets faster during the day</p><p>&rarr; Less buildup of stiffness and fatigue</p><p>&#128073; Open your Week 4 plan (PDF)</p><p>&#128073; <a href="{{calendar_url}}">Add Week 4 to your calendar (optional)</a></p><p>&#128073; Keep one MDT session as a permanent daily anchor</p><p>This is your final week of the 30-day plan.</p><p>Stay with the rhythm you have built.</p><p>Archie &amp; Elizabeth</p></div>',
    TRUE,
    TRUE
  ),
  (
    'upsell_day_30',
    'Congrats, You Completed MDT Level 1. What''s Next?',
    '<div><p>Hi {{Name}},</p><p>You did it - you completed your 30-day MicroDosing Training plan.</p><p>Take a moment to recognize that.</p><p>Because this was not just about workouts.</p><p>You changed how your day works. You created consistency.</p><p>You focused on {{goal}} - and now you are ready for the next step.</p><p>Right now, you have two options:</p><p>&rarr; Stop here and slowly lose the rhythm you built</p><p>&rarr; Continue and turn this into a long-term advantage</p><p>Because what you have built is not finished. It is just getting started.</p><p>So we prepared your next step.</p><p>Level 2 is not a repeat.</p><p>It builds on your progress with new movement patterns and a more adaptive structure - so you keep improving without adding complexity.</p><p>&#128073; <a href="{{level2_offer_url}}">Continue to Level 2 and keep building</a></p><p>You have already done the hard part.</p><p>Now it is about not losing it.</p><p>Archie &amp; Elizabeth</p></div>',
    FALSE,
    TRUE
  ),
  (
    'bounce_no_payment_30m',
    'Your MicroDosing Training Plan is almost here',
    '<div><p>Hi {{Name}},</p><p>You were one step away from starting your MicroDosing Training Plan today.</p><p>Your personalized movement system is ready.</p><p>&#128073; <a href="{{checkout_url}}">Complete your setup here</a></p><p>The sooner you start, the sooner your body starts feeling the difference.</p><p>It takes less than a minute.</p><p>Archie &amp; Elizabeth</p></div>',
    FALSE,
    TRUE
  ),
  (
    'bounce_no_payment_24h',
    'MicroDosing Training - try a new approach today!',
    '<div><p>Hi {{Name}},</p><p>Quick clarification before you decide.</p><p>This is not a workout program.</p><p>You do not need 60 minutes a day.</p><p>You do not need motivation.</p><p>You do not need a gym.</p><p>The MicroDosing Training system works differently:</p><p>&rarr; 1-minute sessions</p><p>&rarr; 4-5 times per day</p><p>&rarr; integrated into your schedule</p><p>Instead of finding time to train, you train inside your day.</p><p>That is why it works.</p><p>&#128073; <a href="{{checkout_url}}">Unlock your personalized MDT plan</a></p><p>Archie &amp; Elizabeth</p></div>',
    FALSE,
    TRUE
  ),
  (
    'bounce_no_payment_48h',
    'MicroDosing Training: why 1 minute actually works?',
    '<div><p>Hi {{Name}},</p><p>Most fitness plans fail for one simple reason:</p><p>They do not fit into real life.</p><p>You are expected to block 45-60 minutes, stay consistent, and stay motivated every day.</p><p>But most days do not work like that.</p><p>That is exactly where MicroDosing Training is different.</p><p>Instead of relying on one long session, it fits into your day:</p><p>&rarr; 1 minute at a time</p><p>&rarr; spread throughout your day</p><p>&rarr; no schedule disruption</p><p>It is not about doing more.</p><p>It is about making movement actually sustainable.</p><p>&#128073; <a href="{{checkout_url}}">Start your MicroDosing Training plan</a></p><p>Archie &amp; Elizabeth</p></div>',
    FALSE,
    TRUE
  ),
  (
    'bounce_no_payment_72h',
    'Quick story from Archie, founder of MicroDosing Training',
    '<div><p>Hi {{Name}},</p><p>I noticed you checked out your personalized MicroDosing Training plan, but have not started yet.</p><p>I am Archie, founder of MDT. With 20 years in coaching and a Master''s in Sport Science, I have trained side by side with clients and seen what actually works.</p><p>And here is what most people get wrong about fitness:</p><p>A typical day looks like this:</p><p>- 6-8 hours of sleep</p><p>- 8-12 hours of work</p><p>- 1-2 hours socializing</p><p>- 1-3 hours for errands and family</p><p>- 1-2 hours of rest</p><p>- ~1 hour at the gym</p><p>The pattern is clear: most of our day is spent sitting.</p><p>Here is the hard truth - an hour at the gym cannot undo a full day of inactivity.</p><p>That is exactly why I created MicroDosing Training.</p><p>Instead of relying on a single workout, it keeps your body active throughout the day, improving mobility, circulation, and energy in small, effective doses.</p><p>The longer we stay inactive, the harder it becomes to reverse the effects.</p><p>If you want to understand how it works, you can read more in our MDT blog: <a href="{{mdt_blog_url}}">MDT Blog</a></p><p>Or, if you are ready to feel the difference, unlock your personalized plan:</p><p>&#128073; <a href="{{checkout_url}}">Unlock your MDT plan</a></p><p>To your health,</p><p>Archie Kabalkin, Founder MDT</p></div>',
    FALSE,
    TRUE
  ),
  (
    'bounce_no_payment_96h',
    'Your MicroDosing Training Plan won''t stay available',
    '<div><p>Hi {{Name}},</p><p>Your personalized MicroDosing Training plan is still available, but not indefinitely.</p><p>We generate MDT plans based on your inputs, and they are not stored forever.</p><p>If you want to start, now is the best moment.</p><p>&#128073; <a href="{{checkout_url}}">Complete your setup</a></p><p>After this, your plan may no longer be accessible.</p><p>Archie &amp; Elizabeth</p></div>',
    FALSE,
    TRUE
  ),
  (
    'bounce_no_payment_120h',
    'Final notice: your MDT plan is about to be removed',
    '<div><p>Hi {{Name}},</p><p>This is the last time I will reach out before your personalized MicroDosing Training plan is removed.</p><p>We only keep plans available for a limited time so they stay accurate and relevant.</p><p>You told us your goal is {{goal}}. This plan was built specifically to help you reach it without the friction of a traditional routine.</p><p>One last reminder: you do not need 60 minutes to undo a day of sitting.</p><p>You need consistent 1-minute resets.</p><p>After this, your link will be deactivated.</p><p>&#128073; <a href="{{checkout_url}}">Final access to your MDT plan</a></p><p>Best,</p><p>Archie Kabalkin, Founder MDT</p></div>',
    FALSE,
    TRUE
  )
ON CONFLICT (template_key) DO UPDATE
SET
  subject = EXCLUDED.subject,
  html = EXCLUDED.html,
  requires_pdf = EXCLUDED.requires_pdf,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS email_sequence_jobs (
    id BIGSERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    template_key VARCHAR(100) NOT NULL,
    sequence_key VARCHAR(100) NOT NULL DEFAULT 'level_1_post_payment',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    scheduled_at TIMESTAMP NOT NULL,
    sent_at TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT email_sequence_jobs_status_check CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
    CONSTRAINT uq_email_sequence_jobs_unique_step UNIQUE (lead_id, sequence_key, template_key)
);

CREATE INDEX IF NOT EXISTS idx_email_sequence_jobs_status_scheduled_at
  ON email_sequence_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_sequence_jobs_lead_id
  ON email_sequence_jobs(lead_id);

CREATE OR REPLACE VIEW email_templates_admin AS
SELECT
  id,
  template_key,
  subject,
  html,
  requires_pdf,
  is_active,
  created_at,
  updated_at
FROM email_templates
ORDER BY template_key;

CREATE OR REPLACE FUNCTION upsert_email_template(
  p_template_key VARCHAR,
  p_subject TEXT,
  p_html TEXT,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_requires_pdf BOOLEAN DEFAULT FALSE
)
RETURNS email_templates
LANGUAGE plpgsql
AS $$
DECLARE
  v_row email_templates;
BEGIN
  INSERT INTO email_templates (template_key, subject, html, requires_pdf, is_active, updated_at)
  VALUES (p_template_key, p_subject, p_html, p_requires_pdf, p_is_active, NOW())
  ON CONFLICT (template_key)
  DO UPDATE SET
    subject = EXCLUDED.subject,
    html = EXCLUDED.html,
    requires_pdf = EXCLUDED.requires_pdf,
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
