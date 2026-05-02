'use strict';

/**
 * Mapping from user_profile values to allowed NocoDB space/equipment values.
 */
const spaceMap = {
  indoor: ['close_space', 'all'],
  outdoors: ['outdoors', 'open_space', 'all'],
  mixed: ['close_space', 'outdoors', 'open_space', 'all'],
};

const equipMap = {
  none: ['none'],
  everyday_items: ['none', 'everyday_items', 'backpack'],
};

module.exports = { spaceMap, equipMap };