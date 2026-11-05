# No.898 3c — smoke test for the four second-step texts

Owner asked for a smoke test, not a live show. Everything ran on Xephyr :9;
the owner's display :1 was never touched — no window placed, no wmctrl, no xdotool.

## This is a REAL second-step refusal, not an injected string

A loopback stub answers POST /api/app/login with 200 (step ONE genuinely succeeds),
then fails POST /api/app/crewing/bootstrap. Both requests appear in the stub log of
every case — see the trailing lines of each .txt. A closed port cannot produce this:
there step ONE fails, which is a different scenario and the one earlier stands measured.

## Files

- `en-workspace_unavailable.png` + `en-workspace_unavailable.txt` — Account accepted, but your Crewing workspace refused the request — s…
- `en-workspace_unreachable.png` + `en-workspace_unreachable.txt` — Account accepted, but we didn't reach your Crewing workspace — sign-…
- `ru-workspace_unavailable.png` + `ru-workspace_unavailable.txt` — Аккаунт приняли, но рабочее место Крюи…
- `ru-workspace_unreachable.png` + `ru-workspace_unreachable.txt` — Аккаунт приняли, но до рабочего места �…

## Verified before handing over

- every frame is 1100x750, cropped to the app window: the subject and nothing else.
  Full-screen grabs are refused by construction, because unpainted framebuffer regions
  hold GPU leftovers (a frame once showed browser chrome no client on :9 had drawn).
- every text is present VERBATIM in the shipped dist/index.html; the .txt strings are
  read from the file, never transcribed from the picture.
- language label matches the actual script in all four.
- the red line is a DURABLE box, not a toast: frames 30 s apart are byte-identical,
  and there is no setTimeout or re-hide near the write (dist:1746 / :16070).
- dist compiled into the binary == dist in the vehicle, sha256
  016e6141e83476e93b9609ef8f2891afa87edc228c1d082f1fef524904a6e384

## What this does NOT establish

- the binary is a DEBUG build from a copy with a loopback dev origin; release untested.
- the server is our stub; what the real server answers in these two cases is not shown.
- only the second-step refusal path ran. A successful sign-in is unreachable in this
  slice (fresh_context_unavailable) and is not shown.
- acceptance is the owner's; these frames are for him to look at, not a substitute.

## Digests

- `491cfcf33d592ce67a2d5653e568286a5c47de992f2cb0e680ef2042fe6dad4d`  en-workspace_unavailable.png
- `3855af58f09454daf4ed5eed65a8e3025dd41e80d2420e06c899acb684aa9cd0`  en-workspace_unavailable.txt
- `3639e8ca963bf2002e517f56e4b56c16b4e7ac8ef2738b43624cb2c87cd90aa7`  en-workspace_unreachable.png
- `a938e26dbeb492d7917609d6ff068dbb5a32adb1901437c753ff63469c1707e5`  en-workspace_unreachable.txt
- `9100baf3351c1ca5d7e4aa216a86c4f10ba5c26a1b85bac423abd846e25ebe5a`  README.md
- `f72030ef53244fdc5c5b68eefdc6dd151c95a0f30c11b83b53fcaca9ca975581`  ru-workspace_unavailable.png
- `545ee4da2ae47ac7de312c0fd1beb4e125fd997446f70e13ca5c23441d2659f1`  ru-workspace_unavailable.txt
- `a01f4960131c58e314d729e12d82fb371bc4fc76dc8d4ac9873f47e039b3b817`  ru-workspace_unreachable.png
- `847b8eabaa3141f4cbc11d3c63eb1b317787f518beda07104b3a2c8fc3f0b31d`  ru-workspace_unreachable.txt
