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
- UI strings: never hard-code text. Use `t('key')` from `web/src/i18n.js` and add the key to **both** `shared/i18n/zh.js` and
  `shared/i18n/en.js` (`test/i18n.test.js` fails if the key sets differ or a Chinese literal sneaks into `web/src`).
  Chinese messages produced by the server (errors, statuses, precheck) are translated via the `srv.*` entries — add one when
  you add a new message.
- Don't commit `data/`, `.env`, screenshots of real customer products, or any key.
- Use clear commit messages (Conventional Commits style is appreciated: `feat:`, `fix:`, `docs:`…).

## Good first issues

- Add another UI language (copy `shared/i18n/en.js`, register it in `shared/i18n/index.js`)
- Per-user accounts / real role enforcement
- More template packs (supplements, apparel, electronics) and marketplaces (Shopify, TikTok Shop)
- Async/queue support in the generic HTTP adapter
