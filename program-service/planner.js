'use strict';

const { MOVEMENT_TYPE_NORM, SPACE_MAP, EQUIPMENT_MAP } = require('./rules/space-equipment-maps');
const { SLOT_BODY_FOCUS, DEFAULT_BODY_FOCUS } = require('./rules/slot-body-focus');
const { GOAL_FALLBACKS } = require('./rules/goal-fallbacks');
const { LEVEL_PROGRESSION } = require('./rules/level-progression');
const { contraToKeyword, isContraExcluded } = require('./rules/contra-filters');

const SESSIONS = ['morning', 'midday', 'afternoon', 'evening'];

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function normaliseExercise(ex) {
  return {
    ex_id:         ex.ex_id,
    name:          ex.name,
    description:   ex.description,
    body_focus:    ex.body_focus,
    level:         ex.level,
    intensity:     ex.intensity,
    movement_type: ex.movement_type,
    primary_goal:  ex.primary_goal,
    image_url:     ex.image_url || ex.imageUrl || ex.image || ex.photo_url || ex.photoUrl || '',
    cues:          ex.cues,
    space:         ex.space,
    equipment:     ex.equipment,
    contraindications: ex.contraindications,
  };
}

/**
 * Build a personalised 4-week program plan.
 *
 * @param {object} userProfile  - Parsed profile object from leads.user_profile
 * @param {object[]} allExercises - Full exercise list from NocoDB
 * @returns {{ week_1, week_2, week_3, week_4 }}
 */
function buildProgramPlan(userProfile, allExercises) {
  const profile = userProfile || {};

  // ─── Resolve normalised movement type ─────────────────────────────────────
  const userMovType = MOVEMENT_TYPE_NORM[profile.movement_type] || profile.movement_type;

  // ─── Space / equipment filters ────────────────────────────────────────────
  const allowedSpaces = SPACE_MAP[profile.space] || ['all'];
  const allowedEquip  = EQUIPMENT_MAP[profile.equipment] || ['none'];

  // ─── Level progression ────────────────────────────────────────────────────
  const weekLevels = LEVEL_PROGRESSION[profile.level] || LEVEL_PROGRESSION.beginner;

  // ─── Contraindications ────────────────────────────────────────────────────
  const contraPainKeywords = (profile.contraindications || [])
    .map(contraToKeyword)
    .filter(Boolean);

  const excludeHighIntensity =
    (profile.contraindications || []).includes('stress') ||
    profile.sleep_bucket === 'very_low' ||
    (profile.sex === 'female' && ['menstrual', 'luteal'].includes(profile.cycle_phase));

  // ─── Body-focus rules ────────────────────────────────────────────────────
  const bodyFocusRules =
    SLOT_BODY_FOCUS[profile.primary_goal] || DEFAULT_BODY_FOCUS;

  // ─── Goal fallbacks ───────────────────────────────────────────────────────
  const goalFallbacks =
    GOAL_FALLBACKS[profile.primary_goal] || [profile.primary_goal];

  // ─── Filter helpers ───────────────────────────────────────────────────────
  function baseExerciseFilter(ex, { goal, weekLevel, mainOnly }) {
    if (mainOnly && ex.primary_goal !== goal) return false;
    if (!mainOnly && ex.primary_goal !== 'warmup') return false;
    if (!allowedSpaces.includes(ex.space)) return false;
    if (!allowedEquip.includes(ex.equipment)) return false;
    if (mainOnly && !weekLevel.includes(ex.level)) return false;
    if (isContraExcluded(ex, contraPainKeywords)) return false;
    if (excludeHighIntensity && ex.intensity === 'high') return false;
    return true;
  }

  function getWarmupPool() {
    return allExercises.filter(ex =>
      baseExerciseFilter(ex, { goal: 'warmup', weekLevel: [], mainOnly: false })
    );
  }

  function getMainPool(goal, weekLevel, minCount = 4) {
    const opts = { goal, weekLevel, mainOnly: true };

    // Prefer movement-type match when there are enough exercises
    if (userMovType && userMovType !== 'mix') {
      const withType = allExercises.filter(ex => {
        if (!baseExerciseFilter(ex, opts)) return false;
        const exTypes = (ex.movement_type || '').split(',').map(s => s.trim());
        return exTypes.includes(userMovType);
      });
      if (withType.length >= minCount) return withType;
    }

    return allExercises.filter(ex => baseExerciseFilter(ex, opts));
  }

  // ─── Build plan ───────────────────────────────────────────────────────────
  const globalUsedMainIds = new Set();
  const warmupPool = getWarmupPool();
  const plan = {};

  for (let w = 0; w < 4; w++) {
    const weekNum   = w + 1;
    const weekLevel = weekLevels[w];

    // Accumulate main pool with goal fallbacks
    let mainPool = [];
    for (const goal of goalFallbacks) {
      const pool  = getMainPool(goal, weekLevel);
      const fresh = pool.filter(e => !mainPool.find(m => m.ex_id === e.ex_id));
      mainPool = [...mainPool, ...fresh];
      if (mainPool.length >= 4) break;
    }

    const freshMain    = mainPool.filter(e => !globalUsedMainIds.has(e.ex_id));
    const effectiveMain = freshMain.length >= 4 ? freshMain : mainPool;

    const weekUsedWarmupIds = new Set();
    const weekUsedMainIds   = new Set();
    const weekPlan          = {};

    for (let s = 0; s < 4; s++) {
      // Warmup pick
      const warmupCandidates = warmupPool.filter(e => !weekUsedWarmupIds.has(e.ex_id));
      const wu = pickRandom(warmupCandidates.length > 0 ? warmupCandidates : warmupPool);
      if (wu) weekUsedWarmupIds.add(wu.ex_id);

      // Main pick (body-focus preference)
      const slotFocus = bodyFocusRules[s];
      let mainCandidates = effectiveMain.filter(
        e => !weekUsedMainIds.has(e.ex_id) && slotFocus.includes(e.body_focus)
      );
      if (mainCandidates.length === 0) {
        mainCandidates = effectiveMain.filter(e => !weekUsedMainIds.has(e.ex_id));
      }
      if (mainCandidates.length === 0) {
        mainCandidates = mainPool;
      }
      const mx = pickRandom(mainCandidates);
      if (mx) {
        weekUsedMainIds.add(mx.ex_id);
        globalUsedMainIds.add(mx.ex_id);
      }

      weekPlan[SESSIONS[s]] = {
        warmup: wu ? normaliseExercise(wu) : null,
        main:   mx ? normaliseExercise(mx) : null,
      };
    }

    plan[`week_${weekNum}`] = weekPlan;
  }

  return plan;
}

module.exports = { buildProgramPlan };
