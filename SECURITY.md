# Security

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's *Report a vulnerability* (private security advisory) on this
repository. We aim to respond within 7 days.

## Security model — read before exposing the app

- **Access gate**: one shared password (`WB_ACCESS_PASSWORD`). Without it, anyone who can reach the port has full
  access. Always set it for anything beyond `localhost`/a trusted LAN, and serve over HTTPS (reverse proxy) with
  `WB_COOKIE_SECURE=1` and `WB_TRUST_PROXY` set appropriately.
- **Roles are not authentication.** Photographer / designer / reviewer / admin is chosen in the UI and sent as a
  header. It organises work and prevents mistakes; it does not stop a malicious user who passed the gate. Per-user
  accounts are on the roadmap — contributions welcome.
- **API keys** are read only from environment variables at call time. They are never stored in the DB, returned by the
  API, logged, or accepted from the UI. Config keys that look like secrets are rejected, `OPENAI_BASE_URL` can only be
  set via env, and the generic HTTP channel only reads env vars prefixed `WB_HTTP_`.
- **Paid channels** cannot be enabled until their key is set. Nothing falls back to another provider's key.
- **Files**: only image folders are served; the SQLite DB and job queue are not. Uploads must decode as images.
- **SSRF**: the ComfyUI and generic HTTP channels call URLs that an admin configures. Treat Settings access as trusted.
- Login attempts are rate-limited (10 failures / 10 min / IP); password comparison is constant-time.
