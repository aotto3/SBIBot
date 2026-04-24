const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber, ExternalHyperlink,
} = require('docx');
const fs = require('fs');
const path = require('path');

const BLUE       = '2E5FA3';
const LIGHT_BLUE = 'D6E4F7';
const GRAY_BG    = 'F2F2F2';
const BORDER     = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS    = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const NO_BORDER  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text, bold: true, size: 32, font: 'Arial', color: BLUE })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, size: 26, font: 'Arial', color: '333333' })],
  });
}

function body(runs, spacing = { before: 80, after: 80 }) {
  return new Paragraph({ spacing, children: Array.isArray(runs) ? runs : [runs] });
}

function run(text, opts = {}) {
  return new TextRun({ text, font: 'Arial', size: 24, ...opts });
}

function code(text) {
  return new TextRun({ text, font: 'Courier New', size: 22, color: '444444' });
}

function bold(text) { return run(text, { bold: true }); }

function bullet(children, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
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

function callout(textRuns) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 720 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 8 } },
    children: Array.isArray(textRuns) ? textRuns : [textRuns],
  });
}

function codeBlock(lines) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: NO_BORDERS,
        shading: { fill: 'F5F5F5', type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 200, right: 200 },
        width: { size: 9360, type: WidthType.DXA },
        children: lines.map(l => new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: l, font: 'Courier New', size: 20, color: '333333' })],
        })),
      })],
    })],
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
    children: [],
  });
}

function optionsTable(rows) {
  const colWidths = [2200, 1800, 5360];
  const headerCells = ['Option', 'Required?', 'Description'].map((h, i) =>
    new TableCell({
      borders: BORDERS,
      shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font: 'Arial', size: 22 })] })],
    })
  );

  const dataRows = rows.map(([opt, req, desc]) =>
    new TableRow({
      children: [opt, req, desc].map((cell, i) =>
        new TableCell({
          borders: BORDERS,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          width: { size: colWidths[i], type: WidthType.DXA },
          children: [new Paragraph({
            children: [new TextRun({ text: cell, font: 'Courier New', size: 20, color: '333333' })],
          })],
        })
      ),
    })
  );

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [new TableRow({ children: headerCells }), ...dataRows],
  });
}

function spacer(before = 160) {
  return new Paragraph({ spacing: { before, after: 0 }, children: [] });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: BLUE },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '333333' },
        paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'steps',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'steps2',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'steps3',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
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
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
          children: [new TextRun({ text: 'SBI Bot \u2014 Cast Member Guide', font: 'Arial', size: 20, color: '888888' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
          children: [
            new TextRun({ text: 'Page ', font: 'Arial', size: 20, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 20, color: '888888' }),
          ],
        })],
      }),
    },
    children: [

      // ── Title ──────────────────────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: 'SBI Bot', bold: true, size: 56, font: 'Arial', color: BLUE })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 400 },
        children: [new TextRun({ text: 'Cast Member Guide', size: 32, font: 'Arial', color: '555555' })],
      }),

      body([run('SBI Bot is the Discord bot that handles scheduling, check-ins, and shift coverage. This guide covers everything you need to use it.')]),

      spacer(160),
      divider(),

      // ── TOC ───────────────────────────────────────────────────────────────
      body([bold('In this guide:')]),
      bullet([run('1. '), run('Checking In for Your Shift')]),
      bullet([run('2. '), run('Viewing Your Schedule')]),
      bullet([run('3. '), run('Requesting Shift Coverage')]),
      bullet([run('4. '), run('Cancelling a Coverage Request')]),
      bullet([run('5. '), run('Responding to Someone Else\u2019s Coverage Request')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 1 ─────────────────────────────────────────────────────────
      heading1('1. Checking In for Your Shift'),
      body([run('Use '), code('/check-in'), run(' to confirm you\u2019re ready for your show.')]),
      spacer(80),

      body([bold('When to do it: '), run('Check in before your call time. If you haven\u2019t checked in by then, the production team will be notified automatically.')]),
      spacer(80),

      heading2('How to use it:'),
      numbered([run('In any channel where the bot is active, type '), code('/check-in'), run(' and press Enter.')], 'steps'),
      numbered([run('If you have one show today, the bot confirms you immediately.')], 'steps'),
      numbered([run('If you have multiple shows today, the bot shows a dropdown \u2014 select which show you\u2019re checking in for.')], 'steps'),

      spacer(120),
      heading2('What you\u2019ll see:'),
      callout([new TextRun({ text: '\u2705 Checked in for Great Gold Bird today.', font: 'Arial', size: 24, italics: true })]),
      spacer(80),
      body([run('The bot\u2019s reply is private \u2014 only you can see it.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 2 ─────────────────────────────────────────────────────────
      heading1('2. Viewing Your Schedule'),
      body([run('Use '), code('/member-schedule'), run(' to see upcoming shifts.')]),

      spacer(120),
      heading2('How to use it:'),
      body([run('Type '), code('/member-schedule'), run(' and fill in the options:')]),
      spacer(80),

      optionsTable([
        ['name',     'One of these two', 'First name as it appears in Bookeo (e.g. DeShae)'],
        ['discord',  'One of these two', '@mention a linked cast member instead'],
        ['week_of',  'No',               'Start date to look from \u2014 defaults to today'],
      ]),

      spacer(120),
      body([run('You must provide either '), code('name'), run(' or '), code('discord'), run(', but not both.')]),

      spacer(120),
      heading2('Example:'),
      codeBlock(['/member-schedule name:Allen']),

      spacer(120),
      heading2('What you\u2019ll see:'),
      codeBlock([
        '\ud83d\udcc5 Allen\u2019s schedule: Thursday, May 14 \u2013 next 7 days',
        '',
        '  \u2022 Great Gold Bird \u2014 Thursday, May 14 at 7:00 PM (8 guests)',
        '  \u2022 The Endings \u2014 Saturday, May 16 at 5:30 PM (12 guests)',
      ]),

      spacer(120),
      body([run('You can also look up a teammate\u2019s schedule the same way \u2014 just use their name or @mention them.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 3 ─────────────────────────────────────────────────────────
      heading1('3. Requesting Shift Coverage'),
      body([run('Use '), code('/coverage-request'), run(' when you need someone to cover one or more of your shifts.')]),

      spacer(120),
      heading2('How to use it:'),
      numbered([run('Type '), code('/coverage-request'), run(' and fill in the options:')], 'steps2'),
      spacer(80),

      optionsTable([
        ['show',      'Yes',                     'Which show you need coverage for'],
        ['character', 'For MFB and The Endings', 'Your character name'],
      ]),

      spacer(120),
      numbered([run('Hit Enter. A form will pop up asking for your shift dates and times \u2014 enter one per line:')], 'steps2'),
      spacer(80),
      codeBlock([
        '5/1/2026 at 7pm',
        '5/2/2026 at 5:30pm',
      ]),
      spacer(80),
      numbered([run('Submit the form. The bot posts your request to the coverage channel.')], 'steps2'),

      spacer(160),
      heading2('About the character option (MFB and The Endings):'),
      body([
        run('These shows have two actors per show, each with their own coverage channel. You must select your character when submitting \u2014 otherwise the bot won\u2019t know where to post.'),
      ]),
      spacer(80),
      bullet([bold('MFB: '), run('choose '), code('Daphne'), run(' or '), code('Houdini')]),
      bullet([bold('The Endings: '), run('choose '), code('HR'), run(' or '), code('Author')]),
      bullet([bold('GGB and Lucidity: '), run('no character selection needed')]),

      spacer(160),
      heading2('What gets posted:'),
      body([run('The bot posts a message in the coverage channel showing your show, the dates/times you need covered, and instructions for other cast members to react.')]),
      spacer(80),
      body([
        run('Each post ends with a '),
        bold('Coverage Request ID'),
        run(' (e.g. '),
        new TextRun({ text: 'Coverage Request ID: 12', font: 'Courier New', size: 22, italics: true, color: '444444' }),
        run('). Save this number \u2014 you\u2019ll need it if you want to cancel the request later.'),
      ]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 4 ─────────────────────────────────────────────────────────
      heading1('4. Cancelling a Coverage Request'),
      body([run('Use '), code('/cancel-coverage-request'), run(' to remove a coverage request you no longer need.')]),

      spacer(120),
      heading2('How to use it:'),
      numbered([run('Find the '), bold('Coverage Request ID'), run(' at the bottom of your original coverage post.')], 'steps3'),
      numbered([run('Type '), code('/cancel-coverage-request request_id:[number]'), run(' \u2014 replacing '), code('[number]'), run(' with your ID.')], 'steps3'),

      spacer(120),
      heading2('What happens:'),
      body([run('The bot deletes the coverage post(s) from the channel and marks the request as cancelled. You\u2019ll get a private confirmation message.')]),
      spacer(80),
      callout([new TextRun({ text: '\u2705 Coverage request 12 cancelled and post(s) deleted.', font: 'Arial', size: 24, italics: true })]),
      spacer(80),
      body([bold('Note: '), run('You can only cancel your own requests. If you need an admin to cancel one for you, ask them to run the same command.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 5 ─────────────────────────────────────────────────────────
      heading1('5. Responding to Someone Else\u2019s Coverage Request'),
      body([run('When a cast member posts a coverage request, you\u2019ll see it in the show\u2019s coverage channel. Here\u2019s how to respond:')]),
      spacer(80),

      bullet([bold('\u2705 React \u2705 '), run('if you\u2019re available to take the shift')]),
      bullet([bold('\u274c React \u274c '), run('if you\u2019re unavailable')]),
      bullet([bold('\u2753 React \u2753 '), run('if you\u2019re unsure')]),

      spacer(120),
      body([run('Reacting \u2705 lets the person requesting coverage (and the production team) see who\u2019s available. Once coverage is confirmed, the post will be updated automatically.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Tips ──────────────────────────────────────────────────────────────
      heading1('Tips'),
      bullet([run('All bot replies are '), bold('private by default'), run(' \u2014 only you can see them.')]),
      bullet([run('If the bot doesn\u2019t respond, it may be offline. Check with an admin.')]),
      bullet([run('Type '), code('/help'), run(' at any time to see a quick list of available commands in Discord.')]),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(__dirname, '..', 'docs', 'cast-member-guide.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Written:', outPath);
});
