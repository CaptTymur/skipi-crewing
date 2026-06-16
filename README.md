# Skipi Crewing

Employer-side Skipi application for verified crewing companies and shipowner HR teams.

Current repo version: `0.4.121`.

## Product Scope

Skipi Crewing is the company-side companion to Skipi Seafarer:

```text
Skipi Seafarer -> public jobs board -> Skipi Crewing
      |                                  ^
      +--------- application package ----+
```

The current app supports:

- posting vessel-specific vacancies to production API;
- receiving seafarer applications and document package summaries;
- mailing requests for standing rank/vessel-type demand;
- compliance profiles;
- local seafarers database from received packages;
- company documents/templates/checklists;
- desktop team chat for special team-scoped tokens.

The mobile app intentionally has no Team module for ordinary trial/company tokens.

## Access Model

Crewing access is token based.

- Verified company tokens are issued manually by Skipi.
- Trial tokens are time-limited, currently intended for one-month tester access.
- Trial-published public vacancies are labelled for seafarers as trial publishers, while the publisher does not see that label in their own app.
- Team access requires explicit `team:read`/`team:write` token scope. A normal trial token must not see or use Team.

Public job vacancies require an IMO when they are posted as actual vessel jobs. Standing rank/vessel-type demand should go through Mailings.

## Desktop Build

```bash
cd /home/linux/Developer/skipi-crewing/src-tauri
cargo tauri build --bundles deb,appimage
```

If the Linux WebKit window crashes on this workstation, launch the release binary with:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  /home/linux/Developer/skipi-crewing/src-tauri/target/release/skipi-crewing
```

The local `cargo tauri build` can still exit non-zero if updater signing keys are not present, even when `.deb` and `.AppImage` bundles were produced.

## Android Build

Use the installed JDK, not the broken system Java path:

```bash
cd /home/linux/Developer/skipi-crewing/src-tauri
JAVA_HOME=/home/linux/.jdks/temurin-21 \
PATH=/home/linux/.jdks/temurin-21/bin:$PATH \
  cargo tauri android build --apk --debug
```

Install on the connected Android test phone:

```bash
adb install -r gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n app.skipi.crewing.mobile/.MainActivity
```

## Latest Smoke

Last full smoke: `2026-06-16`, version `0.4.121`.

Desktop/API covered:

- trial token issue and activation;
- trial vacancy publish/delete;
- public trial publisher label;
- owner token activation and owner claim;
- member token activation;
- member can read applications/team, but cannot add members;
- vacancy list/details/applications;
- application package with PDF + ZIP docs;
- team chat image attachment persistence for desktop;
- documents screen visual check.

Android covered on Pixel 7:

- fresh activation via `Start trial`;
- first screen is `Мои вакансии`;
- vacancy list loads from production API;
- vacancy detail opens;
- applications section loads received application;
- Mailings, Compliance Profiles, Seafarers DB and Documents open from bottom nav;
- Team is absent for trial scope;
- restart keeps session state.

Smoke screenshots are in `/tmp/skipi-crewing-mobile-*.png` and `/tmp/skipi-crewing-0.4.121-visible.png` on the test workstation.

## Known Operational Notes

- `https://api.skipi.app` is the canonical API on Contabo.
- `https://api-ru.skipi.app` is the Timeweb RF bridge. JSON API calls work, but the live bridge currently needs the multipart proxy fix from `/home/linux/Skipi/Timeweb/api-ru-public_html-multipart-fix-2026-06-16.zip` before it can proxy public application uploads.
- `https://api.skipi.app/crewing/latest.json` returns `0.4.121`.
- `https://api-ru.skipi.app/crewing/latest.json` can lag until the Timeweb static mirror is manually updated.
- On the shared Android test phone, Skipi Seafarer and Skipi Crewing can confuse manual smoke if Seafarer is already focused. For deterministic testing, start Crewing explicitly with `adb shell am start -n app.skipi.crewing.mobile/.MainActivity`.

## Local Development

```bash
cd /home/linux/Developer/skipi-crewing/src-tauri
cargo tauri dev
```

Run server separately:

```bash
cd /home/linux/Developer/skipi-server
source .venv/bin/activate
uvicorn app.main:app --reload
```

## License

Proprietary. Copyright 2026 Tymur Rudov. All rights reserved.
