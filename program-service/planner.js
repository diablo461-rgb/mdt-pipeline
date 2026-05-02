'use strict';

const slotBodyFocus = require('./rules/slot-body-focus');
const goalFallbacks = require('./rules/goal-fallbacks');
const levelProgression = require('./rules/level-progression');
const { spaceMap, equipMap } = require('./rules/space-equipment-maps');
const {
  shouldExcludeHighIntensity,
  getActiveContraindicationAliases,
} = require('./rules/contra-filters');

const SESSIONS = ['morning', 'midday', 'afternoon', 'evening'];
const REQUIRED_MAIN_PER_WEEK = SESSIONS.length;

const MOVEMENT_TYPE_NORM = {
  resistance: 'strength',
  'resistance / strength': 'strength',
  strength: 'strength',
  'balanced routine': 'mix',
  mix: 'mix',
  'cardio-based': 'cardio',
  cardio: 'cardio',
  'yoga / pilates': 'mobility',
  'yoga / pilates / dance': 'mobility',
  'yoga/pilates': 'mobility',
  mobility: 'mobility',
};

const MOVEMENT_TYPE_FALLBACKS = {
  cardio: ['cardio', 'mix', 'mobility'],
  strength: ['strength', 'mix', 'mobility'],
  mobility: ['mobility', 'mix'],
  mix: ['mix', 'mobility', 'strength', 'cardio'],
};

const BODY_FOCUS_FALLBACKS = {
  full_body: ['full_body', 'upper_body', 'lower_body'],
  upper_body: ['upper_body', 'full_body'],
  lower_body: ['lower_body', 'full_body'],
};

const EXERCISE_TEXT_ALIASES = {
  progression: ['progression', 'exercise_progression', 'progression_text', 'progressions'],
  regression: ['regression', 'exercise_regression', 'regression_text', 'regressions'],
};

function buildProgramPlan(profile, allExercises) {
  const normalizedProfile = normalizeProfile(profile);
  const exercises = normalizeExercises(allExercises);

  const allowedSpaces = spaceMap[normalizedProfile.space] || ['all'];
  const allowedEquipment = equipMap[normalizedProfile.equipment] || ['none'];
  const weekLevels = levelProgression[normalizedProfile.level] || levelProgression.beginner;
  const bodyFocusRules = slotBodyFocus[normalizedProfile.primary_goal]
      || [['full_body'], ['full_body'], ['full_body'], ['full_body']];
  const fallbackGoals = goalFallbacks[normalizedProfile.primary_goal]
      || [normalizedProfile.primary_goal];

  const excludeHighIntensity = shouldExcludeHighIntensity(normalizedProfile);
  const activeContraindications = getActiveContraindicationAliases(normalizedProfile);
  const userMovementType = normalizeMovementType(normalizedProfile.movement_type);
  const movementFallbacks = resolveMovementFallbacks(userMovementType);

  const warmupPool = exercises.filter(ex =>
      isWarmupCandidate(ex, allowedSpaces, allowedEquipment, excludeHighIntensity, activeContraindications)
  );

  if (warmupPool.length === 0) {
    throw new Error('No warmup exercises found after space/equipment/contraindication/intensity filters');
  }

  const globalUsedMainIds = new Set();
  const plan = {};

  for (let weekIndex = 0; weekIndex < 4; weekIndex++) {
    const weekNumber = weekIndex + 1;
    const weekLevel = weekLevels[weekIndex] || weekLevels[weekLevels.length - 1];

    const baseMainPool = exercises.filter(ex =>
        isMainCandidate(
            ex,
            fallbackGoals,
            weekLevel,
            allowedSpaces,
            allowedEquipment,
            excludeHighIntensity,
            activeContraindications
        )
    );

    assertEnoughUnique(baseMainPool, REQUIRED_MAIN_PER_WEEK, `week_${weekNumber}.main`);

    const freshMainPool = baseMainPool.filter(ex => !globalUsedMainIds.has(ex._exerciseKey));
    const effectiveMainPool = hasEnoughUnique(freshMainPool, REQUIRED_MAIN_PER_WEEK)
        ? freshMainPool
        : baseMainPool;

    const weekUsedWarmupIds = new Set();
    const weekUsedMainIds = new Set();
    const weekPlan = {};

    for (let slotIndex = 0; slotIndex < SESSIONS.length; slotIndex++) {
      const slot = SESSIONS[slotIndex];

      const warmup = pickWarmup(warmupPool, weekUsedWarmupIds);
      if (warmup) {
        weekUsedWarmupIds.add(warmup._exerciseKey);
      }

      const slotBodyFocuses = bodyFocusRules[slotIndex] || ['full_body'];

      const main = pickMainExercise({
        pool: effectiveMainPool,
        usedIds: weekUsedMainIds,
        fallbackGoals,
        movementFallbacks,
        slotBodyFocuses,
      });

      if (!main) {
        throw new Error(`Cannot select unique main exercise for week_${weekNumber}.${slot}`);
      }

      weekUsedMainIds.add(main._exerciseKey);
      globalUsedMainIds.add(main._exerciseKey);

      weekPlan[slot] = {
        warmup: warmup ? mapExercise(warmup, false) : null,
        main: mapExercise(main, true),
      };
    }

    plan[`week_${weekNumber}`] = weekPlan;
  }

  return plan;
}

function isWarmupCandidate(ex, allowedSpaces, allowedEquipment, excludeHighIntensity, activeContraindications) {
  return (
      ex.primary_goal === 'warmup' &&
      allowedSpaces.includes(ex.space) &&
      allowedEquipment.includes(ex.equipment) &&
      matchesContraindications(ex, activeContraindications) &&
      matchesIntensity(ex, excludeHighIntensity)
  );
}

function isMainCandidate(
    ex,
    fallbackGoals,
    weekLevel,
    allowedSpaces,
    allowedEquipment,
    excludeHighIntensity,
    activeContraindications
) {
  return (
      fallbackGoals.includes(ex.primary_goal) &&
      allowedSpaces.includes(ex.space) &&
      allowedEquipment.includes(ex.equipment) &&
      weekLevel.includes(ex.level) &&
      matchesContraindications(ex, activeContraindications) &&
      matchesIntensity(ex, excludeHighIntensity)
  );
}

function pickWarmup(warmupPool, usedIds) {
  const unused = warmupPool.filter(ex => !usedIds.has(ex._exerciseKey));
  return pickRandom(unused.length > 0 ? unused : warmupPool);
}

function pickMainExercise({ pool, usedIds, fallbackGoals, movementFallbacks, slotBodyFocuses }) {
  const unusedPool = pool.filter(ex => !usedIds.has(ex._exerciseKey));

  if (unusedPool.length === 0) {
    return null;
  }

  const bodyFocusFallbacks = resolveBodyFocusFallbacks(slotBodyFocuses);

  const selectionTiers = buildSelectionTiers(fallbackGoals, movementFallbacks, bodyFocusFallbacks);

  for (const tier of selectionTiers) {
    const candidates = unusedPool.filter(ex =>
        tier.goals.includes(ex.primary_goal) &&
        tier.movementTypes.some(type => parseMovementTypes(ex.movement_type).includes(type)) &&
        tier.bodyFocuses.includes(ex.body_focus)
    );

    if (candidates.length > 0) {
      return pickRandom(candidates);
    }
  }

  return pickRandom(unusedPool);
}

function buildSelectionTiers(fallbackGoals, movementFallbacks, bodyFocusFallbacks) {
  const exactGoal = fallbackGoals.slice(0, 1);
  const compatibleGoals = fallbackGoals;

  const exactMovement = movementFallbacks.slice(0, 1);
  const compatibleMovement = movementFallbacks;

  const exactBodyFocus = bodyFocusFallbacks.slice(0, 1);
  const compatibleBodyFocus = bodyFocusFallbacks;

  return [
    {
      goals: exactGoal,
      movementTypes: exactMovement,
      bodyFocuses: exactBodyFocus,
    },
    {
      goals: exactGoal,
      movementTypes: exactMovement,
      bodyFocuses: compatibleBodyFocus,
    },
    {
      goals: compatibleGoals,
      movementTypes: exactMovement,
      bodyFocuses: compatibleBodyFocus,
    },
    {
      goals: compatibleGoals,
      movementTypes: compatibleMovement,
      bodyFocuses: compatibleBodyFocus,
    },
    {
      goals: compatibleGoals,
      movementTypes: compatibleMovement,
      bodyFocuses: ['full_body', 'upper_body', 'lower_body'],
    },
  ];
}

function resolveMovementFallbacks(movementType) {
  if (!movementType) {
    return ['mix', 'mobility', 'strength', 'cardio'];
  }

  return MOVEMENT_TYPE_FALLBACKS[movementType] || [movementType];
}

function resolveBodyFocusFallbacks(slotBodyFocuses) {
  const result = [];

  for (const bodyFocus of slotBodyFocuses) {
    const values = BODY_FOCUS_FALLBACKS[bodyFocus] || [bodyFocus];

    for (const value of values) {
      if (!result.includes(value)) {
        result.push(value);
      }
    }
  }

  return result;
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return {};
  }

  return {
    ...profile,
    contraindications: Array.isArray(profile.contraindications) ? profile.contraindications : [],
  };
}

function normalizeExercises(allExercises) {
  if (!Array.isArray(allExercises)) {
    return [];
  }

  return allExercises
      .filter(ex => ex && typeof ex === 'object')
      .map((ex, index) => ({
        ...ex,
        ex_id: safeString(ex.ex_id || ex.id || ex.Id || ex.ID || `exercise_${index}`),
        primary_goal: normalizeCode(ex.primary_goal),
        space: normalizeCode(ex.space),
        equipment: normalizeCode(ex.equipment),
        level: normalizeCode(ex.level),
        body_focus: normalizeCode(ex.body_focus),
        intensity: normalizeCode(ex.intensity),
        movement_type: normalizeMovementTypeList(ex.movement_type),
        _exerciseKey: safeString(ex.ex_id || ex.id || ex.Id || ex.ID || ex.name || `exercise_${index}`),
      }));
}

function normalizeCode(value) {
  return safeString(value).trim().toLowerCase();
}

function normalizeMovementType(value) {
  const normalized = normalizeCode(value);
  return MOVEMENT_TYPE_NORM[normalized] || normalized;
}

function normalizeMovementTypeList(value) {
  return parseMovementTypes(value)
      .map(type => MOVEMENT_TYPE_NORM[type] || type)
      .join(',');
}

function parseMovementTypes(value) {
  return safeString(value)
      .split(',')
      .map(item => normalizeCode(item))
      .filter(Boolean);
}

function matchesContraindications(ex, activeContraindications) {
  if (activeContraindications.length === 0) {
    return true;
  }

  const exerciseContraindications = safeString(ex.contraindications).toLowerCase();

  if (!exerciseContraindications) {
    return true;
  }

  return !activeContraindications.some(contraindication =>
      exerciseContraindications.includes(contraindication)
  );
}

function matchesIntensity(ex, excludeHighIntensity) {
  return !excludeHighIntensity || ex.intensity !== 'high';
}

function hasEnoughUnique(pool, requiredCount) {
  return new Set(pool.map(ex => ex._exerciseKey)).size >= requiredCount;
}

function assertEnoughUnique(pool, requiredCount, context) {
  const uniqueCount = new Set(pool.map(ex => ex._exerciseKey)).size;

  if (uniqueCount < requiredCount) {
    throw new Error(`${context}: expected at least ${requiredCount} unique exercises after filters, got ${uniqueCount}`);
  }
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) {
    return null;
  }

  return arr[Math.floor(Math.random() * arr.length)];
}

function mapExercise(ex, includePrimaryGoal) {
  const result = {
    ex_id: safeString(ex.ex_id),
    name: safeString(ex.name),
    description: safeString(ex.description),
    body_focus: safeString(ex.body_focus),
    level: safeString(ex.level),
    intensity: safeString(ex.intensity),
    movement_type: safeString(ex.movement_type),
    image_url: mapExerciseImage(ex),
    cues: safeString(ex.cues),
    progression: resolveExerciseText(ex, 'progression'),
    regression: resolveExerciseText(ex, 'regression'),
  };

  if (includePrimaryGoal) {
    result.primary_goal = safeString(ex.primary_goal);
  }

  return result;
}

function mapExerciseImage(ex) {
  return safeString(ex.image_url || ex.imageUrl || ex.image || ex.photo_url || ex.photoUrl);
}

function mapLowercaseKeys(obj) {
  const out = {};

  for (const [key, value] of Object.entries(obj || {})) {
    out[String(key).toLowerCase()] = value;
  }

  return out;
}

function resolveExerciseText(ex, field) {
  const aliases = EXERCISE_TEXT_ALIASES[field] || [field];
  const byLowerKey = mapLowercaseKeys(ex);

  for (const alias of aliases) {
    const value = byLowerKey[String(alias).toLowerCase()];

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (trimmed) {
        return trimmed;
      }
    }
  }

  return '';
}

function safeString(value) {
  if (value == null) {
    return '';
  }

  return String(value);
}

module.exports = { buildProgramPlan };