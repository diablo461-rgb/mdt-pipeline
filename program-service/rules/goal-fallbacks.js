'use strict';

/**
 * For each primary_goal, defines the ordered list of fallback goals to try
 * when the primary pool is too small.
 */
const GOAL_FALLBACKS = {
  energy:   ['energy', 'active'],
  active:   ['active', 'energy'],
  destress: ['destress', 'posture', 'core'],
  posture:  ['posture', 'destress', 'core'],
  core:     ['core', 'destress', 'posture'],
};

module.exports = { GOAL_FALLBACKS };
