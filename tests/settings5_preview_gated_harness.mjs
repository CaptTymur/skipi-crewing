// Regression guard: the crewing "Settings v1.1 preview" shell (renderSettingsFiveShell)
// — which contains the "Paid Service ... does not implement billing" section and other
// placeholder rows (Login model / RBAC / Trust Score) — must stay a DEV-ONLY preview,
// never shown to a real crewing user.
//
// Context (2026-07-13, curator polish). Audit flagged the Paid billing placeholder (M6)
// as embarrassing for a paying user. Independent investigation: the whole five-section
// shell is behind SETTINGS5_FLAG_KEY ('skipi_crewing_settings5'), which defaults OFF and
// the app NEVER enables (no setItem). renderSettingsModal falls through to classic
// settings when the flag is off, so real users never see it. This harness LOCKS that:
//   1) the flag read defaults off (=== '1'),
//   2) desktop + mobile render paths gate the five-shell behind settingsFiveShellEnabled(),
//   3) the app NEVER enables the flag (no setItem(<flag>, '1')),
//   4) the "does not implement billing" placeholder lives inside the gated shell.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'dist', 'index.html'), 'utf8');

const FLAG = 'skipi_crewing_settings5';
let fail = 0;
function ok(cond, msg) { if (cond) console.log('  ✓', msg); else { console.error('  FAIL:', msg); fail = 1; } }

// 1. Flag defaults OFF — enabled only when the stored value === '1'.
ok(new RegExp(`SETTINGS5_FLAG_KEY\\s*=\\s*['"]${FLAG}['"]`).test(html), `SETTINGS5_FLAG_KEY = '${FLAG}' defined`);
ok(/getItem\(\s*SETTINGS5_FLAG_KEY\s*\)\s*===\s*['"]1['"]/.test(html),
   'settingsFiveShellEnabled() reads flag as === "1" (defaults off when unset)');

// 2. Desktop + mobile render paths gate the five-shell behind the flag.
ok(/if\s*\(\s*settingsFiveShellEnabled\(\)\s*\)\s*return\s+renderSettingsFiveShell\(\)/.test(html),
   'renderSettingsModal gates the five-shell behind settingsFiveShellEnabled()');
ok(/if\s*\(\s*settingsFiveShellEnabled\(\)\s*\)\s*return\s+mobileSettingsSectionsFive\(\)/.test(html),
   'mobile settings gates the five-shell behind settingsFiveShellEnabled()');

// 3. The app must NEVER enable the flag (else the dev preview leaks to real users).
const enableRe = new RegExp(`setItem\\(\\s*(?:['"]${FLAG}['"]|SETTINGS5_FLAG_KEY)\\s*,\\s*['"]1['"]`);
ok(!enableRe.test(html), `app never enables the preview flag (no setItem('${FLAG}', '1'))`);

// 4. The "does not implement billing" placeholder lives inside the flag-gated shell.
const shellStart = html.indexOf('function renderSettingsFiveShell()');
const billingIdx = html.indexOf('does not implement billing');
ok(billingIdx === -1 || (shellStart !== -1 && billingIdx > shellStart),
   'the "does not implement billing" placeholder sits inside the flag-gated five-shell');

if (fail) {
  console.error('\n>>> The crewing Settings v1.1 preview (Paid billing placeholder + placeholder rows) may leak to real users.');
  console.error('>>> Keep it behind SETTINGS5_FLAG_KEY (default off); never enable the flag from the app.');
  process.exit(1);
}
console.log('OK: crewing Settings v1.1 preview stays dev-flagged and hidden from real users.');
process.exit(0);
