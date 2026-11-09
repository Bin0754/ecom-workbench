# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: SemVer.

## [0.1.0] - 2026-11-09 (first public release)

### Added
- Phone-first shoot tasks and upload (angle slots, data-saver mode, retries, archive naming)
- Automatic 11-template Amazon skincare pack on a React Flow infinite canvas
- Deterministic pure-white MAIN image (local background removal, 85 % fill, 2000×2000)
- Model-background templates with product paste-back, alignment, harmonisation, contact shadow and code-rendered text
- Sectioned v2 prompts with variables derived from SKU data and source-photo analysis
- AI precheck incl. 15 FDA/Amazon claim rules; review flow with reasons and resubmission compare
- Asset library and Amazon ZIP export (`ASIN.MAIN.jpg`, `APLUS/…`, `manifest.csv`)
- Model channels: mock, external import (`grok`), OpenAI GPT Image, fal.ai, generic HTTP, ComfyUI; cost ledger
- Shared-password access gate; env-only API keys; Docker image; CI; `node:test` suite
- Full English UI next to Chinese: every page, dialog, toast and error; template names, angles, review reasons, statuses
  and AI precheck results are bilingual. Language follows the browser, can be switched in the header/sidebar or with
  `?lang=en|zh`, and is remembered (also for the login page). Shared dictionaries in `shared/i18n/` with a test that
  keeps the zh/en key sets identical. Prompts sent to models stay English.
- Step-by-step user guides with screenshots: [docs/GUIDE.md](docs/GUIDE.md) and [docs/GUIDE.zh-CN.md](docs/GUIDE.zh-CN.md)
- `npm run dev` and `npm run seed` read `.env` like `npm start`
