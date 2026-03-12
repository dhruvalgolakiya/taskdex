# From Zero to Codex Mobile in 5 Minutes (Local Setup + Full Feature Guide)

If you want to run Codex agents from your phone without a complex setup, this guide gets you there fast.

In about 5 minutes, you will:

- run the bridge server locally
- launch the mobile app
- connect both with auto-filled config
- start using multi-agent chat, queueing, notifications, and more

This project is called **Codex Mobile** (CLI package name: `taskdex`).

## What You Need First

- Node.js `18+`
- Codex CLI installed and authenticated (`codex` available in terminal)
- iOS or Android phone on the same network as your computer
- Git installed

Optional but recommended:

- `npx` / npm latest stable version
- iOS dev build if you want Live Activity and richer native features

## Fastest Setup (Recommended)

Run this from your terminal:

```bash
git clone <your-repo-url> codex-mobile
cd codex-mobile
node scripts/setup-and-start.mjs
```

The script does everything needed for first run:

- asks for `PORT` (default `3001`)
- generates or accepts an API key
- asks Expo mode (`lan` or `tunnel`)
- installs dependencies
- starts bridge server
- starts Expo and shows a QR code
- injects bridge URL + API key so the app opens pre-configured

## 60-Second Prompt Walkthrough

When prompted:

1. Keep `Bridge port [3001]` unless that port is in use.
2. Press Enter for auto-generated API key (recommended).
3. Choose Expo mode:
   - `lan`: fastest on same Wi-Fi
   - `tunnel`: fallback if LAN discovery fails
4. Keep dependency install as `Y` for first setup.

Once Expo starts:

1. Scan QR from your phone.
2. App opens with bridge URL + API key prefilled.
3. Tap connect.

## Start Your First Agent

Inside the app:

1. Create an agent (choose name/model/cwd).
2. Send a task message (example: "Summarize current repo structure and suggest next improvements.").
3. Watch streaming output in real time.

You can create multiple agents and run tasks in parallel.

## Enable All Major Features

### 1) Multi-Agent Workflow

- Create separate agents for different tasks (backend, mobile, docs).
- Keep long-running work isolated by agent thread.

### 2) Message Queue

- If an agent is busy, send additional prompts anyway.
- Messages are queued and delivered automatically when ready.

### 3) Push Notifications

- Use a physical device (not simulator-only flow).
- Allow notifications on first launch.
- You will get completion alerts even when the app is in background.

### 4) Interactive Notification Replies

- Long-press/hold a notification.
- Reply directly from notification without opening the app.

### 5) Live Activity (iOS)

- Best with dev build (`expo run:ios`), not basic Expo Go.
- Shows active task state on lock screen / Dynamic Island.

### 6) QR Connect

- Bridge prints a terminal QR.
- Scan from app settings to auto-fill bridge URL and API key anytime.

### 7) Remote Access (Outside Home/Office Network)

Use Tailscale on both devices, then set bridge URL with your Tailscale IP:

```text
ws://100.x.x.x:3001
```

## Full Native Development Build (Recommended for Power Usage)

For best reliability and native capabilities:

```bash
cd mobile
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

Then run Expo in dev-client mode:

```bash
npx expo start --dev-client
```

## Manual Setup (If You Prefer Full Control)

Start bridge manually:

```bash
cd bridge-server
npm install
npm run dev
```

Then start mobile:

```bash
cd mobile
npm install
npx expo start
```

In app settings, enter:

- Bridge URL: `ws://<your-local-ip>:3001`
- API key: value printed by bridge server

## Quick Troubleshooting

- Phone cannot connect:
  - confirm both devices are on same network
  - switch Expo mode from `lan` to `tunnel`
  - verify local firewall allows port `3001`
- `codex` not found:
  - install/login Codex CLI and retry
- No push notifications:
  - test on physical device and re-check notification permission
- Live Activity missing on iOS:
  - use dev build instead of plain Expo Go

## Security Notes

- Treat bridge API key like a password.
- For remote use, prefer `wss://` behind reverse proxy (Caddy/Nginx) and strong API key.
- Keep bridge access limited to trusted devices/users.

## What to Do Next

- Add a dedicated agent for each repository area.
- Keep one "review" agent and one "implementation" agent for faster delivery loops.
- Move to VPS + `wss://` setup when you need always-on remote access.

