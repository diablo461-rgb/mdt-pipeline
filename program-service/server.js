'use strict';

const express = require('express');
const { fetchAllExercises } = require('./nocodb');
const { buildProgramPlan } = require('./planner');

const app = express();
const PORT = process.env.PORT || 3002;
const NOCODB_TABLE_ID = process.env.NOCODB_TABLE_ID || '';

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'mdt-program-service' }));

app.post('/generate-program', async (req, res) => {
  try {
    const profile = normalizeUserProfile(req.body.user_profile ?? {});
    const allExercises = await fetchAllExercises(NOCODB_TABLE_ID);
    const program_plan = buildProgramPlan(profile, allExercises);

    validateProgramPlan(program_plan);

    return res.json({ program_plan });
  } catch (err) {
    console.error('[generate-program] error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`mdt-program-service listening on :${PORT}`));

function normalizeUserProfile(userProfile) {
  if (userProfile == null) return {};
  if (userProfile && typeof userProfile === 'object') return userProfile;
  if (typeof userProfile === 'string' && userProfile.trim()) {
    const parsed = JSON.parse(userProfile);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  return {};
}

function validateProgramPlan(plan) {
  const WEEKS = ['week_1', 'week_2', 'week_3', 'week_4'];
  const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];
  const EX_KEYS = ['name', 'description', 'image_url', 'cues'];

  for (const week of WEEKS) {
    if (!plan[week]) throw new Error(`program_plan missing key: ${week}`);
    for (const slot of SLOTS) {
      if (!plan[week][slot]) throw new Error(`${week} missing slot: ${slot}`);
      for (const role of ['warmup', 'main']) {
        const ex = plan[week][slot][role];
        if (ex === null) continue;
        if (typeof ex !== 'object') throw new Error(`${week}.${slot}.${role} must be object or null`);
        for (const key of EX_KEYS) {
          if (typeof ex[key] !== 'string') {
            throw new Error(`${week}.${slot}.${role}.${key} must be string, got ${typeof ex[key]}`);
          }
        }
      }
    }
  }
}

