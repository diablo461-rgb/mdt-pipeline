'use strict';

/**
 * Defines which exercise levels are appropriate for each of the 4 weeks,
 * keyed by the user's self-reported level.
 */
const LEVEL_PROGRESSION = {
  beginner:     [['beginner'], ['beginner'], ['beginner'], ['beginner']],
  intermediate: [['beginner'], ['beginner', 'intermediate'], ['intermediate'], ['intermediate', 'advanced']],
  advanced:     [['intermediate'], ['intermediate', 'advanced'], ['advanced'], ['advanced']],
};

module.exports = { LEVEL_PROGRESSION };
