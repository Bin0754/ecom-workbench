# Contributing / 参与贡献

Thanks for helping! 中文、English 都可以。

## Setup

```bash
npm install          # installs root + web/
cp .env.example .env # optional
npm run dev          # API :5180 (watch) + Vite :5173
```

Node ≥ 22.13. No GPU or API key is needed — the default `mock` channel generates placeholder backgrounds for free; the external-import channel needs no key either.

## Before opening a PR

```bash
npm run check        # lint + tests + build (what CI runs; CI also runs prettier --check)
npm run format       # auto-format
```

- Tests use `node:test` (`test/*.test.js`). **Never call a real model API in tests** — use a local mock server like
  `test/providers.test.js`. The test setup strips `OPENAI_API_KEY` / `FAL_KEY` on purpose.
- New adapter? Follow [docs/ADAPTERS.md](docs/ADAPTERS.md). New template? [docs/PROMPTS.md](docs/PROMPTS.md).
- Keep pages other than the canvas usable on a 375 px wide phone.
- UI strings: Chinese is the default; when touching the app shell, use `t()` from `web/src/i18n.js` and add both `zh` and `en`.
- Don't commit `data/`, `.env`, screenshots of real customer products, or any key.
- Use clear commit messages (Conventional Commits style is appreciated: `feat:`, `fix:`, `docs:`…).

## Good first issues

- Translate more screens via `i18n.js`
- Per-user accounts / real role enforcement
- More template packs (supplements, apparel, electronics) and marketplaces (Shopify, TikTok Shop)
- Async/queue support in the generic HTTP adapter
