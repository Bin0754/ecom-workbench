#!/usr/bin/env bash
# Background launcher: install deps if missing → build the frontend → (re)start the server → log to server.log.
# Model API keys are taken ONLY from the .env file, never inherited from your shell, so a key exported in your
# shell for some other tool is never picked up by accident. (Use `npm start` if you want normal env inheritance.)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm run build --silent
# Stop the instance this script started last time (tracked by PID file, so other Node apps are left alone).
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then kill "$(cat server.pid)"; sleep 1; fi
# Legacy: a gitignored .access_password file can hold the gate password when it is not in .env / the environment.
if [ -z "${WB_ACCESS_PASSWORD:-}" ] && [ -f .access_password ]; then export WB_ACCESS_PASSWORD="$(tr -d '\n' < .access_password)"; fi
nohup env -u OPENAI_API_KEY -u FAL_KEY -u OPENAI_BASE_URL node --env-file-if-exists=.env server/index.js > server.log 2>&1 &
echo $! > server.pid
sleep 2 && tail -n 3 server.log
