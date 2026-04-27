'use strict';

/**
 * Maps contraindication strings from the quiz to body-part keywords used
 * to exclude exercises from the pool.
 */
const CONTRA_KEYWORD_MAP = {
  low_back_pain:  'low back',
  knee_pain:      'knee',
  shoulders_pain: 'shoulders',
};

/**
 * Normalise a contraindication value to a filter keyword.
 * Returns null for the 'stress' value (handled separately as intensity filter).
 */
function contraToKeyword(value) {
  if (value === 'stress') return null;
  return CONTRA_KEYWORD_MAP[value] || value.replace(/_/g, ' ');
}

/**
 * Returns true when an exercise should be excluded due to contraindications.
 */
function isContraExcluded(exercise, painKeywords) {
  if (painKeywords.length === 0) return false;
  if (!exercise.contraindications) return false;
  const exContra = exercise.contraindications.toLowerCase();
  return painKeywords.some(k => exContra.includes(k));
}

module.exports = { contraToKeyword, isContraExcluded };
