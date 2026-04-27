'use strict';

const express = require('express');
const { fetchAllExercises } = require('./nocodb');
const { buildProgramPlan }  = require('./planner');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(express.json({ limit: '2mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'mdt-program-service' })
);

// ─── Generate program plan ────────────────────────────────────────────────────
/**
 * POST /generate-program
 * Body: { user_profile: object, email?: string }
 *
 * Returns: { program_plan: { week_1, week_2, week_3, week_4 } }
 *
 * Each week: { morning, midday, afternoon, evening }
 * Each slot: { warmup: Exercise|null, main: Exercise|null }
 * Exercise fields: ex_id, name, description, body_focus, level, intensity,
 *                  movement_type, primary_goal, image_url, cues
 */
app.post('/generate-program', async (req, res) => {
  const { user_profile, email } = req.body;

  if (!user_profile || typeof user_profile !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid user_profile' });
  }

  try {
    const exercises   = await fetchAllExercises();
    const programPlan = buildProgramPlan(user_profile, exercises);

    // Validate the contract
    const WEEKS    = ['week_1', 'week_2', 'week_3', 'week_4'];
    const SESSIONS = ['morning', 'midday', 'afternoon', 'evening'];
    for (const wk of WEEKS) {
      if (!programPlan[wk]) {
        return res.status(500).json({ error: `program_plan missing ${wk}` });
      }
      for (const sl of SESSIONS) {
        if (!programPlan[wk][sl]) {
          return res.status(500).json({ error: `program_plan.${wk} missing slot ${sl}` });
        }
      }
    }

    res.json({ program_plan: programPlan, email: email || null });
  } catch (err) {
    console.error('[generate-program] error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`mdt-program-service listening on :${PORT}`)
);
