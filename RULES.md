# RULES.md
# Operational rules with feedback tracking.
# When a rule is correctly applied: increment ✓. When violated or corrected: increment ✗.

| ID | Trigger | Rule | ✓ | ✗ |
|---|---|---|---|---|
| R001 | docx XML edit | Node.js script files only. Write `.js` to project root, run, delete. Never sed/awk/perl. | 0 | 1 |
| R002 | docx: script reading /tmp | `cygpath -w /tmp/dir` first. Use the `C:\Users\Allen\AppData\Local\Temp\...` result in Node. | 0 | 1 |
| R003 | docx: any string replace | `grep -c 'pattern' file` must return 1. Stop if 0 or 2+. | 0 | 1 |
| R004 | docx: calling pack.py | Always `--validate false`. cp1252 Unicode bug crashes the validator on this machine. | 0 | 2 |
| R005 | every git commit | No Co-Authored-By line. | 0 | 0 |
| R006 | non-trivial implementation task | Investigate → plan → get approval before writing code. | 0 | 0 |
| R007 | any DB work | `node:sqlite` only. Never `better-sqlite3` (native compile fails on Railway). | 0 | 0 |
| R008 | any code needing today's date string | `utils.todayCentral()`. Never `new Date()` raw. Railway=UTC; CT evenings = next calendar day UTC. | 0 | 0 |
| R009 | any private interaction reply | `flags: MessageFlags.Ephemeral`. `ephemeral: true` is deprecated; fix on touch. | 0 | 0 |
| R010 | any file importing Routes | `require('discord-api-types/v10')`. NOT `@discordjs/rest`. | 0 | 0 |
| R011 | add/rename/change options on slash command | `npm run deploy-commands` after. Guild-scoped = instant; skipping = command not updated. | 0 | 0 |
| R012 | any Bookeo API call with date range | Client-side filter: `shifts.filter(s => s.date >= from && s.date <= to)`. bookeo-asst ignores `to`. | 0 | 0 |
| R013 | cancelling via /open-coverage button | Edit post to cancelled state. Never `message.delete()`. (/cancel-custom-game slash cmd still deletes.) | 0 | 0 |
| R014 | any change to startup sequence in index.js | `scheduler.start()` must come AFTER `seedAndScheduleToday()` resolves. | 0 | 0 |
| R015 | adding a new show | Add to `SHOWS` in `lib/shows.js` + abbreviation map in `lib/bookeo.js` + `SHOW_GROUPS` in bookeo-asst `upcoming.py`. | 0 | 0 |
