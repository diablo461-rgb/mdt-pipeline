'use strict';

/**
 * Contraindication filtering rules for exercise selection.
 */
const painKeywords = {
  low_back_pain: 'low back',
  knee_pain: 'knee',
  shoulders_pain: 'shoulders',
};

function shouldExcludeHighIntensity(profile) {
  return (
    (profile.contraindications || []).includes('stress') ||
    profile.sleep_bucket === 'very_low' ||
    (profile.sex === 'female' && ['menstrual', 'luteal'].includes(profile.cycle_phase))
  );
}

module.exports = { painKeywords, shouldExcludeHighIntensity };

