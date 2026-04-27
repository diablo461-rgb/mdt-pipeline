'use strict';

/**
 * Rules for distributing body_focus by day slot for each primary goal.
 *
 * Structure:
 *   goal: [morning_focuses, midday_focuses, afternoon_focuses, evening_focuses]
 */
module.exports = {
  energy: [
    ['full_body'],
    ['upper_body', 'full_body'],
    ['full_body'],
    ['full_body'],
  ],
  destress: [
    ['full_body'],
    ['upper_body', 'full_body'],
    ['full_body'],
    ['full_body'],
  ],
  posture: [
    ['full_body'],
    ['lower_body', 'full_body'],
    ['upper_body', 'full_body'],
    ['full_body'],
  ],
  active: [
    ['lower_body', 'full_body'],
    ['upper_body', 'full_body'],
    ['full_body'],
    ['full_body'],
  ],
  core: [
    ['full_body'],
    ['lower_body', 'full_body'],
    ['full_body'],
    ['full_body'],
  ],
};

