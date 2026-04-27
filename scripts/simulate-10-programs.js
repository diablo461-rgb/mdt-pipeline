'use strict';

const crypto = require('crypto');
const { execSync } = require('child_process');

const PROGRAM_BASE_URL = process.env.PROGRAM_BASE_URL || 'http://localhost:3002';
const PDF_BASE_URL = process.env.PDF_BASE_URL || 'http://localhost:3001';
const ROOT = '/Users/aleksejkazakov/mdt-pipeline';

const GOAL_MAP = {
  'Energize & Refocus': 'energy',
  'De-Stress & Reset': 'destress',
  'Posture & Mobility Flow': 'posture',
  'Stay Fit & Active': 'active',
  'Core & Balance': 'core',
  'Energize / refocus (mornings, post-flight fatigue)': 'energy',
  'De-Stress / reset (calm, unwind after long days)': 'destress',
  'Posture / mobility (counter long hours of sitting)': 'posture',
  'Stay fit / active (keep strength and movement)': 'active',
  'Core / balance (control and coordination)': 'core',
};
const SPACE_MAP = {
  Indoor: 'indoor',
  Outdoors: 'outdoors',
  'Mixed environment': 'mixed',
  Mixed: 'mixed',
  'Indoors (hotel room, Airbnb, apartment)': 'indoor',
  'Outdoors (park, beach, rooftop, terrace)': 'outdoors',
  'Mixed environments (varies day to day)': 'mixed',
};
const EQUIP_MAP = {
  'Bodyweight only': 'none',
  'Bodyweight + everyday items': 'everyday_items',
  'Bodyweight + Everyday Items': 'everyday_items',
  'Bodyweight + items (backpack, bottles of water)': 'everyday_items',
};
const LEVEL_MAP = {
  Beginner: 'beginner',
  Intermediate: 'intermediate',
  Advanced: 'advanced',
  'Intermediate (active, but inconsistent)': 'intermediate',
  'Beginner (just starting out)': 'beginner',
  'Beginner (new, returning to exercise)': 'beginner',
  'Advanced (very consistent)': 'advanced',
  'Advanced (comfortable with higher intensity)': 'advanced',
};
const CONTRA_MAP = {
  'Low Back': 'low_back_pain',
  'Low back sensitivity': 'low_back_pain',
  Knees: 'knee_pain',
  'Knee sensitivity': 'knee_pain',
  Shoulders: 'shoulders_pain',
  'Shoulders sensitivity': 'shoulders_pain',
  'High Stress': 'stress',
  'High Stress / fatigue': 'stress',
  'High stress / feeling fatigued': 'stress',
  'None, feeling good': null,
  "None, I'm feeling good": null,
  None: null,
};
const SLEEP_MAP = {
  'Less than 5 hours': 'very_low',
  'Under 5 hours': 'very_low',
  '5 hours': 'very_low',
  '6\u20137 hours': 'normal',
  '6–7 hours': 'normal',
  'More than 8 hours': 'high',
  '8+ hours': 'high',
  '8 or more': 'high',
};
const MOVEMENT_MAP = {
  Cardio: 'cardio',
  Resistance: 'resistance',
  'Resistance / strength (weights, bodyweights)': 'resistance',
  'Yoga / Pilates': 'mobility',
  'Yoga/Pilates': 'mobility',
  'Yoga / pilates / dance': 'mobility',
  Mixed: 'mix',
  'Balanced routine': 'mix',
  'Balanced mix': 'mix',
  'Cardio-based': 'cardio',
  'Cardio-based (running, cycling, swimming)': 'cardio',
  'Resistance / strength': 'resistance',
};
const CYCLE_MAP = {
  'Menstrual phase': 'menstrual',
  'Follicular phase': 'follicular',
  'Ovulatory phase': 'ovulatory',
  'Luteal phase': 'luteal',
  'Not applicable': 'none',
  'Not sure / Prefer not to say / Skip': 'none',
};

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSql(sql) {
  const cmd = `cd ${sqlLiteral(ROOT)} && docker compose exec -T postgres psql -U mdt_user -d mdt_db -t -A`;
  return execSync(cmd, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function normalizeSurveyToProfile(s) {
  const rawAreas = Array.isArray(s.mindfulAreas)
    ? s.mindfulAreas
    : s.mindfulAreas
      ? [s.mindfulAreas]
      : [];

  return {
    primary_goal: GOAL_MAP[s.focus] || s.focus || null,
    space: SPACE_MAP[s.trainingEnvironment] || String(s.trainingEnvironment || '').toLowerCase() || null,
    equipment: EQUIP_MAP[s.trainingImplementation] || String(s.trainingImplementation || '').toLowerCase() || null,
    level: LEVEL_MAP[s.activityLevel] || String(s.activityLevel || '').toLowerCase() || 'beginner',
    movement_type: MOVEMENT_MAP[s.activityType] || String(s.activityType || '').toLowerCase() || null,
    sleep_bucket: SLEEP_MAP[s.sleepAmount] || 'normal',
    sex: String(s.gender || '').toLowerCase() || 'undisclosed',
    cycle_phase: CYCLE_MAP[s.cyclePhase] || 'none',
    contraindications: rawAreas.map(a => CONTRA_MAP[a] ?? null).filter(Boolean),
    lifestyle: String(s.travelLifestyle || '').toLowerCase().replace(/\s+/g, '_') || null,
    age_group: String(s.ageGroup || '').toLowerCase().replace(/\s+/g, '_') || null,
  };
}

function validateProgramPlan(plan) {
  const weeks = ['week_1', 'week_2', 'week_3', 'week_4'];
  const slots = ['morning', 'midday', 'afternoon', 'evening'];
  for (const week of weeks) {
    if (!plan || !plan[week]) return false;
    for (const slot of slots) {
      if (!plan[week][slot]) return false;
      if (!Object.prototype.hasOwnProperty.call(plan[week][slot], 'warmup')) return false;
      if (!Object.prototype.hasOwnProperty.call(plan[week][slot], 'main')) return false;
    }
  }
  return true;
}

function hashPlan(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

function makeSurveyResponses() {
  const stamp = Date.now();
  return [
    { focus: 'Energize & Refocus', trainingEnvironment: 'Indoor', trainingImplementation: 'Bodyweight only', activityLevel: 'Beginner', activityType: 'Balanced routine', sleepAmount: '6-7 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'None', travelLifestyle: 'Frequent traveler', ageGroup: '25-34' },
    { focus: 'De-Stress & Reset', trainingEnvironment: 'Outdoors', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Intermediate', activityType: 'Yoga / Pilates', sleepAmount: 'Less than 5 hours', gender: 'female', cyclePhase: 'Luteal phase', mindfulAreas: 'High Stress', travelLifestyle: 'Remote worker', ageGroup: '35-44' },
    { focus: 'Posture & Mobility Flow', trainingEnvironment: 'Mixed environment', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Advanced', activityType: 'Resistance / strength', sleepAmount: '8+ hours', gender: 'female', cyclePhase: 'Follicular phase', mindfulAreas: 'Shoulders sensitivity', travelLifestyle: 'Office', ageGroup: '45-54' },
    { focus: 'Stay Fit & Active', trainingEnvironment: 'Indoor', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Intermediate', activityType: 'Cardio-based', sleepAmount: '6-7 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'Knee sensitivity', travelLifestyle: 'Hybrid', ageGroup: '18-24' },
    { focus: 'Core & Balance', trainingEnvironment: 'Outdoors', trainingImplementation: 'Bodyweight only', activityLevel: 'Beginner', activityType: 'Yoga/Pilates', sleepAmount: 'Under 5 hours', gender: 'female', cyclePhase: 'Menstrual phase', mindfulAreas: 'Low back sensitivity', travelLifestyle: 'Traveler', ageGroup: '55-64' },
    { focus: 'Energize / refocus (mornings, post-flight fatigue)', trainingEnvironment: 'Indoors (hotel room, Airbnb, apartment)', trainingImplementation: 'Bodyweight + items (backpack, bottles of water)', activityLevel: 'Beginner (new, returning to exercise)', activityType: 'Cardio-based (running, cycling, swimming)', sleepAmount: '5 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: "None, I'm feeling good", travelLifestyle: 'Business', ageGroup: '25-34' },
    { focus: 'De-Stress / reset (calm, unwind after long days)', trainingEnvironment: 'Mixed environments (varies day to day)', trainingImplementation: 'Bodyweight + Everyday Items', activityLevel: 'Intermediate (active, but inconsistent)', activityType: 'Yoga / pilates / dance', sleepAmount: '6\u20137 hours', gender: 'female', cyclePhase: 'Ovulatory phase', mindfulAreas: 'High stress / feeling fatigued', travelLifestyle: 'Freelancer', ageGroup: '35-44' },
    { focus: 'Posture / mobility (counter long hours of sitting)', trainingEnvironment: 'Outdoors (park, beach, rooftop, terrace)', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Advanced (very consistent)', activityType: 'Resistance / strength (weights, bodyweights)', sleepAmount: 'More than 8 hours', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'Shoulders', travelLifestyle: 'Desk job', ageGroup: '45-54' },
    { focus: 'Stay fit / active (keep strength and movement)', trainingEnvironment: 'Mixed', trainingImplementation: 'Bodyweight only', activityLevel: 'Advanced (comfortable with higher intensity)', activityType: 'Resistance', sleepAmount: '8 or more', gender: 'male', cyclePhase: 'Not applicable', mindfulAreas: 'None, feeling good', travelLifestyle: 'Coach', ageGroup: '25-34' },
    { focus: 'Core / balance (control and coordination)', trainingEnvironment: 'Indoor', trainingImplementation: 'Bodyweight + everyday items', activityLevel: 'Beginner (just starting out)', activityType: 'Mixed', sleepAmount: '6-7 hours', gender: 'female', cyclePhase: 'Luteal phase', mindfulAreas: 'Knees', travelLifestyle: 'Student', ageGroup: '18-24' },
  ].map((x, i) => ({
    ...x,
    name: `Survey Test ${i + 1}`,
    email: `surveytest+${stamp}_${i + 1}@example.com`,
  }));
}

async function main() {
  const survey = makeSurveyResponses();

  const programHealth = await fetch(`${PROGRAM_BASE_URL}/health`);
  const pdfHealth = await fetch(`${PDF_BASE_URL}/health`);
  if (!programHealth.ok) throw new Error(`program-service health failed: ${programHealth.status}`);
  if (!pdfHealth.ok) throw new Error(`pdf-service health failed: ${pdfHealth.status}`);

  const planHashes = new Set();
  let leadsSaved = 0;
  let plansSaved = 0;
  let plansValid = 0;
  let pdfOk = 0;

  for (let i = 0; i < survey.length; i++) {
    const s = survey[i];
    const userProfile = normalizeSurveyToProfile(s);

    const leadInsertSql = `
INSERT INTO leads (name, email, status, tally_payload, user_profile)
VALUES (
  ${sqlLiteral(s.name)},
  ${sqlLiteral(s.email)},
  'new',
  ${sqlLiteral(JSON.stringify({ survey: s }))}::jsonb,
  ${sqlLiteral(JSON.stringify(userProfile))}::jsonb
)
ON CONFLICT (email) DO UPDATE SET
  updated_at = NOW(),
  name = EXCLUDED.name,
  tally_payload = EXCLUDED.tally_payload,
  user_profile = EXCLUDED.user_profile
RETURNING id;
`;
    const leadId = runSql(leadInsertSql);
    if (leadId) leadsSaved += 1;

    const gen = await postJson(`${PROGRAM_BASE_URL}/generate-program`, {
      email: s.email,
      user_profile: userProfile,
    });
    if (!gen.ok) {
      throw new Error(`program generation failed for ${s.email}: ${gen.status} ${JSON.stringify(gen.json)}`);
    }

    const programPlan = gen.json.program_plan || {};
    if (validateProgramPlan(programPlan)) plansValid += 1;
    planHashes.add(hashPlan(programPlan));

    const savePlanSql = `
UPDATE leads
SET
  status = 'paid',
  program_plan = ${sqlLiteral(JSON.stringify(programPlan))}::jsonb,
  payment_date = NOW(),
  paid_amount = 99,
  paddle_transaction_id = ${sqlLiteral(`txn_sim_${i + 1}`)},
  week1_sent_at = NOW(),
  updated_at = NOW()
WHERE email = ${sqlLiteral(s.email)};

INSERT INTO payment_events (event_id, event_type, lead_id, email, transaction_id, raw_payload)
SELECT
  ${sqlLiteral(`evt_sim_${Date.now()}_${i + 1}`)},
  'transaction.completed',
  id,
  email,
  ${sqlLiteral(`txn_sim_${i + 1}`)},
  ${sqlLiteral(JSON.stringify({ simulated: true, email: s.email }))}::jsonb
FROM leads
WHERE email = ${sqlLiteral(s.email)}
ON CONFLICT (event_id) DO NOTHING;
`;
    runSql(savePlanSql);
    plansSaved += 1;

    const pdf = await postJson(`${PDF_BASE_URL}/generate-pdf`, {
      name: s.name,
      week_number: 1,
      week_plan: programPlan.week_1,
      profile: userProfile,
      calendar_url: '',
    });
    if (pdf.ok && String(pdf.json.pdf || '').startsWith('JVBERi0')) {
      pdfOk += 1;
    }
  }

  const emails = survey.map(x => sqlLiteral(x.email)).join(', ');
  const checkSql = `
SELECT COUNT(*)::int
FROM leads
WHERE email = ANY(ARRAY[${emails}]::text[])
  AND status = 'paid'
  AND program_plan IS NOT NULL;
`;
  const paidWithPlan = Number(runSql(checkSql) || 0);

  console.log('=== Simulation Result ===');
  console.log(`Leads inserted/updated:        ${leadsSaved}/10`);
  console.log(`Program plans saved to leads:  ${plansSaved}/10`);
  console.log(`Program plan contract valid:   ${plansValid}/10`);
  console.log(`Unique program plans (hashes): ${planHashes.size}/10`);
  console.log(`Rows paid+program_plan in DB:  ${paidWithPlan}/10`);
  console.log(`PDF generated (base64 %PDF):   ${pdfOk}/10`);
  console.log('Emails:');
  for (const s of survey) console.log(`- ${s.email}`);

  if (leadsSaved !== 10 || plansSaved !== 10 || plansValid !== 10 || paidWithPlan !== 10 || pdfOk !== 10) {
    process.exitCode = 2;
  }
}

main().catch(err => {
  console.error('Simulation failed:', err.message);
  process.exit(1);
});

