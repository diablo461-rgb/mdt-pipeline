'use strict';

const express = require('express');
const { fetchAllExercises } = require('./nocodb');
const { buildProgramPlan } = require('./planner');

const app = express();

const PORT = process.env.PORT || 3002;
const NOCODB_TABLE_ID = process.env.NOCODB_TABLE_ID || '';
const STRICT_WARMUP_UNIQUENESS = process.env.STRICT_WARMUP_UNIQUENESS !== 'false';

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  return res.json({ ok: true, service: 'mdt-program-service' });
});

app.post('/generate-program', async (req, res) => {
  try {
    const requests = normalizeGenerateProgramRequests(req.body);

    if (requests.length === 0) {
      return res.status(400).json({
        error: 'Request body must be an object or an array of objects',
      });
    }

    const allExercises = await fetchAllExercises(NOCODB_TABLE_ID);

    const results = requests.map(item => {
      const profile = normalizeUserProfile(item.user_profile);
      const program_plan = buildProgramPlan(profile, allExercises);

      validateProgramPlan(program_plan);

      return {
        ...item,
        user_profile: profile,
        program_plan,
      };
    });

    return res.json(Array.isArray(req.body) ? results : results[0]);
  } catch (err) {
    console.error('[generate-program] error:', err.message, err.stack);

    return res.status(500).json({
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`mdt-program-service listening on :${PORT}`);
});

function normalizeGenerateProgramRequests(body) {
  if (Array.isArray(body)) {
    return body.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  }

  if (body && typeof body === 'object') {
    return [body];
  }

  return [];
}

function normalizeUserProfile(userProfile) {
  if (userProfile == null) {
    return {};
  }

  if (Array.isArray(userProfile)) {
    const first = userProfile.find(item => item && typeof item === 'object' && !Array.isArray(item));
    return first || {};
  }

  if (typeof userProfile === 'string' && userProfile.trim()) {
    const parsed = JSON.parse(userProfile);

    if (Array.isArray(parsed)) {
      const first = parsed.find(item => item && typeof item === 'object' && !Array.isArray(item));
      return first || {};
    }

    if (parsed && typeof parsed === 'object') {
      return normalizeProfileObject(parsed);
    }

    return {};
  }

  if (typeof userProfile === 'object') {
    return normalizeProfileObject(userProfile);
  }

  return {};
}

function normalizeProfileObject(profile) {
  return {
    ...profile,
    contraindications: Array.isArray(profile.contraindications)
        ? profile.contraindications
        : [],
  };
}

function validateProgramPlan(plan) {
  const WEEKS = ['week_1', 'week_2', 'week_3', 'week_4'];
  const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];
  const ROLES = ['warmup', 'main'];
  const REQUIRED_STRING_KEYS = ['name', 'description', 'image_url', 'cues'];

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('program_plan must be an object');
  }

  for (const week of WEEKS) {
    const weekPlan = plan[week];

    if (!weekPlan || typeof weekPlan !== 'object' || Array.isArray(weekPlan)) {
      throw new Error(`program_plan missing key: ${week}`);
    }

    const mainIds = new Set();
    const warmupIds = new Set();

    for (const slot of SLOTS) {
      const slotPlan = weekPlan[slot];

      if (!slotPlan || typeof slotPlan !== 'object' || Array.isArray(slotPlan)) {
        throw new Error(`${week} missing slot: ${slot}`);
      }

      for (const role of ROLES) {
        const exercise = slotPlan[role];

        if (exercise === null) {
          if (role === 'main') {
            throw new Error(`${week}.${slot}.main is required`);
          }

          continue;
        }

        validateExerciseShape(exercise, `${week}.${slot}.${role}`, REQUIRED_STRING_KEYS);
      }

      const main = slotPlan.main;
      const mainId = main.ex_id;

      if (mainIds.has(mainId)) {
        throw new Error(`${week}: duplicate main exercise detected: ${mainId}`);
      }

      mainIds.add(mainId);

      const warmup = slotPlan.warmup;

      if (STRICT_WARMUP_UNIQUENESS && warmup) {
        const warmupId = warmup.ex_id;

        if (warmupIds.has(warmupId)) {
          throw new Error(`${week}: duplicate warmup exercise detected: ${warmupId}`);
        }

        warmupIds.add(warmupId);
      }
    }
  }
}

function validateExerciseShape(exercise, path, requiredStringKeys) {
  if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise)) {
    throw new Error(`${path} must be object or null`);
  }

  if (typeof exercise.ex_id !== 'string' || !exercise.ex_id.trim()) {
    throw new Error(`${path}.ex_id must be non-empty string`);
  }

  for (const key of requiredStringKeys) {
    if (typeof exercise[key] !== 'string') {
      throw new Error(`${path}.${key} must be string, got ${typeof exercise[key]}`);
    }
  }
}