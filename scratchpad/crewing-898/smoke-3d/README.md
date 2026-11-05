# No.898 — smoke after 3d: the four second-step texts, now readable

Replaces smoke-3c/. Same four cases, same real second-step refusal, re-run after the
contrast fix. Ran entirely on Xephyr :9; the owner's display was never touched.

## What the owner is accepting

**The DESKTOP refusal line** — its wording and its legibility. NOT 'legibility' in general:
the mobile path (m-login-error, .mobile-status.warn -> var(--warn)) is still 2.79:1 in the
light theme and is a separate task. This limit is also recorded inside the stage's ACK_STOP.

## Contrast

| | declared | rendered in these frames |
|---|---|---|
| before 3d | 1.46 : 1 | 1.96 : 1 |
| after 3d  | 6.40 : 1 | 6.09 / 5.94 : 1 |

WCAG AA floor for body text is 4.5 : 1. Three independent calculations agreed on 6.40:
mine, the coordinator's, and his contrast_ratio.py run against the bytes on disk.

**A correction to carry:** 'the frame flatters the product' is NOT a general rule. I said
it after measuring the pale version and the coordinator adopted it. Antialiasing pulls
glyph cores TOWARD the background, so a frame OVERSTATES contrast when text is lighter
than its background (1.96 vs 1.46) and UNDERSTATES it when darker (6.09 vs 6.40). The
direction depends on polarity, not on a constant optimism.

## Files
- `en-workspace_unavailable.png` + `en-workspace_unavailable.txt` — Account accepted, but your Crewing workspace refused the reque…
- `en-workspace_unreachable.png` + `en-workspace_unreachable.txt` — Account accepted, but we didn't reach your Crewing workspace �…
- `ru-workspace_unavailable.png` + `ru-workspace_unavailable.txt` — Аккаунт приняли, но рабочее место …
- `ru-workspace_unreachable.png` + `ru-workspace_unreachable.txt` — Аккаунт приняли, но до рабочего ме…

## Verified

- each .txt text read FROM the shipped dist, never transcribed from the picture
- each .txt ends with that run's stub log: login 200, then bootstrap dropped or 503
- frames 1100x750, cropped to the app window — no desktop content captured
- dist compiled into the binary == dist in the vehicle, sha256
  96b6bd5000f957155569b342a236c17b51e244a8291475cf82260d1980fdf3fa

## Not established

- debug build from a copy with a loopback dev origin; release untested
- our stub, not the real server
- only the second-step refusal path; a successful sign-in is unreachable in this slice

## Digests
- `50e1adddf5e5929e6e989802752297eb06785165b614132bbc65fd12e61d3a1f`  en-workspace_unavailable.png
- `4bd809d3ff541b4810ed461283a36d9e67c3a61f48e0f9b7b78924a99c3d2433`  en-workspace_unavailable.txt
- `f23d2f8e9ea0e8508f0e1557bf23f6b6b4bba7b2a7be341078036ee885f57b1f`  en-workspace_unreachable.png
- `88b0674d91df229e0cd075ff1747b6a7318f547dfbc178bb6ce1630c88e1b278`  en-workspace_unreachable.txt
- `0c667e3844157190ac69918865df97e5e42f2fef9af6a3296fe74f75fa2e3856`  README.md
- `49e2324aa6c952090f2ff716be2c69e187d218a39adf8eb39b9b8cb8bd4e2168`  ru-workspace_unavailable.png
- `69be9bb7589a06bdce3840942a62d8c76be7fbb62ab811f3e0ae9e17160a96a6`  ru-workspace_unavailable.txt
- `91b22dc280e4c0b8dd28841e4f0af615916016cca84f7a3d3e0d1173de7e43b2`  ru-workspace_unreachable.png
- `a1dbfe615e1b772ee13576eac345bb50a7fa057c66bd4be184705dd3e651986d`  ru-workspace_unreachable.txt
