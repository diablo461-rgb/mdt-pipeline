'use strict';

const fetch = require('node-fetch');

const NOCODB_API_TOKEN = process.env.NOCODB_API_TOKEN || '';
const NOCODB_BASE_URL = 'https://app.nocodb.com/api/v2/tables';
const PAGE_SIZE = 100;

/**
 * Fetch all records from a NocoDB table via pagination.
 * @param {string} tableId
 * @returns {Promise<object[]>}
 */
async function fetchAllExercises(tableId) {
  const exercises = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${NOCODB_BASE_URL}/${tableId}/records?limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { 'xc-token': NOCODB_API_TOKEN },
    });

    if (!res.ok) {
      throw new Error(`NocoDB fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const list = data.list || [];
    exercises.push(...list);

    offset += PAGE_SIZE;
    hasMore = list.length === PAGE_SIZE;
  }

  return exercises;
}

module.exports = { fetchAllExercises };

