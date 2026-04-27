'use strict';

/**
 * For each primary_goal, defines which body_focus values are preferred
 * for each of the 4 daily slots (morning / midday / afternoon / evening).
 *
 * Each entry is an array of 4 arrays, one per slot.
 */
const SLOT_BODY_FOCUS = {
  energy:   [['full_body'], ['upper_body', 'full_body'], ['full_body'], ['full_body']],
  destress: [['full_body'], ['upper_body', 'full_body'], ['full_body'], ['full_body']],
  posture:  [['full_body'], ['lower_body', 'full_body'], ['upper_body', 'full_body'], ['full_body']],
  active:   [['lower_body', 'full_body'], ['upper_body', 'full_body'], ['full_body'], ['full_body']],
  core:     [['full_body'], ['lower_body', 'full_body'], ['full_body'], ['full_body']],
};

/** Default when primary_goal is not in the map. */
const DEFAULT_BODY_FOCUS = [['full_body'], ['full_body'], ['full_body'], ['full_body']];

module.exports = { SLOT_BODY_FOCUS, DEFAULT_BODY_FOCUS };
