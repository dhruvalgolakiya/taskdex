# Pylon — Product Requirements Document

## What Pylon Actually Is

Pylon is a mobile app that remote-controls OpenAI Codex coding agents. It has two parts:

1. **Bridge server** (Node.js) — runs on your machine where the code lives. Spawns `codex app-server` child processes, communicates via JSON-RPC over stdio, and exposes a WebSocket API.
2. **Mobile app** (React Native/Expo) — connects to the bridge over WebSocket. Sends messages, receives streaming responses, manages workspaces/threads.

**This is NOT a SaaS.** The bridge must run where the codebase is — your laptop, a VPS, wherever `codex` CLI is installed and authenticated with OpenAI. The mobile app is just a remote control.

### How It Works Today

```
Mobile App                          Bridge Server (your machine)
──────────                          ────────────────────────────
Enter bridge URL (ws://ip:3001) ──► Express + WebSocket on port 3001
                                    No auth — anyone who connects gets full access

create_agent {name, model, cwd} ──► Spawns `codex app-server` child process
                                    JSON-RPC: initialize → thread/start
                                    Returns agent with threadId

send_message {agentId, text}    ──► JSON-RPC: turn/start → codex processes
                                    Streams back: turn/started, item/*, turn/completed
                                    Broadcasts ALL events to ALL connected clients

Push notifications              ──► Expo Push API (free, no certs)
                                    Sends to ALL registered tokens

On bridge restart               ──► All agents lost (in-memory only)
                                    Mobile marks them 'stopped'
                                    Auto-recreates on next message send
```

### Key Constraints

- `codex` CLI must be installed and `OPENAI_API_KEY` set on the bridge machine
- Bridge spawns processes with `approvalPolicy: 'never'` + `sandbox: 'danger-full-access'` (hardcoded)
- Each agent = one `codex app-server` process = one thread
- Agents are in-memory on bridge, messages stored in AsyncStorage on mobile
- No auth, no scoping — every client sees everything

---

## Phase 1: Persistence `P0`

Currently messages are in AsyncStorage (fragile, single device). Agent state is in-memory on bridge (lost on restart).

### 1.1 Convex Setup

- [x] Initialize Convex project in `convex/` directory
- [x] Install `convex` + `convex-expo` in mobile app *(February 21, 2026: `convex-expo` is not published on npm; React Native integration uses `convex` directly.)*
- [x] Define schema:
  - `bridges` — id, name, url, lastConnected
  - `workspaces` — id, bridgeUrl, name, model, cwd, createdAt
  - `threads` — id, workspaceId, title, bridgeAgentId, createdAt
  - `messages` — id, threadId, role, type, text, itemId, timestamp, streaming
  - `settings` — id, bridgeUrl, theme, preferences
- [x] Create mutations: `saveMessage`, `saveThread`, `saveWorkspace`
- [x] Create queries: `getMessages(threadId)`, `getThreads(workspaceId)`, `getWorkspaces`
- [x] Wire `ConvexProvider` into App.tsx

### 1.2 Message Persistence

- [x] On `appendMessage` (user sends): also call `saveMessage` mutation
- [x] On `finalizeItem` (agent message complete): also call `saveMessage` mutation
- [x] On thread open: load messages from Convex, fall back to local store
- [x] Paginate: load latest 50, scroll up loads more
- [x] Stop storing full message arrays in AsyncStorage (keep only agent metadata)

### 1.3 Workspace & Agent Persistence

- [x] Save workspace/thread structure to Convex on create
- [x] On app launch: load from Convex instead of AsyncStorage
- [x] Keep AsyncStorage as offline fallback only
- [x] On WebSocket connect: reconcile Convex data with live bridge `list_agents`
- [x] Save bridge URL to Convex settings (syncs across devices)

### 1.4 Cross-Device Sync

- [x] Convex subscriptions auto-update message list on all devices
- [x] Open same bridge from phone + tablet — see same threads/messages
- [x] No extra code needed — Convex handles this via reactive queries

---

## Phase 2: Bridge Security `P0`

Right now anyone who knows your bridge IP:port has full control. Need basic auth.

### 2.1 API Key Auth

- [x] Bridge generates a random API key on first start, prints it to terminal
- [x] Save API key to `~/.pylon/config.json` on bridge machine
- [x] Mobile enters API key during bridge setup (one-time)
- [x] WebSocket handshake: first message must be `{ action: 'auth', params: { key: '...' } }`
- [x] Bridge rejects and disconnects clients that fail auth
- [x] Store API key in mobile's Convex settings (or SecureStore)

### 2.2 Client Scoping

- [x] Bridge tracks authenticated clients with a clientId
- [x] Push tokens scoped per client (don't blast all tokens)
- [x] Agent events still broadcast to all authenticated clients (single-user tool, but prevents random access)

### 2.3 Bridge Status Endpoint

- [x] `GET /health` requires API key as Bearer token or query param
- [x] Returns: uptime, agent count, connected clients, system info
- [x] Mobile shows bridge health in settings screen

---

## Phase 3: Enhanced Chat `P0`

### 3.1 Better Message Rendering

- [x] Syntax highlighting for code blocks (detect language from markdown fences)
- [x] Collapsible thinking blocks (collapsed by default, tap to expand)
- [x] Collapsible command output (show first 5 lines, "Show more" button)
- [x] Copy button on code blocks
- [x] Tap filename in file_change messages to view file (needs Phase 5 file browser)

### 3.2 Message Search

- [x] Search bar in chat header
- [x] Search messages in current thread (local filter)
- [x] Search across all threads (Convex full-text index on `messages.text`)
- [x] Tap result to scroll to message

### 3.3 Message Actions

- [x] Long-press context menu: Copy, Share, Retry, Delete
- [x] Copy copies message text to clipboard
- [x] Retry resends the user message to the agent
- [x] Delete removes from Convex + local store

### 3.4 Input Improvements

- [x] Slash commands: `/stop` (interrupt), `/clear` (clear thread display)
- [x] `@filename` mention — bridge action `list_files` returns cwd contents for autocomplete
- [x] Voice input via speech recognition (mic button)
  - Implemented with `expo-speech-recognition` mic toggle in chat input.

---

## Phase 4: Agent Management `P1`

### 4.1 Agent Templates

- [x] Template = { name, model, promptPrefix, icon }
- [x] Built-in: "Bug Fixer", "Code Reviewer", "Test Writer"
- [x] Template selector in "New Agent" modal
- [x] Custom templates saved to Convex
- [x] Template applies: pre-fills model, prepends prompt to first message

### 4.2 Agent Configuration

- [x] Model selector dropdown (not just text input)
- [x] Working directory browser on bridge machine (new action: `list_directories`)
- [x] Approval policy picker: auto-approve vs ask (update `protocol.ts` threadStartRequest)
- [x] System prompt / instructions field (prepended to every turn)
- [x] Save config per workspace in Convex

### 4.3 Agent Dashboard

- [x] Grid/list of all agents across workspaces
- [x] Status dot, model, last message preview, time since last activity
- [x] Quick actions: tap to open thread, long-press for stop/restart
- [x] Filter: active only / stopped only / all

### 4.4 Agent Reconnect Improvements

- [x] Currently: stopped agents recreate on send — works but creates new threadId
- [x] Better: bridge saves agent state to disk, restores on restart
- [x] Bridge writes `~/.pylon/agents.json` on agent create/stop
- [x] On bridge start: read saved agents, reconnect where possible
- [x] Mobile detects restored agents via `list_agents` merge

---

## Phase 5: File Browser & Git `P1`

### 5.1 File Browser

- [x] New bridge action: `list_files { cwd, path }` — returns directory listing
- [x] New bridge action: `read_file { cwd, path }` — returns file contents
- [x] File tree screen accessible from workspace
- [x] Syntax-highlighted file viewer
- [x] Mark files modified by agent (tracked from file_change events)
- [x] Navigate from file_change message → file viewer

### 5.2 Git Integration

- [x] Install `simple-git` on bridge
- [x] Bridge actions: `git_status`, `git_log`, `git_diff`, `git_commit`
- [x] Git status badge in chat header (branch name, clean/dirty)
- [x] Diff viewer for agent's changes
- [x] One-tap commit with auto-generated message
- [x] Branch picker (list/switch)

---

## Phase 6: Cloud Bridge Deployment `P1`

Run bridge on a VPS so agents keep working when your laptop sleeps.

### 6.1 Docker

- [x] `Dockerfile` for bridge server
- [x] `docker-compose.yml` with volume mounts for code directories
- [x] Environment variables: `PORT`, `API_KEY`, `CODEX_CWD`
- [x] Health check
- [x] Document in README

### 6.2 VPS Setup Guide

- [x] Hetzner: create server, install Docker, clone repos, deploy bridge
- [x] SSH key / deploy key setup so bridge machine can `git clone` your repos
- [x] Reverse proxy (Caddy) for WSS (secure WebSocket over HTTPS)
- [x] PM2 / systemd to keep bridge alive
- [x] Auto-pull repos before agent start (optional)

### 6.3 Remote Repo Management

- [x] Bridge action: `clone_repo { url }` — git clone to bridge machine
- [x] Bridge action: `list_repos` — show cloned repos with paths
- [x] Bridge action: `pull_repo { path }` — git pull
- [x] Mobile screen: manage repos on cloud bridge
- [x] Use repo paths as cwd when creating agents

---

## Phase 7: Analytics `P2`

### 7.1 Usage Tracking

- [x] Parse token counts from codex turn responses (if available in JSON-RPC)
- [x] Store per-turn: model, tokens, response time, in Convex
- [x] Simple usage screen: messages sent today/week, active time per agent
- [x] Cost estimate based on model

### 7.2 Agent Metrics

- [x] Response time per turn (measure turn/started → turn/completed delta)
- [x] Error count per agent
- [x] Metric display on agent cards

---

## Phase 8: Notifications & Widgets `P2`

### 8.1 Notification Preferences

- [x] Per-agent: all / errors only / muted
- [x] Bridge respects mute: don't send push for muted agents
- [x] New action: `update_notification_prefs { agentId, level }`
- [x] Notification history screen

### 8.2 iOS Widgets

- [x] Home screen widget: agent status summary (name + status dot)
- [x] Deep link: tap widget → opens agent thread
- [x] Requires dev build (WidgetKit native module)
  - Completed: Added `mobile/modules/pylon-widget-bridge` Expo native module and wired app-group shared widget summary updates from the app.

---

## Phase 9: Performance & Offline `P3`

### 9.1 Performance

- [x] Optimize FlatList rendering (getItemLayout, windowSize tuning)
- [x] Stop saving full message arrays to AsyncStorage on every finalize
- [x] Debounce store updates during rapid streaming deltas
- [x] Lazy load workspace data

### 9.2 Offline Resilience

- [x] Detect offline / bridge unreachable
- [x] Show clear indicator in header
- [x] Queue messages locally, send on reconnect
- [x] Show cached messages from Convex offline cache

---

## Phase 10: Polish `P2`

### 10.1 Onboarding

- [x] First-launch: 2-3 screen walkthrough
- [x] "Start bridge" screen with copy-pasteable command
- [x] Bridge URL entry with connection test
- [x] Guided first agent creation

### 10.2 QR Code Connect

- [x] Bridge prints QR code in terminal on start (encodes ws://ip:port + API key)
- [x] Mobile scans QR to auto-fill bridge URL + API key
- [x] Uses `expo-barcode-scanner`

### 10.3 Haptics & Animations

- [x] Haptic on send and receive
- [x] Message slide-in animation
- [x] Skeleton loading states
- [x] Smooth sidebar transitions

### 10.4 Error Handling

- [x] Replace raw error strings with user-friendly messages
- [x] Retry button on failed sends
- [x] Error boundary wrapping app
- [x] Exponential backoff on reconnect (currently fixed 3s)

---

## Implementation Priority

| Phase | What | Priority |
|-------|------|----------|
| Phase 1 | Persistence (Convex) | P0 — messages lost on restart |
| Phase 2 | Bridge security (API key) | P0 — open to anyone on network |
| Phase 3 | Enhanced chat | P0 — core UX |
| Phase 4 | Agent management | P1 |
| Phase 5 | File browser & git | P1 |
| Phase 6 | Cloud deployment | P1 |
| Phase 7 | Analytics | P2 |
| Phase 8 | Notifications & widgets | P2 |
| Phase 10 | Polish | P2 |
| Phase 9 | Performance & offline | P3 |

---

## Tech Stack Additions

| What | Technology |
|------|-----------|
| Database + sync | Convex |
| File browser | New bridge actions (Node.js `fs`) |
| Git | `simple-git` on bridge |
| QR code | `expo-barcode-scanner` |
| Voice input | `expo-speech-recognition` |
| Containers | Docker + docker-compose |
| Process manager | PM2 / systemd |
| Reverse proxy | Caddy (WSS) |
