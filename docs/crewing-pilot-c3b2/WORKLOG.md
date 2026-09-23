# Crewing Pilot C3b-2 WORKLOG

## Scope and invariants

- Task: `/home/linux/Developer/skipi-ops/handoffs/EXEC-PROMPT-2026-09-23-crewing-c3b2.md`; card `/home/linux/Developer/skipi-ops/handoffs/TASKCARD-2026-09-22-crewing-c3b2.md` (write right to the card is NOT delegated; this file is the only journal of the EXEC).
- Frozen PREP `handoffs/crewing-c3b2-prep-20260922/PREP.md` verified `sha256sum` = `7fdd85df422946e7b55934ffef35d5c490a5af2b7b05560c3e1775a6ac170a62` at 02:15:09Z.
- Live `refs/heads/main` of `git@github.com:CaptTymur/skipi-crewing.git` at 02:15:09Z = `0ace64019dfa96b02efe2f463002ac8bbd517df6` (matches the required base).
- Worktree `/home/linux/Developer/worktrees/crewing-c3b2-20260922`, branch `feature/crewing-c3b2-20260922`, created 02:16:11Z from the 40-char SHA; `git rev-parse HEAD` printed `0ace64019dfa96b02efe2f463002ac8bbd517df6`. Local `refs/heads/main` stays at `12a7ce4c46e7b694cafc4b782b5a2b9e23e89861` (F1: not moved). Canonical checkout `779e1db` and worktree `crewing-c3b1-20260922` untouched.
- F2: `.gitignore` on the base ignores `docs/`; this file is added with `git add -f` and `git ls-files docs/crewing-pilot-c3b2/` is checked before every push. `.gitignore` is not changed.
- Allowed product paths (exactly six): `dist/index.html`, `src-tauri/src/crewing_intake.rs`, `src-tauri/src/lib.rs` (registration only), `tests/crewing_c3b2_candidate_harness.mjs`, `docs/crewing-pilot-c3b2/WORKLOG.md`, `.github/workflows/skipi-guard.yml` (pin-only line 23 → `7bd9300601e5445a9a60f1136d2fd57a9e9b32c5`; line 36 runtime pin `d6238191c554bc370983366672c41b41116754ce` unchanged).
- Server reference read-only: `/home/linux/Developer/worktrees/server-crewing-c1-s1-20260920` at `92dc6c02c912fa841af5f52695655a5cd5228810` (verified `git rev-parse HEAD`, status empty); deps `/home/linux/Developer/worktrees/server-crewing-baseline-20260915/scratchpad/crewing-baseline/deps` (147992466 B, 0 `*.pyc`). `PYTHONDONTWRITEBYTECODE=1` on every server launch.
- Scratch only `scratchpad/crewing-c3b2-20260922/` inside this worktree.
- Forbidden: PR/merge/deploy/release/tag, `--no-verify`, force, override, fake journal touch, owner display `:1`, vault, real CV/mail/provider/login/payments, writes outside this worktree, moving local `main`.
- `AGENTS.md` of the target repo read at 02:15:09Z: no conflict with the task. Its line "if this file is not in /memory the session is raised wrongly" is noted: this EXEC is a manager-dispatched subagent (skipi-ops AGENTS «Субагенты», step 0 satisfied by reading the file itself).

## 2026-09-23T02:15:09Z — preflight

- `df -h /` at 02:15:09Z: 101 GB free (≥ 20 GB).
- Read fully: TASKCARD, frozen PREP, session prompt §6–11, MANAGER-REVIEW, supervisor-review, counselor-review, LAUNCH-RECIPE C3b-1 with all scripts, guard route HANDOFF/APPROVAL/patch, C3a API contract, server routers/schemas/services for facts/rank/shortlist/matching-profiles, current `crewing_intake.rs`, pilot block of `dist/index.html`, C3b-1 harness, workflow.
- Guard repo `/home/linux/Developer/skipi-guard` main HEAD `83f5dad8c3f6f96f44941067438110ce50ff00dd` (read-only; only an untracked `.worktrees/` of somebody else is present, not touched). Route `crewing-c3b2` with 7 checks present at lines 76–90 / 523–552 / 623–630 of `configs/homes/crewing.json`.

## 2026-09-23T02:18:01Z — baseline on base 0ace (before any edit)

- 15 JS harnesses (`node tests/<name>.mjs`), all rc=0; raw logs `scratchpad/crewing-c3b2-20260922/baseline/<name>.log`:
  build_provenance 12 · crewing_c3b1_pilot 59 · crewing_compliance_manual_flow 15 · crewing_crew_flow_demo 90 · crewing_mailbox_contract 25 · crewing_mail_cv_intake_demo 28 · crewing_plugin_isolation 152 · crewing_presence_contract 212 · crewing_theme_default 38 · csp_inline_handlers OK · settings5_preview_gated OK · stack_build_metadata 20 · stack_verification_negative_control 5 · trial_activate_unconnected PASS · trial_gate_wired OK.
- Native baseline: `cargo test --manifest-path src-tauri/Cargo.toml` started after the disk gate (see `baseline/df-before-cargo-test.txt`); result recorded below when finished.

## 2026-09-23T02:18:43Z — native baseline result

- `cargo test --manifest-path src-tauri/Cargo.toml` on base 0ace: rc=0, lib unittests **6 passed, 0 failed** (5 in `crewing_intake::tests` + 1 in `messaging::tests`; the card's "five native unit tests" counted only the pilot module — the real lib count is six), main/integration targets 0 tests. Fresh target dir, 32 s. Raw log `scratchpad/crewing-c3b2-20260922/baseline/cargo-test-baseline.log`; disk gate `baseline/df-before-cargo-test.txt` (101 GB free).

## 2026-09-23T02:36:29Z — functional implementation (first checkpoint, no push)

- `src-tauri/src/crewing_intake.rs`: nine typed commands `crewing_intake_candidate_get / fact_list / fact_record / fact_correct / candidate_rank / rank_list / shortlist_confirm / shortlist_withdraw / matching_profile_list` with fixed paths through the existing `fixed_url`/context/client policy; typed DTOs (`CandidateFact` keeps `confidence: Option<f64>` so null and 0 stay distinct; `ShortlistPair.profile_version: i64` checked ≥ 1); shape checks before any dispatch (`invalid_request` kind); the safe-detail allowlist extended with the contract §5 domain codes only; `send` split into `perform` + JSON decode (unchanged semantics: an empty 204 on a typed read is still `malformed_response`) and a new `send_no_content` whose only success is an exact empty 204 — any other 2xx is `unexpected_success` with `ambiguous=true` (UNKNOWN), refusals/network follow the shared policy. `lib.rs`: nine registrations only.
- Rust unit tests added (10): expected-204 ACK with fixed DELETE path and no JSON body; unexpected empty 200 → ambiguous; 200 with JSON body on expected 204 → ambiguous; documented 403 `withdraw_not_permitted` stays a refusal (not ambiguous); typed reads still refuse an empty 204; rank posts exactly `{}`; path-segment encoding for `facts/{field}/correct` and `matching-profiles`; pair/fact shape refusals dispatch nothing; confidence null vs 0 distinct in the DTO; Pydantic list detail is not a code. Two initial test-fixture defects were mine (wrong Content-Length; reqwest discards a 204 body so "204 with bytes" is unobservable — replaced by the observable neighbour "200 with body"), fixed, logs `rust/cargo-test-1.log` (rc=101, 14/2), `rust/cargo-test-2.log` (rc=0, 16/0), `rust/cargo-test-3.log` after rustfmt (rc=0, 16/0). rustfmt applied to `crewing_intake.rs` only (`lib.rs` base is not rustfmt-clean and is left untouched beyond the registration lines).
- `dist/index.html`: new bounded block `C3b-2 CANDIDATE CARD START/END` after the C3b-1 block: card view with three sections (Сведения и источники → Сохранённые оценки → История решений · исходная оценка не сохранена), RU/EN dictionary with the §8 mandatory strings, fact form bound to this card's objects (empty objects block entry), correction mode with fixed field, explicit rank button, per-pair confirm/withdraw, decision history with `Сотрудник <user_id>` and UTC times, unranked active profiles, write-attempt ledger (PENDING/ACKED/REFUSED/UNKNOWN) separate from observed data, ACK + failed read-back shown as "Запись подтверждена, обновление не удалось", UNKNOWN shown with "Проверить текущее состояние" (reads only), new explicit action after UNKNOWN gated by the "Предыдущая запись могла выполниться…" dialog, domain refusal codes mapped before generic 403/404, unknown enum/codes shown as unknown. Fences: detail generation + per-section request ids + context key; close/open/A→B/A→B→A/settings save purge detail, forms and outcomes. C3b-1 block edits (minimal): `detail`/`detailGeneration` in fresh state, `Open` control on queue rows, render dispatch to the card, `open` text key. CSS additions for the card only.
- Product defect found by the new harness and fixed failing-test-first: `pilotOpenCard` set `detail` before the context-key sync inside `renderIntakePilot`, which reset it (a card opened right after a context change vanished). Fix: sync the context first (`js/c3b2-run-2.log` red → `c3b2-run-3.log`).
- `tests/crewing_c3b2_candidate_harness.mjs`: 123 assertions GREEN (`js/c3b2-run-4.log`): static bridge/registration/pins, positive chain on an in-memory fake of the C3a API behind the recorded `invoke` stub, RU/EN, nullable/unknown codes, refusal precedence (rank_not_found, profile_version_stale, profile_not_active, already_confirmed, withdraw_not_permitted, named-seat 403, flag-off 404, fact_no_source_object 422, list detail), profile lookup 403 fallback, unsafe integer version refusal, pending/double-click, settings purge, close/reopen late write; **M01–M12, M15 (UI half), M16 as isolated source mutants of the C3b-2 block, each known-good GREEN → mutant RED → clean GREEN (14 KILLED)**; **R01–R07** each with its own assertion set. M13/M14 and the native half of M15 are Rust-level and are run as source mutants against `cargo test` at functional freeze (recorded below when done).
- PRESERVE: all 15 existing harnesses rc=0 after the UI change (`js/checkpoint1-*.log`), C3b-1 pilot harness 59/59.

## 2026-09-23T02:38:07Z — exact candidate build

- Checkpoint commit `c1bc691580ce39e3031d9101ad282171e5e35900` (product paths only; `git add` by explicit paths, WORKLOG with `-f`). No functional file changed after it: `git diff --stat c1bc691 -- dist src-tauri tests` is empty at freeze.
- `cargo tauri build --no-bundle` rc=0 (`native/build/tauri-build.log`, disk gate 97 GB): `src-tauri/target/release/skipi-crewing` SHA256 `0b53533920beab6d1f51bec5ed61e9d2469481b0105ea56b1a4266f76bd8c98e` (embedded dist = the checkpoint dist). Not the C3b-1 binary (`2f00…`).

## 2026-09-23T02:45:41Z — M13/M14/M15 native adapter controls (source mutants against cargo test)

Method: `src-tauri/src/crewing_intake.rs` clean copy hashed (`rust/mutants/clean.sha256` = `c640b42d…7b0`, equal to the HEAD blob), one mutant at a time copied over the working file, `cargo test --lib crewing_intake::tests` run with loopback TcpListener stubs (the only "network"), file restored from the clean copy and re-hashed (`rust/mutants/restore.log`, all `match=yes`), then the full `cargo test` on the restored tree (`rust/cargo-test-restore-clean.log`, 16/0). Raw logs `rust/mutants/cargo-test-M1{3,4,5}.log`, disk gate files next to them.

| ID | Mutant (source) | Sensor | Clean before | Mutant | Restore |
|---|---|---|---|---|---|
| M13 | expected empty 204 routed through the JSON decoder (`send::<Value>`) | `withdraw_expected_empty_204_is_ack` (+ two neighbours) | GREEN 16/0 | RED 12/3 | GREEN 16/0 |
| M14 | any 2xx accepted as withdraw ACK | `withdraw_unexpected_empty_200_stays_ambiguous`, `withdraw_200_with_json_body_stays_ambiguous` | GREEN | RED 13/2 | GREEN |
| M15 (native half) | documented 403 treated as success in `perform` | `withdraw_documented_403_keeps_refusal_code` | GREEN | RED 14/1 | GREEN |

Boundary named: the mutation is applied to the working file for the duration of one test process (sole writer, bit-identical restore proven by hash), not to a separate crate copy — a separate crate cannot compile this module without the Tauri host. UI half of M15 (refusal shown as refusal, history untouched) is in the JS harness (KILLED).

## 2026-09-23T02:44:41Z — guard: config-superset proof and local route on the checkpoint

- `skipi-guard assert-config-superset --home crewing --old-ref 93b1a51e… --new-ref 7bd93006…` → PASS (`guard/config-superset-93b1a51-to-7bd9300.json`): old 9 tasks ⊂ new 10 tasks (adds `crewing-c3b2`), missing harnesses/additive checks/allowed patterns/release-sensitive/protected = none.
- `skipi-guard verify --home crewing --auto-task --run-harness --base 0ace… --head HEAD` on the checkpoint → task `crewing-c3b2` (declarative route), protected touches 0, release no, 7/7 harness commands pass (`guard/verify-checkpoint1.log/.json`); repeated after the pin edit with the same result (`guard/verify-after-pin.log`).

## 2026-09-23T02:55:53Z — NEW native chain on the exact candidate (isolated sandbox)

Recipe `native/LAUNCH-RECIPE-C3B2.md` + `native/scripts/*` (adapted from C3b-1; every run recorded, adaptation is not a run). `bwrap --unshare-all`, loopback only (`native/logs/private-network.json`: `lo` UP 127.0.0.1/8, no default/gateway route), `--clearenv`, isolated HOME/XDG/TMPDIR under `native/profile/`, Xvfb `:95` 1400x1000 (owner display `:1` never used), exact server archive of `92dc6c02…` with three empty `releases/*` dirs pre-created (file set diffed equal to `git archive`), deps read-only, `python3 -I -S`, `PYTHONDONTWRITEBYTECODE=1` (pyc count in deps and server-runtime = 0 after all runs), `uvicorn 127.0.0.1:18082` lifespan off, `tauri-driver 14446/14447` + `/usr/bin/WebKitWebDriver`, one candidate process (PID 31 in the sandbox pid namespace, exe `/candidate/skipi-crewing` = the built binary) kept across all phases. Synthetic secrets are generated from `/dev/urandom` per launch into the launcher environment only.

Runner corrections before the clean run were runner defects, not product defects, each attempt kept (`native/logs-attempt*`): 1) server import needs `releases/` dirs (read-only bind); 2) my scenario assumed the upload lands on page 2 — the queue is newest-first (the upload is row 1 of page 1), page preservation is now proven on page 2 with a read-only open of a seeded card; 3+4+5) WebKitWebDriver clicks/Enter on controls below the fold of the scrolled `#main` landed nowhere (same class as the C3b-1 "pagination click semantics" note) → `Session.activate` scrolls the control to the centre, clicks, verifies the effect through the attempt ledger and records the method (`activate` events: 13 × `click`, 0 × Enter fallback); 6) patch not applied (my assertion), rerun; 7) all phases ok but rc=1 from the runner tail (`cat` of the wrong session-file path) → fixed; 8) the isolated profile survived between runs and kept the EN language chosen at the end of the previous run → the profile is wiped per run.

Clean run `native/logs/launch-positive.log` rc=0, 02:55:14Z–02:55:53Z, phases `wd-positive/arranged/unknown/unknown-check/noactive/flagoff/close` all `ok`; events `native/logs/positive-ui-events.jsonl` (0 `assertion_failed`), safe HTTP trace `native/logs/native-http-trace.jsonl`, DB `native/positive-server.db`, join `native/logs/verify-native.json` **PASS 44/44**:

| # | Operation | HTTP (trace) | UI result (events) | DB read-back |
|---|---|---|---|---|
| 1 | candidate_get | GET card 200 | card_opened: objects id/content_type, source_trust unverified, empty facts/ranks, 3 unranked | intake row quarantined/unverified linked to receipt |
| 2 | fact_list | GET facts 200 | versions newest-first | — |
| 3 | fact_record | POST facts 201 ×2 | rank v1 "Mastre" (page 1), certificate:coc_master v1 "held", ACK + read-back ok | rows by member1, operator_entered, confidence NULL, cite this intake's object |
| 4 | fact_correct | POST facts/rank/correct 201 | v2 "Master" newest-first, v1 "Mastre" preserved | version 2 row |
| 5 | candidate_rank | POST rank 200 ×4 | 3/3 ranked; A met, B missing(rank), C unconfirmed(certificate:radio_operator); "Запрос пересчёта выполнен"; later 3/2 after arrangements; 0/0 no_active_profiles | ranks A v1, A v2, B v1, C v1, D v1; intake state ranked, source_trust still unverified |
| 6 | rank_list | GET ranks 200 | three separate lists, freshness caveat on every row, v1/v2 side by side, unranked D | — |
| 7 | shortlist_confirm | POST shortlist 201 ×2 (+409 ×3, 404 ×1) | B v1 **decided=false** confirmed; re-add after withdraw → second id | two B rows, distinct ids, second active |
| 8 | shortlist_withdraw | DELETE …/shortlist/B/1 204 (+403 ×1 on C) | ACK on empty 204 (`result: null`), history shows withdrawn_by/at | first B row withdrawn_by member1 |
| 9 | matching_profile_list | GET matching-profiles?include_archived=true 200 | names, current version/state next to ids | — |

Negatives on unchanged 92dc through the compiled desktop: already_confirmed 409 (RU/EN text), profile_version_stale 409 (A → v2 by admin PATCH), profile_not_active 409 (C paused), withdraw_not_permitted 403 (member2's decision; DB row untouched), rank_not_found 404 (handler driven for unranked D — the screen offers no control for a pair without a stored comparison; recorded as arrangement), fact_no_source_object 422 (handler driven with a foreign object id injected into renderer state — the form only offers this card's objects; arrangement), no_active_profiles 200 = success without computation, flag-off 404 on card/facts/ranks after a server restart with `CREWING_C1_INTAKE_ENABLED=0` (same candidate PID), lost write answer (server stopped) → UNKNOWN with "Проверить текущее состояние" (reads only, attempt stays UNKNOWN, no dispatch) → new explicit rank shows the dialog "Предыдущая запись могла выполниться…" → new attempt ACKED, old stays UNKNOWN. Named-seat 403: separate sandbox run `native/logs/launch-negative.log` rc=0 (display `:96`, port 18083, company-wide token): card/facts/ranks/profiles readable, fact record → 403 `not authorised for this crewing` → "Нет прав." / "Access denied.", DB unchanged (`native/logs/negative-ui-events.jsonl`, `native/logs/native-negative-http-trace.jsonl`).

Queue page preserved on Back (offset 50 → 50, arrangement with a read-only open) and on return from the working card (offset 0); Escape closes the card (dialog/settings open → ignored). Language switched through the real Settings control.

## Visual acceptance (RU/EN, isolated display, exact candidate)

`native/screenshots/01…26` (27 files): 01/01b queue page 2 + Back; 02 empty card; 03 facts with v2/v1 history; 04 three lists (met/missing/unconfirmed); 05 attempts ledger with 409 already_confirmed; 06 back to page 1; 07 withdrawn; 08 two decision ids; 09–12 EN card/facts/comparisons/history; 13 two stale reasons + unranked D; 14 409 stale; 15 403 withdraw; 16 EN 403/409; 17 422/404; 18 v1/v2 after rerank; 19/20 RU/EN UNKNOWN write outcome; 21 dialog; 22 no_active_profiles; 23/24 RU/EN flag-off 404; 25/26 RU/EN named-seat 403. Reviewed by me on the images: all §8 strings present, three lists never flattened, decided text carries no suitability claim, history labels by `Сотрудник <user_id>` with UTC. Known pre-existing: top navigation tabs overflow at 1100 px (C3b-1 header overflow) — not claimed fixed.

## PRESERVE

- All 15 existing harnesses rc=0 on the final functional tree (`final/*.log`), C3b-1 pilot harness 59/59 (its six controls untouched), `cargo test` 16/0 (`final/cargo-test-final.log`). Alias/Copy/upload/queue paths exercised natively in the positive run (upload receipt + pagination + language switch). Native clipboard stays UNKNOWN (not exercised). Demo/plugins/mobile: static assertions in the C3b-1 harness still pass; no change to those paths.

## Controls matrix (final functional tree; every number from this SHA)

M01–M12, M15(UI), M16: JS harness `js/c3b2-run-4.log` / `final/crewing_c3b2_candidate_harness.log` — 14/14 KILLED (clean GREEN → mutant RED → clean GREEN). M13, M14, M15(native): cargo mutants above — 3/3 KILLED. R01–R07: 7/7 PASS with separate assertions (R07 two assertions incl. declined dialog). No row substituted; no methodical blocker.

## Guard pin (this commit)

`.github/workflows/skipi-guard.yml` line 23 `ref: 93b1a51e…` → `ref: 7bd9300601e5445a9a60f1136d2fd57a9e9b32c5`; line 36 runtime pin `d6238191…` unchanged; diff = 1 line (`git diff` shows exactly one `-`/`+` pair). Config-superset proof above.

## 2026-09-23T02:58:50Z — freeze and handover

- Functional freeze: the four functional files are byte-identical to checkpoint `c1bc691`; this commit adds only the pin line and this journal. Final HEAD/upstream/live-remote are reported to the manager after the push through the canonical pre-push hook (no `--no-verify`, no force). No PR/merge/deploy/release/tag.
- Own processes: 0 left (checked by `/proc/<pid>/cwd`/`exe`, ports 18082/18083/14446–14449 free, only the owner's `X1` socket exists). The owner's own bwrap processes (qbittorrent/obsidian) were never touched.
- Scratch `scratchpad/crewing-c3b2-20260922/` 29 MB, untracked. Cleanup manifest (synthetic runtime secrets/DBs to delete after acceptance, nothing real inside): `native/positive-fixture.json`, `native/negative-fixture.json` (mode 600, synthetic tokens), `native/profile/config/skipi-crewing/settings.json`, `native/negative-profile/config/skipi-crewing/settings.json`, `native/positive-server.db`, `native/negative-server.db`, `native/*-session.json`, the `native/profile/` and `native/negative-profile/` trees, `native/server-runtime/` (archive copy of 92dc). Unique evidence to keep: `native/logs*`, `native/screenshots*`, `native/scripts`, `native/LAUNCH-RECIPE-C3B2.md`, `baseline/`, `rust/`, `js/`, `guard/`, `final/`, `ui/`.
- Known limitations: (a) rank_not_found and fact_no_source_object were driven through the real handlers from the WebDriver script (the screen itself does not offer those pairs/objects) — recorded as arrangements; (b) M13/M14/M15-native mutants ran on the working file with hash-proven restore, not on a separate crate; (c) "204 with bytes" is unobservable through reqwest (body discarded) — the neighbour "200 with body" is tested; (d) no CI run: feature push alone does not run the PR workflow; PR/CI/two reviews remain the manager's window; (e) header overflow pre-existing.

## Current step

## 2026-09-23T03:00:14Z — STOP: push refused by the canonical pre-push hook (stale base, trap F1)

- `git push git@github.com:CaptTymur/skipi-crewing.git feature/crewing-c3b2-20260922` at 02:59:04Z → hook `skipi-guard pre-push-ref` FAIL (`guard/push.log`): for a NEW remote ref (remote sha zero) the hook takes `merge-base(local_sha, origin/main)` (`bin/skipi-guard:127–135`), and `refs/remotes/origin/main` of the shared `.git` is `12a7ce4c46e7b694cafc4b782b5a2b9e23e89861` — 8 commits behind live main `0ace6401…` (F1). The range therefore includes the C3b-1 files (`docs/crewing-pilot-c3b1/WORKLOG.md`, `tests/crewing_c3b1_pilot_harness.mjs`), 8 changed files, route `plugin-host`, "changes outside allowed patterns". Remote ref was not created; live main unchanged at `0ace6401…`.
- Evidence that the route covers the real diff: `verify --auto-task --base 0ace… --head 05dd0add…` → PASS, task `crewing-c3b2`, 6 changed files, 7/7 harness (`guard/verify-final-head.log/.json`); `pre-push-ref` simulated with `--remote-sha 0ace…` → PASS, same route (`guard/pre-push-ref-sim-base-0ace.log`). The refusal is purely the stale `origin/main` tracking ref of the canonical checkout.
- Not done, by the task's rules: no `--no-verify`, no force, no override, no fetch/heal of `origin/main` or `main` in the shared `.git` (other people's checkout; the morning `--heal` is the manager's command). Decision left to the manager: heal `origin/main` (`git fetch <ssh-url> main` in the canonical repo per the morning pass) and then rerun the same push, or another route. Until then the candidate is local-only (durability BLOCKED-class by the manager's gate).
