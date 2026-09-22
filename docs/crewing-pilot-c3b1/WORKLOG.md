# Crewing Pilot C3b-1 WORKLOG

## Scope and invariants

- Task card: `/home/linux/Developer/skipi-ops/handoffs/TASKCARD-2026-09-22-crewing-c3b1.md`.
- Status: `EXEC_AUTHORIZED`; one product writer in this worktree.
- Base: `12a7ce4c46e7b694cafc4b782b5a2b9e23e89861` on `feature/crewing-c3b1-20260922`.
- Server reference is read-only at `92dc6c02c912fa841af5f52695655a5cd5228810`.
- No contracts, guard, verify, release/version, production, provider, device, PR, merge, deploy, or tag actions.
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

## Current step

Commit the timestamp/projection regressions, rebuild the exact final local SHA, rerun the full isolated native/visual chain and six mutations against it, then complete preservation checks. External product push remains stopped until the separate authorized guard route is merged and available; this executor does not change guard.

## ПЕРЕДАЧА

PENDING.
