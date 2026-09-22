# Crewing Pilot C3b-1 WORKLOG

## Scope and invariants

- Task card: `/home/linux/Developer/skipi-ops/handoffs/TASKCARD-2026-09-22-crewing-c3b1.md`.
- Status: `EXEC_AUTHORIZED`; one product writer in this worktree.
- Base: `12a7ce4c46e7b694cafc4b782b5a2b9e23e89861` on `feature/crewing-c3b1-20260922`.
- Server reference is read-only at `92dc6c02c912fa841af5f52695655a5cd5228810`.
- No contracts, guard implementation/config, verify, release/version, production, provider, device, PR, merge, deploy, or tag actions. After the separately authorized guard route merged, the workflow guard pin alone was authorized for refresh.
- Scratch belongs under `scratchpad/crewing-c3b1-20260922/`; runtime evidence uses isolated HOME/XDG/app data and loopback synthetic data only.

## 2026-09-22T15:08:40Z — preflight and baseline

- Read `AGENTS.md` from the exact base with `git show`; no conflict with the authorized card.
- Read the full card, Supervisor PREP, Counselor PREP, and accepted C3a API contract.
- Confirmed the canonical checkout remains on the unrelated freeze branch; created this fresh worktree from the exact base.
- Chosen implementation: a new fixed-operation native C3b-1 module with one settings snapshot per call, expected-context comparison before dispatch, redirects disabled, explicit configured endpoint only, and no automatic retry. The UI separately guards late responses by request generation and context.
- Baseline: all existing `tests/*harness.mjs` passed. Baseline `cargo check --manifest-path src-tauri/Cargo.toml` passed with only the two existing dead-code warnings in `db.rs`.
- Disk gate immediately before baseline cargo: 108 GB free (>=20 GB). No shared target was assigned by the card or repository; this isolated worktree target is 1.3 GB after baseline and 107 GB remains free. Reuse of another checkout's mutable target was avoided to preserve one-writer isolation.
- CI limitation recorded: repository workflow runs on pull requests or main; an authorized feature push alone cannot close the CI guard. PR/CI remains `PENDING` until a separately authorized exact candidate window.

## Current step

## 2026-09-22T15:31Z — first functional implementation

- Added eight fixed native operations for alias list/create/rotate/pause/resume/revoke, synthetic submit, and paginated queue list. The client uses the exact settings snapshot, compares the UI expected context before dispatch, disables redirects, issues one request without write retry, sanitizes error detail, validates upload XOR/base64/size, and runs blocking HTTP outside the UI task.
- Added a desktop-only RU/EN intake pilot, distinct from Demo. Raw aliases live only in current in-memory display, copy success awaits the clipboard promise, file reading follows a user file-input action, upload retry keeps the same event/payload, and queue rendering preserves server pagination, lifecycle, nullable summary and the closed 41-reason catalogue.
- Added request/generation/context fences for queue, file reads, alias writes, revoke confirmation, settings save, copy, and A→B→A context changes. Alias drafts survive full rerenders. A shrinking total cannot render an impossible range.
- Added `tests/crewing_c3b1_pilot_harness.mjs`: 52 behavioral/static assertions currently pass. Existing Crew Flow (90), presence (212), and CSP harnesses still pass after the UI insertion.
- Supervisor interim static findings were read from `artifacts/crewing-c3b1-20260922/supervisor-mid.md`; all three concrete findings have been addressed in the current WIP and received regression assertions.
- Created assigned evidence scratch at `scratchpad/crewing-c3b1-20260922/`; future raw commands/screenshots will be recorded there. Earlier baseline stdout exists in the session transcript and is summarized above, but was not retroactively reconstructed as a raw log.

## Current step

## 2026-09-22T15:35Z — durable checkpoint and guard blocker

- First functional commit: `b1506d85c01a6a7845d381ddf391a4a4a92bdd72`.
- Native tests after formatting: 4 passed, 0 failed; disk gate immediately before the run: 104 GB free. The initial async conversion compile attempt failed on eight explicit `tauri::State` lifetimes; the source was corrected to `State<'_, AppState>` and the retry passed. Both raw logs are preserved in assigned scratch.
- Configured HTTPS push failed authentication before any remote write. The authorized SSH push then reached the mandatory pre-push guard. All four guard harnesses passed, but auto-task resolved `crewing / plugin-host` and rejected the five-file C3b-1 diff as outside that task's allowlist. The hook forbids env overrides and the current guard config has no C3b-1 route.
- Automatic refusal rule applied: stopped the push action; no bypass, `--no-verify`, force, hook edit, guard edit, or alternate publishing path attempted. Remote feature ref remains absent. PR/CI remains blocked on a human guard-route decision.

## Current step

## 2026-09-22T15:40Z — post-checkpoint review fixes

- Added the missing legacy `saveSettings()` context purge. Existing module-host settings save and legacy settings save now both clear one-time alias/upload state immediately when server/token/tenant changes.
- Strengthened the bounded harness to 57 passing assertions: exact 41 server reason keys with nonempty RU/EN text, execution of rendered Next controls at offsets 0/50/100, legacy settings purge, queue shrink range, alias generation/ABA races and draft preservation.
- Source ID and event ID are internal upload mechanics and no longer appear as ordinary user inputs. The visible flow is choose synthetic file → upload → receipt. Wording now says facts/ranking are a later screen and does not imply that ranked queue rows cannot exist.

## Current step

## 2026-09-22T16:08Z — isolated native chain and review correction

- `cargo tauri build --no-bundle` passed for `a2ab17e`; disk gate immediately before the build showed 103 GB free. Binary SHA-256 was `2b031d283dd5ecbf1c921f500ca5746302d988041675b27715c4cbce6dbe59e7`.
- The successful pre-fix native run used one `bwrap --unshare-all` environment with only loopback (`lo` UP, `127.0.0.1/8`, no default/gateway/non-loopback route), isolated HOME/XDG/runtime/vault, offscreen Xvfb `:93`, exact compiled desktop, exact server archive `92dc6c0`, full accepted routers with lifespan off, and an isolated SQLite database. Candidate PID/executable, safe HTTP trace, DOM events and database receipt linkage are preserved under assigned scratch.
- That run exercised alias list/create/rotate/pause/resume/revoke plus candidate submit/list. It seeded 51 synthetic rows, uploaded one user-selected synthetic file, paged 0→50 through the real rendered control (52 total), switched RU→EN through Settings, and matched distinct intake/receipt IDs and content SHA across UI state, rendered receipt, HTTP and read-only SQLite query. Six screenshots contain no raw alias; capture fails closed while the one-time value is visible.
- The first complete screenshots confirmed a review defect: server SQLite timestamps are serialized without an offset and were interpreted as local time, while the queue refresh ISO timestamp was converted from UTC. The same screen appeared four hours apart. The C3b-1-only formatter now treats a naive server timestamp as UTC and renders every pilot timestamp with an explicit `UTC` suffix. A regression verifies naive and `Z` forms have identical output.
- The bounded mutation suite caught all six authorized benign UI mutants; clean UI SHA was restored. Clipboard/file/network effects use recording/in-memory fixtures only. A post-hoc isolated reconstruction of `b1506d8` is red on the missing legacy settings-save purge assertion; this is regression evidence, not a failing-first claim.
- Native runner setup failures and their exact rc/logs remain in scratch. They were harness defects (redundant post-capability loopback mutation, HTML readiness parsing, Xvfb GLX/socket setup, screenshot logger argument, WebDriver pagination click semantics), not product failures; the complete run exited 0 after bounded runner-only corrections.

## 2026-09-22T16:31Z — exact functional candidate acceptance

- Functional source candidate is `4ee78c03bf40456e85e6c4e5f2cfba8a54c56655`. `cargo tauri build --no-bundle` passed after a 102 GB disk gate. The exact binary SHA-256 is `2f0082224b326787f998c84789e2a7f2158bf3e1889cb9d7a327403ab1aa7ef0` and embeds the 12-character build label `4ee78c03bf40`.
- Final source hashes: `dist/index.html` `bd3dea3528b7a7f4e638a578d4b08046166b7e77d964b4cd62d2216538b21267`; `src-tauri/src/crewing_intake.rs` `52558dcf5521ea7af8733869b9b9cca1859a265d41acd483ce73d1848c195272`; pilot harness `5ee3e1217753fb53828dd18975f8bff1923e192e25b4528c391081a40c980155`.
- Five native bridge tests pass. All 15 JavaScript harness files pass; the new pilot harness is 59/59. Relevant preserve counts include provenance 12, compliance 15, Crew Flow 90, mail demo 28, mailbox 25, plugin isolation 152, presence 212, theme 38, stack metadata 20, stack negative 5, with the remaining harnesses also green. Six authorized benign UI mutants were each caught and the clean HTML hash was restored.
- The exact binary completed an isolated fresh-profile native run with rc 0. One private `bwrap --unshare-all` namespace contained the actual desktop, offscreen Xvfb, WebDriver and the actual `92dc6c0` server routers over loopback; the network proof contains only `lo`, `127.0.0.1/8`, `::1` and no default/gateway/non-loopback interface. The actual desktop exercised all eight bridge operations: alias list/create/rotate/pause/resume/revoke and candidate submit/list. The rendered Next control produced offset 50 / 2 rows of 52. Distinct receipt/intake IDs and content SHA matched DOM, safe HTTP trace and read-only SQLite linkage.
- Frozen positive screenshots are `scratchpad/crewing-c3b1-20260922/screenshots/final-positive-4ee78c0/01-ru-queue-page1.png` through `06-en-queue-page1-revoked.png`. They show actual RU and EN, explicit UTC timestamps, full left-edge framing and no raw one-time alias. Capture refuses while a raw alias is visible.
- A supplemental fresh-profile native slice used the same exact binary and exited 0. Before any language switch it activated the actual rendered Next then Previous controls: offset `0→50→0`, rows `50→2→50`, with matching native HTTP requests. A member-token alias create produced native bridge HTTP 403, visible `Нет прав.` / `Access denied.`, and alias row count stayed `1→1`. The same app process/session survived server restart with the feature flag off; actual native refresh produced alias and queue GET 404 with visible `Раздел недоступен.` / `Section unavailable.` and zero queue rows. Frozen screenshots are under `screenshots/final-negative-4ee78c0/07...10`; safe event/HTTP/network traces and rc are under `logs/native-negative-*`.
- Provenance control is calibrated against the final positive evidence: the real native receipt passes only with one HTTP POST 201 within 0.160139 seconds and matching isolated DB row. A fixture-only copy of the receipt event with no native-dispatch trace is refused with rc 1 (`REFUSED: native HTTP dispatch evidence count=0`). This is evidence control only; no product mutation or protection change.
- Clipboard success/failure is covered in the VM harness with a recording/rejecting stub. No claim of an actual OS clipboard write is made. File and network negative effects are likewise isolated fixtures/stubs; positive file upload and HTTP are the native run above.
- The earlier rc 143 run remains classified as a preliminary runner cleanup failure. The later positive and supplemental-negative packages both exit 0. The first supplemental attempt failed before app launch because the bwrap mount layout omitted dynamic-linker symlinks; its rc/log is preserved separately, and the corrected contained run did not weaken network or capability boundaries.

## 2026-09-22T16:34Z — guard pin readiness

- Owner-authorized guard PR 63 is merged at `071eea0c3679c8b35bad2bd62adb2df4c3b17746`; manager reported canonical guard clean and synchronized. The ordinary guard `assert-config-superset` passed from old `fdbf3d8cc29435e5da64afd105e5850c571245fa` to new `071eea0c3679c8b35bad2bd62adb2df4c3b17746`, with no missing harness/task/path/protected-path coverage (`scratchpad/crewing-c3b1-20260922/pin-superset.json`).
- The only workflow change is the exact guard checkout ref. Runtime dependency pin and guard implementation are untouched. This pin and the final WORKLOG are documentation/CI metadata after functional `4ee78c0`; no UI rebuild is needed. Product code bytes and the accepted binary remain those of `4ee78c0`.

## Current step

## 2026-09-22T16:38Z — durability and executor sanitation

- The pin/acceptance commit `d6298ce9a4d5358e92884c54e73868058881871c` passed the ordinary unchanged pre-push hook as task `crewing/crewing-c3b1`: six configured guard harness commands passed, six paths were accepted, protected touches were zero and release changes were absent. Normal SSH push created `refs/heads/feature/crewing-c3b1-20260922`; live SSH read-back matched `d6298ce9a4d5358e92884c54e73868058881871c`.
- Mini-sanitation removed only 21 manifest-listed reconstructible or sensitive scratch entries (37,479,705 bytes): the exact server/archive copies, derived mutant/archive copies, isolated databases, settings/profiles, token fixtures and disposable synthetic upload. Product source and build target were not touched. Unique runners, launch recipe, reverse-patched regression harnesses, safe raw logs and screenshots remain; manager confirmed their hashed ops copies before deletion.
- Post-sanitation source/binary hashes are identical to functional `4ee78c0`. All 15 JavaScript harness files passed again. A disk gate immediately before Cargo showed 102 GB free; all five targeted native bridge tests passed again with only the two existing `db.rs` dead-code warnings.
- Final scratch inventory is `scratchpad/crewing-c3b1-20260922/logs/final-file-inventory-sha256.txt` (189 files); `SANITARY-MANIFEST.md` records exclusions and retained evidence. No executor candidate, bwrap, Xvfb, WebDriver or server process remains. Scratch is intentionally untracked evidence and is being mapped to the manager's off-worktree ops artifacts rather than added to the product branch.
- This final WORKLOG-only commit changes no functional, workflow or binary byte. The accepted binary remains the build of functional `4ee78c0`; the final product branch head is reported after its normal push. PR/CI remains pending the separately authorized exact candidate window.

## Current step

Stop product writes after the final documentation push and hand the exact remote head to the manager for review/PR gating.

## ПЕРЕДАЧА

LOCAL ACCEPTANCE PASS for functional `4ee78c03bf40456e85e6c4e5f2cfba8a54c56655`; feature-branch durability PASS. PR/CI remains PENDING the manager's separately authorized exact candidate window. No production, release, provider, scanner, real-CV, device, merge or deploy action was performed.
