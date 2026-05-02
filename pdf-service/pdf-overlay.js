'use strict';

const { PDFDocument, rgb, PDFName, PDFString, PDFArray } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

const PAGE_H = 842;
const toY = (top) => PAGE_H - top;

// IMAGE QUALITY FIX:
// PDF uses points, not pixels. If we rasterize image as 179x163 px,
// it will look blurry in PDF. Scale raster image up, but draw it
// into the same PDF box size.
const IMAGE_SCALE = 3;

const DARK = rgb(0.13, 0.13, 0.13);
const DARK_SEC = rgb(0.40, 0.38, 0.35);
const WHITE = rgb(1.0, 1.0, 1.0);
const WHITE_SEC = rgb(0.85, 0.83, 0.80);

const WEEK_COLORS = {
  1: { textColor: DARK, secondaryColor: DARK_SEC },
  2: { textColor: DARK, secondaryColor: DARK_SEC },
  3: { textColor: WHITE, secondaryColor: WHITE_SEC },
  4: { textColor: WHITE, secondaryColor: WHITE_SEC },
};

const PAGE1_LAYOUT = {
  1: { nameX: 148, commaX: 217.9, nameTop: 296 },
  2: { nameX: 193, commaX: 262.7, nameTop: 296 },
  3: { nameX: 193, commaX: 262.7, nameTop: 296 },
  4: { nameX: 193, commaX: 262.7, nameTop: 296 },
};

const PAGE2_LAYOUT = {
  valueX: 187,
  rowTops: [114, 156, 198, 240],
  maxRightX: 575,
};

function createPage3Layout() {
  return {
    rows: [
      { top: 706, bottom: 734 },
      { top: 737, bottom: 765 },
      { top: 767, bottom: 795 },
      { top: 796, bottom: 824 },
    ],
    warmupCol: { centerX: 260, width: 260 },
    mainCol: { centerX: 478, width: 145 },
  };
}

const PAGE3_LAYOUT = {
  1: createPage3Layout(),
  2: createPage3Layout(),
  3: createPage3Layout(),
  4: createPage3Layout(),
};

const SESSION_LAYOUT = [
  {
    warmup: { rowTop: 81, rowBot: 244, progRegSplit: 163 },
    main: { rowTop: 250, rowBot: 413, progRegSplit: 332 },
  },
  {
    warmup: { rowTop: 485, rowBot: 648, progRegSplit: 567 },
    main: { rowTop: 654, rowBot: 817, progRegSplit: 736 },
  },
];

const CARD_LAYOUT = {
  imageCol: { x: 19, width: 179, padding: 0 },
  textCol: { x: 204, width: 275, padding: 4 },
  rightCol: { x: 485, width: 91, padding: 4 },
};

const CARD_TEXT = {
  size: 11,
  lineGap: 2,
};

function sanitize(text) {
  if (text === null || text === undefined) return '';
  return String(text)
      .replace(/[\u2192]/g, '->')
      .replace(/[\u2190]/g, '<-')
      .replace(/[\u2191]/g, '^')
      .replace(/[\u2193]/g, 'v')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/\u2022/g, '*')
      .replace(/\s+/g, ' ')
      .trim();
}

function valueToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => valueToString(v)).filter(Boolean).join(', ');
  return '';
}

function ellipsisToFit(text, font, size, maxWidth, suffix = '...') {
  const clean = sanitize(text);
  if (!clean) return '';
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;

  let tail = suffix;
  while (tail && font.widthOfTextAtSize(tail, size) > maxWidth) {
    tail = tail.slice(0, -1);
  }
  if (!tail) return '';

  let out = clean;
  while (out && font.widthOfTextAtSize(`${out}${tail}`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}${tail}`;
}

function fitTextToLines(text, font, size, maxWidth, maxLines, withEllipsis = true) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (!words.length || maxLines <= 0) return { lines: [], overflow: false };

  const lines = [];
  let line = '';
  let i = 0;
  let overflow = false;

  while (i < words.length) {
    const word = words[i];
    const candidate = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      i += 1;
      continue;
    }

    if (!line) {
      lines.push(ellipsisToFit(word, font, size, maxWidth, ''));
      i += 1;
    } else {
      lines.push(line);
      line = '';
    }

    if (lines.length >= maxLines) {
      overflow = i < words.length || Boolean(line);
      break;
    }
  }

  if (!overflow && line) {
    if (lines.length < maxLines) {
      lines.push(line);
    } else {
      overflow = true;
    }
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
    overflow = true;
  }

  if (overflow && withEllipsis && lines.length) {
    lines[lines.length - 1] = ellipsisToFit(lines[lines.length - 1], font, size, maxWidth);
  }

  return { lines, overflow };
}

function drawTextBox(page, { text, font, size, color, x, top, maxWidth, align = 'left' }) {
  const clean = sanitize(text);
  if (!clean) return '';

  const output = maxWidth ? ellipsisToFit(clean, font, size, maxWidth) : clean;
  const width = font.widthOfTextAtSize(output, size);
  let drawX = x;
  if (align === 'center') drawX = x - width / 2;
  if (align === 'right') drawX = x - width;

  page.drawText(output, { x: drawX, y: toY(top), font, size, color });
  return output;
}

function drawWrappedWithinBox(page, {
  text,
  font,
  size,
  color,
  x,
  top,
  width,
  height,
  lineGap = 2,
  maxLines,
  align = 'left',
  valign = 'top',
  withEllipsis = true,
}) {
  const clean = sanitize(text);
  if (!clean || width <= 0 || height <= 0) return { lines: [], usedHeight: 0, overflow: false };

  const byHeight = Math.max(0, Math.floor((height + lineGap) / (size + lineGap)));
  const targetLines = Math.min(maxLines ?? byHeight, byHeight);
  if (targetLines <= 0) return { lines: [], usedHeight: 0, overflow: true };

  const fitted = fitTextToLines(clean, font, size, width, targetLines, withEllipsis);
  if (!fitted.lines.length) return { lines: [], usedHeight: 0, overflow: fitted.overflow };

  const usedHeight = fitted.lines.length * (size + lineGap) - lineGap;
  let startTop = top;
  if (valign === 'center') startTop = top + (height - usedHeight) / 2;
  if (valign === 'bottom') startTop = top + height - usedHeight;

  for (let i = 0; i < fitted.lines.length; i++) {
    const line = fitted.lines[i];
    const lw = font.widthOfTextAtSize(line, size);
    let lineX = x;
    if (align === 'center') lineX = x + (width - lw) / 2;
    if (align === 'right') lineX = x + width - lw;

    page.drawText(line, {
      x: lineX,
      y: toY(startTop + size + i * (size + lineGap)),
      font,
      size,
      color,
    });
  }

  return { lines: fitted.lines, usedHeight, overflow: fitted.overflow };
}
function drawCenteredMultiline(page, text, {
  font,
  color,
  centerX,
  top,
  height,
  width,
  maxLines = 2,
  lineGap = 0,
  preferredSize = 13,
  minSize = 9,
  verticalOffset = -1,
  paddingTop = 0,
  paddingBottom = 0,
}) {
  const clean = sanitize(text);
  if (!clean) return;

  const availableTop = top + paddingTop;
  const availableHeight = Math.max(0, height - paddingTop - paddingBottom);

  let picked = null;

  for (let size = preferredSize; size >= minSize; size--) {
    const fit = fitTextToLines(clean, font, size, width, maxLines, size === minSize);
    if (!fit.lines.length) continue;

    const lineStep = size + lineGap;
    const visualHeight = size + (fit.lines.length - 1) * lineStep;
    const fitsByWidth = !fit.overflow || size === minSize;
    const fitsByHeight = visualHeight <= availableHeight - 2;

    if (fitsByWidth && fitsByHeight) {
      picked = { size, lines: fit.lines, lineStep, visualHeight };
      break;
    }
  }

  if (!picked) {
    const fit = fitTextToLines(clean, font, minSize, width, maxLines, true);
    if (!fit.lines.length) return;

    const lineStep = minSize + lineGap;
    picked = {
      size: minSize,
      lines: fit.lines,
      lineStep,
      visualHeight: minSize + (fit.lines.length - 1) * lineStep,
    };
  }

  const ascentRatio = 0.78;
  const visualTop = availableTop + (availableHeight - picked.visualHeight) / 2 + verticalOffset;

  for (let i = 0; i < picked.lines.length; i++) {
    const line = picked.lines[i];
    const lineWidth = font.widthOfTextAtSize(line, picked.size);
    const baselineTop = visualTop + picked.size * ascentRatio + i * picked.lineStep;

    page.drawText(line, {
      x: centerX - lineWidth / 2,
      y: toY(baselineTop),
      font,
      size: picked.size,
      color,
    });
  }
}


function normalizeUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw || raw === '#') return '';
  if (/^https?:\/\/|^webcal:\/\/|^mailto:/i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return `https://${raw}`;
}

function addLink(pdfDoc, page, x, yBottom, width, height, url) {
  const href = normalizeUrl(url);
  if (!href) return;
  const annot = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x, yBottom, x + width, yBottom + height],
    Border: [0, 0, 0],
    A: pdfDoc.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(href),
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

function extractGdriveId(str) {
  const patterns = [
    /drive\.google\.com\/file\/d\/([^/]+)/i,
    /drive\.google\.com\/open\?id=([^&]+)/i,
    /drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/i,
    /docs\.google\.com\/uc\?(?:.*&)?id=([^&]+)/i,
    /[?&]id=([^&]+)/i,
  ];
  for (const p of patterns) {
    const m = String(str).match(p);
    if (m?.[1]) return m[1];
  }
  return '';
}

function parseImageUrl(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const v of value) {
      const parsed = parseImageUrl(v);
      if (parsed) return parsed;
    }
    return '';
  }

  const str = String(value).trim();
  if (!str) return '';

  const md = str.match(/\((https?:\/\/[^\s)]+)\)/i);
  const raw = md ? md[1] : (str.match(/https?:\/\/[^\s"')]+/i)?.[0] ?? str);
  const id = extractGdriveId(raw);

  // IMAGE QUALITY FIX:
  // Do not convert Drive URLs to thumbnail here.
  // Use original download URL first. Thumbnails are compressed previews
  // and often look blurry inside generated PDFs.
  return id
      ? `https://drive.google.com/uc?export=download&id=${id}`
      : raw.startsWith('http') ? raw : '';
}

function buildFetchCandidates(url) {
  const parsed = parseImageUrl(url);
  const id = extractGdriveId(url) || extractGdriveId(parsed);

  if (!id) return parsed ? [parsed] : [];

  // IMAGE QUALITY FIX:
  // Try original file first, then view URL, and only then high-resolution thumbnails.
  // Thumbnail is fallback, not primary source.
  return [
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.google.com/uc?export=view&id=${id}`,
    `https://drive.google.com/thumbnail?id=${id}&sz=w3200`,
    `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
  ];
}

function requestBinary(target, redirectsLeft, cookies = []) {
  return new Promise((resolve, reject) => {
    const mod = target.startsWith('https') ? https : http;
    const req = mod.get(target, {
      headers: {
        'User-Agent': 'mdt-pdf-service/3.0',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      },
    }, (res) => {
      const code = res.statusCode || 0;
      const location = res.headers.location;
      const nextCookies = [
        ...cookies,
        ...(res.headers['set-cookie'] || []).map((v) => v.split(';')[0]),
      ];

      if ([301, 302, 303, 307, 308].includes(code) && location && redirectsLeft > 0) {
        res.resume();
        resolve(requestBinary(new URL(location, target).toString(), redirectsLeft - 1, nextCookies));
        return;
      }

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: code, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });

    req.setTimeout(15000, () => req.destroy(new Error('Image request timeout')));
    req.on('error', reject);
  });
}

function detectFormat(res) {
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('avif')) return 'avif';

  const b = res.body;
  if (!b || b.length < 4) return '';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'webp';
  return '';
}

async function tryResolveHtmlConfirmPage(res) {
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('text/html')) return null;

  const html = res.body.toString('utf8');
  const m1 = html.match(/href="(\/uc\?export=download[^"]+)"/i);
  if (m1) return requestBinary(`https://drive.google.com${m1[1].replace(/&amp;/g, '&')}`, 10);

  const m2 = html.match(/"downloadUrl":"(https:[^"]+)"/i);
  if (m2) {
    return requestBinary(m2[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\/g, ''), 10);
  }

  return null;
}

async function fetchImageBytes(imageUrl) {
  const candidates = buildFetchCandidates(parseImageUrl(imageUrl));
  const errors = [];

  for (const candidate of candidates) {
    let res;
    try {
      res = await requestBinary(candidate, 10);
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
      continue;
    }

    if (res.statusCode !== 200) {
      errors.push(`${candidate}: HTTP ${res.statusCode}`);
      continue;
    }

    const format = detectFormat(res);
    if (format) return { bytes: res.body, format };

    let confirmed;
    try {
      confirmed = await tryResolveHtmlConfirmPage(res);
    } catch (err) {
      errors.push(`${candidate}: confirm page error: ${err.message}`);
      continue;
    }

    if (confirmed) {
      if (confirmed.statusCode !== 200) {
        errors.push(`${candidate}: confirm HTTP ${confirmed.statusCode}`);
        continue;
      }

      const confirmedFormat = detectFormat(confirmed);
      if (confirmedFormat) return { bytes: confirmed.body, format: confirmedFormat };
    }

    const meta = await sharp(res.body).metadata().catch(() => null);
    if (meta?.format) return { bytes: res.body, format: meta.format.toLowerCase() };

    errors.push(`${candidate}: unrecognised image payload`);
  }

  throw new Error(`Image fetch failed. Attempts: ${errors.join(' | ')}`);
}

async function normalizeImage(bytes, targetWidth, targetHeight) {
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));

  // IMAGE QUALITY FIX:
  // rotate() respects EXIF orientation.
  // lanczos3 gives better down/up-sampling quality.
  // PNG keeps line-art/illustrations cleaner than low-quality JPEG.
  return sharp(bytes)
      .rotate()
      .resize({
        width,
        height,
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .flatten({ background: '#ffffff' })
      .png({
        compressionLevel: 6,
        adaptiveFiltering: true,
      })
      .toBuffer()
      .catch(() => bytes);
}

async function drawImageContained(pdfDoc, page, imageUrl, box) {
  if (!imageUrl) return;

  try {
    const { bytes } = await fetchImageBytes(imageUrl);

    // IMAGE QUALITY FIX:
    // Render image at 3x pixel density, but draw it into the same PDF box.
    // This keeps layout unchanged and improves sharpness.
    const png = await normalizeImage(
        bytes,
        box.width * IMAGE_SCALE,
        box.height * IMAGE_SCALE
    );

    const img = await pdfDoc.embedPng(png);

    page.drawImage(img, {
      x: box.x,
      y: toY(box.bottom),
      width: box.width,
      height: box.height,
    });
  } catch (err) {
    console.warn(`Image skipped "${imageUrl}": ${err.message}`);
  }
}
function overlayPage1(pdfDoc, page, { name, calendarUrl, bold, weekNum }) {
  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const layout = PAGE1_LAYOUT[weekNum] || PAGE1_LAYOUT[1];
  const maxNameWidth = Math.max(0, layout.commaX - layout.nameX - 2);

  drawTextBox(page, {
    text: valueToString(name),
    font: bold,
    size: 17,
    color: colors.textColor,
    x: layout.nameX,
    top: layout.nameTop,
    maxWidth: maxNameWidth,
  });

  if (calendarUrl && calendarUrl !== '#') {
    addLink(pdfDoc, page, 67, toY(817.4), 237, 47, calendarUrl);
  }
}

function overlayPage2(page, { profile, bold, weekNum }) {
  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const source = profile && typeof profile === 'object' ? profile : {};

  const goal = source.primary_goal || source.goal || source.focus || '';
  const level = source.level || '';
  const environment = Array.isArray(source.spaces)
      ? source.spaces.join(', ')
      : (source.space || source.environment || '');
  const focus = source.focus_area || source.training_focus || source.focus_detail || '';

  const values = [goal, level, environment, focus];
  const maxWidth = PAGE2_LAYOUT.maxRightX - PAGE2_LAYOUT.valueX;

  for (let i = 0; i < PAGE2_LAYOUT.rowTops.length; i++) {
    drawTextBox(page, {
      text: valueToString(values[i]),
      font: bold,
      size: 17,
      color: colors.textColor,
      x: PAGE2_LAYOUT.valueX,
      top: PAGE2_LAYOUT.rowTops[i],
      maxWidth,
    });
  }
}

function overlayPage3(page, { weekPlan, regular, weekNum }) {
  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const layout = PAGE3_LAYOUT[weekNum] || PAGE3_LAYOUT[1];
  const slotsSource = weekPlan && typeof weekPlan === 'object' ? weekPlan : {};

  const slots = [
    slotsSource.morning,
    slotsSource.midday,
    slotsSource.afternoon,
    slotsSource.evening,
  ];

  const warmupCenterX = layout.warmupCol.centerX;
  const warmupWidth = layout.warmupCol.width;
  const mainCenterX = layout.mainCol.centerX;
  const mainWidth = layout.mainCol.width;

  for (let i = 0; i < layout.rows.length; i++) {
    const slot = slots[i] || {};
    const row = layout.rows[i];

    drawCenteredMultiline(page, valueToString(slot.warmup?.name), {
      font: regular,
      color: colors.textColor,
      centerX: warmupCenterX,
      top: row.top,
      height: row.bottom - row.top,
      width: warmupWidth,
      maxLines: 2,
      lineGap: 0,
      preferredSize: 13,
      minSize: 9,
      verticalOffset: -5,
      paddingTop: 1,
      paddingBottom: 3,
    });

    drawCenteredMultiline(page, valueToString(slot.main?.name), {
      font: regular,
      color: colors.textColor,
      centerX: mainCenterX,
      top: row.top,
      height: row.bottom - row.top,
      width: mainWidth,
      maxLines: 2,
      lineGap: 0,
      preferredSize: 13,
      minSize: 9,
      verticalOffset: -5,
      paddingTop: 1,
      paddingBottom: 3,
    });
  }
}

function drawExerciseMainTextArea(page, exercise, fonts, colors, box) {
  const { bold, regular } = fonts;
  const name = valueToString(exercise?.name);
  const description = valueToString(exercise?.description);
  const cues = valueToString(exercise?.cues);

  const pad = CARD_LAYOUT.textCol.padding;
  const innerX = box.x + pad;
  const innerTop = box.top + pad;
  const innerWidth = box.width - pad * 2;
  const innerHeight = Math.max(0, box.height - pad * 2 - 4);

  const size = CARD_TEXT.size;
  const lineGap = CARD_TEXT.lineGap;

  let contentBottom = innerTop + innerHeight;

  if (cues) {
    const minUpperHeight = (size + lineGap) * 5;
    const maxCuesHeight = Math.max(0, innerHeight - minUpperHeight);
    const cuesLabelGap = 2;
    const cuesSectionGap = 4;

    const bodyAvailable = Math.max(0, maxCuesHeight - cuesSectionGap - size - cuesLabelGap);
    const maxCueLines = Math.max(1, Math.floor((bodyAvailable + lineGap) / (size + lineGap)));
    const cueFit = fitTextToLines(cues, regular, size, innerWidth, maxCueLines, true);
    const cueBodyHeight = cueFit.lines.length ? cueFit.lines.length * (size + lineGap) - lineGap : 0;
    const cuesBlockHeight = cuesSectionGap + size + cuesLabelGap + cueBodyHeight;

    const cuesTop = innerTop + innerHeight - cuesBlockHeight;
    const cuesLabelVisualTop = cuesTop + cuesSectionGap;
    const cuesBodyTop = cuesLabelVisualTop + size + cuesLabelGap;

    contentBottom = Math.max(innerTop, cuesTop - 4);

    drawTextBox(page, {
      text: 'Cues',
      font: bold,
      size,
      color: colors.textColor,
      x: innerX,
      top: cuesLabelVisualTop + size,
      maxWidth: innerWidth,
    });

    drawWrappedWithinBox(page, {
      text: cueFit.lines.join(' '),
      font: regular,
      size,
      color: colors.textColor,
      x: innerX,
      top: cuesBodyTop,
      width: innerWidth,
      height: cueBodyHeight || bodyAvailable,
      lineGap,
      maxLines: cueFit.lines.length || maxCueLines,
      withEllipsis: true,
    });
  }

  let cursorTop = innerTop;
  if (name && cursorTop < contentBottom) {
    const nameBoxHeight = Math.max(0, contentBottom - cursorTop);
    const nameRender = drawWrappedWithinBox(page, {
      text: name,
      font: bold,
      size,
      color: colors.textColor,
      x: innerX,
      top: cursorTop,
      width: innerWidth,
      height: nameBoxHeight,
      lineGap,
      maxLines: 2,
      withEllipsis: true,
    });
    cursorTop += nameRender.usedHeight + 2;
  }

  if (description && cursorTop < contentBottom) {
    drawWrappedWithinBox(page, {
      text: description,
      font: regular,
      size,
      color: colors.textColor,
      x: innerX,
      top: cursorTop,
      width: innerWidth,
      height: Math.max(0, contentBottom - cursorTop),
      lineGap,
      withEllipsis: true,
    });
  }
}

function drawProgressionRegression(page, exercise, fonts, colors, layout) {
  const { bold, regular } = fonts;
  const size = CARD_TEXT.size;
  const lineGap = CARD_TEXT.lineGap;

  const pad = CARD_LAYOUT.rightCol.padding;
  const rightX = CARD_LAYOUT.rightCol.x;
  const rightWidth = CARD_LAYOUT.rightCol.width;

  const progressionText = valueToString(exercise?.progression);
  const regressionText = valueToString(exercise?.regression);

  const progressionBox = {
    x: rightX,
    top: layout.rowTop,
    width: rightWidth,
    height: layout.progRegSplit - layout.rowTop,
  };
  const regressionBox = {
    x: rightX,
    top: layout.progRegSplit,
    width: rightWidth,
    height: layout.rowBot - layout.progRegSplit,
  };

  if (progressionText) {
    const innerX = progressionBox.x + pad;
    const innerTop = progressionBox.top + pad;
    const innerWidth = progressionBox.width - pad * 2;
    const innerHeight = Math.max(0, progressionBox.height - pad * 2 - 4);
    const labelVisualTop = innerTop;

    drawTextBox(page, {
      text: 'Progression',
      font: bold,
      size,
      color: colors.textColor,
      x: innerX,
      top: labelVisualTop + size,
      maxWidth: innerWidth,
    });

    drawWrappedWithinBox(page, {
      text: progressionText,
      font: regular,
      size,
      color: colors.textColor,
      x: innerX,
      top: labelVisualTop + size + 3,
      width: innerWidth,
      height: Math.max(0, innerHeight - size - 3),
      lineGap,
      withEllipsis: true,
    });
  }

  if (regressionText) {
    const innerX = regressionBox.x + pad;
    const innerTop = regressionBox.top + pad;
    const innerWidth = regressionBox.width - pad * 2;
    const innerHeight = Math.max(0, regressionBox.height - pad * 2 - 4);
    const labelVisualTop = innerTop;

    drawTextBox(page, {
      text: 'Regression',
      font: bold,
      size,
      color: colors.textColor,
      x: innerX,
      top: labelVisualTop + size,
      maxWidth: innerWidth,
    });

    drawWrappedWithinBox(page, {
      text: regressionText,
      font: regular,
      size,
      color: colors.textColor,
      x: innerX,
      top: labelVisualTop + size + 3,
      width: innerWidth,
      height: Math.max(0, innerHeight - size - 3),
      lineGap,
      withEllipsis: true,
    });
  }
}

async function overlayExerciseRow(pdfDoc, page, exercise, layout, fonts, weekNum) {
  if (!exercise) return;

  const colors = WEEK_COLORS[weekNum] || WEEK_COLORS[1];
  const rowHeight = layout.rowBot - layout.rowTop;

  const imageUrl = parseImageUrl(
      exercise.image_url || exercise.imageUrl || exercise.image || exercise.photo_url || exercise.photoUrl || ''
  );

  await drawImageContained(pdfDoc, page, imageUrl, {
    x: CARD_LAYOUT.imageCol.x,
    top: layout.rowTop,
    bottom: layout.rowBot,
    width: CARD_LAYOUT.imageCol.width,
    height: rowHeight,
  });

  drawExerciseMainTextArea(page, exercise, fonts, colors, {
    x: CARD_LAYOUT.textCol.x,
    top: layout.rowTop,
    width: CARD_LAYOUT.textCol.width,
    height: rowHeight,
  });

  drawProgressionRegression(page, exercise, fonts, colors, layout);
}

async function overlaySessionPage(pdfDoc, page, slot1, slot2, fonts, weekNum) {
  const slots = [slot1, slot2];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const layout = SESSION_LAYOUT[i];
    await overlayExerciseRow(pdfDoc, page, slot.warmup, layout.warmup, fonts, weekNum);
    await overlayExerciseRow(pdfDoc, page, slot.main, layout.main, fonts, weekNum);
  }
}

function overlayPage6(pdfDoc, page, { bonusVideoUrl, weekNum }) {
  if (!bonusVideoUrl || bonusVideoUrl === '#') return;
  const btnTop = weekNum === 4 ? 344.4 : 350.4;
  const btnBot = weekNum === 4 ? 390.4 : 396.4;
  addLink(pdfDoc, page, 67, toY(btnBot), 237, btnBot - btnTop, bonusVideoUrl);
}

async function overlayWeekPDF({ weekNum, name, profile, weekPlan, calendarUrl, bonusVideoUrl }) {
  const wn = Math.max(1, Math.min(4, Number(weekNum) || 1));

  const templatePath = path.join(__dirname, 'templates', `week${wn}.pdf`);
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);

  const fontsDir = path.join(__dirname, 'fonts');
  const bold = await pdfDoc.embedFont(fs.readFileSync(path.join(fontsDir, 'WorkSans-Bold.ttf')));
  const regular = await pdfDoc.embedFont(fs.readFileSync(path.join(fontsDir, 'WorkSans-Regular.ttf')));

  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  const safeWeekPlan = weekPlan && typeof weekPlan === 'object' ? weekPlan : {};

  const [p1, p2, p3, p4, p5, p6] = pdfDoc.getPages();

  if (p1) overlayPage1(pdfDoc, p1, { name, calendarUrl, bold, weekNum: wn });
  if (p2) overlayPage2(p2, { profile: safeProfile, bold, weekNum: wn });
  if (p3) overlayPage3(p3, { weekPlan: safeWeekPlan, regular, weekNum: wn });
  if (p4) await overlaySessionPage(pdfDoc, p4, safeWeekPlan.morning, safeWeekPlan.midday, { bold, regular }, wn);
  if (p5) await overlaySessionPage(pdfDoc, p5, safeWeekPlan.afternoon, safeWeekPlan.evening, { bold, regular }, wn);
  if (p6) overlayPage6(pdfDoc, p6, { bonusVideoUrl, weekNum: wn });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { overlayWeekPDF };