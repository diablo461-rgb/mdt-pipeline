'use strict';

const express = require('express');
const { overlayWeekPDF } = require('./pdf-overlay');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '20mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'mdt-pdf-service' }));

// ─── Generate PDF for a specific week ─────────────────────────────────────────
/**
 * POST /generate-pdf
 * Body: {
 *   name:            string,
 *   week_number:     1|2|3|4,
 *   week_plan:       { morning, midday, afternoon, evening },
 *   profile:         { focus?, level?, spaces?, sensitivity?, primary_goal? },
 *   calendar_url?:   string,
 *   bonus_video_url?: string,
 * }
 *
 * Each slot shape:
 *   { label?, time?,
 *     warmup: { name, description, cues?, image_url? },
 *     main:   { name, description, cues?, image_url? } }
 *
 * Returns: { pdf: "<base64>" }
 */
app.post('/generate-pdf', async (req, res) => {
  const { name, week_number, week_plan, profile, calendar_url, bonus_video_url } = req.body;

  if (!week_plan || !profile) {
    return res.status(400).json({ error: 'Missing week_plan or profile' });
  }

  const weekNum = Math.max(1, Math.min(4, Number(week_number) || 1));

  try {
    const pdfBuf = await overlayWeekPDF({
      weekNum,
      name:          name           || 'Friend',
      profile,
      weekPlan:      week_plan,
      calendarUrl:   calendar_url   || '#',
      bonusVideoUrl: bonus_video_url || '#',
    });

    res.json({ pdf: pdfBuf.toString('base64') });
  } catch (err) {
    console.error('[generate-pdf] error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`mdt-pdf-service listening on :${PORT}`));