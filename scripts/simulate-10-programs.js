#!/usr/bin/env node
/**
 * simulate-10-programs.js
 *
 * Integration test: generates 10 program plans for 10 different user profiles,
 * inserts/updates them as leads in Postgres, and verifies PDF generation.
 *
 * Prerequisites:
 *   - program-service running on http://localhost:3002
 *   - pdf-service running on http://localhost:3001
 *   - Postgres accessible via PG* env vars (or defaults from .env)
 *
 * Run:
 *   node scripts/simulate-10-programs.js
 */

'use strict';

const http = require('http');

// ─── Helper: HTTP POST JSON ───────────────────────────────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || 80,
      path:     parsed.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error(`JSON parse error: ${raw}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Helper: PG query via psql (uses -f flag with a temp file to avoid shell injection) ─
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function pgQuery(sql) {
  const user = process.env.POSTGRES_USER || 'mdt_user';
  const pass = process.env.POSTGRES_PASSWORD || '';
  const db   = process.env.POSTGRES_DB || 'mdt_db';
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  // Write SQL to a temp file to avoid any shell-quoting issues
  const tmpFile = path.join(os.tmpdir(), `mdt_sim_${process.pid}_${Date.now()}.sql`);
  try {
    fs.writeFileSync(tmpFile, sql, 'utf8');
    return execFileSync(
      'psql',
      ['-h', host, '-p', port, '-U', user, '-d', db, '-t', '-f', tmpFile],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: pass } }
    ).trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

// ─── Safe SQL literal escaping (single-quotes and backslashes) ────────────────
function pgLiteral(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

// ─── 10 diverse profiles ──────────────────────────────────────────────────────
const PROFILES = [
  { name: 'Alice',   email: 'sim_alice@mdt.test',   primary_goal: 'energy',   level: 'beginner',     space: 'indoor',   equipment: 'none',            movement_type: 'mix',                    contraindications: [] },
  { name: 'Bob',     email: 'sim_bob@mdt.test',     primary_goal: 'posture',  level: 'intermediate', space: 'outdoors', equipment: 'everyday_items',   movement_type: 'resistance / strength',  contraindications: ['low_back_pain'] },
  { name: 'Carol',   email: 'sim_carol@mdt.test',   primary_goal: 'destress', level: 'beginner',     space: 'indoor',   equipment: 'none',            movement_type: 'yoga / pilates',         contraindications: ['stress'] },
  { name: 'Dave',    email: 'sim_dave@mdt.test',    primary_goal: 'core',     level: 'advanced',     space: 'mixed',    equipment: 'everyday_items',   movement_type: 'balanced routine',       contraindications: ['knee_pain'] },
  { name: 'Eve',     email: 'sim_eve@mdt.test',     primary_goal: 'active',   level: 'intermediate', space: 'outdoors', equipment: 'none',            movement_type: 'cardio-based',           contraindications: [] },
  { name: 'Frank',   email: 'sim_frank@mdt.test',   primary_goal: 'energy',   level: 'beginner',     space: 'indoor',   equipment: 'none',            movement_type: 'mix',                    contraindications: ['shoulders_pain'], sleep_bucket: 'very_low' },
  { name: 'Grace',   email: 'sim_grace@mdt.test',   primary_goal: 'posture',  level: 'beginner',     space: 'indoor',   equipment: 'none',            movement_type: 'yoga/pilates',           contraindications: [], sex: 'female', cycle_phase: 'menstrual' },
  { name: 'Hank',    email: 'sim_hank@mdt.test',    primary_goal: 'destress', level: 'advanced',     space: 'mixed',    equipment: 'everyday_items',   movement_type: 'resistance',             contraindications: ['stress', 'low_back_pain'] },
  { name: 'Iris',    email: 'sim_iris@mdt.test',    primary_goal: 'core',     level: 'intermediate', space: 'indoor',   equipment: 'none',            movement_type: 'mix',                    contraindications: [] },
  { name: 'Jack',    email: 'sim_jack@mdt.test',    primary_goal: 'active',   level: 'advanced',     space: 'outdoors', equipment: 'everyday_items',   movement_type: 'cardio-based',           contraindications: ['knee_pain'] },
];

const PROGRAM_SERVICE_URL = process.env.PROGRAM_SERVICE_URL || 'http://localhost:3002';
const PDF_SERVICE_URL     = process.env.PDF_SERVICE_URL     || 'http://localhost:3001';

async function main() {
  const results = {
    inserted: 0, saved: 0, valid: 0, unique: 0, pdfOk: 0,
  };

  const planHashes = new Set();

  for (const profile of PROFILES) {
    const { name, email, ...userProfile } = profile;
    process.stdout.write(`[${name}] generating program... `);

    // 1) Generate program
    const genRes = await postJson(`${PROGRAM_SERVICE_URL}/generate-program`, {
      user_profile: userProfile,
      email,
    });
    if (genRes.status !== 200 || !genRes.body.program_plan) {
      console.log(`FAIL (generate-program ${genRes.status})`);
      continue;
    }
    const { program_plan } = genRes.body;

    // 2) Insert/update lead
    const upsertSql = [
      'INSERT INTO leads (name, email, user_profile, status)',
      `VALUES (${pgLiteral(name)}, ${pgLiteral(email)}, ${pgLiteral(JSON.stringify(userProfile))}::jsonb, 'paid')`,
      'ON CONFLICT (email) DO UPDATE',
      '  SET name = EXCLUDED.name, user_profile = EXCLUDED.user_profile,',
      "      status = 'paid', updated_at = NOW()",
      'RETURNING id',
    ].join(' ');
    try {
      pgQuery(upsertSql);
      results.inserted++;
    } catch (e) {
      console.log(`FAIL (upsert lead: ${e.message})`);
      continue;
    }

    // 3) Save program_plan
    const saveSql = [
      `UPDATE leads SET program_plan = ${pgLiteral(JSON.stringify(program_plan))}::jsonb, updated_at = NOW()`,
      `WHERE email = ${pgLiteral(email)}`,
    ].join(' ');
    try {
      pgQuery(saveSql);
      results.saved++;
    } catch (e) {
      console.log(`FAIL (save plan: ${e.message})`);
      continue;
    }

    // 4) Validate contract
    const WEEKS    = ['week_1','week_2','week_3','week_4'];
    const SESSIONS = ['morning','midday','afternoon','evening'];
    let contractOk = true;
    for (const wk of WEEKS) {
      if (!program_plan[wk]) { contractOk = false; break; }
      for (const sl of SESSIONS) {
        if (!program_plan[wk][sl]) { contractOk = false; break; }
      }
    }
    if (contractOk) results.valid++;

    // 5) Uniqueness (by week_1 main exercise IDs)
    const planSignature = JSON.stringify(Object.keys(program_plan.week_1).map(s => program_plan.week_1[s].main?.ex_id));
    planHashes.add(planSignature);

    // 6) Generate PDF for week 1
    const weekPlan = program_plan.week_1;
    const pdfRes = await postJson(`${PDF_SERVICE_URL}/generate-pdf`, {
      name, week_number: 1,
      profile: { primary_goal: userProfile.primary_goal, level: userProfile.level },
      week_plan: weekPlan,
    });
    if (pdfRes.status === 200 && pdfRes.body.pdf && pdfRes.body.pdf.startsWith('JVBERi0')) {
      results.pdfOk++;
      process.stdout.write('PDF✓ ');
    } else {
      process.stdout.write(`PDF✗(${pdfRes.status}) `);
    }
    console.log('OK');
  }

  results.unique = planHashes.size;

  console.log('\n─── Results ─────────────────────────────────────');
  console.log(`Leads inserted/updated:          ${results.inserted}/10`);
  console.log(`Program plans saved to leads:    ${results.saved}/10`);
  console.log(`Program plan contract valid:     ${results.valid}/10`);
  console.log(`Unique program plans (hashes):   ${results.unique}/10`);
  console.log(`PDF generated (base64 %PDF):     ${results.pdfOk}/10`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
