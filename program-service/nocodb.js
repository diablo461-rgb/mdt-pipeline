'use strict';

const NOCODB_BASE = 'https://app.nocodb.com/api/v2/tables';

/**
 * Fetch all exercises from NocoDB in pages of 100.
 * Returns a flat array of exercise objects.
 */
async function fetchAllExercises() {
  const token = process.env.NOCODB_API_TOKEN;
  const tableId = process.env.NOCODB_TABLE_ID;

  if (!token || !tableId) {
    throw new Error('NOCODB_API_TOKEN and NOCODB_TABLE_ID env vars are required');
  }

  const { default: fetch } = await import('node-fetch');

  const headers = { 'xc-auth': token };
  const pageSize = 100;
  let offset = 0;
  let all = [];

  while (true) {
    const url = `${NOCODB_BASE}/${tableId}/records?limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`NocoDB fetch failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const records = body.list || [];
    all = all.concat(records);
    if (records.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

module.exports = { fetchAllExercises };
