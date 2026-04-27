'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

const envFile = loadEnvFile(ENV_PATH);
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';
const PDF_BASE_URL = process.env.PDF_BASE_URL || 'http://localhost:3001';
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || envFile.PADDLE_WEBHOOK_SECRET || '';

if (!PADDLE_WEBHOOK_SECRET) {
  console.error('Missing PADDLE_WEBHOOK_SECRET. Set it in .env or export env var before running.');
  process.exit(1);
}

const FIELD_KEYS = {
  TRAVEL_LIFESTYLE: 'question_y6lBLd',
  AGE_GROUP: 'question_XDepXz',
  TRAINING_ENVIRONMENT: 'question_8KdXOr',
  TRAINING_IMPLEMENTATION: 'question_0xEKXA',
  FOCUS: 'question_zqKklg',
  ACTIVITY_LEVEL: 'question_lyNxQX',
  ACTIVITY_TYPE: 'question_R0zApQ',
  DAILY_SCHEDULE: 'question_oyAqWN',
  SLEEP_AMOUNT: 'question_GzrZWO',
  GENDER: 'question_V0ZKg6',
  CYCLE_ADJUST: 'question_DNr5Nb',
  CYCLE_PHASE: 'question_lyoLy5',
  MINDFUL_AREAS: 'question_P6A7Kx',
  NAME: 'question_R0XR0l',
  EMAIL: 'question_jyBjN1',
};

function field(key, value, type) {
  return { key, label: key, type: type || 'INPUT_TEXT', value };
}

function buildTallyBody(profile) {
  return {
    eventId: `evt_tally_${profile.id}`,
    eventType: 'FORM_RESPONSE',
    createdAt: new Date().toISOString(),
    data: {
      responseId: `resp_${profile.id}`,
      submissionId: `sub_${profile.id}`,
      respondentId: `r_${profile.id}`,
      formId: 'mdt-test-form',
      formName: 'MDT Test Form',
      createdAt: new Date().toISOString(),
      fields: [
        field(FIELD_KEYS.NAME, profile.name),
        field(FIELD_KEYS.EMAIL, profile.email, 'INPUT_EMAIL'),
        field(FIELD_KEYS.FOCUS, profile.focus),
        field(FIELD_KEYS.TRAINING_ENVIRONMENT, profile.trainingEnvironment),
        field(FIELD_KEYS.TRAINING_IMPLEMENTATION, profile.trainingImplementation),
        field(FIELD_KEYS.ACTIVITY_LEVEL, profile.activityLevel),
        field(FIELD_KEYS.ACTIVITY_TYPE, profile.activityType),
        field(FIELD_KEYS.SLEEP_AMOUNT, profile.sleepAmount),
        field(FIELD_KEYS.GENDER, profile.gender),
        field(FIELD_KEYS.CYCLE_PHASE, profile.cyclePhase),
        field(FIELD_KEYS.MINDFUL_AREAS, profile.mindfulAreas),
        field(FIELD_KEYS.TRAVEL_LIFESTYLE, profile.travelLifestyle),
        field(FIELD_KEYS.AGE_GROUP, profile.ageGroup),
        field(FIELD_KEYS.DAILY_SCHEDULE, profile.dailySchedule),
        field(FIELD_KEYS.CYCLE_ADJUST, profile.cycleAdjust),
      ],
    },
  };
}

function buildPaddleEvent(profile, idx) {
  return {
    event_id: `evt_pay_${Date.now()}_${idx}`,
    event_type: 'transaction.completed',
    data: {
      id: `txn_local_${idx}`,
      status: 'paid',
      customer: { email: profile.email },
      customer_id: `cus_local_${idx}`,
      details: { totals: { total: 9900 } },
      billed_at: new Date().toISOString(),
      custom_data: { email: profile.email },
    },
  };
}

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function queryRowsByEmails(emails) {
  const emailArray = emails.map(sqlLiteral).join(', ');
  const sql = `
SELECT row_to_json(t)::text
FROM (
  SELECT
    l.email,
    l.name,
    l.status,
    l.user_profile,
    l.program_plan,
    (l.week1_sent_at IS NOT NULL) AS week1_sent,
    (
      SELECT COUNT(*)::int
      FROM payment_events pe
      WHERE pe.email = l.email
    ) AS payment_events
  FROM leads l
  WHERE l.email = ANY(ARRAY[${emailArray}]::text[])
  ORDER BY l.email
) t;
`;

  const cmd = `cd ${sqlLiteral(ROOT)} && docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A`;
  const out = execSync(cmd, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const rows = out
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => JSON.parse(s));
  return rows;
}

function validateProgramPlan(plan) {
  const weeks = ['week_1', 'week_2', 'week_3', 'week_4'];
  const slots = ['morning', 'midday', 'afternoon', 'evening'];
  for (const week of weeks) {
    if (!plan || typeof plan !== 'object' || !plan[week]) return false;
    for (const slot of slots) {
      const v = plan[week][slot];
      if (!v || typeof v !== 'object') return false;
      if (!Object.prototype.hasOwnProperty.call(v, 'warmup')) return false;
      if (!Object.prototype.hasOwnProperty.call(v, 'main')) return false;
    }
  }
  return true;
}

function hashPlan(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

async function generatePdfForLead(row) {
  const programPlan = row.program_plan || {};
  const weekPlan = programPlan.week_1 || {};
  const payload = {
    name: row.name || 'there',
    week_number: 1,
    week_plan: weekPlan,
    profile: row.user_profile || {},
    calendar_url: '',
  };
  const res = await postJson(`${PDF_BASE_URL}/generate-pdf`, payload);
  if (!res.ok) return { ok: false, status: res.status, error: res.json };
  const pdf = String(res.json.pdf || '');
  return { ok: pdf.startsWith('JVBERi0'), status: res.status, pdfLen: pdf.length };
}

function makeProfiles() {
  const stamp = Date.now();
  return [
    { focus: 'Energize & Refocus', trainingEnvironment: 'Indoor', trainingImplementation: 'Bodyweight only', activityLevel: 'Beginner', activityType: 'Balanced routine', sleepAmount: '6-7 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'None', travelLifestyle: 'Frequent traveler', ageGroup: '25-34', dailySchedule: 'Morning', cycleAdjust: 'No', },
    { focus: 'De-Stress & Reset', trainingEnvironment: 'Outdoors', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Intermediate', activityType: 'Yoga / Pilates', sleepAmount: 'Less than 5 hours', gender: 'female', cyclePhase: 'Luteal phase', mindfulAreas: 'High Stress', travelLifestyle: 'Remote worker', ageGroup: '35-44', dailySchedule: 'Evening', cycleAdjust: 'Yes', },
    { focus: 'Posture & Mobility Flow', trainingEnvironment: 'Mixed environment', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Advanced', activityType: 'Resistance / strength', sleepAmount: '8+ hours', gender: 'female', cyclePhase: 'Follicular phase', mindfulAreas: 'Shoulders sensitivity', travelLifestyle: 'Office', ageGroup: '45-54', dailySchedule: 'Afternoon', cycleAdjust: 'Yes', },
    { focus: 'Stay Fit & Active', trainingEnvironment: 'Indoor', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Intermediate', activityType: 'Cardio-based', sleepAmount: '6-7 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'Knee sensitivity', travelLifestyle: 'Hybrid', ageGroup: '18-24', dailySchedule: 'Midday', cycleAdjust: 'No', },
    { focus: 'Core & Balance', trainingEnvironment: 'Outdoors', trainingImplementation: 'Bodyweight only', activityLevel: 'Beginner', activityType: 'Yoga/Pilates', sleepAmount: 'Under 5 hours', gender: 'female', cyclePhase: 'Menstrual phase', mindfulAreas: 'Low back sensitivity', travelLifestyle: 'Traveler', ageGroup: '55-64', dailySchedule: 'Morning', cycleAdjust: 'Yes', },
    { focus: 'Energize / refocus (mornings, post-flight fatigue)', trainingEnvironment: 'Indoors (hotel room, Airbnb, apartment)', trainingImplementation: 'Bodyweight + items (backpack, bottles of water)', activityLevel: 'Beginner (new, returning to exercise)', activityType: 'Cardio-based (running, cycling, swimming)', sleepAmount: '5 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'None, I\'m feeling good', travelLifestyle: 'Business', ageGroup: '25-34', dailySchedule: 'Morning', cycleAdjust: 'No', },
    { focus: 'De-Stress / reset (calm, unwind after long days)', trainingEnvironment: 'Mixed environments (varies day to day)', trainingImplementation: 'Bodyweight + Everyday Items', activityLevel: 'Intermediate (active, but inconsistent)', activityType: 'Yoga / pilates / dance', sleepAmount: '6\u20137 hours', gender: 'female', cyclePhase: 'Ovulatory phase', mindfulAreas: 'High stress / feeling fatigued', travelLifestyle: 'Freelancer', ageGroup: '35-44', dailySchedule: 'Evening', cycleAdjust: 'Yes', },
    { focus: 'Posture / mobility (counter long hours of sitting)', trainingEnvironment: 'Outdoors (park, beach, rooftop, terrace)', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Advanced (very consistent)', activityType: 'Resistance / strength (weights, bodyweights)', sleepAmount: 'More than 8 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'Shoulders', travelLifestyle: 'Desk job', ageGroup: '45-54', dailySchedule: 'Midday', cycleAdjust: 'No', },
    { focus: 'Stay fit / active (keep strength and movement)', trainingEnvironment: 'Mixed', trainingImplementation: 'Bodyweight only', activityLevel: 'Advanced (comfortable with higher intensity)', activityType: 'Resistance', sleepAmount: '8 or more', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'None, feeling good', travelLifestyle: 'Coach', ageGroup: '25-34', dailySchedule: 'Afternoon', cycleAdjust: 'No', },
    { focus: 'Core / balance (control and coordination)', trainingEnvironment: 'Indoor', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Beginner (just starting out)', activityType: 'Mixed', sleepAmount: '6-7 hours', gender: 'female', cyclePhase: 'Luteal phase', mindfulAreas: 'Knees', travelLifestyle: 'Student', ageGroup: '18-24', dailySchedule: 'Evening', cycleAdjust: 'Yes', },
  ].map((p, i) => {
    const n = i + 1;
    return {
      ...p,
      id: `${stamp}_${n}`,
      name: `Load Test ${n}`,
      email: `loadtest+${stamp}_${n}@example.com`,
    };
  });
}

async function main() {
  const profiles = makeProfiles();

  const healthN8n = await getJson(`${N8N_BASE_URL}/healthz`);
  const healthPdf = await getJson(`${PDF_BASE_URL}/health`);
  if (!healthN8n.ok) {
    throw new Error(`n8n is not reachable at ${N8N_BASE_URL}/healthz (status ${healthN8n.status})`);
  }
  if (!healthPdf.ok) {
    throw new Error(`pdf-service is not reachable at ${PDF_BASE_URL}/health (status ${healthPdf.status})`);
  }

  console.log('1) Sending 10 simulated Tally submissions...');
  for (const profile of profiles) {
    const tallyPayload = buildTallyBody(profile);
    const res = await postJson(`${N8N_BASE_URL}/webhook/tally-webhook`, tallyPayload);
    if (!res.ok) {
      throw new Error(`Tally webhook failed for ${profile.email}: ${res.status} ${JSON.stringify(res.json)}`);
    }
  }

  console.log('2) Sending 10 simulated Paddle paid events with valid signature...');
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const eventBody = buildPaddleEvent(profile, i + 1);
    const rawBody = JSON.stringify(eventBody);
    const ts = Math.floor(Date.now() / 1000);
    const h1 = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET).update(`${ts}:${rawBody}`).digest('hex');

    const res = await fetch(`${N8N_BASE_URL}/webhook/paddle-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Paddle-Signature': `ts=${ts};h1=${h1}`,
      },
      body: rawBody,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Paddle webhook failed for ${profile.email}: ${res.status} ${text}`);
    }
  }

  console.log('3) Validating rows in leads/payment_events...');
  const rows = queryRowsByEmails(profiles.map(p => p.email));
  if (rows.length !== 10) {
    throw new Error(`Expected 10 leads rows, got ${rows.length}`);
  }

  let okStatus = 0;
  let okPlan = 0;
  let okEvent = 0;
  const planHashes = new Set();

  for (const row of rows) {
    if (row.status === 'paid') okStatus += 1;
    if (validateProgramPlan(row.program_plan)) okPlan += 1;
    if (Number(row.payment_events || 0) > 0) okEvent += 1;
    if (row.program_plan) planHashes.add(hashPlan(row.program_plan));
  }

  console.log('4) Validating PDF generation for each lead via pdf-service...');
  let okPdf = 0;
  for (const row of rows) {
    const pdfRes = await generatePdfForLead(row);
    if (pdfRes.ok) okPdf += 1;
  }

  console.log('\n=== E2E RESULT ===');
  console.log(`Leads found:                 ${rows.length}/10`);
  console.log(`Status paid:                 ${okStatus}/10`);
  console.log(`payment_events present:      ${okEvent}/10`);
  console.log(`program_plan contract valid: ${okPlan}/10`);
  console.log(`Unique program_plan hashes:  ${planHashes.size}/10`);
  console.log(`PDF generated:               ${okPdf}/10`);
  console.log('Emails:');
  for (const p of profiles) console.log(`- ${p.email}`);

  if (okStatus !== 10 || okEvent !== 10 || okPlan !== 10 || okPdf !== 10) {
    process.exitCode = 2;
  }
}

main().catch(err => {
  console.error('E2E test failed:', err.message);
  process.exit(1);
});

