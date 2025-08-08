# Google Flights Playwatch (Local, Private, Reliable)

A tiny **local** Playwright watcher that reads your **Google Flights Saved** page (Google as source of truth),
extracts prices + labels, and alerts you in Telegram when prices **drop by ≥ threshold**.

- Runs **locally** with a **persistent browser profile** (no passwords in code).
- **Tracks price changes** between your monitoring runs (not just Google's "was" prices).
- Column-aligned, date-first output; includes **flight numbers** and **routes**.
- Handles **Cheapest flight** watch tiles too (listed after flights).

## Requirements
- macOS (or Linux) with Node 18+
- `npm i` will install Playwright automatically

## Quick Start

```bash
# 1) Install deps
npm install

# 2) Set Telegram credentials (optional) and threshold
cp .env.example .env
# edit .env to set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and PRICE_DROP_THRESHOLD (default 25)

# 3) One-time login to seed the persistent profile
npm run login
# a visible window opens; log in to Google, make sure Saved Flights loads; press Enter in the terminal to save the profile

# 4) Test the watcher
npm run watch

# You should see formatted lines; if a price drop ≥ threshold is detected, it posts to Telegram.
```

## Run Every 15 Minutes (launchd, with jitter)

```bash
make plist-load   # installs a LaunchAgent that runs the watcher every 15 min with 0–90s jitter
make plist-logs   # tails logs
make plist-unload # stops/removes the LaunchAgent
```

The LaunchAgent calls `bin/run-watch.sh`, which sleeps a random 0–90 seconds, then runs `node watch.js` and appends logs to `logs/`.

## Security Notes
- All auth lives in `./user-data/` (your Playwright browser profile). **Keep it private.** `.gitignore` excludes it.
- The watcher only loads `https://www.google.com/travel/flights/saves` and posts to your Telegram bot (if configured).

## Telegram Setup (Optional)
1. **Create a bot**: Message `@BotFather` on Telegram → `/newbot` → follow prompts → get your bot token
2. **Get your chat ID**: Message your new bot (a real message, something other than `/start`), then visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` → find your `chat.id`
3. **Add to .env**:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
   TELEGRAM_CHAT_ID=123456789
   ```

## Re‑auth flow
If Google asks to verify again (rare), the watch run will post a Telegram message saying **"Reauth needed"**.
Run:
```bash
npm run login
```
Complete the prompt, hit Enter in the terminal, and you're back in action.

---

### Output example
```
13 Aug   UA 0737   SFO–EWR :: $285 | was $1,010
17 Aug   UA 2328   EWR–SFO :: $356 | was $339
...
--- Watches (no specific date) ---
[Watch] Cheapest flight • One way • Economy :: $285 | was $434
```

