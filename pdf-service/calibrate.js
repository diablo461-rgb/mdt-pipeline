'use strict';

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const PAGE_W = 595;
const PAGE_H = 842;

const toY = (top) => PAGE_H - top;

const COLOR = {
  gridX: rgb(0.25, 0.25, 0.9),
  gridY: rgb(0.9, 0.25, 0.25),

  columnOuter: rgb(0, 0.65, 0),
  columnInner: rgb(0, 0.45, 0.9),
  rowTop: rgb(1, 0.45, 0),
  rowBottom: rgb(1, 0.75, 0),
  split: rgb(0.8, 0, 0.8),
  center: rgb(1, 0, 0),
};

const CALIBRATION_CONFIG = {
  page1: {
    1: { nameX: 148, commaX: 217.9, top: 296 },
    2: { nameX: 193, commaX: 262.7, top: 296 },
    3: { nameX: 193, commaX: 262.7, top: 296 },
    4: { nameX: 193, commaX: 262.7, top: 296 },
  },

  page2: {
    valueX: 187,
    rowTops: [114, 156, 198, 240],
    maxRightX: 575,
  },

  page3: {
    table: {
      x0: 19,
      x1: 576,
      headerTop: 675,
      headerBottom: 706,
      bottom: 824,
    },

    columns: {
      time: { x0: 19, x1: 126 },
      session: { x0: 126, x1: 245 },
      warmup: { x0: 245, x1: 420 },
      main: { x0: 420, x1: 576 },
    },

    rows: [
      { label: 'Morning', top: 706, bottom: 734 },
      { label: 'Midday', top: 737, bottom: 765 },
      { label: 'Afternoon', top: 767, bottom: 795 },
      { label: 'Evening', top: 796, bottom: 824 },
    ],
  },

  pages45: {
    columns: {
      image: { x0: 19, x1: 198 },
      text: { x0: 204, x1: 479, padding: 4 },
      right: { x0: 485, x1: 576, padding: 4 },
    },

    rows: [
      { label: 'A warmup', top: 81, bottom: 244, split: 163 },
      { label: 'A main', top: 250, bottom: 413, split: 332 },
      { label: 'B warmup', top: 485, bottom: 648, split: 567 },
      { label: 'B main', top: 654, bottom: 817, split: 736 },
    ],
  },

  page6: {
    1: { buttonX0: 67, buttonX1: 304, buttonTop: 350.4, buttonBottom: 396.4 },
    2: { buttonX0: 67, buttonX1: 304, buttonTop: 350.4, buttonBottom: 396.4 },
    3: { buttonX0: 67, buttonX1: 304, buttonTop: 350.4, buttonBottom: 396.4 },
    4: { buttonX0: 67, buttonX1: 304, buttonTop: 344.4, buttonBottom: 390.4 },
  },
};

async function genCalibration(weekNum) {
  const templatePath = path.join(__dirname, 'templates', `week${weekNum}.pdf`);
  const templateBytes = fs.readFileSync(templatePath);

  const doc = await PDFDocument.load(templateBytes);
  doc.registerFontkit(fontkit);

  const bold = await doc.embedFont(
      fs.readFileSync(path.join(__dirname, 'fonts', 'WorkSans-Bold.ttf'))
  );

  const pages = doc.getPages();
  const [p1, p2, p3, p4, p5, p6] = pages;

  for (const page of pages) {
    drawGrid(page, bold);
  }

  calibratePage1(p1, bold, weekNum);
  calibratePage2(p2, bold);
  calibratePage3(p3, bold);
  calibrateSessionPage(p4, bold, 'page4');
  calibrateSessionPage(p5, bold, 'page5');
  calibratePage6(p6, bold, weekNum);

  const outPath = `/tmp/calibration_week${weekNum}.pdf`;
  fs.writeFileSync(outPath, await doc.save());

  console.log(`Written: ${outPath}`);
}

function drawGrid(page, font) {
  for (let y = 0; y <= PAGE_H; y += 50) {
    page.drawLine({
      start: { x: 0, y },
      end: { x: PAGE_W, y },
      thickness: 0.25,
      color: COLOR.gridY,
      opacity: 0.35,
    });

    page.drawText(String(Math.round(PAGE_H - y)), {
      x: 2,
      y: y + 1,
      font,
      size: 6,
      color: COLOR.gridY,
    });
  }

  for (let x = 0; x <= PAGE_W; x += 50) {
    page.drawLine({
      start: { x, y: 0 },
      end: { x, y: PAGE_H },
      thickness: 0.25,
      color: COLOR.gridX,
      opacity: 0.35,
    });

    if (x > 0) {
      page.drawText(String(x), {
        x: x + 1,
        y: PAGE_H - 12,
        font,
        size: 6,
        color: COLOR.gridX,
      });
    }
  }
}

function drawText(page, font, text, x, y, color, size = 7) {
  if (!text) return;

  page.drawText(String(text), {
    x,
    y,
    font,
    size,
    color,
  });
}

function vLine(page, font, x, label, labelTop, color = COLOR.columnOuter) {
  page.drawLine({
    start: { x, y: 0 },
    end: { x, y: PAGE_H },
    thickness: 1,
    color,
    opacity: 0.85,
  });

  drawText(page, font, label || `x=${x}`, x + 3, toY(labelTop), color, 7);
}

function hLine(page, font, top, label, color = COLOR.rowTop) {
  const y = toY(top);

  page.drawLine({
    start: { x: 0, y },
    end: { x: PAGE_W, y },
    thickness: 1,
    color,
    opacity: 0.85,
  });

  drawText(page, font, label || `top=${top}`, 8, y + 3, color, 7);
}

function dot(page, font, x, top, label, color = COLOR.center) {
  const y = toY(top);

  page.drawRectangle({
    x: x - 3,
    y: y - 3,
    width: 6,
    height: 6,
    color,
    opacity: 0.9,
  });

  page.drawLine({
    start: { x: 0, y },
    end: { x: PAGE_W, y },
    thickness: 0.5,
    color,
    opacity: 0.4,
  });

  page.drawLine({
    start: { x, y: 0 },
    end: { x, y: PAGE_H },
    thickness: 0.5,
    color,
    opacity: 0.3,
  });

  drawText(page, font, label || `x=${x} top=${top}`, x + 4, y + 2, color, 7);
}

function rect(page, box, color, opacity = 0.12) {
  page.drawRectangle({
    x: box.x0,
    y: toY(box.bottom),
    width: box.x1 - box.x0,
    height: box.bottom - box.top,
    color,
    opacity,
  });
}

function calibratePage1(page, font, weekNum) {
  if (!page) return;

  const cfg = CALIBRATION_CONFIG.page1[weekNum] || CALIBRATION_CONFIG.page1[1];

  dot(page, font, cfg.nameX, cfg.top, `page1 name x=${cfg.nameX} top=${cfg.top}`);
  dot(page, font, cfg.commaX, cfg.top, `page1 comma x=${cfg.commaX} top=${cfg.top}`);
}

function calibratePage2(page, font) {
  if (!page) return;

  const cfg = CALIBRATION_CONFIG.page2;

  vLine(page, font, cfg.valueX, `profile.valueX=${cfg.valueX}`, 80, COLOR.columnOuter);
  vLine(page, font, cfg.maxRightX, `profile.maxRightX=${cfg.maxRightX}`, 80, COLOR.columnInner);

  for (let i = 0; i < cfg.rowTops.length; i++) {
    dot(page, font, cfg.valueX, cfg.rowTops[i], `profile row${i + 1} top=${cfg.rowTops[i]}`);
  }
}

function calibratePage3(page, font) {
  if (!page) return;

  const cfg = CALIBRATION_CONFIG.page3;

  rect(page, {
    x0: cfg.table.x0,
    x1: cfg.table.x1,
    top: cfg.table.headerBottom,
    bottom: cfg.table.bottom,
  }, rgb(0, 0.7, 0), 0.06);

  hLine(page, font, cfg.table.headerTop, `weekly header top=${cfg.table.headerTop}`, COLOR.split);
  hLine(page, font, cfg.table.headerBottom, `weekly data top=${cfg.table.headerBottom}`, COLOR.rowTop);
  hLine(page, font, cfg.table.bottom, `weekly table bottom=${cfg.table.bottom}`, COLOR.rowBottom);

  for (const [name, col] of Object.entries(cfg.columns)) {
    vLine(page, font, col.x0, `${name}.x0=${col.x0}`, 690, COLOR.columnOuter);
    vLine(page, font, col.x1, `${name}.x1=${col.x1}`, 705, COLOR.columnInner);

    const center = (col.x0 + col.x1) / 2;
    dot(page, font, center, cfg.rows[0].top, `${name}.center=${center}`);
  }

  for (const row of cfg.rows) {
    hLine(page, font, row.top, `${row.label}.top=${row.top}`, COLOR.rowTop);
    hLine(page, font, row.bottom, `${row.label}.bottom=${row.bottom}`, COLOR.rowBottom);

    const centerTop = (row.top + row.bottom) / 2;
    dot(page, font, cfg.columns.warmup.x0, centerTop, `${row.label}.centerTop=${centerTop}`);
  }
}

function calibrateSessionPage(page, font, pageLabel) {
  if (!page) return;

  const cfg = CALIBRATION_CONFIG.pages45;

  for (const [name, col] of Object.entries(cfg.columns)) {
    vLine(page, font, col.x0, `${pageLabel}.${name}.x0=${col.x0}`, 65, COLOR.columnOuter);
    vLine(page, font, col.x1, `${pageLabel}.${name}.x1=${col.x1}`, 78, COLOR.columnInner);

    if (col.padding) {
      const innerX0 = col.x0 + col.padding;
      const innerX1 = col.x1 - col.padding;

      vLine(page, font, innerX0, `${pageLabel}.${name}.innerX0=${innerX0}`, 95, COLOR.split);
      vLine(page, font, innerX1, `${pageLabel}.${name}.innerX1=${innerX1}`, 108, COLOR.split);
    }
  }

  for (const row of cfg.rows) {
    hLine(page, font, row.top, `${pageLabel}.${row.label}.top=${row.top}`, COLOR.rowTop);
    hLine(page, font, row.bottom, `${pageLabel}.${row.label}.bottom=${row.bottom}`, COLOR.rowBottom);
    hLine(page, font, row.split, `${pageLabel}.${row.label}.split=${row.split}`, COLOR.split);

    rect(page, {
      x0: cfg.columns.image.x0,
      x1: cfg.columns.image.x1,
      top: row.top,
      bottom: row.bottom,
    }, rgb(0, 0.6, 0), 0.04);

    rect(page, {
      x0: cfg.columns.text.x0,
      x1: cfg.columns.text.x1,
      top: row.top,
      bottom: row.bottom,
    }, rgb(0, 0.3, 1), 0.04);

    rect(page, {
      x0: cfg.columns.right.x0,
      x1: cfg.columns.right.x1,
      top: row.top,
      bottom: row.split,
    }, rgb(0.8, 0, 0.8), 0.04);

    rect(page, {
      x0: cfg.columns.right.x0,
      x1: cfg.columns.right.x1,
      top: row.split,
      bottom: row.bottom,
    }, rgb(1, 0.45, 0), 0.04);
  }
}

function calibratePage6(page, font, weekNum) {
  if (!page) return;

  const cfg = CALIBRATION_CONFIG.page6[weekNum] || CALIBRATION_CONFIG.page6[1];

  hLine(page, font, cfg.buttonTop, `video.buttonTop=${cfg.buttonTop}`, COLOR.split);
  hLine(page, font, cfg.buttonBottom, `video.buttonBottom=${cfg.buttonBottom}`, COLOR.split);
  vLine(page, font, cfg.buttonX0, `video.buttonX0=${cfg.buttonX0}`, 330, COLOR.split);
  vLine(page, font, cfg.buttonX1, `video.buttonX1=${cfg.buttonX1}`, 345, COLOR.split);
}

async function main() {
  for (const weekNum of [1, 2, 3, 4]) {
    await genCalibration(weekNum);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});