'use strict';

/**
 * pdf-overlay.js  —  refactored for new MDT templates (weeks 1-4)
 *
 * Template page dimensions: 595 × 842 pt  (A4)
 * pdfplumber uses top-down coordinates; pdf-lib uses bottom-up.
 * Conversion: pdf_lib_y = PAGE_H - pdfplumber_top
 *
 * ─── LAYOUT SUMMARY (measured from new templates) ────────────────────────────
 *
 * PAGE 1  — Cover
 *   Name position  (pdfplumber top ≈ 281):
 *     Week 1:   "Welcome [bold name],"   — name starts at x≈148
 *     Weeks 2-4: "Welcome back [bold name]," — name starts at x≈193
 *   Calendar button rect: x0=67 top=770 x1=304 bottom=817  → link zone
 *
 * PAGE 2  — Profile
 *   All weeks: Goal / Level / Environment / Sensitivity
 *     row tops (pdfplumber): 91, 133, 175, 217
 *   Value x start: x=187 (all weeks)
 *
 * PAGE 3  — Weekly Plan table
 *   Table row tops (pdfplumber): Morning=707, Midday=736, Afternoon=766, Evening=795
 *   Warm-Up col x: 286–430  (center ≈ 358, we left-align at 286)
 *   Main col x:    403–576  (center ≈ 460, we left-align at 403)
 *   Text size: 10, centered in available width
 *
 * PAGES 4 & 5  — Session cards (2 sessions per page)
 *   Session A (top):    header bar top=25..73
 *     Warmup row:  image x0=19 top=80  width=179 height=168
 *                  text  x0=215 top=85  width=222 (to 437)
 *                  prog  x0=445 top=87  width=126 (to 571)
 *     Main row:    image x0=19 top=248 width=179 height=186
 *                  text  x0=215 top=253 width=222
 *                  prog  x0=445 top=255 width=126
 *   Session B (bottom): header bar top=434..482
 *     Warmup row:  image x0=19 top=489 width=179 height=168
 *                  text  x0=215 top=495 width=222
 *                  prog  x0=445 top=497 width=126
 *     Main row:    image x0=19 top=657 width=179 height=185
 *                  text  x0=215 top=663 width=222
 *                  prog  x0=445 top=665 width=126
 *
 * PAGE 6  — SOS video + closing
 *   Video button: x0=67 top=344..390 x1=304  (weeks 1-3 ≈ top=350, week 4 ≈ top=344)
 *   Link zone: x0=67, y_bottom=842-390=452, width=237, height=46
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { PDFDocument, rgb, PDFName, PDFString, PDFArray } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_H = 842;

/** Convert pdfplumber "top" (from top of page) → pdf-lib y (from bottom) */
const toY = (top) => PAGE_H - top;

// Text colours — derived from actual template backgrounds
const DARK       = rgb(0.13, 0.13, 0.13);   // near-black, used on light pages (w1, w2)
const LIGHT_DARK = rgb(0.20, 0.20, 0.20);   // slightly softer dark for w3 beige bg
const WHITE      = rgb(1, 1, 1);            // week 3/4 dark sections
const MID_LIGHT  = rgb(0.85, 0.83, 0.80);   // secondary text on dark bg (cues)
const DARK_SEC   = rgb(0.40, 0.38, 0.35);   // secondary text on light bg

/**
 * Per-week colour config.
 * textColor     — primary text colour (name, exercise name, description)
 * secondaryColor — cue text colour
 * profileColor  — profile page values colour
 */
const WEEK_COLORS = {
  1: { textColor: DARK,       secondaryColor: DARK_SEC,  profileColor: DARK       },
  2: { textColor: DARK,       secondaryColor: DARK_SEC,  profileColor: DARK       },
  3: { textColor: LIGHT_DARK, secondaryColor: DARK_SEC,  profileColor: LIGHT_DARK },
  4: { textColor: WHITE,      secondaryColor: MID_LIGHT, profileColor: WHITE      },
};

// ─── Text utilities ────────────────────────────────────────────────────────────

function sanitize(text) {
  if (!text) return '';
  return String(text)
      .replace(/→/g, '->')
      .replace(/←/g, '<-')
      .replace(/↑/g, '^')
      .replace(/↓/g, 'v')
      .replace(/–/g, '-')
      .replace(/—/g, '-')
      .replace(/'/g, "'")
      .replace(/'/g, "'")
      .replace(/"/g, '"')
      .replace(/"/g, '"')
      .replace(/…/g, '...')
      .replace(/•/g, '*')
      .replace(/[^\x00-\xFF]/g, '?');
}

function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return [];
  const words = sanitize(String(text)).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw wrapped text, returns updated y position.
 * @param {*} page
 * @param {string} text
 * @param {*} font
 * @param {number} size
 * @param {number} x
 * @param {number} y        pdf-lib y (bottom-up)
 * @param {number} maxWidth
 * @param {number} lineGap  extra gap between lines
 * @param {*} color
 * @param {number} [minY]   clipping: don't draw below this y
 * @returns {number}        new y after drawing
 */
function drawWrapped(page, text, font, size, x, y, maxWidth, lineGap, color, minY) {
  if (!text) return y;
  const lines = wrapText(sanitize(String(text)), font, size, maxWidth);
  for (const ln of lines) {
    if (minY !== undefined && y < minY) break;
    page.drawText(ln, { x, y, font, size, color: color || DARK });
    y -= size + lineGap;
  }
  return y;
}

// ─── Link annotation ──────────────────────────────────────────────────────────

function normalizeUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw || raw === '#') return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') ||
      raw.startsWith('webcal://') || raw.startsWith('mailto:')) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return `https://${raw}`;
}

function addLink(pdfDoc, page, x, yBottom, width, height, url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;

  const annot = pdfDoc.context.obj({
    Type:   PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect:   [x, yBottom, x + width, yBottom + height],
    Border: [0, 0, 0],
    A: pdfDoc.context.obj({
      Type: PDFName.of('Action'),
      S:    PDFName.of('URI'),
      URI:  PDFString.of(normalized),
    }),
  });

  const ref = pdfDoc.context.register(annot);
  const existing = page.node.get(PDFName.of('Annots'));
  if (existing) {
    existing.push(ref);
  } else {
    const arr = PDFArray.withContext(pdfDoc.context);
    arr.push(ref);
    page.node.set(PDFName.of('Annots'), arr);
  }
}

// ─── Image fetching & normalisation ───────────────────────────────────────────

function extractGoogleDriveFileId(str) {
  const patterns = [
    /drive\.google\.com\/file\/d\/([^/]+)/i,
    /drive\.google\.com\/open\?id=([^&]+)/i,
    /drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/i,
    /docs\.google\.com\/uc\?(?:.*&)?id=([^&]+)/i,
    /[?&]id=([^&]+)/i,
  ];
  for (const p of patterns) {
    const m = String(str).match(p);
    if (m && m[1]) return m[1];
  }
  return '';
}

function toDirectImageUrl(url) {
  const norm = normalizeUrl(url);
  if (!norm) return '';
  const id = extractGoogleDriveFileId(norm);
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
  return norm;
}

function parseImageUrl(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const v of value) { const p = parseImageUrl(v); if (p) return p; }
    return '';
  }
  const str = String(value).trim();
  if (!str) return '';
  const md  = str.match(/\((https?:\/\/[^\s)]+)\)/i);
  if (md)  return toDirectImageUrl(md[1]);
  const css = str.match(/url\((https?:\/\/[^\s)]+)\)/i);
  if (css) return toDirectImageUrl(css[1]);
  const pl  = str.match(/https?:\/\/[^\s"')]+/i);
  if (pl)  return toDirectImageUrl(pl[0]);
  return toDirectImageUrl(str);
}

function buildImageFetchCandidates(url) {
  const norm = parseImageUrl(url);
  if (!norm) return [];
  const id = extractGoogleDriveFileId(norm);
  if (!id) return [norm];
  return [
    `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.google.com/uc?export=view&id=${id}`,
    norm,
  ];
}

function requestBinary(target, redirectsLeft, cookies = []) {
  return new Promise((resolve, reject) => {
    const mod = target.startsWith('https') ? https : http;
    const req = mod.get(target, {
      headers: {
        'User-Agent': 'mdt-pdf-service/2.0',
        'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      },
    }, (res) => {
      const code     = res.statusCode || 0;
      const location = res.headers.location;
      const nextCookies = [...cookies, ...(res.headers['set-cookie'] || []).map(v => v.split(';')[0])];
      if ([301, 302, 303, 307, 308].includes(code) && location && redirectsLeft > 0) {
        res.resume();
        resolve(requestBinary(new URL(location, target).toString(), redirectsLeft - 1, nextCookies));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ statusCode: code, headers: res.headers, body: Buffer.concat(chunks), finalUrl: target }));
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('Image request timeout')));
    req.on('error', reject);
  });
}

function detectImageFormat(response) {
  const ct = String(response.headers['content-type'] || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
  if (ct.includes('png'))  return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif'))  return 'gif';
  if (ct.includes('tiff')) return 'tiff';
  if (ct.includes('avif')) return 'avif';
  const b = response.body;
  if (b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'webp';
  return '';
}

async function resolveDriveConfirmPage(response) {
  const ct = String(response.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('text/html')) return null;
  const html = response.body.toString('utf8');
  const m1 = html.match(/href="(\/uc\?export=download[^"]+)"/i);
  if (m1) return requestBinary(`https://drive.google.com${m1[1].replace(/&amp;/g, '&')}`, 10);
  const m2 = html.match(/"downloadUrl":"(https:[^"]+)"/i);
  if (m2) return requestBinary(m2[1].replace(/\\u003d/g,'=').replace(/\\u0026/g,'&').replace(/\\/g,''), 10);
  return null;
}

async function fetchImageBytes(url) {
  const candidates = buildImageFetchCandidates(url);
  if (!candidates.length) throw new Error('Empty image URL');
  const errors = [];
  for (const candidate of candidates) {
    try {
      let response = await requestBinary(candidate, 10);
      if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
      let format = detectImageFormat(response);
      if (format) return { bytes: response.body, format };
      const confirmed = await resolveDriveConfirmPage(response);
      if (confirmed) {
        if (confirmed.statusCode !== 200) throw new Error(`Confirm HTTP ${confirmed.statusCode}`);
        format = detectImageFormat(confirmed);
        if (format) return { bytes: confirmed.body, format };
        response = confirmed;
      }
      const meta = await sharp(response.body).metadata().catch(() => null);
      if (meta && meta.format) return { bytes: response.body, format: meta.format.toLowerCase() };
      throw new Error('Unsupported image payload');
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(`Image fetch failed. Attempts: ${errors.join(' | ')}`);
}

async function normalizeImageForPdf(bytes, targetWidth, targetHeight) {
  const prepared = await sharp(bytes)
      .trim()
      .resize({
        width:  Math.max(1, Math.round(targetWidth)),
        height: Math.max(1, Math.round(targetHeight)),
        fit:    'cover',
        position: 'centre',
        withoutEnlargement: false,
      })
      .flatten({ background: '#ffffff' })
      .toBuffer()
      .catch(() => bytes);

  const png = await sharp(prepared).png().toBuffer().catch(() => prepared);
  return { bytes: png, format: 'png' };
}

async function drawExerciseImage(pdfDoc, page, imageUrl, x, yBottom, width, height) {
  if (!imageUrl) return;
  try {
    const fetched    = await fetchImageBytes(imageUrl);
    const normalized = await normalizeImageForPdf(fetched.bytes, width, height);
    let img;
    if (normalized.format === 'png') {
      img = await pdfDoc.embedPng(normalized.bytes);
    } else {
      img = await pdfDoc.embedJpg(normalized.bytes);
    }
    page.drawImage(img, { x, y: yBottom, width, height });
  } catch (e) {
    console.warn(`Image skipped "${imageUrl}": ${e.message}`);
  }
}

// ─── PAGE 1 — Cover ───────────────────────────────────────────────────────────

function overlayPage1(pdfDoc, page, { name, calendarUrl, bold, weekNum }) {
  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const nameStr = sanitize(name || '');
  const fontSize = 17;
  const maxNameWidth = 160;

  // Truncate name to fit
  let displayName = nameStr;
  while (displayName.length > 0 && bold.widthOfTextAtSize(displayName, fontSize) > maxNameWidth) {
    displayName = displayName.slice(0, -1);
  }

  // Name x position: after "Welcome " (w1) or "Welcome back " (w2-4)
  // Measured: "Welcome " ends ~x=148 for w1, "Welcome back " ends ~x=193 for w2-4
  const nameX = weekNum === 1 ? 148 : 193;
  // pdfplumber top=281 → pdf-lib y
  const nameY = toY(281);

  // No cover rectangle needed — templates have no underline placeholder to hide
  // Just draw the name in bold
  page.drawText(displayName + ',', {
    x: nameX,
    y: nameY,
    font:  bold,
    size:  fontSize,
    color: colors.textColor,
  });

  // Calendar button clickable zone
  // rect: x0=67 top=770 x1=304 bottom=817 → pdf-lib yBottom=842-817=25, height=47
  if (calendarUrl && calendarUrl !== '#') {
    addLink(pdfDoc, page, 67, toY(817), 237, 47, calendarUrl);
  }
}

// ─── PAGE 2 — Profile ─────────────────────────────────────────────────────────

function overlayPage2(page, { profile, bold, weekNum }) {
  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const sz = 14;
  const valueX = 187;
  const maxW = 595 - valueX - 20; // to right margin

  /**
   * Profile field layout — UNIFIED for all weeks:
   *   row0 top=91   → Goal
   *   row1 top=133  → Level
   *   row2 top=175  → Environment
   *   row3 top=217  → Sensitivity
   *
   * Note: template labels on Week 1 may visually read "Focus / ... / Sensitivity"
   *       and on Weeks 2-4 "Goal / ... / Focus", but the values we write follow
   *       the unified order above. Update the templates if labels need to match.
   */
  const rowTops = [91, 133, 175, 217];

  const fieldValues = [
    profile.primary_goal || profile.goal || profile.focus || '',
    profile.level || '',
    Array.isArray(profile.spaces)
        ? profile.spaces.join(', ')
        : String(profile.spaces || profile.environment || ''),
    profile.sensitivity || '',
  ];

  for (let i = 0; i < rowTops.length; i++) {
    const val = fieldValues[i];
    if (!val) continue;
    const y = toY(rowTops[i]);
    let t = sanitize(String(val));
    while (t.length > 1 && bold.widthOfTextAtSize(t, sz) > maxW) t = t.slice(0, -1);
    page.drawText(t, { x: valueX, y, font: bold, size: sz, color: colors.profileColor });
  }
}

// ─── PAGE 3 — Weekly Plan Table ───────────────────────────────────────────────

function overlayPage3(page, { weekPlan, regular, bold, weekNum }) {
  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const sz = 10;
  const lineGap = 2;

  // Column layout (from measurement):
  // Warm-Up col:   x0≈286, x1≈430  → center=358, usable width≈144
  // Main col:      x0≈403, x1≈571  → center=487, usable width≈168
  // But text in cells can wrap to 2 lines. Let's centre in each column.
  const warmupXc = 358;   // centre x for warm-up column
  const mainXc   = 487;   // centre x for main column
  const warmupW  = 140;   // usable width
  const mainW    = 160;

  const slots = [
    { top: 707, slot: weekPlan.morning },
    { top: 736, slot: weekPlan.midday },
    { top: 766, slot: weekPlan.afternoon },
    { top: 795, slot: weekPlan.evening },
  ];

  for (const { top, slot } of slots) {
    if (!slot) continue;

    const wuName = slot.warmup && slot.warmup.name ? sanitize(String(slot.warmup.name)) : '';
    const mnName = slot.main   && slot.main.name   ? sanitize(String(slot.main.name))   : '';

    if (wuName) {
      const lines = wrapText(wuName, regular, sz, warmupW);
      const totalH = lines.length * (sz + lineGap) - lineGap;
      let y = toY(top) + totalH / 2;
      for (const ln of lines) {
        const lw = regular.widthOfTextAtSize(ln, sz);
        page.drawText(ln, { x: warmupXc - lw / 2, y, font: regular, size: sz, color: colors.textColor });
        y -= sz + lineGap;
      }
    }

    if (mnName) {
      const lines = wrapText(mnName, regular, sz, mainW);
      const totalH = lines.length * (sz + lineGap) - lineGap;
      let y = toY(top) + totalH / 2;
      for (const ln of lines) {
        const lw = regular.widthOfTextAtSize(ln, sz);
        page.drawText(ln, { x: mainXc - lw / 2, y, font: regular, size: sz, color: colors.textColor });
        y -= sz + lineGap;
      }
    }
  }
}

// ─── PAGES 4 & 5 — Session Cards ─────────────────────────────────────────────

/**
 * Layout constants for session pages (pdfplumber coordinates → pdf-lib conversion)
 *
 * Each page has 2 sessions (A=top, B=bottom).
 * Each session has 2 exercise rows (warmup, main).
 *
 * Image cell (col 1):  x0=19  x1=198  (width=179)
 * Text cell  (col 2):  x0=198 x1=441  (width=243, usable from x=215 with 8px padding)
 * Prog cell  (col 3):  x0=441 x1=576  (width=135, usable from x=449 with 8px padding)
 *
 * Session A:
 *   header bar:  top=25..73
 *   warmup row:  image top=80..248   text/prog top=80
 *   main row:    image top=248..434  text/prog top=248
 * Session B:
 *   header bar:  top=434..482
 *   warmup row:  image top=489..657  text/prog top=489
 *   main row:    image top=657..842  text/prog top=657
 */

const SESSION_LAYOUT = [
  // Session A (top half)
  {
    warmup: { imgTop: 80,  imgBot: 248, textTop: 80,  imgX: 19, imgW: 179 },
    main:   { imgTop: 248, imgBot: 434, textTop: 248, imgX: 19, imgW: 179 },
  },
  // Session B (bottom half)
  {
    warmup: { imgTop: 489, imgBot: 657, textTop: 489, imgX: 19, imgW: 179 },
    main:   { imgTop: 657, imgBot: 842, textTop: 657, imgX: 19, imgW: 179 },
  },
];

// Text / prog columns
const COL2_X    = 215;   // text column start x (8px padding inside cell)
const COL2_W    = 222;   // text column usable width (215 to 437)
const COL3_X    = 449;   // progression column start x
const COL3_W    = 120;   // progression column usable width

async function overlaySessionPage(pdfDoc, page, slot1, slot2, fonts, weekNum) {
  const slots = [slot1, slot2];
  for (let si = 0; si < 2; si++) {
    const slot = slots[si];
    if (!slot) continue;
    const layout = SESSION_LAYOUT[si];
    await overlayExerciseRow(pdfDoc, page, slot.warmup, layout.warmup, fonts, weekNum);
    await overlayExerciseRow(pdfDoc, page, slot.main,   layout.main,   fonts, weekNum);
  }
}

async function overlayExerciseRow(pdfDoc, page, exercise, layout, { bold, regular }, weekNum) {
  if (!exercise) return;

  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];

  // ── Image ──────────────────────────────────────────────────────────────────
  const imgH = layout.imgBot - layout.imgTop;
  const imgYBottom = toY(layout.imgBot);  // pdf-lib bottom y of image cell
  const imgPad = 4;

  const imageUrl = parseImageUrl(
      exercise.image_url || exercise.imageUrl || exercise.image ||
      exercise.photo_url || exercise.photoUrl
  );
  await drawExerciseImage(
      pdfDoc, page, imageUrl,
      layout.imgX + imgPad,
      imgYBottom + imgPad,
      layout.imgW - imgPad * 2,
      imgH - imgPad * 2
  );

  // ── Text column (name + description + Cues label + cues text) ──────────────
  const nameSize = 11;
  const descSize = 9;
  const cueSize  = 9;
  const lineGap  = 2;

  // Top padding: 8px below the row top
  const rowTopPt    = layout.textTop + 8;
  const rowMinY     = toY(layout.imgBot - 4);  // don't draw below image bottom

  let curY = toY(rowTopPt);

  // Exercise name (bold)
  const name = sanitize(String(exercise.name || ''));
  if (name) {
    curY = drawWrapped(page, name, bold, nameSize, COL2_X, curY, COL2_W, lineGap, colors.textColor, rowMinY);
    curY -= 2; // small gap after name
  }

  // Description
  if (exercise.description) {
    curY = drawWrapped(page, exercise.description, regular, descSize, COL2_X, curY, COL2_W, lineGap, colors.textColor, rowMinY);
  }

  // Cues: bold label "Cues" then regular cue text
  if (exercise.cues) {
    curY -= 3;
    if (curY > rowMinY) {
      page.drawText('Cues', { x: COL2_X, y: curY, font: bold, size: cueSize, color: colors.textColor });
      curY -= cueSize + lineGap;
    }
    if (curY > rowMinY) {
      curY = drawWrapped(page, exercise.cues, regular, cueSize, COL2_X, curY, COL2_W, lineGap, colors.secondaryColor, rowMinY);
    }
  }

  // ── Progression / Regression column ───────────────────────────────────────
  // Col 3 has 4 sub-cells stacked vertically:
  //   top cell:    "Progression" label + text  (upper half of row)
  //   bottom cell: "Regression"  label + text  (lower half of row)
  const rowH        = layout.imgBot - layout.imgTop;
  const progCellBot = layout.imgTop + rowH * 0.5;   // midpoint of row
  const regCellBot  = layout.imgBot;

  // Progression
  const progTopY  = toY(layout.textTop + 8);
  const progMinY  = toY(progCellBot - 2);
  let   pY        = progTopY;

  if (exercise.progression) {
    page.drawText('Progression', { x: COL3_X, y: pY, font: bold,    size: 9, color: colors.textColor });
    pY -= 11;
    pY = drawWrapped(page, exercise.progression, regular, 8.5, COL3_X, pY, COL3_W, 2, colors.textColor, progMinY);
  }

  // Regression
  const regTopY  = toY(progCellBot + 8);
  const regMinY  = toY(regCellBot - 2);
  let   rY       = regTopY;

  if (exercise.regression) {
    page.drawText('Regression', { x: COL3_X, y: rY, font: bold,    size: 9, color: colors.textColor });
    rY -= 11;
    drawWrapped(page, exercise.regression, regular, 8.5, COL3_X, rY, COL3_W, 2, colors.textColor, regMinY);
  }
}

// ─── PAGE 6 — SOS Video ───────────────────────────────────────────────────────

function overlayPage6(pdfDoc, page, { bonusVideoUrl, weekNum }) {
  if (!bonusVideoUrl || bonusVideoUrl === '#') return;

  // WATCH VIDEO button rect (measured per week):
  // Weeks 1-3: x0=67 top=350 x1=304 bottom=396  (h≈46)
  // Week 4:    x0=67 top=344 x1=304 bottom=390  (h≈46)
  const btnTop    = weekNum === 4 ? 344 : 350;
  const btnBot    = weekNum === 4 ? 390 : 396;
  const btnH      = btnBot - btnTop;
  addLink(pdfDoc, page, 67, toY(btnBot), 237, btnH, bonusVideoUrl);
}

// ─── Main overlay function ────────────────────────────────────────────────────

async function overlayWeekPDF({ weekNum, name, profile, weekPlan, calendarUrl, bonusVideoUrl }) {
  const templatePath = path.join(__dirname, 'templates', `week${weekNum}.pdf`);
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);

  const fontsDir = path.join(__dirname, 'fonts');
  const bold    = await pdfDoc.embedFont(fs.readFileSync(path.join(fontsDir, 'WorkSans-Bold.ttf')));
  const regular = await pdfDoc.embedFont(fs.readFileSync(path.join(fontsDir, 'WorkSans-Regular.ttf')));

  const pages = pdfDoc.getPages();
  const [p1, p2, p3, p4, p5, p6] = pages;

  const wn = Math.max(1, Math.min(4, Number(weekNum) || 1));

  overlayPage1(pdfDoc, p1, { name, calendarUrl, bold, weekNum: wn });
  if (p2) overlayPage2(p2, { profile, bold, weekNum: wn });
  if (p3) overlayPage3(p3, { weekPlan, regular, bold, weekNum: wn });
  if (p4) await overlaySessionPage(pdfDoc, p4, weekPlan.morning, weekPlan.midday,    { bold, regular }, wn);
  if (p5) await overlaySessionPage(pdfDoc, p5, weekPlan.afternoon, weekPlan.evening, { bold, regular }, wn);
  if (p6) overlayPage6(pdfDoc, p6, { bonusVideoUrl, weekNum: wn });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { overlayWeekPDF };