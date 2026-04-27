'use strict';

const slotBodyFocus = require('./rules/slot-body-focus');
const goalFallbacks = require('./rules/goal-fallbacks');
const levelProgression = require('./rules/level-progression');
const { spaceMap, equipMap } = require('./rules/space-equipment-maps');
const { painKeywords, shouldExcludeHighIntensity } = require('./rules/contra-filters');

const SESSIONS = ['morning', 'midday', 'afternoon', 'evening'];

const MOVEMENT_TYPE_NORM = {
  resistance: 'strength',
  'resistance / strength': 'strength',
  'balanced routine': 'mix',
  mix: 'mix',
  'cardio-based': 'cardio',
  'yoga / pilates': 'mobility',
  'yoga / pilates / dance': 'mobility',
  'yoga/pilates': 'mobility',
};

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function mapExerciseImage(ex) {
  return ex.image_url || ex.imageUrl || ex.image || ex.photo_url || ex.photoUrl || '';
}

/**
 * Build a 4-week program_plan from lead profile and NocoDB exercise pool.
 * @param {object} profile
 * @param {object[]} allExercises
 * @returns {object}
 */
function buildProgramPlan(profile, allExercises) {
  const userMovType = MOVEMENT_TYPE_NORM[profile.movement_type] || profile.movement_type;

  const allowedSpaces = spaceMap[profile.space] || ['all'];
  const allowedEquip = equipMap[profile.equipment] || ['none'];
  const weekLevels = levelProgression[profile.level] || levelProgression.beginner;
  const bodyFocusRules = slotBodyFocus[profile.primary_goal]
    || [['full_body'], ['full_body'], ['full_body'], ['full_body']];
  const goalFallbackList = goalFallbacks[profile.primary_goal] || [profile.primary_goal];
  const excludeHighIntensity = shouldExcludeHighIntensity(profile);

  const activePainKeywords = (profile.contraindications || [])
    .filter(c => c !== 'stress')
    .map(c => painKeywords[c] || c.replace(/_/g, ' '));

  function matchesContra(ex) {
    if (activePainKeywords.length === 0) return true;
    if (!ex.contraindications) return true;
    const exContra = ex.contraindications.toLowerCase();
    return !activePainKeywords.some(k => exContra.includes(k));
  }

  function baseFilter(ex, goal, weekLevel) {
    if (ex.primary_goal !== goal) return false;
    if (!allowedSpaces.includes(ex.space)) return false;
    if (!allowedEquip.includes(ex.equipment)) return false;
    if (!weekLevel.includes(ex.level)) return false;
    if (!matchesContra(ex)) return false;
    if (excludeHighIntensity && ex.intensity === 'high') return false;
    return true;
  }

  function getWarmupPool() {
    return allExercises.filter(ex => {
      if (ex.primary_goal !== 'warmup') return false;
      if (!allowedSpaces.includes(ex.space)) return false;
      if (!allowedEquip.includes(ex.equipment)) return false;
      if (!matchesContra(ex)) return false;
      if (excludeHighIntensity && ex.intensity === 'high') return false;
      return true;
    });
  }

  function getMainPool(goal, weekLevel, minCount = 4) {
    if (userMovType && userMovType !== 'mix') {
      const withType = allExercises.filter(ex => {
        if (!baseFilter(ex, goal, weekLevel)) return false;
        const exTypes = (ex.movement_type || '').split(',').map(s => s.trim());
        return exTypes.includes(userMovType);
      });
      if (withType.length >= minCount) return withType;
    }
    return allExercises.filter(ex => baseFilter(ex, goal, weekLevel));
  }

  const globalUsedMainIds = new Set();
  const warmupPool = getWarmupPool();
  const plan = {};

  for (let w = 0; w < 4; w++) {
    const weekNum = w + 1;
    const weekLevel = weekLevels[w];

    let mainPool = [];
    for (const goal of goalFallbackList) {
      const pool = getMainPool(goal, weekLevel);
      const fresh = pool.filter(e => !mainPool.find(m => m.ex_id === e.ex_id));
      mainPool = [...mainPool, ...fresh];
      if (mainPool.length >= 4) break;
    }

    const freshMain = mainPool.filter(e => !globalUsedMainIds.has(e.ex_id));
    const effectiveMain = freshMain.length >= 4 ? freshMain : mainPool;

    const weekUsedWarmupIds = new Set();
    const weekUsedMainIds = new Set();
    const weekPlan = {};

    for (let s = 0; s < 4; s++) {
      const warmupCandidates = warmupPool.filter(e => !weekUsedWarmupIds.has(e.ex_id));
      const wu = pickRandom(warmupCandidates.length > 0 ? warmupCandidates : warmupPool);
      if (wu) weekUsedWarmupIds.add(wu.ex_id);

      const slotFocus = bodyFocusRules[s];
      let mainCandidates = effectiveMain.filter(e =>
        !weekUsedMainIds.has(e.ex_id) && slotFocus.includes(e.body_focus)
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
        warmup: wu ? {
          ex_id: wu.ex_id,
          name: wu.name,
          description: wu.description,
          body_focus: wu.body_focus,
          level: wu.level,
          intensity: wu.intensity,
          movement_type: wu.movement_type,
          image_url: mapExerciseImage(wu),
          cues: wu.cues,
        } : null,
        main: mx ? {
          ex_id: mx.ex_id,
          name: mx.name,
          description: mx.description,
          body_focus: mx.body_focus,
          level: mx.level,
          intensity: mx.intensity,
          movement_type: mx.movement_type,
          primary_goal: mx.primary_goal,
          image_url: mapExerciseImage(mx),
          cues: mx.cues,
        } : null,
      };
    }

    plan[`week_${weekNum}`] = weekPlan;
  }

  return plan;
}

module.exports = { buildProgramPlan };

