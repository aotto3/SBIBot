const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber,
} = require('docx');
const fs   = require('fs');
const path = require('path');

const BLUE       = '2E5FA3';
const LIGHT_BLUE = 'D6E4F7';
const BORDER     = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS    = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const NO_BORDER  = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

const r  = (text, opts = {}) => new TextRun({ text, font: 'Arial', size: 24, ...opts });
const b  = (text)             => r(text, { bold: true });
const c  = (text)             => new TextRun({ text, font: 'Courier New', size: 22, color: '333333' });
const p  = (children, spacing = { before: 80, after: 80 }) =>
  new Paragraph({ spacing, children: Array.isArray(children) ? children : [children] });

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 100 },
    children: [new TextRun({ text, bold: true, size: 30, font: 'Arial', color: BLUE })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 60 },
    children: [new TextRun({ text, bold: true, size: 24, font: 'Arial', color: '333333' })],
  });
}

function bullet(children) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 60, after: 60 },
    children: Array.isArray(children) ? children : [children],
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
    children: [],
  });
}

function spacer(before = 120) {
  return new Paragraph({ spacing: { before, after: 0 }, children: [] });
}

function simpleTable(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

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
      children: [new Paragraph({
        children: typeof cell === 'string'
          ? [new TextRun({ text: cell, font: 'Arial', size: 22 })]
          : cell,
      })],
    })),
  }));

  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

// Two-column command reference table (command | description, with section header rows)
function commandTable(sections) {
  const colWidths = [3200, 6160];
  const totalWidth = 9360;

  const rows = [];
  for (const { heading, commands } of sections) {
    // Section header row spanning both columns
    rows.push(new TableRow({
      children: [new TableCell({
        columnSpan: 2,
        borders: NO_BORDERS,
        shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        width: { size: totalWidth, type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({ text: heading, bold: true, font: 'Arial', size: 22, color: BLUE })],
        })],
      })],
    }));

    for (const [cmd, desc] of commands) {
      rows.push(new TableRow({
        children: [
          new TableCell({
            borders: BORDERS,
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            width: { size: colWidths[0], type: WidthType.DXA },
            children: [new Paragraph({
              children: [new TextRun({ text: cmd, font: 'Courier New', size: 21, color: '333333' })],
            })],
          }),
          new TableCell({
            borders: BORDERS,
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            width: { size: colWidths[1], type: WidthType.DXA },
            children: [new Paragraph({
              children: [new TextRun({ text: desc, font: 'Arial', size: 22 })],
            })],
          }),
        ],
      }));
    }
  }

  return new Table({ width: { size: totalWidth, type: WidthType.DXA }, columnWidths: colWidths, rows });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: BLUE },
        paragraph: { spacing: { before: 320, after: 100 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '333333' },
        paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
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
          children: [new TextRun({ text: 'SBI Bot \u2014 Admin Guide', font: 'Arial', size: 20, color: '888888' })],
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

      // Title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: 'SBI Bot', bold: true, size: 56, font: 'Arial', color: BLUE })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 200 },
        children: [new TextRun({ text: 'Admin Guide', size: 32, font: 'Arial', color: '555555' })],
      }),
      p([r('Requires '), b('Manage Server'), r(' permission. All bot replies are private unless noted otherwise.')]),
      divider(),

      // ── 1. First-time Setup ───────────────────────────────────────────────
      h1('1. First-Time Setup'),
      p([r('Run these once when setting up the bot, or whenever your configuration changes.')]),
      spacer(80),

      h2('Link all cast members'),
      p([r('Use '), c('/link-member'), r(' to connect each Discord user to their Bookeo name. Required before shift DMs and check-ins work for that person.')]),
      spacer(80),

      h2('Set coverage channels'),
      p([r('Use '), c('/set-coverage-channel'), r(' to set where coverage requests post. MFB and The Endings need a separate channel per character \u2014 run the command once per character.')]),
      spacer(80),

      simpleTable(
        ['Show', 'show value', 'character needed?'],
        [
          ['The Man From Beyond', 'MFB',      'Yes \u2014 Daphne and Houdini (run twice)'],
          ['The Endings',         'Endings',   'Yes \u2014 HR and Author (run twice)'],
          ['Great Gold Bird',     'GGB',       'No'],
          ['Lucidity',            'Lucidity',  'No'],
        ],
        [2800, 1800, 4760]
      ),
      spacer(80),

      h2('Set check-in alert channels'),
      p([r('Use '), c('/set-checkin-channel'), r(' for each check-in eligible show (GGB, Lucidity, The Endings). This is where no-show alerts fire when a cast member misses their call time.')]),
      spacer(80),

      h2('Add check-in contacts'),
      p([r('Use '), c('/add-checkin-contact'), r(' to add anyone who should be pinged on no-show alerts. Run once per person.')]),
      spacer(80),

      h2('Set error channel'),
      p([r('Use '), c('/set-error-channel'), r(' to designate a channel for bot error messages.')]),

      divider(),

      // ── 2. Member Management ──────────────────────────────────────────────
      h1('2. Member Management'),
      p([c('/link-member discord:@User bookeo_name:FirstLast')]),
      p([r('Links a Discord user to their Bookeo display name. Must match exactly what Bookeo shows (e.g. '), c('Allen Otto'), r(').')]),
      spacer(80),
      p([c('/unlink-member discord:@User'), r(' \u2014 removes a link.')]),
      p([c('/list-members'), r(' \u2014 shows all current Discord \u2194 Bookeo pairs.')]),

      divider(),

      // ── 3. Meetings ───────────────────────────────────────────────────────
      h1('3. Meetings'),

      h2('Scheduling'),
      bullet([c('/schedule-meeting'), r(' \u2014 one-time meeting. Requires title, date, time, channel, target.')]),
      bullet([c('/schedule-recurring'), r(' \u2014 weekly or monthly. Add '), c('recurrence'), r(', '), c('day'), r(', and '), c('week'), r(' (monthly only).')]),
      spacer(80),
      p([r('Target options: '), c('@everyone'), r(', '), c('@here'), r(', or '), c('Specific members'), r('. If you choose Specific members, run '), c('/meeting-add-member'), r(' before the first reminder fires. Both commands default to 1-hour duration with 7-day and 24-hour reminders enabled.')]),

      spacer(100),
      h2('Managing existing meetings'),
      bullet([c('/meetings'), r(' \u2014 lists all active meetings with IDs.')]),
      bullet([c('/edit-meeting meeting_id:N'), r(' \u2014 change title, date (one-time only), time, duration, or channel. Future reminders use the new details; existing posts are not edited.')]),
      bullet([c('/cancel-meeting meeting_id:N'), r(' \u2014 deactivates the meeting and posts a cancellation notice to the channel.')]),
      bullet([c('/attendance meeting_id:N'), r(' \u2014 shows RSVP counts for the most recent reminder. Add '), c('date:YYYY-MM-DD'), r(' for a specific occurrence.')]),
      bullet([c('/meeting-add-member meeting_id:N user:@User'), r(' \u2014 adds a member to a Specific Members meeting.')]),

      divider(),

      // ── 4. Schedule & Shifts ──────────────────────────────────────────────
      h1('4. Schedule & Shift Reminders'),
      bullet([c('/schedule'), r(' \u2014 shows the full week of Bookeo shifts. Add '), c('week_of'), r(' for a different week.')]),
      bullet([c('/send-shift-reminders'), r(' \u2014 manually triggers shift DMs. Options: '), c('mode'), r(' (weekly or 24hr), '), c('user'), r(' (limit to one person), '), c('preview:True'), r(' (shows DM text without sending).')]),

      divider(),

      // ── 5. Coverage Requests ──────────────────────────────────────────────
      h1('5. Coverage Requests'),
      bullet([c('/custom-game show:X date:X channel:#X'), r(' \u2014 posts a custom game availability check. The bot replies with a Game ID.')]),
      bullet([c('/cancel-custom-game game_id:N'), r(' \u2014 deletes the post. Get the ID from the post itself.')]),
      bullet([c('/set-coverage-channel'), r(' \u2014 configure where coverage requests go. See First-Time Setup.')]),
      bullet([c('/list-coverage-channels'), r(' \u2014 shows current channel assignments for all shows.')]),

      divider(),

      // ── 6. Check-in Monitoring ────────────────────────────────────────────
      h1('6. Check-in Monitoring'),
      p([r('The bot seeds check-in records from Bookeo each morning and fires alerts at call time for cast members who haven\u2019t checked in.')]),
      spacer(80),
      bullet([c('/checkin-status'), r(' \u2014 shows check-in records for the last 3 days. States: checked in, alert fired, missed (bug), or pending.')]),
      bullet([c('/force-checkin user:@User'), r(' \u2014 manually marks a cast member as checked in. Add '), c('show:X'), r(' if they have multiple shifts today.')]),
      spacer(80),
      p([b('Managing alert contacts: '), c('/add-checkin-contact'), r(', '), c('/remove-checkin-contact'), r(', '), c('/list-checkin-contacts'), r('.')]),

      divider(),

      // ── 7. Bot Settings ───────────────────────────────────────────────────
      h1('7. Bot Settings'),
      p([c('/bot-config setting:X value:On|Off'), r(' \u2014 toggle automated shift DMs.')]),
      bullet([b('Weekly shift DMs'), r(' \u2014 Sunday DMs covering the next 7 days.')]),
      bullet([b('Daily 24hr shift DMs'), r(' \u2014 morning DMs for shifts that day.')]),

      divider(),

      // ── 8. Command Reference ──────────────────────────────────────────────
      h1('8. Command Reference'),
      spacer(80),

      commandTable([
        {
          heading: 'Member Management',
          commands: [
            ['/link-member',   'Link a Discord user to their Bookeo name'],
            ['/unlink-member', 'Remove a member link'],
            ['/list-members',  'List all Discord \u2194 Bookeo links'],
          ],
        },
        {
          heading: 'Meetings',
          commands: [
            ['/schedule-meeting',    'Schedule a one-time meeting'],
            ['/schedule-recurring',  'Schedule a weekly or monthly meeting'],
            ['/edit-meeting',        'Edit an existing meeting'],
            ['/cancel-meeting',      'Cancel a meeting and post a notice'],
            ['/meetings',            'List all active meetings with IDs'],
            ['/attendance',          'Show RSVP counts for a meeting'],
            ['/meeting-add-member',  'Add a member to a targeted meeting'],
          ],
        },
        {
          heading: 'Schedule & Shifts',
          commands: [
            ['/schedule',              'View the weekly Bookeo shift schedule'],
            ['/member-schedule',       "View one cast member's upcoming shifts"],
            ['/send-shift-reminders',  'Manually trigger shift DMs'],
          ],
        },
        {
          heading: 'Coverage',
          commands: [
            ['/custom-game',           'Post a custom game availability check'],
            ['/cancel-custom-game',    'Delete a custom game post'],
            ['/set-coverage-channel',  'Set the coverage channel for a show/character'],
            ['/list-coverage-channels','List all configured coverage channels'],
          ],
        },
        {
          heading: 'Check-in',
          commands: [
            ['/checkin-status',        'View check-in records for the last 3 days'],
            ['/force-checkin',         'Manually confirm a cast member as checked in'],
            ['/set-checkin-channel',   'Set the no-show alert channel for a show'],
            ['/add-checkin-contact',   'Add a user to no-show alert pings'],
            ['/remove-checkin-contact','Remove a user from no-show alert pings'],
            ['/list-checkin-contacts', 'List current no-show alert contacts'],
          ],
        },
        {
          heading: 'Bot Settings',
          commands: [
            ['/bot-config',       'Toggle automated shift DMs on or off'],
            ['/set-error-channel','Set the channel for bot error messages'],
          ],
        },
      ]),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(__dirname, '..', 'docs', 'admin-guide.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Written:', outPath);
});
