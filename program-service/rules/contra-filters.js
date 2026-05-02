'use strict';

/**
 * Contraindication filtering rules for exercise selection.
 */

const contraindicationAliases = {
  low_back_pain: ['low_back_pain', 'low back', 'lower back', 'back pain'],
  knee_pain: ['knee_pain', 'knee', 'knees', 'knee pain'],
  shoulders_pain: ['shoulders_pain', 'shoulder', 'shoulders', 'shoulder pain'],
};

function shouldExcludeHighIntensity(profile) {
  const contraindications = Array.isArray(profile.contraindications)
      ? profile.contraindications
      : [];

  return (
      contraindications.includes('stress') ||
      profile.sleep_bucket === 'very_low' ||
      (profile.sex === 'female' && ['menstrual', 'luteal'].includes(profile.cycle_phase))
  );
}

function getActiveContraindicationAliases(profile) {
  const contraindications = Array.isArray(profile.contraindications)
      ? profile.contraindications
      : [];

  return contraindications
      .filter(code => code !== 'stress')
      .flatMap(code => contraindicationAliases[code] || [String(code).replace(/_/g, ' ')])
      .map(value => String(value).trim().toLowerCase())
      .filter(Boolean);
}

module.exports = {
  contraindicationAliases,
  shouldExcludeHighIntensity,
  getActiveContraindicationAliases,
};