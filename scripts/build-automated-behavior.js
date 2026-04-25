const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber,
} = require('docx');
const fs   = require('fs');
const path = require('path');

const BLUE       = '2E5FA3';
const GREEN      = '1E7E34';
const LIGHT_BLUE = 'D6E4F7';
const AMBER_BG   = 'FFF8E1';
const BORDER     = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS    = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const r  = (text, opts = {}) => new TextRun({ text, font: 'Arial', size: 24, ...opts });
const b  = (text, opts = {}) => r(text, { bold: true, ...opts });
const c  = (text)             => new TextRun({ text, font: 'Courier New', size: 22, color: '333333' });
const it = (text)             => r(text, { italics: true, color: '555555' });

function h1(text, color = BLUE) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text, bold: true, size: 30, font: 'Arial', color })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, font: 'Arial', color: '333333' })],
  });
}

function p(children, spacing = { before: 80, after: 80 }) {
  return new Paragraph({ spacing, children: Array.isArray(children) ? children : [children] });
}

function bullet(children) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 60, after: 60 },
    children: Array.isArray(children) ? children : [children],
  });
}

function numbered(children, ref = 'steps') {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { before: 80, after: 80 },
    children: Array.isArray(children) ? children : [children],
  });
}

function callout(children, fillColor = 'F0F4FF') {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 720 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 8 } },
    children: Array.isArray(children) ? children : [children],
  });
}

function note(children) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
      shading: { fill: AMBER_BG, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      width: { size: 9360, type: WidthType.DXA },
      children: [new Paragraph({ children: Array.isArray(children) ? children : [children] })],
    })]})],
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
    children: [],
  });
}

function sectionBanner(text, color = BLUE) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      shading: { fill: color, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      width: { size: 9360, type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, size: 28, font: 'Arial', color: 'FFFFFF' })],
      })],
    })]})],
  });
}

function spacer(before = 120) {
  return new Paragraph({ spacing: { before, after: 0 }, children: [] });
}

function twoColTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      borders: BORDERS,
      shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font: 'Arial', size: 22 })] })],
    })),
  });

  const dataRows = rows.map(cells => new TableRow({
    children: cells.map((cell, i) => new TableCell({
      borders: BORDERS,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: cell, font: 'Arial', size: 22 })] })],
    })),
  }));

  return new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: BLUE },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '333333' },
        paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      },
      {
        reference: 'steps',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      },
      {
        reference: 'steps2',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
        children: [new TextRun({ text: 'SBI Bot \u2014 Automated Behavior', font: 'Arial', size: 20, color: '888888' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
        children: [
          new TextRun({ text: 'Page ', font: 'Arial', size: 20, color: '888888' }),
          new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 20, color: '888888' }),
        ],
      })] }),
    },
    children: [

      // Title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: 'SBI Bot', bold: true, size: 56, font: 'Arial', color: BLUE })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text: 'Automated Behavior Guide', size: 32, font: 'Arial', color: '555555' })],
      }),
      p([it('This document explains everything the bot does automatically, without anyone running a command.')],
        { before: 0, after: 320 }),

      // ── PART 1: CAST MEMBERS ─────────────────────────────────────────────
      sectionBanner('Part 1: Cast Members \u2014 What to Expect', '2E5FA3'),
      spacer(80),

      h2('Weekly Shift Summary \u2014 Monday mornings'),
      p([r('Every Monday around '), b('9:00 AM CT'), r(', the bot sends each cast member a private DM listing their shifts for the coming week. This is informational only \u2014 no action is required.')]),
      spacer(60),
      p([r('If you don\u2019t receive this on a Monday, either your Discord account isn\u2019t linked yet (ask an admin) or the weekly DM feature is turned off.')]),

      spacer(120),
      h2('Daily Shift Reminder \u2014 Every morning'),
      p([r('Every morning around '), b('9:00 AM CT'), r(', the bot sends a DM to anyone with a shift in the next 24 hours. The DM includes:')]),
      bullet([r('The show name, date, and time')]),
      bullet([r('A '), b('Check In'), r(' button for each shift requiring check-in')]),
      spacer(80),
      p([r('Tap the button to check in. It will update to confirm your check-in time and become disabled. You can also use '), c('/check-in'), r(' in any bot channel.')]),
      spacer(80),
      note([b('Note: '), r('Not all shows require individual check-in. Only Great Gold Bird, Lucidity, and The Endings (HR role only) have check-in requirements.')]),

      spacer(160),
      h2('If You Don\u2019t Check In by Call Time'),
      p([r('Your call time is '), b('30 minutes before your show\u2019s start time'), r('.')]),
      spacer(80),
      p([r('If you haven\u2019t checked in by call time, the bot automatically posts an alert in the production team\u2019s channel and pings the designated contacts. The alert includes your name, show, and call time.')]),
      spacer(80),
      p([r('If you check in late \u2014 after the alert has already posted \u2014 the bot updates that alert message to note that you checked in and at what time.')]),

      spacer(160),
      h2('Coverage Requests'),
      p([r('When a cast member posts a coverage request, it appears in the show\u2019s coverage channel. React to indicate your availability:')]),
      bullet([b('\u2705 Available '), r('\u2014 you can take the shift')]),
      bullet([b('\u274c Unavailable '), r('\u2014 you can\u2019t make it')]),
      bullet([b('\u2753 Unsure '), r('\u2014 you\u2019re not certain yet')]),
      spacer(80),
      p([r('The production team handles confirming coverage. You don\u2019t need to do anything else after reacting.')]),

      spacer(200),
      divider(),

      // ── PART 2: ADMINS ───────────────────────────────────────────────────
      sectionBanner('Part 2: Admins \u2014 What to Expect', '1A3E6E'),
      spacer(80),

      h2('On Bot Startup'),
      p([r('Every time the bot starts or redeploys, it:')]),
      numbered([b('Sends Allen a DM: '), r('\u2705 SBI Bot is online at [time] CT \u2014 confirms the bot is running')], 'steps'),
      numbered([b('Seeds check-in records '), r('\u2014 pulls today\u2019s Bookeo shifts and creates records for eligible cast members. Retries every 5 minutes for up to an hour if Bookeo is unreachable.')], 'steps'),
      numbered([b('Schedules check-in alert timers '), r('\u2014 any call times that already passed while the bot was down will fire immediately on startup.')], 'steps'),
      numbered([b('Pre-opens DM channels '), r('\u2014 opens DM channels with cast members in the background to avoid delays.')], 'steps'),

      spacer(160),
      h2('12:05 AM CT \u2014 Check-in Seeding'),
      p([r('The bot seeds check-in records for the new day and schedules alert timers for all eligible cast members. Runs silently with no visible output.')]),

      spacer(160),
      h2('8:00 AM CT Daily \u2014 Reminders & Follow-ups'),
      p([b('Meeting reminders:'), r(' Scans all active meetings. If a meeting is exactly 7 days or 1 day away, the bot posts a reminder to the configured channel with RSVP reactions (\u2705 \u274c \u2753). Each reminder only posts once \u2014 duplicates are prevented.')]),
      spacer(80),
      p([b('Custom game 48-hour follow-up:'), r(' Finds open custom game posts older than 48 hours with no follow-up sent yet. Posts a reminder pinging the requester and any uncovered roles:')]),
      bullet([r('Single-role shows (GGB, Lucidity): pings '), c('@here')]),
      bullet([r('Multi-role shows (MFB, Endings): pings only the specific roles still uncovered')]),

      spacer(160),
      h2('9:00 AM CT Daily \u2014 Shift DMs'),
      p([r('Sends personalized DMs to all linked cast members with shifts in the next 24 hours, including check-in buttons for pending records. Unlinked cast members are silently skipped.')]),

      spacer(160),
      h2('9:00 AM CT Monday Only \u2014 Weekly Shift DMs'),
      p([r('Sends each linked cast member a DM with their full week of shifts. No check-in buttons \u2014 informational only.')]),

      spacer(160),
      h2('Check-in Alerts \u2014 Fire at Call Time'),
      p([r('When a cast member\u2019s call time arrives and they haven\u2019t checked in, the bot:')]),
      numbered([r('Posts an alert in the show\u2019s configured alert channel')], 'steps2'),
      numbered([r('Pings all configured check-in contacts + the cast member')], 'steps2'),
      numbered([r('Stores the alert message ID so it can be edited if they check in late')], 'steps2'),
      spacer(100),

      p([b('Alert message:')]),
      callout([r('\u26a0\ufe0f @contacts @castmember '), b('[Name]'), r(' has not checked in for '), b('[Show]'), r('. Call time was [time] CT.')]),
      spacer(60),
      p([b('If they check in late:')]),
      callout([r('\u26a0\ufe0f \u2026 \u2705 [FirstName] checked in at [time] CT.')]),
      spacer(60),
      p([b('If admin force-checks them in:')]),
      callout([r('\u26a0\ufe0f \u2026 \u2705 Manually confirmed by @Admin at [time] CT.')]),

      spacer(160),
      h2('DM Forwarding \u2014 Real-time'),
      p([r('Any DM sent to the bot by someone other than Allen is automatically forwarded to Allen, including the sender\u2019s name, username, and timestamp.')]),

      spacer(160),
      h2('RSVP Tracking \u2014 Real-time'),
      p([r('When anyone adds or removes a reaction on a meeting reminder or custom game post, the bot updates the RSVP tracker section of that message in place automatically.')]),

      spacer(200),
      divider(),

      // ── Disabling Behavior ────────────────────────────────────────────────
      h1('What Can Disable Automatic Behavior'),
      spacer(80),

      twoColTable(
        ['Behavior', 'What disables it'],
        [
          ['Weekly shift DMs',              'Admin turns off \u201cWeekly shift DMs\u201d in /bot-config'],
          ['Daily shift DMs',               'Admin turns off \u201cDaily 24hr shift DMs\u201d in /bot-config'],
          ['Check-in alerts for a show',    'No alert channel set for that show (/set-checkin-channel)'],
          ['Shift DMs for a cast member',   'Member not linked via /link-member'],
          ['Check-in records for a member', 'Member not linked, or missing the required show role'],
        ],
        [3600, 5760]
      ),

      spacer(200),
      divider(),

      // ── At a Glance ───────────────────────────────────────────────────────
      h1('Expected Bot Activity \u2014 At a Glance'),
      spacer(80),

      twoColTable(
        ['Time', 'What happens'],
        [
          ['Bot startup',              'DM to Allen, check-in seeding, alert timers set'],
          ['12:05 AM CT',              'Check-in records seeded for the new day'],
          ['8:00 AM CT',               'Meeting reminders + custom game 48h follow-ups'],
          ['9:00 AM CT',               'Daily shift DMs with check-in buttons'],
          ['9:00 AM CT (Monday only)', 'Weekly shift DMs'],
          ['Call time (30 min before show)', 'No-show alert if cast member hasn\u2019t checked in'],
          ['Anytime',                  'DM forwarding, RSVP tracker updates'],
        ],
        [3200, 6160]
      ),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(__dirname, '..', 'docs', 'automated-behavior.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Written:', outPath);
});
