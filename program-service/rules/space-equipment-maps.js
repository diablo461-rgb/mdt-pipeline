'use strict';

/**
 * Maps movement_type strings from Tally answers to internal canonical values.
 */
const MOVEMENT_TYPE_NORM = {
  resistance: 'strength',
  'resistance / strength': 'strength',
  'balanced routine': 'mix',
  mix: 'mix',
  'cardio-based': 'cardio',
  'yoga / pilates': 'mobility',
  'yoga / pilates / dance': 'mobility',
  'yoga/pilates': 'mobility',
};

/**
 * Maps space values to allowed NocoDB space tags.
 */
const SPACE_MAP = {
  indoor: ['close_space', 'all'],
  outdoors: ['outdoors', 'open_space', 'all'],
  mixed: ['close_space', 'outdoors', 'open_space', 'all'],
};

/**
 * Maps equipment values to allowed NocoDB equipment tags.
 */
const EQUIPMENT_MAP = {
  none: ['none'],
  everyday_items: ['none', 'everyday_items', 'backpack'],
};

module.exports = { MOVEMENT_TYPE_NORM, SPACE_MAP, EQUIPMENT_MAP };
