#!/usr/bin/env python3
"""Emit content-s3c-A.json and content-s3c-B.json. Everything numeric here was MEASURED;
digests are read from the files at generation time so the content cannot drift from them."""
import hashlib, json, os, subprocess

SP = "/home/linux/Developer/skipi-crewing/scratchpad/crewing-898"
WT = "/home/linux/Developer/worktrees/crewing-898-20261104"

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

DRIVER = SP + "/coord/run-s3c.sh"
PRS    = SP + "/coord/patch-s3c-twostep.py"
PDIST  = SP + "/coord/patch-s3c-dist.py"
ORACLE = SP + "/coord/assert-names.mjs"
DRYRUN = SP + "/coord/run-s3c-dryrun.sh"
WORDING= SP + "/WORDING-3c-workspace-codes.md"

POST = {"A": {"dist": "eca4048ef1a26699fa65b4c6a458791686e644af12d606655531d50e465f451b"},
        "B": {"dist": "016e6141e83476e93b9609ef8f2891afa87edc228c1d082f1fef524904a6e384"}}
RS_POST   = "e611fae5478234a34415d18452c738612828a38a575d417d5777f9b0f041af48"
HARN_POST = "7264bd55cab733869e39f2792a0d1fa223363e2384e65f8fe67cbf7c67e088c8"

def content(reg):
    return {
 "outcome": ("Sub-stage 3c: the two-step distinction. The second step of an interactive login "
   "(`transport.bootstrap(&identity.token` - native_lifecycle.rs:561 PRE / :580 POST) gets its OWN "
   "refusal codes, so a failure "
   "AFTER the account was accepted is no longer indistinguishable from one before it."),
 "new": ("TWO codes, not one: `workspace_unreachable` (from transport_unreachable, keeps the "
   "actionable 'check your network') and `workspace_unavailable` (from upstream_unavailable, keeps "
   "'this is on our side'). Mapped at the CALL SITE via `second_step_code`, never renamed in "
   "native_account.rs. Plus four texts (2 keys x 2 languages), the harness oracle extended to a "
   "code-birth shape it was blind to, and 23 new asserts."),
 "why_two_and_not_one": ("I first proposed ONE code and withdrew it: the two shipped texts are "
   "already distinguished BY ACTION ('check your network … now' vs 'on our side … wait'), so "
   "collapsing them would lose both clauses. The house rule I cited to justify the collapse names "
   "its own CONDITION - indistinguishability AT THE INTERFACE (dist/index.html:14999-15002) - and "
   "this pair does not meet it. The error was judging a replacement without measuring what it "
   "replaced."),
 "why_the_call_site_and_not_the_transport": ("`refresh` (`pub(crate) fn refresh` - native_lifecycle.rs:599 PRE / :619 POST) calls the "
   "same bootstrap with a STORED credential and has no first step at all, so its identical failure "
   "must NOT imply an accepted account. A rename inside native_account.rs would corrupt it. Drill A "
   "is exactly this mutation and it is caught."),
 "preserve": ("`transport_unreachable` and `upstream_unavailable` keep their map entries and texts - "
   "step one and `refresh` still emit them, and two asserts pin that. The `refresh` call site is "
   "untouched and the patch refuses if it vanishes. No cargo runs in the window, so neither the "
   "external target dir nor src-tauri/gen/schemas/ is written."),
 "stop": ("STOP and report if: any of the THREE files is not at its pinned PRE digest; the vehicle "
   "porcelain is not exactly the two declared modified files; any POST digest differs from its pin; "
   "the harness is not exactly 180/0/0; the register argument is absent or not A/B."),
 "proves": ("Driver self-hashes first. Three distinct ACK ids with pairwise inequality. Window read "
   "from the certificate, never from a message. PRE and POST digests for all three files. Harness "
   "summary parsed, not grepped. ACK_STOP is the last action."),
 "rust_dry_run_evidence_not_an_in_window_check": {
   "where": "a COPY outside the vehicle, CARGO_TARGET_DIR outside both repos, OUTSIDE any window",
   "failing_first": "247 passed / 1 failed, dying on the intended assertion with its intended message",
   "after_fix": "248 passed / 0 failed UNDER umask 0022",
   "under_the_machine_default_umask_0002": ("233 passed / 15 failed. The 15 are pre-existing and "
     "umask-caused (12 directory-mode under db::native_database, 3 file-mode native635_bindingfmt_*), "
     "flipped 0002->0022->0002 in ONE target dir, filed with the manager as No.922 HIGH. 0022 is a "
     "NAMED CONDITION of the baseline, not a norm and not a fix: the default here is 0002."),
   "the_new_test_itself": "passes under BOTH umasks, so it does not depend on the chosen condition",
   "cost": "cold 33.9 s / 383 units / 2.6 G; warm 4.68 s; warm after editing the Rust 4.52 s, Compiling 1",
   "why_the_warm_floor_is_1_unit": ("cargo said it itself: `Dirty … the file ../.git/HEAD is missing`. "
     "The condition is that ../.git/HEAD does not resolve, NOT that we are in a worktree - the copy "
     "has no .git at all and the floor is the same."),
   "in_tree_writes_measured": ("manifest (path+mode+sha256) before and after: exactly 4 files, all "
     "under src-tauri/gen/schemas/, all ignored. NONE of the 76 TRACKED files under src-tauri/gen/ "
     "(43 android + 33 apple) was touched - that was the risk worth measuring, since only "
     "gen/schemas/ is ignored."),
   "mutation_drills": ("four, each caught by a DIFFERENT control on a DIFFERENT line, each restored "
     "by DIGEST and not by a green run: collapse the pair -> 1948; widen the mapping to refresh -> "
     "1968; map every code -> 1977; map at step one -> 1961."),
   "a_control_that_did_NOT_fire": ("the `assert_ne!(seen[0], seen[1])` I added for the collapse is "
     "preceded by the loop's own expectation, so drill D was caught at 1948 by the loop, not by it. "
     "It is a second line of defence, not a proven one. Reported because an unexercised control "
     "counted as exercised is what a false green lives on."),
 },
 "oracle_coverage_gain": {
   "population": {"before": 16, "after": 26, "lost": 0},
   "attribution": ("+10 = 2 of mine + 8 status->code TABLE codes entering coverage for the FIRST "
     "time (bad_email, entitlement_expired, entitlement_missing, entitlement_revoked, "
     "invalid_credentials, invalid_request, scope_denied, too_many_attempts). Unattributed: 0. "
     "Already covered by another route: login_required, ownership_conflict, tenant_mismatch, "
     "upstream_unavailable."),
   "how_measured": ("by dumping the harness's own `codes` SET before and after. Three earlier "
     "figures (12, 7, 6) were each produced by an instrument answering a different question - "
     "table composition, or regex-findability, which ignores REACHABILITY. Named because the "
     "number moved three times and the arithmetic was never the fault."),
   "rule_chosen": ("the arm pattern must CONTAIN a string literal, not BE one. Measured: pattern IS "
     "a literal -> 2 values and NONE of the 12 table codes; pattern CONTAINS -> 15, of which 12 are "
     "table codes; any arm -> 36, of which 24 are the phase builder. The narrow form would have been "
     "blind to the most likely birthplace of the NEXT code."),
   "the_one_exclusion": ("`expired` from account_session_state (lib.rs:669-684) - a producer of "
     "SESSION STATES, not refusal codes: its values reach the UI via s.account_session "
     "(dist:1319, :1686), never via loginRefusalText, and settings.crewing.login.expired occurs "
     "ZERO times in dist. Subtracted BY FUNCTION, with a vocabulary DERIVED from the body in the "
     "file's existing PHASES idiom, plus its two controls - non-emptiness and collision with the "
     "map - so the exclusion cannot become a silent hole."),
   "coupling_drill": ("harness 3c + Rust 3c + UNTOUCHED dist (restored by digest) -> 4 FAIL naming "
     "exactly workspace_unavailable and workspace_unreachable. Rust-without-texts is refused "
     "mechanically, by four independent asserts, not by agreement."),
 },
 "refactor_oracle_NOT_APPLICABLE_here": ("Declared inapplicable, not applied. It is built for a PURE "
   "refactor (3a), where no counted population moves. 3c changes behaviour, and three asserts carry "
   "measured COUNTS inside their NAME (reachable codes=16 mapped=26; 23 keys; functions reached=143), "
   "which 3c necessarily changes. The 4+-digit normalisation cannot reach them (two to three digits) "
   "and widening it to any digits would collapse No.894/No.898/No.880. And paying debt (i) inside 3c "
   "would NOT rescue it: moving a count out of a name IS itself a name change, so LOST would stay 3 "
   "with GAINED 3. There is no reachable green for this instrument in this stage - that is the "
   "reason, stronger than inconvenience. The instrument is kept as coord/assert-names.mjs (--diff "
   "computes the set difference ITSELF: `comm` on two JS-sorted files warns on stderr, prints rows "
   "on stdout and returns rc 0, so an exit-code check would accept a non-answer). 3c's oracle instead: "
   "the three pinned POST digests, the four drills, and the population numbers above."),
 "not_in_this_grant": {
   "why_this_field_exists": ("A declared write RESERVES scope: overlaps() would count the path "
     "occupied and a neighbour needing it would get SEQUENTIAL_REQUIRED for a write that never "
     "happens. So a false declaration costs more than an absent one. These were considered and are "
     "NOT touched - named here so the reader sees the surface was examined."),
   "paths": [
     {"path": "/tmp/claude-1000/-home-linux-Developer-skipi-crewing/ebbd1815-b6d4-4272-b07f-4adc865ecf49/scratchpad/s3c-dryrun/cargo-target",
      "reason": "external CARGO_TARGET_DIR; cargo does not execute in this window, the run was outside it"},
     {"path": WT + "/src-tauri/gen/schemas",
      "reason": ("tauri_build::build() writes 4 files here, and it is gitignored so invisible to the "
                 "PRE/POST predicate - but no build runs in this window. Verified absent in the "
                 "vehicle before and after the dry run.")},
   ]},
 "expected_post": {
   "why": "Pinned as an exit condition; the driver EXITS 11 if any POST differs.",
   "vehicle_porcelain_becomes": [" M dist/index.html", " M src-tauri/src/native_lifecycle.rs",
                                 " M tests/crewing635_public_settings_harness.mjs"],
   "files": [
     {"path": WT + "/dist/index.html", "sha256": POST[reg]["dist"], "mode": "664"},
     {"path": WT + "/src-tauri/src/native_lifecycle.rs", "sha256": RS_POST, "mode": "664"},
     {"path": WT + "/tests/crewing635_public_settings_harness.mjs", "sha256": HARN_POST, "mode": "664"},
   ],
   "harness": "exactly 180 passed / 0 failed / 0 setup_errors",
   "register_changes_only_dist": ("the harness POST digest is IDENTICAL for A and B; only dist "
     "differs, so the owner's choice invalidates no measurement - it moves one pin."),
 },
 "driver": {
   "path": DRIVER, "sha256": sha(DRIVER),
   "patch_scripts": [
     {"path": PRS, "sha256": sha(PRS),
      "note": ("two stages: `test` inserts the failing test and REFUSES if the fix is present; `fix` "
               "REFUSES unless `test` ran first. That ordering is what made the failing-first real.")},
     {"path": PDIST, "sha256": sha(PDIST),
      "note": ("register is a required parameter with no default; refuses a text holding a raw double "
               "quote (the JS string layer) or claiming a completed sign-in.")}],
   "dry_run_driver": {"path": DRYRUN, "sha256": sha(DRYRUN)},
   "oracle": {"path": ORACLE, "sha256": sha(ORACLE)},
   "exit_codes": ("1 self-hash, 2 certificate, 3 AUTHORITY, 4 PRUDENCE/window, 5 ACK ids, 6 register "
     "and scripts, 7 vehicle state, 8 PRE digests, 9 log dir/ACK_START, 10 patch, 11 POST digests, "
     "12 harness. Authority precedes argument validation, so a bad certificate refuses before a bad "
     "register - otherwise the driver would report the wrong blocker."),
 },
 "measured_duration": {
   "harness_run": "~0.55 s (180 asserts, three reachability walks at depths 5/6/7)",
   "patch_apply": "under 1 s for all three steps",
   "no_cargo_in_window": "the Rust suite is NOT run here; 4.52 s was measured outside, on the copy",
   "stage_total_expected": "a few seconds; the driver refuses below a 30 s remainder",
 },
 "resource_identities_note": "Empty by fact: no network, database, port, host resource, or git byte.",
 "owner_window": ("REQUIRED and NOT satisfied by this request. Four new user-facing texts need live "
   "owner acceptance (CANON-ui-v1); the register (A or B) is the owner's single choice, relayed by "
   "the manager. Rust and text are UNSHIPPABLE IN PARTS: both codes occur ZERO times in dist today "
   "and loginRefusalText falls back to `refused_unspecified`, so Rust alone would show 'the app was "
   "given no reason' in place of 'check your network' - worse by action AND false in fact. "
   "'Rust is ready' must not be read as 'ready to ship'."),
 "depends": ("Card /home/linux/Developer/skipi-ops/handoffs/TASKCARD-2026-11-04-crewing-898-login-texts.md. "
   "Wording candidates on disk: " + WORDING + " sha256 " + sha(WORDING) + "."),
 "active_neighbors": ("PROSE, not a second declared stream. Nothing of mine runs outside this stage; "
   "the dry run finished before the request was built and its 2.7 G target is kept warm in /tmp "
   "only to make a re-run cheap."),
 "next_action": ("Sibling of BACKLOG No.797, NOT its closure - No.797 is the fifteen sites of "
   "login_required, confirmed by the manager as open with no assignee. Deferred and named: debt (i) "
   "in its full form - the invariant 'the NAME is a constant, everything measured after ::' across "
   "the 26 asserts that concatenate an expression into the name (10 lists, 4 offsets, ~12 counts). "
   "Paying it buys the refactor oracle a new domain, not tidiness. Also open: the inherited edge "
   "that a received status proves reachability but not WHOSE server (an intercepting proxy or guest "
   "portal lands in the same catch-all), filed separately by the manager, deliberately not in this slice."),
 "line_citation_units": ("Stated because this document necessarily mixes them. Citations to "
   "native_account.rs, native_fresh.rs, lib.rs and dist/index.html are PRE-state AND POST-state "
   "alike - 3c does not modify those files, so they do not move; each was re-verified by NEEDLE at "
   "generation time, not by eye. Citations to native_lifecycle.rs are PRE-state unless marked, and "
   "they SHIFT by +19 lines once the mapper is inserted (`authenticate` 548->567, the bootstrap call "
   "561->580, `refresh` 599->619, and `second_step_code` appears at 138). The four mutation-drill "
   "line numbers (1948, 1961, 1968, 1977) are POST-state by construction - the drills ran on the "
   "patched copy. Where a number moves, the SYMBOL is given beside it: the needle survives the "
   "shift, the index does not. This is debt (ii) paid."),
 "surfaces": {
   "code": {"reads": [], "writes": ["path:" + WT + "/dist/index.html",
                                     "path:" + WT + "/src-tauri/src/native_lifecycle.rs"]},
   "contracts": {"reads": ["path:/home/linux/Developer/skipi-contracts"], "writes": []},
   "schema": {"reads": [], "writes": []},
   "generated": {"reads": [], "writes": []},
   "tests": {"reads": [], "writes": ["path:" + WT + "/tests/crewing635_public_settings_harness.mjs"]},
   "database": {"reads": [], "writes": []},
   "ports": {"reads": [], "writes": []},
   "cache": {"reads": [], "writes": []},
   "build": {"reads": [], "writes": []},
   "guard": {"reads": ["path:/home/linux/Developer/skipi-guard/configs/homes/crewing.json"], "writes": []},
   "release": {"reads": [], "writes": []},
   "card": {"reads": ["path:/home/linux/Developer/skipi-ops/handoffs/TASKCARD-2026-11-04-crewing-898-login-texts.md"], "writes": []},
   "logs": {"reads": [], "writes": ["path:" + SP + "/stage-implement-3c"]},
 }}

for reg in ("A", "B"):
    p = SP + "/coord/content-s3c-%s.json" % reg
    json.dump(content(reg), open(p, "w"), ensure_ascii=False, indent=2)
    print("%s  sha256 %s" % (os.path.basename(p), sha(p)[:16]))
