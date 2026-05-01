# Skipi Crewing

**Vacancy posting and applications inbox for verified maritime employers.**
Companion desktop application to [Skipi](https://github.com/CaptTymur/skipi.app)
(the seafarer-side document vault).

---

## What it does

Verified crewing managers and shipowner HR offices use Skipi Crewing to:

- **Post vacancies** to the public skipi.app jobs board.
- **Receive applications** from seafarers running Skipi (via the Package
  Link transactional-email flow).
- **Manage open positions** without exposing seafarers to data-harvesting
  intermediaries.

Skipi Crewing is the employer-side endpoint of the skipi.app triangle:

```
Skipi Seafarer ──poll───▶  skipi.app jobs board  ◀──post── Skipi Crewing
       │                          │                              ▲
       └──────── apply (Package Link) ───────────────────────────┘
```

## Status

`v0.1.0` — MVP scaffold. Three screens (vacancies / new / applications),
local SQLite cache, settings (server URL + bearer token + company name).
Backend integration runs against a local `skipi-server` instance for now.

## Eligibility

Skipi Crewing is **not** open to general signup. Bearer tokens are issued
manually by Skipi after company verification — typically against MLC
compliance documentation, P&I membership, or industry references.

To request a verification, email <tymur.rudov@icloud.com> with company
details, a publicly verifiable maritime presence (Equasis, Marine Traffic,
LinkedIn), and the email at which you want the bearer token delivered.

## Tech

Tauri 2 (Rust + WebView). Same stack as the Skipi seafarer client —
single-file `dist/index.html` frontend with inline JS, Rust backend in
`src-tauri/src/`. SQLite for local cache of posted vacancies and received
applications.

## Email delivery decision

For cross-platform email flows, the common denominator is a generated `.eml`
file, not a direct call into every installed mail client. Skipi should build a
complete email intent with subject, body, footer, and attachments, save it as
`.eml`, then open the file or containing folder for the user to send from their
preferred mail app. SMTP remains the production path for direct in-app sending.

Native composer integrations may still exist as convenience adapters, but they
are not the delivery guarantee.

## Local development

```bash
# from repo root
cd src-tauri && cargo tauri dev
```

Backend defaults to `http://127.0.0.1:8000` (the local skipi-server). Run
that side-by-side:

```bash
cd ../skipi-server
source .venv/bin/activate
uvicorn app.main:app --reload
```

## License

Proprietary. © 2026 Tymur Rudov. All rights reserved.

Skipi Crewing is closed-source by design — unlike the seafarer-side Skipi
client, which is MIT-licensed for transparency. The asymmetry is
intentional: seafarers need to verify what runs on their machine;
employers do not.
