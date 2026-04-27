#!/usr/bin/env node
/**
 * simulate-10-e2e.js
 *
 * End-to-end test: posts 10 Tally-like payloads to the n8n tally-webhook,
 * then simulates a Paddle payment webhook for each lead.
 *
 * NOTE: This requires that n8n workflows are active (published) and accessible
 * at WEBHOOK_URL (default http://localhost:5678). Due to a known activation drift
 * in n8n (see AGENTS.md), webhooks may return 404 until workflows are manually
 * activated in the n8n UI.
 *
 * Prerequisites:
 *   - All Docker services running: docker compose up -d
 *   - Tally workflow active at POST /webhook/tally-webhook
 *   - Paddle payment workflow active at POST /webhook/paddle-webhook
 *   - PADDLE_WEBHOOK_SECRET set (Paddle signature verification is skipped in test mode)
 *
 * Run:
 *   node scripts/simulate-10-e2e.js
 */

'use strict';

const http  = require('http');
const https = require('https');
const crypto = require('crypto');

const N8N_BASE = process.env.N8N_BASE_URL || 'http://localhost:5678';
const PADDLE_SECRET = process.env.PADDLE_WEBHOOK_SECRET || 'test-secret';

// ─── Helper: HTTP POST JSON ───────────────────────────────────────────────────
function postJson(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: raw }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Build a minimal Tally-style webhook payload ──────────────────────────────
function buildTallyPayload(profile) {
  const fields = [
    { label: 'Full Name',       value: profile.name },
    { label: 'Email',           value: profile.email },
    { label: 'Primary Goal',    value: profile.primary_goal },
    { label: 'Level',           value: profile.level },
    { label: 'Space',           value: profile.space },
    { label: 'Equipment',       value: profile.equipment || 'none' },
    { label: 'Movement Type',   value: profile.movement_type || 'mix' },
  ];
  return { data: { fields } };
}

// ─── Build a Paddle transaction.completed event with HMAC signature ───────────
function buildPaddleEvent(email, transactionId) {
  const event = {
    event_id:   `evt_sim_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    event_type: 'transaction.completed',
    data: {
      id:       transactionId,
      status:   'completed',
      customer: { email },
      items: [{ price: { unit_price: { amount: '2900', currency_code: 'EUR' } } }],
      custom_data: { email },
    },
  };
  const body      = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed    = `${timestamp}:${body}`;
  const hmac      = crypto.createHmac('sha256', PADDLE_SECRET).update(signed).digest('hex');
  const signature = `ts=${timestamp};h1=${hmac}`;
  return { body, signature };
}

// ─── 10 diverse profiles (same as simulate-10-programs.js) ───────────────────
const PROFILES = [
  { name: 'Alice',  email: 'e2e_alice@mdt.test',  primary_goal: 'energy',   level: 'beginner',     space: 'indoor',   equipment: 'none' },
  { name: 'Bob',    email: 'e2e_bob@mdt.test',    primary_goal: 'posture',  level: 'intermediate', space: 'outdoors', equipment: 'everyday_items' },
  { name: 'Carol',  email: 'e2e_carol@mdt.test',  primary_goal: 'destress', level: 'beginner',     space: 'indoor',   equipment: 'none' },
  { name: 'Dave',   email: 'e2e_dave@mdt.test',   primary_goal: 'core',     level: 'advanced',     space: 'mixed',    equipment: 'everyday_items' },
  { name: 'Eve',    email: 'e2e_eve@mdt.test',    primary_goal: 'active',   level: 'intermediate', space: 'outdoors', equipment: 'none' },
  { name: 'Frank',  email: 'e2e_frank@mdt.test',  primary_goal: 'energy',   level: 'beginner',     space: 'indoor',   equipment: 'none' },
  { name: 'Grace',  email: 'e2e_grace@mdt.test',  primary_goal: 'posture',  level: 'beginner',     space: 'indoor',   equipment: 'none' },
  { name: 'Hank',   email: 'e2e_hank@mdt.test',   primary_goal: 'destress', level: 'advanced',     space: 'mixed',    equipment: 'everyday_items' },
  { name: 'Iris',   email: 'e2e_iris@mdt.test',   primary_goal: 'core',     level: 'intermediate', space: 'indoor',   equipment: 'none' },
  { name: 'Jack',   email: 'e2e_jack@mdt.test',   primary_goal: 'active',   level: 'advanced',     space: 'outdoors', equipment: 'everyday_items' },
];

async function main() {
  console.log(`Using n8n at: ${N8N_BASE}`);
  let tallyOk = 0, paddleOk = 0;

  for (const profile of PROFILES) {
    // Step 1: Tally webhook
    const tallyPayload = buildTallyPayload(profile);
    const tallyRes = await postJson(`${N8N_BASE}/webhook/tally-webhook`, tallyPayload);
    const tallyStatus = tallyRes.status;
    process.stdout.write(`[${profile.name}] tally=${tallyStatus} `);
    if (tallyStatus === 200) tallyOk++;

    // Brief pause so lead is persisted
    await new Promise(r => setTimeout(r, 500));

    // Step 2: Paddle payment webhook
    const txId = `txn_sim_${Date.now()}`;
    const { body, signature } = buildPaddleEvent(profile.email, txId);

    const paddleRes = await new Promise((resolve, reject) => {
      const parsed  = new URL(`${N8N_BASE}/webhook/paddle-webhook`);
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || 80,
        path:     parsed.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Paddle-Signature': signature,
        },
      };
      const req = http.request(options, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, text: raw }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    process.stdout.write(`paddle=${paddleRes.status}`);
    if (paddleRes.status === 200) paddleOk++;
    console.log();
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n─── E2E Results ────────────────────────────────');
  console.log(`Tally webhooks accepted (200):   ${tallyOk}/10`);
  console.log(`Paddle webhooks accepted (200):  ${paddleOk}/10`);
  if (tallyOk < 10 || paddleOk < 10) {
    console.log('\nNOTE: If webhooks return 404, activate workflows in the n8n UI (http://localhost:5678).');
    console.log('Known drift: Dockerfile.n8n activation script may not cover all workflow IDs.');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
