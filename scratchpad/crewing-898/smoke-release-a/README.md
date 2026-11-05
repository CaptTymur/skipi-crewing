# No.898 — part A: S1 on the RELEASE binary, and what a release build cannot show

Taken 2026-11-05 07:16:48–07:17:25Z under certificate `CERT-r1-c76599d2…`, driver
`run-s11-smoke-a.sh` `84cc396d7a6cabe9`, instrument `smoke-tool.py` `89da3a2f8b6c6f42`.
Entirely on Xephyr `:9`; the owner's display `:1` was never addressed — the capture subcommand
refuses `:0` and `:1` outright, so a typo could not photograph it.

**Subject: the RELEASE binary `1488c7004c14ea6027b7ef84218bc49cf78828c67d036130cb8166af58a0ff73`,
built from `e5132934` with `dist` `96b6bd50…fdf3fa`.**

## This does NOT replace smoke-3d/ or smoke-3c/

Those two directories are untouched: all 18 of their files were digested before the first run
and compared after the last, byte for byte. A difference would have been exit 15.

**And it corrects one claim they make about themselves.** `smoke-3d/README.md` is headed "the
four second-step texts". That is true of four FILES and false of four STATES: those four PNG are
**two** states (`workspace_unreachable`, `workspace_unavailable`) in two languages. Measured
across the whole card: files named for `transport_unreachable` — 0; for `upstream_unavailable` —
0. The first-step codes do appear inside the 3d `.txt` files, but as the mapping's SOURCE
(`produced : step two dropped the connection -> transport_unreachable`), never as a shown state,
so a grep for coverage by state name returns non-zero and closes the point falsely.
**That README is not edited** — its digest list includes its own digest and its stage is closed,
so the correction travels here instead.

**This README deliberately does NOT list its own digest**, precisely so that it stays
correctable. Listing it is what made the 3d one unfixable.

## Coverage of the four states, as it now stands

| state | step | where it is shown | build |
|---|---|---|---|
| **S1** `transport_unreachable` | 1 | **here — first frames of this state anywhere** | RELEASE |
| **S2** `upstream_unavailable` | 1 | nowhere yet — stage B2 | (debug, pending) |
| S3 `workspace_unreachable` | 2 | `../smoke-3d/` | debug |
| S4 `workspace_unavailable` | 2 | `../smoke-3d/` | debug |

Earlier S1 texts were read on the 25.10 stand at commit `b31b3213` — a DIFFERENT object, not
coverage of this candidate.

## Why only S1 on a release build — three measured borders

1. `ACCOUNT_ORIGIN` is a compile-time `const` (`native_account.rs:7`); the dev override is
   `option_env!` (`:382`) — the COMPILER's environment, so nothing handed to the running app
   redirects it.
2. That branch and the `direct_loopback_qa` field it reads are `#[cfg(debug_assertions)]`
   (`:381`, `:385-386`): the branch does not exist in a release build, so **rebuilding the
   release profile with the variable set still yields the production origin**.
3. The account client is reqwest 0.12.28; `Cargo.toml:29` asks for `rustls-tls`, which reqwest's
   own `Cargo.toml:148` defines as `["rustls-tls-webpki-roots"]` — bundled roots, no runtime path
   to add a CA.

So S2/S3/S4 each need a COMPLETED TLS session to a domain we do not own. The loopback stand is
debug-only as a deliberate security boundary, which the product states in its own comment.
Debug is therefore not a weaker instrument here; it is the only one that reaches those states.

## The prediction, written before the run, and its outcome

Predicted (the coordinator's, recorded in the driver header and in the request before the stage
ran): a proxy answering **503 to the CONNECT** still yields S1, not S2, because
`upstream_unavailable` is born only inside `response_json()` — reached only after
`request.send()` has succeeded and the body has been read.

**CONFIRMED, and more sharply than the test was designed to confirm.** The geometry test asked
whether the boxes matched; the frames turned out **byte-identical**:
`en-closed-3-refusal.png` and `en-503-3-refusal.png` are both
`f7cf0e23fc7d0da8183ce67a1b9ae534cea58ef484a86eab57c6737d3fa6321c`. Two different network
conditions, the same pixels. **S2 is unreachable on an unmodified release build for the same
reason as S3 and S4.**

## Controls, all passed

- **Geometry.** S1 boxes measure 13 px, one line, against the 31 px two-line second-step
  calibration taken from `smoke-3d` before this instrument was pinned.
- **Language, on the TEXT and not on the fact of switching.** The EN and RU refusal frames
  differ (box widths 373 px vs 367 px); identical frames would have meant one of the two labels
  was false.
- **Prior evidence.** All 18 files of `smoke-3c/` and `smoke-3d/` byte-identical before and
  after.
- **Positive control for the stage as a whole.** The output directory must not exist beforehand:
  frames appear where there were none.
- **Every captured frame** holds ≥ 50 distinct colours (1309–1343 measured); a near-uniform frame
  is what a broken capture produces, and it would otherwise pass as "the app drew nothing".
- **Each step self-verified**: an unchanged frame after a click or after submit stops the stage,
  because typing into a screen that is not the form yields a confident wrong frame.

## Two independent witnesses that the host was production and was never reached

- The app's own log (reqwest TRACE), in every run — and the PORT differs by condition, which is
  itself a check that each log belongs to its own run rather than being a copy of one:
  - `en-closed-app.log`, `ru-closed-app.log`: `proxy(http://127.0.0.1:19165/) intercepts 'https://assistant.skipi.app/'`
  - `en-503-app.log`: `proxy(http://127.0.0.1:**19166**/) intercepts 'https://assistant.skipi.app/'`
- The proxy's log, in the 503 run: `CONNECT assistant.skipi.app:443 HTTP/1.1`

These are not two spellings of one question: the first says "I decided to go to this host via
the proxy", the second says "someone came to me asking for this host". Together they close both
the route and the fact of the attempt. **No egress was possible by construction** — the proxy
points at loopback, so neither address nor password could leave the machine. Measured: neither
typed credential appears in any published log (0 occurrences of each, in 1405-byte logs).

## Contrast — three estimators, one verdict

| estimator | value | what it asks |
|---|---|---|
| core (darkest glyph pixel vs modal background) | **6.40** | did the DECLARED colour land on screen |
| mean (every glyph pixel, antialiased edges included) | 5.55 EN / 5.69 RU | what a reader meets |
| smoke-3d's README | 6.09 / 5.94 | a third glyph population |

They are **not** three attempts at one number and none confirms another: they average different
pixel populations. What all three agree on is the only thing the threshold asks — every reading
clears the WCAG AA floor of 4.5.

## What this does NOT establish

- **No owner acceptance exists.** These frames are a condition of the show, not a substitute for
  it. The owner's live gate is unchanged by anything here.
- The second step was never exercised: this is the FIRST step failing.
- Our loopback refusal, not the real server. **No stand has ever seen the real server**, and a
  separate finding (card No.956) holds that client and server may diverge on path, shape and
  field name — in which case S3 and S4 could be unreachable in production too.
- The desktop path only. The mobile `.mobile-status.warn` remains 2.79:1 (No.925).

## Files and digests

- `ab2ef7847efac28cc93e385eb787c9b5aafc4f095008ff65dd6b683d8e60b41f`  en-503-1-entry.png
- `c7ee39b34de4aa2d44bea263e308366e2ffa55195386c858d9a5d699663fa4d9`  en-503-2-form.png
- `f7cf0e23fc7d0da8183ce67a1b9ae534cea58ef484a86eab57c6737d3fa6321c`  en-503-3-refusal.png
- `a46d10324c09880aaf054664bcb7107c98be980e627e73e61dd6ae16d88cf193`  en-503-app.log
- `ab2ef7847efac28cc93e385eb787c9b5aafc4f095008ff65dd6b683d8e60b41f`  en-closed-1-entry.png
- `c7ee39b34de4aa2d44bea263e308366e2ffa55195386c858d9a5d699663fa4d9`  en-closed-2-form.png
- `f7cf0e23fc7d0da8183ce67a1b9ae534cea58ef484a86eab57c6737d3fa6321c`  en-closed-3-refusal.png
- `0bba7203fef4f38185845c974c47b449c4f8fb8c7865ebce3220b9bf93ce4b94`  en-closed-app.log
- `3f000f054ab56668a5adc56462ea01d511dc95d32f40c130deef081ed5645abf`  ru-closed-1-entry.png
- `a3fbeff2883891bd2b47c8a8ddc46e0c716628454c554dcdd0ee8a61e776600d`  ru-closed-2-form.png
- `57160a5671826974ac3bf50d19d0e7767472540227aaf7bf9d673a8952d0ad24`  ru-closed-3-refusal.png
- `03ed3a21b5074dcfca9e9c9e002641f19c9b4c1ad56b1a70dec417a09a6eb9a1`  ru-closed-app.log

The README's own digest is deliberately absent, so this file stays correctable.
