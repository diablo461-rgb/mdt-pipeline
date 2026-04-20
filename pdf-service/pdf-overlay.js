'use strict';

const { PDFDocument, rgb, PDFName, PDFString, PDFArray } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs   = require('fs');
const path = require('path');

// A4 page height in points (pdfplumber uses top-origin; pdf-lib uses bottom-origin)
const PAGE_H = 842;

// Convert pdfplumber "top from page top" → pdf-lib "y from page bottom"
const toY = (top) => PAGE_H - top;

// Dark text colour used throughout
const DARK  = rgb(0.05, 0.05, 0.05);
const MID   = rgb(0.25, 0.25, 0.25);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Replace characters not supported by WinAnsi (used by pdf-lib standard fonts). */
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

/** Split text into lines that fit maxWidth at given fontSize. */
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
 * Draw wrapped text starting at (x, y) going downward.
 * Returns the y of the last drawn baseline.
 */
function drawWrapped(page, text, font, size, x, y, maxWidth, lineGap, color) {
  if (!text) return y;
  const lines = wrapText(sanitize(String(text)), font, size, maxWidth);
  for (const ln of lines) {
    page.drawText(ln, { x, y, font, size, color: color || DARK });
    y -= size + lineGap;
  }
  return y;
}

/**
 * Add a clickable URI annotation rectangle to a page.
 * Coordinates are pdf-lib (bottom-origin).
 */
function addLink(pdfDoc, page, x, yBottom, width, height, url) {
  if (!url || url === '#') return;
  const annot = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x, yBottom, x + width, yBottom + height],
    Border: [0, 0, 0],
    A: pdfDoc.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(url),
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

/** Fetch image bytes from a URL (http or https). */
function fetchImageBytes(url) {
  const https = require('https');
  const http  = require('http');
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Embed and draw an exercise image (JPEG/PNG) in a box. */
async function drawExerciseImage(pdfDoc, page, imageUrl, x, yBottom, width, height) {
  if (!imageUrl) return;
  try {
    const bytes = await fetchImageBytes(imageUrl);
    let img;
    // Try JPEG first, fall back to PNG
    try {
      img = await pdfDoc.embedJpg(bytes);
    } catch {
      img = await pdfDoc.embedPng(bytes);
    }
    // Scale to fit box while preserving aspect ratio
    const scale = Math.min(width / img.width, height / img.height);
    const drawW = img.width  * scale;
    const drawH = img.height * scale;
    const drawX = x + (width  - drawW) / 2;
    const drawY = yBottom + (height - drawH) / 2;
    page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
  } catch {
    // Silently skip if image fetch/embed fails
  }
}

// ─── Per-page overlay functions ───────────────────────────────────────────────

/**
 * Page 1 – Cover.
 * Template has: "Welcome _______ ,"  (blank underline between Welcome and comma)
 * Dynamic: user name, calendar link.
 */
function overlayPage1(pdfDoc, page, { name, calendarUrl, bold }) {
  // Name sits right after "Welcome " (which ends at x≈142.5) on the same baseline.
  // pdfplumber extracted ",\n" at x0=212.1, top=281 – name goes between 142.5 and 212.1.
  // We draw with size 17 bold at y = PAGE_H − top_of_text_box − fontSize.
  // "Welcome" top=281, bottom=298 → baseline ≈ PAGE_H - 298 = 544.
  const nameFontSize = 17;
  const nameText = name || '';
  // Measure and trim if too long to avoid overwriting comma
  const maxNameWidth = 63; // 212.1 - 144 ≈ 68, leave small margin
  let displayName = nameText;
  while (
    displayName.length > 0 &&
    bold.widthOfTextAtSize(displayName, nameFontSize) > maxNameWidth
  ) {
    displayName = displayName.slice(0, -1);
  }

  // Cover template underline: top=297, bot=298 → pdf-lib y=844–845 (toY(298)=544, toY(297)=545)
  // Rect must start at y=543 to cover the 1pt curve at y=544–545.
  // Use photo background colour (~warm light grey) so the rect blends in.
  page.drawRectangle({ x: 143, y: toY(298) - 1, width: 70, height: 4, color: rgb(0.90, 0.89, 0.87) });
  page.drawText(sanitize(displayName), {
    x: 150,               // +6pt space before name
    y: toY(298),
    font: bold,
    size: nameFontSize,
    color: DARK,
  });

  // Clickable link over the "ADD MDT TO CALENDAR >>>" dark button.
  // Button text is at pdfplumber top≈786, bottom≈798 inside a dark rect.
  // Button rect (dark bg) runs approximately x=67–290, top≈778–802.
  if (calendarUrl && calendarUrl !== '#') {
    addLink(pdfDoc, page, 67, toY(802), 224, 24, calendarUrl);
  }
}

/**
 * Page 2 – Your Profile.
 * Template has blank underlines after Focus: / Level: / Environment: / Sensitivity:
 * Values in Bold Work Sans, size 17.
 */
function overlayPage2(page, { profile, regular }) {
  const sz = 17;
  const entries = [
    { y: toY(108), value: profile.focus        || profile.primary_goal || '' },
    { y: toY(150), value: profile.level        || '' },
    { y: toY(192), value: Array.isArray(profile.spaces)
        ? profile.spaces.join(', ')
        : String(profile.spaces || '') },
    { y: toY(234), value: profile.sensitivity  || '' },
  ];
  for (const { y, value } of entries) {
    if (value) {
      page.drawText(sanitize(String(value)), { x: 190, y, font: regular, size: sz, color: DARK });
    }
  }
}

/**
 * Page 3 – General concept + Your weekly plan table.
 * Fills in Warm-Up and Main Exercise columns with exercise names.
 */
function overlayPage3(page, { weekPlan, regular }) {
  const sz = 13;
  // Column x positions (from pdfplumber): Warm-Up header x0=294, Main Exercise x0=403
  const warmupX = 282;
  const mainX   = 393;
  const warmupW = 108;  // width until Main column
  const mainW   = 130;  // width until right margin

  // Row baselines (pdfplumber bot → pdf-lib y):
  //   Morning bot=720, Midday bot=749, Afternoon bot=779, Evening bot=808
  const rows = [
    { y: toY(720), slot: weekPlan.morning   },
    { y: toY(749), slot: weekPlan.midday    },
    { y: toY(779), slot: weekPlan.afternoon },
    { y: toY(808), slot: weekPlan.evening   },
  ];

  for (const { y, slot } of rows) {
    if (!slot) continue;
    const wuName = slot.warmup && slot.warmup.name ? sanitize(String(slot.warmup.name)) : '';
    const mnName = slot.main   && slot.main.name   ? sanitize(String(slot.main.name))   : '';

    // Truncate to fit column width
    let wu = wuName;
    while (wu.length > 1 && regular.widthOfTextAtSize(wu, sz) > warmupW - 4) wu = wu.slice(0, -1);
    let mn = mnName;
    while (mn.length > 1 && regular.widthOfTextAtSize(mn, sz) > mainW - 4) mn = mn.slice(0, -1);

    if (wu) page.drawText(wu, { x: warmupX, y, font: regular, size: sz, color: DARK });
    if (mn) page.drawText(mn, { x: mainX,   y, font: regular, size: sz, color: DARK });
  }
}

/**
 * Pages 4 & 5 – Session exercises.
 *
 * Layout per page (2 sessions, each with 2 rows):
 *   Session A (Morning/Afternoon):
 *     Header dark bar: top=25–73
 *     Row 1 Warmup:  top=80–240  (then 8 pt gap)
 *     Row 2 Main:    top=248–408
 *   Session B (Midday/Evening):
 *     Header dark bar: top=434–482
 *     Row 1 Warmup:  top=490–650  (8 pt gap)
 *     Row 2 Main:    top=658–818
 *
 * Columns (x, pdfplumber coords):
 *   Col1 image:  x=19–198   (width 179)
 *   Col2 text:   x=205–432  (width 227, text from x=213)
 *   Col3 split into 2 stacked boxes:
 *     Col3a top:  x=441–576  top=rowTop    to rowTop+76
 *     Col3b btm:  x=441–576  top=rowTop+84 to rowTop+160
 */
const SESSIONS_LAYOUT = [
  { rowATop: 80,  rowBTop: 248 },   // Session A rows (Morning or Afternoon)
  { rowATop: 490, rowBTop: 658 },   // Session B rows (Midday or Evening)
];

async function overlaySessionPage(pdfDoc, page, slot1, slot2, fonts) {
  const slots = [slot1, slot2];
  for (let si = 0; si < 2; si++) {
    const slot = slots[si];
    if (!slot) continue;
    const layout = SESSIONS_LAYOUT[si];
    const rows = [
      { data: slot.warmup, rowTop: layout.rowATop },
      { data: slot.main,   rowTop: layout.rowBTop },
    ];
    for (const { data, rowTop } of rows) {
      if (!data) continue;
      await overlayExerciseRow(pdfDoc, page, data, rowTop, fonts);
    }
  }
}

async function overlayExerciseRow(pdfDoc, page, exercise, rowTop, { bold, regular }) {
  const PAD = 4;  // 4pt padding on all sides

  // Col1 image box: x=19–198, rowTop to rowTop+160
  const imgX      = 19 + PAD;
  const imgYBot   = toY(rowTop + 160 - PAD);
  const imgWidth  = 179 - PAD * 2;
  const imgHeight = 160 - PAD * 2;
  await drawExerciseImage(pdfDoc, page, exercise.image_url, imgX, imgYBot, imgWidth, imgHeight);

  // Col2 text area: x=205–432. White bg to erase template underlines.
  const col2X     = 205 + PAD;   // 209
  const col2Width = 432 - col2X - PAD;  // 219
  const nameSize  = 13;
  const descSize  = 11;
  const cueSize   = 9;
  const lineGap   = 3;

  // Name (Bold) – 4pt from top of row
  const nameY = toY(rowTop + PAD + nameSize);
  page.drawText(sanitize(String(exercise.name || '')), {
    x: col2X, y: nameY, font: bold, size: nameSize, color: DARK,
  });

  // Description (Regular size 11, wrapped)
  let curY = nameY - nameSize - lineGap - 2;
  if (exercise.description) {
    curY = drawWrapped(page, exercise.description, regular, descSize,
      col2X, curY, col2Width, lineGap, DARK);
  }

  // Cues below description
  if (exercise.cues) {
    curY -= PAD;
    drawWrapped(page, exercise.cues, regular, cueSize,
      col2X, curY, col2Width, lineGap, MID);
  }

  // Col3 two stacked boxes: x=441–576. White bg first.
  const col3X     = 441 + PAD;  // 445
  const col3Width = 576 - col3X - PAD;  // 127

  // Col3a top box (rowTop to rowTop+76): exercise name (Bold)
  const col3aY = toY(rowTop + PAD + 8);
  drawWrapped(page, String(exercise.name || ''), bold, 8, col3X, col3aY, col3Width, 3, DARK);

  // Col3b bottom box (rowTop+84 to rowTop+160): cues (Regular)
  if (exercise.cues) {
    const col3bY = toY(rowTop + 84 + PAD + 8);
    drawWrapped(page, exercise.cues, regular, 8, col3X, col3bY, col3Width, 3, MID);
  }
}

/**
 * Page 6 – SOS + video.
 * Dynamic: clickable link over the main video image area.
 * From pdfplumber: img X2 at x0=284, top=641, w=343, h=230
 */
function overlayPage6(pdfDoc, page, { bonusVideoUrl }) {
  if (bonusVideoUrl && bonusVideoUrl !== '#') {
    // Clamp to page bounds: max bottom = PAGE_H = 842
    const top    = 641;
    const height = Math.min(230, PAGE_H - top);
    addLink(pdfDoc, page, 284, toY(top + height), 343, height, bonusVideoUrl);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a personalised PDF for a given week.
 *
 * @param {object} opts
 * @param {number}  opts.weekNum       1–4
 * @param {string}  opts.name          User's first name
 * @param {object}  opts.profile       { focus, level, spaces, sensitivity, primary_goal }
 * @param {object}  opts.weekPlan      { morning, midday, afternoon, evening }
 *                                     Each slot: { label, time, warmup: {name,description,cues,image_url},
 *                                                             main:   {name,description,cues,image_url} }
 * @param {string=} opts.calendarUrl
 * @param {string=} opts.bonusVideoUrl
 * @returns {Promise<Buffer>} PDF bytes
 */
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

  overlayPage1(pdfDoc, p1, { name, calendarUrl, bold });
  overlayPage2(p2, { profile, regular });
  if (p3) overlayPage3(p3, { weekPlan, regular });
  await overlaySessionPage(pdfDoc, p4, weekPlan.morning,   weekPlan.midday,   { bold, regular });
  await overlaySessionPage(pdfDoc, p5, weekPlan.afternoon, weekPlan.evening,  { bold, regular });
  if (p6) overlayPage6(pdfDoc, p6, { bonusVideoUrl });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { overlayWeekPDF };
