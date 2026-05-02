'use strict';

/**
 * Week-by-week allowed exercise levels for each user level over 4 weeks.
 */
module.exports = {
  beginner: [
    ['beginner'],
    ['beginner'],
    ['beginner'],
    ['beginner'],
  ],
  intermediate: [
    ['beginner'],
    ['beginner', 'intermediate'],
    ['intermediate'],
    ['intermediate', 'advanced'],
  ],
  advanced: [
    ['intermediate'],
    ['intermediate', 'advanced'],
    ['advanced'],
    ['advanced', 'flow'],
  ],
};