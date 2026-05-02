'use strict';
const { overlayWeekPDF } = require('./pdf-overlay');
const fs = require('fs');

const sampleProfile = {
  primary_goal: 'mobility',
  level: 'beginner',
  spaces: ['home', 'gym'],
  focus_area: 'lower back'
};

const sampleWeekPlan = {
  morning: {
    warmup: {
      name: '90/90 Hip Switches',
      description: 'Sit in 90/90 -> rotate the hips -> switch the legs. 1. Sit tall in the 90/90 position.',
      image_url: '',
      cues: 'Move from the hips. Chest tall. Slow and controlled.',
      progression: 'Add a light resistance band around knees.',
      regression: 'Keep hands on floor for support.'
    },
    main: {
      name: 'Supported Hip Airplane',
      description: 'One foot on wall -> hinge forward -> reach arm -> return. Stand with back to wall.',
      image_url: '',
      cues: 'Brace before you move. Reach long.',
      progression: 'Add light load to reaching arm (0.5L bottle).',
      regression: 'Smaller hinge angle. Reach only halfway.'
    }
  },
  midday: {
    warmup: {
      name: 'Arm Circles',
      description: 'Stand tall, circle arms forward and back.',
      image_url: '',
      cues: 'Keep shoulders down.',
      progression: 'Use 0.5kg weights.',
      regression: 'Smaller circles.'
    },
    main: {
      name: 'Kneeling Windmill',
      description: 'Kneel tall -> arms in T -> rotate torso side to side.',
      image_url: '',
      cues: 'Ribs stacked over pelvis.',
      progression: 'Add 2x0.5L bottles.',
      regression: 'Reduce rotation range.'
    }
  },
  afternoon: {
    warmup: {
      name: 'Split Stance Ankle Pulses',
      description: 'Stand in split stance, pulse front ankle.',
      image_url: '',
      cues: 'Keep heel on floor.',
      progression: 'Increase range.',
      regression: 'Hold wall for balance.'
    },
    main: {
      name: 'Thread the Needle at Wall',
      description: 'On all fours near wall, thread arm under body.',
      image_url: '',
      cues: 'Move from thoracic spine.',
      progression: 'Increase reach.',
      regression: 'Smaller range.'
    }
  },
  evening: {
    warmup: {
      name: 'Doorway Stretch',
      description: 'Stand in doorway, stretch chest and shoulders.',
      image_url: '',
      cues: 'Stand tall. Breathe.',
      progression: 'Move feet forward.',
      regression: 'Reduce arm height.'
    },
    main: {
      name: 'Wall Supported Childs Pose',
      description: 'Hands on wall, hinge back into stretch.',
      image_url: '',
      cues: 'Push hips back. Breathe out.',
      progression: 'Move hands higher.',
      regression: 'Use chair for support.'
    }
  }
};

async function run() {
  for (let w = 1; w <= 4; w++) {
    const pdfBytes = await overlayWeekPDF({
      weekNum: w,
      name: 'Anna',
      profile: sampleProfile,
      weekPlan: sampleWeekPlan,
      calendarUrl: 'https://example.com/calendar',
      bonusVideoUrl: 'https://example.com/bonus'
    });
    const outPath = '/tmp/test_week' + w + '.pdf';
    fs.writeFileSync(outPath, pdfBytes);
    console.log('Written:', outPath);
  }
}

run().catch(console.error);

