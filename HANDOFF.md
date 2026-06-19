# Skipi Crewing Handoff

Date: 2026-06-19

## Current State

- Repo/app version: `0.4.122`.
- Mobile bottom nav now fits all five modules without a horizontal swipe
  (`.mobile-nav-btn` uses `flex: 1 1 0`). Verified on Pixel 7.
- Refreshed app icon set (new higher-res `source.png` regen) shipped in this release.
- GitHub release `v0.4.122` is published (all desktop platforms + `latest.json`).
- Prod `https://api.skipi.app/crewing/latest.json` updated to `0.4.122` (file at
  `/opt/skipi-server/releases/crewing/latest.json` on Contabo, served by FastAPI).
- Android APK builds and installs as `app.skipi.crewing.mobile` with `versionName=0.4.122`, `versionCode=4122`.
- Team module is removed from mobile navigation and remains desktop-only for special team-scoped tokens.
- Trial token path is live on production after the server-side flush fix.

## Release recipe (for next time)

1. Bump version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (`version`
   AND window `title`), `dist/index.html` (`appVersion`),
   `src-tauri/gen/android/app/tauri.properties` (versionName + versionCode), and
   the `skipi-crewing` package line in `src-tauri/Cargo.lock`.
2. `git commit` + `git tag vX.Y.Z` + `git push origin main && git push origin vX.Y.Z`.
   The tag push triggers `.github/workflows/release.yml` (CI builds Linux/Windows/
   macOS×2 and publishes the GitHub release with `latest.json`). CI does NOT build Android.
3. Update prod manifest:
   `gh release download vX.Y.Z --pattern latest.json` then
   `scp` it to `root@167.86.105.152:/opt/skipi-server/releases/crewing/latest.json`.
4. Android: `cargo tauri android build --apk --debug` (debug) — see `docs/ANDROID_RELEASE.md`
   for the signed-release/Play path.
5. RU bridge mirror: `python /home/linux/Skipi/Timeweb/mirror_crewing_release.py X.Y.Z`.

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
