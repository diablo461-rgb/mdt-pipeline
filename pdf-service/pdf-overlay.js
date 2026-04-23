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

const DARK = rgb(0.05, 0.05, 0.05);
const MID = rgb(0.25, 0.25, 0.25);

function normalizeUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw || raw === '#') return '';
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('webcal://') ||
    raw.startsWith('mailto:')
  ) {
    return raw;
  }
  if (raw.startsWith('//')) return `https:${raw}`;
  return `https://${raw}`;
}

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

function addLink(pdfDoc, page, x, yBottom, width, height, url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;

  const annot = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x, yBottom, x + width, yBottom + height],
    Border: [0, 0, 0],
    A: pdfDoc.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(normalized),
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

function extractGoogleDriveFileId(value) {
  if (!value) return '';
  const str = String(value).trim();

  const patterns = [
    /drive\.google\.com\/file\/d\/([^/]+)/i,
    /drive\.google\.com\/open\?id=([^&]+)/i,
    /drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/i,
    /docs\.google\.com\/uc\?(?:.*&)?id=([^&]+)/i,
    /[?&]id=([^&]+)/i,
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match && match[1]) return match[1];
  }

  return '';
}

function toDirectImageUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return '';

  const fileId = extractGoogleDriveFileId(normalized);
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  return normalized;
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
  if (md) return toDirectImageUrl(md[1]);

  const css = str.match(/url\((https?:\/\/[^\s)]+)\)/i);
  if (css) return toDirectImageUrl(css[1]);

  const plain = str.match(/https?:\/\/[^\s"')]+/i);
  if (plain) return toDirectImageUrl(plain[0]);

  return toDirectImageUrl(str);
}

function requestBinary(target, redirectsLeft, cookies = []) {
  return new Promise((resolve, reject) => {
    const mod = target.startsWith('https') ? https : http;

    const req = mod.get(target, {
      headers: {
        'User-Agent': 'mdt-pdf-service/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      },
    }, (res) => {
      const code = res.statusCode || 0;
      const location = res.headers.location;
      const setCookie = res.headers['set-cookie'] || [];
      const nextCookies = [...cookies, ...setCookie.map((v) => v.split(';')[0])];

      if ([301, 302, 303, 307, 308].includes(code) && location && redirectsLeft > 0) {
        const next = new URL(location, target).toString();
        res.resume();
        resolve(requestBinary(next, redirectsLeft - 1, nextCookies));
        return;
      }

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: code,
          headers: res.headers,
          body: Buffer.concat(chunks),
          finalUrl: target,
        });
      });
      res.on('error', reject);
    });

    req.setTimeout(15000, () => req.destroy(new Error('Image request timeout')));
    req.on('error', reject);
  });
}

function extensionFromPathname(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const idx = pathname.lastIndexOf('.');
    if (idx < 0) return '';
    return pathname.slice(idx + 1);
  } catch {
    return '';
  }
}

function detectFormatFromContentType(contentTypeHeader) {
  const contentType = String(contentTypeHeader || '').toLowerCase();

  if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) return 'jpeg';
  if (contentType.includes('image/png')) return 'png';
  if (contentType.includes('image/webp')) return 'webp';
  if (contentType.includes('image/gif')) return 'gif';
  if (contentType.includes('image/tiff')) return 'tiff';
  if (contentType.includes('image/avif')) return 'avif';
  if (contentType.includes('image/heic')) return 'heic';
  if (contentType.includes('image/heif')) return 'heif';

  return '';
}

function detectFormatFromBytes(buffer) {
  if (!buffer || buffer.length < 12) return '';

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpeg';
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'gif';
  }

  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return 'tiff';
  }

  const header = buffer.slice(4, 12).toString('ascii');
  if (header === 'ftypavif') return 'avif';
  if (header.startsWith('ftypheic')) return 'heic';
  if (header.startsWith('ftypheix')) return 'heic';
  if (header.startsWith('ftyphevc')) return 'heic';
  if (header.startsWith('ftyphevx')) return 'heic';
  if (header.startsWith('ftypmif1')) return 'heif';
  if (header.startsWith('ftypmsf1')) return 'heif';

  return '';
}

function detectImageFormat(response) {
  const byType = detectFormatFromContentType(response.headers['content-type']);
  if (byType) return byType;

  const byBytes = detectFormatFromBytes(response.body);
  if (byBytes) return byBytes;

  const byExt = extensionFromPathname(response.finalUrl);
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'heic', 'heif'].includes(byExt)) {
    if (byExt === 'jpg') return 'jpeg';
    if (byExt === 'tif') return 'tiff';
    return byExt;
  }

  return '';
}

async function resolveDriveConfirmPage(response) {
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('text/html')) return null;

  const html = response.body.toString('utf8');

  const confirmMatch = html.match(/href="(\/uc\?export=download[^"]+)"/i);
  if (confirmMatch) {
    const confirmUrl = `https://drive.google.com${confirmMatch[1].replace(/&amp;/g, '&')}`;
    return requestBinary(confirmUrl, 10);
  }

  const formMatch = html.match(/<form[^>]+action="([^"]*uc[^"]*)"[^>]*>/i);
  if (formMatch) {
    const formUrl = new URL(formMatch[1].replace(/&amp;/g, '&'), 'https://drive.google.com').toString();
    const confirmTokenMatch = html.match(/name="confirm"\s+value="([^"]+)"/i);
    const idMatch = html.match(/name="id"\s+value="([^"]+)"/i);

    const urlObj = new URL(formUrl);
    if (confirmTokenMatch && !urlObj.searchParams.get('confirm')) {
      urlObj.searchParams.set('confirm', confirmTokenMatch[1]);
    }
    if (idMatch && !urlObj.searchParams.get('id')) {
      urlObj.searchParams.set('id', idMatch[1]);
    }

    return requestBinary(urlObj.toString(), 10);
  }

  return null;
}

async function fetchImageBytes(url) {
  const normalized = parseImageUrl(url);
  if (!normalized) {
    throw new Error('Empty image URL');
  }

  let response = await requestBinary(normalized, 10);

  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode}`);
  }

  let format = detectImageFormat(response);
  if (format) {
    return { bytes: response.body, format };
  }

  const maybeConfirmed = await resolveDriveConfirmPage(response);
  if (maybeConfirmed) {
    if (maybeConfirmed.statusCode !== 200) {
      throw new Error(`Google Drive confirm HTTP ${maybeConfirmed.statusCode}`);
    }

    format = detectImageFormat(maybeConfirmed);
    if (format) {
      return { bytes: maybeConfirmed.body, format };
    }

    response = maybeConfirmed;
  }

  const meta = await sharp(response.body).metadata().catch(() => null);
  if (meta && meta.format) {
    return { bytes: response.body, format: meta.format.toLowerCase() };
  }

  throw new Error(`Unsupported or undetected image format for URL: ${normalized}`);
}

async function normalizeImageForPdf(bytes, format) {
  const normalizedFormat = String(format || '').toLowerCase();

  if (normalizedFormat === 'jpeg' || normalizedFormat === 'png') {
    return { bytes, format: normalizedFormat };
  }

  const converted = await sharp(bytes).png().toBuffer();
  return { bytes: converted, format: 'png' };
}

async function drawExerciseImage(pdfDoc, page, imageUrl, x, yBottom, width, height) {
  if (!imageUrl) return;

  try {
    const fetched = await fetchImageBytes(imageUrl);
    const normalized = await normalizeImageForPdf(fetched.bytes, fetched.format);

    let img;
    if (normalized.format === 'png') {
      img = await pdfDoc.embedPng(normalized.bytes);
    } else {
      img = await pdfDoc.embedJpg(normalized.bytes);
    }

    const scale = Math.min(width / img.width, height / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = x + (width - drawW) / 2;
    const drawY = yBottom + (height - drawH) / 2;

    page.drawImage(img, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
    });
  } catch (e) {
    console.warn(`Image render skipped for URL "${imageUrl}": ${e.message}`);
  }
}

function overlayPage1(pdfDoc, page, { name, calendarUrl, bold }) {
  const nameFontSize = 17;
  const nameText = name || '';
  const maxNameWidth = 56;
  let displayName = nameText;

  while (
    displayName.length > 0 &&
    bold.widthOfTextAtSize(displayName, nameFontSize) > maxNameWidth
  ) {
    displayName = displayName.slice(0, -1);
  }

  page.drawRectangle({ x: 143, y: toY(298) - 1, width: 70, height: 4, color: rgb(0.90, 0.89, 0.87) });
  page.drawRectangle({ x: 208, y: toY(298) - 2, width: 14, height: 8, color: rgb(0.90, 0.89, 0.87) });
  page.drawText(sanitize(displayName), {
    x: 150,
    y: toY(298),
    font: bold,
    size: nameFontSize,
    color: DARK,
  });

  const commaX = 150 + bold.widthOfTextAtSize(sanitize(displayName), nameFontSize) + 4;
  page.drawText(',', {
    x: commaX,
    y: toY(298),
    font: bold,
    size: nameFontSize,
    color: DARK,
  });

  if (calendarUrl && calendarUrl !== '#') {
    addLink(pdfDoc, page, 67, toY(802), 224, 24, calendarUrl);
  }
}

function overlayPage2(page, { profile, regular }) {
  const sz = 17;
  const entries = [
    { y: toY(108), value: profile.focus || profile.primary_goal || '' },
    { y: toY(150), value: profile.level || '' },
    { y: toY(192), value: Array.isArray(profile.spaces)
        ? profile.spaces.join(', ')
        : String(profile.spaces || '') },
    { y: toY(234), value: profile.sensitivity || '' },
  ];

  for (const { y, value } of entries) {
    if (value) {
      page.drawText(sanitize(String(value)), { x: 190, y, font: regular, size: sz, color: DARK });
    }
  }
}

function overlayPage3(page, { weekPlan, regular }) {
  const sz = 13;
  const warmupX = 282;
  const mainX = 393;
  const warmupW = 108;
  const mainW = 130;

  const rows = [
    { y: toY(720), slot: weekPlan.morning },
    { y: toY(749), slot: weekPlan.midday },
    { y: toY(779), slot: weekPlan.afternoon },
    { y: toY(808), slot: weekPlan.evening },
  ];

  for (const { y, slot } of rows) {
    if (!slot) continue;

    const wuName = slot.warmup && slot.warmup.name ? sanitize(String(slot.warmup.name)) : '';
    const mnName = slot.main && slot.main.name ? sanitize(String(slot.main.name)) : '';

    let wu = wuName;
    while (wu.length > 1 && regular.widthOfTextAtSize(wu, sz) > warmupW - 4) wu = wu.slice(0, -1);

    let mn = mnName;
    while (mn.length > 1 && regular.widthOfTextAtSize(mn, sz) > mainW - 4) mn = mn.slice(0, -1);

    if (wu) page.drawText(wu, { x: warmupX, y, font: regular, size: sz, color: DARK });
    if (mn) page.drawText(mn, { x: mainX, y, font: regular, size: sz, color: DARK });
  }
}

const SESSIONS_LAYOUT = [
  { rowATop: 80, rowBTop: 248 },
  { rowATop: 490, rowBTop: 658 },
];

async function overlaySessionPage(pdfDoc, page, slot1, slot2, fonts) {
  const slots = [slot1, slot2];

  for (let si = 0; si < 2; si++) {
    const slot = slots[si];
    if (!slot) continue;

    const layout = SESSIONS_LAYOUT[si];
    const rows = [
      { data: slot.warmup, rowTop: layout.rowATop },
      { data: slot.main, rowTop: layout.rowBTop },
    ];

    for (const { data, rowTop } of rows) {
      if (!data) continue;
      await overlayExerciseRow(pdfDoc, page, data, rowTop, fonts);
    }
  }
}

async function overlayExerciseRow(pdfDoc, page, exercise, rowTop, { bold, regular }) {
  const PAD = 4;

  const imgX = 19 + PAD;
  const imgYBot = toY(rowTop + 160 - PAD);
  const imgWidth = 179 - PAD * 2;
  const imgHeight = 160 - PAD * 2;
  const rowMinY = imgYBot + 2;

  const imageUrl = parseImageUrl(
    exercise.image_url || exercise.imageUrl || exercise.image || exercise.photo_url || exercise.photoUrl
  );

  await drawExerciseImage(pdfDoc, page, imageUrl, imgX, imgYBot, imgWidth, imgHeight);

  const col2X = 205 + PAD;
  const col2Width = 432 - col2X - PAD;
  const nameSize = 13;
  const descSize = 11;
  const cueSize = 9;
  const lineGap = 3;

  const nameY = toY(rowTop + PAD + nameSize);
  page.drawText(sanitize(String(exercise.name || '')), {
    x: col2X,
    y: nameY,
    font: bold,
    size: nameSize,
    color: DARK,
  });

  let curY = nameY - nameSize - lineGap - 2;

  if (exercise.description) {
    curY = drawWrapped(
      page,
      exercise.description,
      regular,
      descSize,
      col2X,
      curY,
      col2Width,
      lineGap,
      DARK,
      rowMinY
    );
  }

  if (exercise.cues) {
    curY -= PAD;
    drawWrapped(
      page,
      exercise.cues,
      regular,
      cueSize,
      col2X,
      curY,
      col2Width,
      lineGap,
      MID,
      rowMinY
    );
  }

  const col3X = 441 + PAD;
  const col3Width = 576 - col3X - PAD;
  const col3TopCellMinY = toY(rowTop + 84 - PAD);

  const col3aY = toY(rowTop + PAD + 8);
  drawWrapped(page, String(exercise.name || ''), bold, 8, col3X, col3aY, col3Width, 3, DARK, col3TopCellMinY);

  if (exercise.cues) {
    const col3bY = toY(rowTop + 84 + PAD + 8);
    drawWrapped(page, exercise.cues, regular, 8, col3X, col3bY, col3Width, 3, MID, rowMinY);
  }
}

function overlayPage6(pdfDoc, page, { bonusVideoUrl }) {
  if (bonusVideoUrl && bonusVideoUrl !== '#') {
    addLink(pdfDoc, page, 66, toY(387), 224, 34, bonusVideoUrl);
    const top = 641;
    const height = Math.min(230, PAGE_H - top);
    addLink(pdfDoc, page, 284, toY(top + height), 343, height, bonusVideoUrl);
  }
}

async function overlayWeekPDF({ weekNum, name, profile, weekPlan, calendarUrl, bonusVideoUrl }) {
  const templatePath = path.join(__dirname, 'templates', `week${weekNum}.pdf`);
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);

  const fontsDir = path.join(__dirname, 'fonts');
  const bold = await pdfDoc.embedFont(fs.readFileSync(path.join(fontsDir, 'WorkSans-Bold.ttf')));
  const regular = await pdfDoc.embedFont(fs.readFileSync(path.join(fontsDir, 'WorkSans-Regular.ttf')));

  const pages = pdfDoc.getPages();
  const [p1, p2, p3, p4, p5, p6] = pages;

  overlayPage1(pdfDoc, p1, { name, calendarUrl, bold });
  overlayPage2(p2, { profile, regular });
  if (p3) overlayPage3(p3, { weekPlan, regular });
  if (p4) await overlaySessionPage(pdfDoc, p4, weekPlan.morning, weekPlan.midday, { bold, regular });
  if (p5) await overlaySessionPage(pdfDoc, p5, weekPlan.afternoon, weekPlan.evening, { bold, regular });
  if (p6) overlayPage6(pdfDoc, p6, { bonusVideoUrl });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { overlayWeekPDF };