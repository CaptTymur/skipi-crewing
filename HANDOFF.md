# Skipi Crewing Handoff

Date: 2026-06-16

## Current State

- Repo/app version: `0.4.121`.
- Desktop release binary launches and shows `Skipi Crewing 0.4.121`.
- Android APK builds and installs as `app.skipi.crewing.mobile` with `versionName=0.4.121`, `versionCode=4121`.
- Team module is removed from mobile navigation and remains desktop-only for special team-scoped tokens.
- Trial token path is live on production after the server-side flush fix.

## Smoke Result

Passed:

- trial token activation;
- trial vacancy publish/list/detail/delete;
- applications list after public apply package;
- owner/member token scope checks;
- desktop team chat including pasted image attachment persistence;
- desktop documents screen;
- Android first screen vacancies;
- Android vacancy detail and applications section;
- Android Mailings, Compliance Profiles, Seafarers DB and Documents modules;
- Android restart/session persistence.

Test device:

- Pixel 7, ADB id `29191FDH2007CD`.

Useful screenshots:

- `/tmp/skipi-crewing-0.4.121-visible.png`
- `/tmp/skipi-crewing-mobile-after-trial.png`
- `/tmp/skipi-crewing-mobile-vacancy-detail-2.png`
- `/tmp/skipi-crewing-mobile-applications-section.png`
- `/tmp/skipi-crewing-mobile-crewing-documents2.png`

## Build Commands

Desktop:

```bash
cd /home/linux/Developer/skipi-crewing/src-tauri
cargo tauri build --bundles deb,appimage
```

Android:

```bash
cd /home/linux/Developer/skipi-crewing/src-tauri
JAVA_HOME=/home/linux/.jdks/temurin-21 \
PATH=/home/linux/.jdks/temurin-21/bin:$PATH \
  cargo tauri android build --apk --debug
```

Launch Android app deterministically:

```bash
adb shell am force-stop app.skipi.seafarer
adb shell am start -n app.skipi.crewing.mobile/.MainActivity
```

Launch Linux desktop on this workstation:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  /home/linux/Developer/skipi-crewing/src-tauri/target/release/skipi-crewing
```

## Open Items

1. Deploy the Timeweb bridge multipart fix:
   `/home/linux/Skipi/Timeweb/api-ru-public_html-multipart-fix-2026-06-16.zip`.

2. Update the Timeweb crewing static manifest/assets so `https://api-ru.skipi.app/crewing/latest.json` no longer reports an older build.

3. Play Console publish still needs a real signed/release Android artifact and manual console upload/check, unless release automation is added.

4. Consider making the mobile bottom nav fit all five modules without horizontal swipe, or add an explicit `More` pattern. Current behavior works but is not obvious.

5. On the shared Android test phone, Seafarer can remain focused after share/deep-link flows. Always force-start Crewing for reproducible smoke.
