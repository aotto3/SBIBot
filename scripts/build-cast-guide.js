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
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
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
      {
        reference: 'steps4',
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
          children: [new TextRun({ text: 'SBI Bot — Cast Member Guide', font: 'Arial', size: 20, color: '888888' })],
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

      body([run('Welcome to the SBI Bot! This bot lives right here in Discord and quietly handles a lot of the behind-the-scenes work for our shows — meeting reminders, shift check-ins, and coverage requests. You don’t need any technical knowledge to use it. This guide covers everything you need to know as a cast member.')]),

      spacer(160),
      divider(),

      // ── How to Use Bot Commands ───────────────────────────────────────────
      heading1('How to Use Bot Commands'),
      body([run('The SBI Bot responds to '), bold('slash commands'), run(' — commands that start with a '), code('/'), run('. Here’s how to use them:')]),
      spacer(80),
      numbered([run('Click into any Discord channel and type '), code('/')], 'steps'),
      numbered([run('A menu will pop up showing available commands')], 'steps'),
      numbered([run('Click the one you want, or keep typing to search for it')], 'steps'),
      numbered([run('Fill in any fields that appear and press Enter')], 'steps'),
      spacer(80),
      callout([new TextRun({ text: 'Tip: You only need a handful of commands — they’re all listed in this guide.', font: 'Arial', size: 24, italics: true })]),

      spacer(200),
      divider(),

      // ── TOC ───────────────────────────────────────────────────────────────
      body([bold('In this guide:')]),
      bullet([run('1. '), run('Meeting Reminders & RSVPs')]),
      bullet([run('2. '), run('Checking In for Your Shift')]),
      bullet([run('3. '), run('Viewing Your Schedule')]),
      bullet([run('4. '), run('Requesting Shift Coverage')]),
      bullet([run('5. '), run('Cancelling a Coverage Request')]),
      bullet([run('6. '), run('Responding to Someone Else’s Coverage Request')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 1: Meeting Reminders ──────────────────────────────────────
      heading1('1. Meeting Reminders & RSVPs'),

      heading2('What the bot does automatically'),
      body([run('When a meeting is scheduled, the bot posts an announcement in the meeting channel with RSVP reactions:')]),
      spacer(80),
      bullet([bold('✅'), run(' — You’re attending')]),
      bullet([bold('❌'), run(' — You can’t make it')]),
      bullet([bold('❓'), run(' — Maybe')]),
      spacer(80),
      body([run('As the meeting gets closer, the bot will post follow-up reminders (7 days out and 24 hours out). These will @mention you if you’ve already said ✅ or ❓, and include a link back to the original post so you can update your response. If a meeting is cancelled, the original post will be updated and a cancellation notice will appear in the channel.')]),

      spacer(120),
      heading2('What you need to do'),
      body([run('React to the reminder post with one of the three emojis. '), bold('You only need to RSVP once'), run(' — the original post is the single place your response is tracked. The follow-up reminders don’t have their own reactions — just use the link to go back to the original.')]),
      spacer(80),
      body([run('You can change your response at any time — just remove your old reaction and add the new one.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 2: Check-in ───────────────────────────────────────────────
      heading1('2. Checking In for Your Shift'),

      heading2('What the bot does automatically'),
      body([run('For shows with check-in enabled (GGB, Lucidity, and The Endings), the bot keeps an eye on call times. If you haven’t checked in by your call time, an alert fires in your show’s admin channel so the right people are notified.')]),
      spacer(80),
      callout([new TextRun({ text: 'Note: MFB does not use check-in.', font: 'Arial', size: 24, italics: true })]),

      spacer(120),
      heading2('What you need to do'),
      body([run('Use '), code('/check-in'), run(' to confirm you’re ready for your show.')]),
      spacer(80),
      body([bold('When to do it: '), run('Check in before your call time.')]),
      spacer(80),

      heading2('How to use it:'),
      numbered([run('In any channel where the bot is active, type '), code('/check-in'), run(' and press Enter.')], 'steps2'),
      numbered([run('If you have one show today, the bot confirms you immediately.')], 'steps2'),
      numbered([run('If you have multiple shows today, the bot shows a dropdown — select which show you’re checking in for.')], 'steps2'),

      spacer(120),
      heading2('What you’ll see:'),
      callout([new TextRun({ text: '✅ Checked in for Great Gold Bird today.', font: 'Arial', size: 24, italics: true })]),
      spacer(80),
      body([run('The bot’s reply is private — only you can see it.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 3: Schedule ───────────────────────────────────────────────
      heading1('3. Viewing Your Schedule'),
      body([run('Use '), code('/member-schedule'), run(' to see upcoming shifts.')]),

      spacer(120),
      heading2('How to use it:'),
      body([run('Type '), code('/member-schedule'), run(' and fill in the options:')]),
      spacer(80),

      optionsTable([
        ['name',     'One of these two', 'First name as it appears in Bookeo (e.g. DeShae)'],
        ['discord',  'One of these two', '@mention a linked cast member instead'],
        ['week_of',  'No',               'Start date to look from — defaults to today'],
      ]),

      spacer(120),
      body([run('You must provide either '), code('name'), run(' or '), code('discord'), run(', but not both.')]),

      spacer(120),
      heading2('Example:'),
      codeBlock(['/member-schedule name:Allen']),

      spacer(120),
      heading2('What you’ll see:'),
      codeBlock([
        '📅 Allen’s schedule: Thursday, May 14 – next 7 days',
        '',
        '  • Great Gold Bird — Thursday, May 14 at 7:00 PM (8 guests)',
        '  • The Endings — Saturday, May 16 at 5:30 PM (12 guests)',
      ]),

      spacer(120),
      body([run('You can also look up a teammate’s schedule the same way — just use their name or @mention them.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 4: Coverage Request ───────────────────────────────────────
      heading1('4. Requesting Shift Coverage'),

      heading2('What the bot does automatically'),
      body([run('Once you post a coverage request, the bot takes it from there:')]),
      spacer(80),
      bullet([run('Posts individual messages for each shift in your show’s role channel (e.g. '), code('#mfb-daphne'), run(', '), code('#ggb-mikey'), run(', '), code('#endings-hr'), run(')')]),
      bullet([run('Sends daily reminders about open requests until they’re filled')]),
      bullet([run('Notifies the coverage manager automatically when a shift is covered')]),

      spacer(120),
      heading2('What you need to do'),
      body([run('Use '), code('/coverage-request'), run(' when you need someone to cover one or more of your shifts.')]),

      spacer(120),
      heading2('How to use it:'),
      numbered([run('Type '), code('/coverage-request'), run(' and fill in the options:')], 'steps3'),
      spacer(80),

      optionsTable([
        ['show',      'Yes',                     'Which show you need coverage for'],
        ['character', 'For MFB and The Endings', 'Your character name'],
      ]),

      spacer(120),
      numbered([run('Hit Enter. A form will pop up asking for your shift dates and times — enter one per line:')], 'steps3'),
      spacer(80),
      codeBlock([
        '5/1/2026 at 7pm',
        '5/2/2026 at 5:30pm',
      ]),
      spacer(80),
      numbered([run('Submit the form. The bot posts your request to the coverage channel.')], 'steps3'),

      spacer(160),
      heading2('About the character option (MFB and The Endings):'),
      body([
        run('These shows have two actors per show, each with their own coverage channel. You must select your character when submitting — otherwise the bot won’t know where to post.'),
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
        run('). Save this number — you’ll need it if you want to cancel the request later.'),
      ]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 5: Cancel ─────────────────────────────────────────────────
      heading1('5. Cancelling a Coverage Request'),
      body([run('Use '), code('/cancel-coverage-request'), run(' to cancel a shift you no longer need covered.')]),

      spacer(120),
      heading2('How to use it:'),
      numbered([run('Find the '), bold('Shift ID'), run(' at the bottom of the specific shift post you want to cancel.')], 'steps4'),
      numbered([run('Type '), code('/cancel-coverage-request request_id:[number]'), run(' — replacing '), code('[number]'), run(' with that ID.')], 'steps4'),

      spacer(120),
      heading2('What happens:'),
      body([run('The shift post is updated to show it’s cancelled (it stays in the channel so the history is preserved). If it was the last open shift in your request, the header post is also updated. You’ll get a private confirmation message.')]),
      spacer(80),
      callout([new TextRun({ text: '✅ Shift 12 cancelled.', font: 'Arial', size: 24, italics: true })]),
      spacer(80),
      body([bold('Note: '), run('You can only cancel your own requests. If you need an admin to cancel one for you, ask them to run the same command.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Section 6: Responding ─────────────────────────────────────────────
      heading1('6. Responding to Someone Else’s Coverage Request'),
      body([run('When a cast member posts a coverage request, you’ll see it in the show’s coverage channel. Here’s how to respond:')]),
      spacer(80),

      bullet([bold('✅ React ✅ '), run('if you’re available to take the shift')]),
      bullet([bold('❌ React ❌ '), run('if you’re unavailable')]),
      bullet([bold('❓ React ❓ '), run('if you’re unsure')]),

      spacer(120),
      body([run('Reacting ✅ lets the person requesting coverage (and the production team) see who’s available. Once coverage is confirmed by an admin, the post will be updated to show it’s covered.')]),

      spacer(200),
      divider(),
      spacer(80),

      // ── Tips ──────────────────────────────────────────────────────────────
      heading1('Tips'),
      bullet([run('All bot replies are '), bold('private by default'), run(' — only you can see them.')]),
      bullet([run('If the bot doesn’t respond, it may be offline. Check with an admin.')]),
      bullet([run('Type '), code('/help'), run(' at any time to see a quick list of available commands in Discord.')]),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(__dirname, '..', 'docs', 'cast-member-guide.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Written:', outPath);
});
