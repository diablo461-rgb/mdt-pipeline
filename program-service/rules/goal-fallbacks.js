'use strict';

/**
 * Ordered fallback goals when exercises for the primary goal are insufficient.
 */
module.exports = {
  energy: ['energy', 'active'],
  active: ['active', 'energy'],
  destress: ['destress', 'posture', 'core'],
  posture: ['posture', 'destress', 'core'],
  core: ['core', 'destress', 'posture'],
};

