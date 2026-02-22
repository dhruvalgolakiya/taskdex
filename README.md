# Codex Mobile

Control [OpenAI Codex](https://openai.com/index/openai-codex/) coding agents from your phone. Run multiple agents simultaneously, get push notifications when tasks complete, and reply directly from your lock screen.

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Mobile App     │◄──────────────────►│  Bridge Server   │
│  (React Native) │  ws://<ip>:3001    │  (Node.js)       │
└─────────────────┘                    │                   │
                                       │  Spawns & manages │
                                       │  codex app-server │
                                       │  processes (stdio)│
                                       └───┬───┬───┬───────┘
                                           │   │   │
                                        codex1 codex2 codex3
```

The **bridge server** runs on your Mac/PC alongside the Codex CLI. The **mobile app** connects to it over your local network (or remotely via Tailscale) and gives you a chat UI to interact with each agent.

## Prerequisites

- **Node.js** >= 18
- **OpenAI Codex CLI** installed and authenticated (`codex` command available in your terminal)
- **Expo CLI**: `npm install -g expo-cli`
- **iOS device** or Android device (for push notifications and Live Activity, a physical device is required)
- Both your computer and phone on the **same network** (or connected via [Tailscale](https://tailscale.com) for remote access)

## Bridge Server

The bridge server spawns and manages `codex app-server` child processes, exposing them over a WebSocket API.

### Setup

```bash
cd bridge-server
npm install
```

### Run

```bash
npm run dev
```

This starts the server on port **3001**. You'll see output like:

```
  Codex Bridge Server running
  Local:   ws://localhost:3001
  Network: ws://192.168.1.42:3001
  API key: <generated-key>
```

Note the **Network** URL and **API key** — you'll enter both in the mobile app.

### Production

```bash
npm run build
npm start
```

### Health Check (authenticated)

```
GET http://localhost:3001/health?key=<api-key>
# or
Authorization: Bearer <api-key>
```

Returns uptime, active agent count, connected client count, push counts, and system info.

### Docker

Run the bridge in Docker with a mounted code workspace:

```bash
docker compose up -d --build
```

Environment variables used by `docker-compose.yml`:

- `PORT` (default `3001`)
- `API_KEY` (required in production)
- `CODEX_CWD` (container path to workspace, default `/workspace`)
- `HOST_CODE_DIR` (host path mounted into `CODEX_CWD`)
- `OPENAI_API_KEY` (required for Codex CLI)

### API

The bridge accepts JSON messages over WebSocket:

| Action | Params | Description |
|---|---|---|
| `create_agent` | `{ name, model, cwd, approvalPolicy?, systemPrompt? }` | Spawn a new Codex agent |
| `list_agents` | — | List all running agents |
| `send_message` | `{ agentId, text }` | Send a message to an agent |
| `interrupt` | `{ agentId }` | Interrupt an agent's current turn |
| `stop_agent` | `{ agentId }` | Stop and kill an agent process |
| `update_agent_model` | `{ agentId, model }` | Change an agent's model |
| `update_agent_config` | `{ agentId, model?, approvalPolicy?, systemPrompt? }` | Update agent runtime config |
| `get_agent` | `{ agentId }` | Get details for a specific agent |
| `register_push_token` | `{ token }` | Register an Expo push token for notifications |
| `list_files` | `{ cwd, path }` | List files/directories in workspace |
| `list_directories` | `{ cwd, path }` | List only directories for cwd browsing |
| `read_file` | `{ cwd, path }` | Read file contents |
| `git_status` | `{ cwd }` | Get git branch/dirty state |
| `git_log` | `{ cwd, limit? }` | Get commit history |
| `git_diff` | `{ cwd, file? }` | Get current diff |
| `git_commit` | `{ cwd, message }` | Commit all current changes |
| `git_branches` | `{ cwd }` | List local branches |
| `git_checkout` | `{ cwd, branch }` | Switch to local branch |

The bridge streams events back to the mobile app (e.g. `turn/started`, `item/agentMessage/delta`, `turn/completed`).

## Mobile App

React Native app built with Expo.

### Setup

```bash
cd mobile
npm install
```

### Run (Expo Go)

```bash
npx expo start
```

Scan the QR code with your phone. On first launch, enter the bridge server's **Network URL** (e.g. `ws://192.168.1.42:3001`).

### Development Build (recommended)

A dev build is required for push notifications and Live Activity:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

### Features

- **Multiple agents** — Create and manage several Codex agents at once
- **Streaming responses** — See agent output in real time as it types
- **Message queue** — Send messages while agent is busy; they'll be delivered when it's ready
- **Agent persistence** — Agents survive app restarts; stopped agents auto-reconnect when you send a new message
- **Push notifications** — Get notified when agents finish tasks, even with the app closed
- **Interactive replies** — Reply to agents directly from notification (hold/long-press the notification)
- **Action buttons** — Stop Agent and Open Thread buttons on notifications
- **Live Activity (iOS)** — Real-time agent status in Dynamic Island and lock screen
- **Dark mode** — Light and dark theme support

## Remote Access with Tailscale

To use the app outside your local network:

1. Install [Tailscale](https://tailscale.com) on both your computer and phone
2. Sign in with the same account on both devices
3. Use your computer's **Tailscale IP** (e.g. `ws://100.x.x.x:3001`) as the bridge URL in the mobile app

## Project Structure

```
codex-mobile/
├── bridge-server/
│   ├── src/
│   │   ├── index.ts           # Express + WebSocket server
│   │   ├── agent-manager.ts   # Spawns/manages codex app-server processes
│   │   ├── protocol.ts        # JSON-RPC message helpers
│   │   └── push.ts            # Expo Push Notification sender
│   ├── package.json
│   └── tsconfig.json
├── mobile/
│   ├── App.tsx                # Main app entry (navigation, notifications, UI)
│   ├── components/
│   │   ├── AgentCard.tsx      # Agent card for list view
│   │   ├── ChatBubble.tsx     # Message bubble with markdown
│   │   ├── MessageInput.tsx   # Text input + send button
│   │   ├── QueuePanel.tsx     # Queued messages panel
│   │   └── TypingIndicator.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts    # WebSocket connection & stream handling
│   │   └── useLiveActivity.ts # iOS Live Activity integration
│   ├── stores/
│   │   ├── agentStore.ts      # Agent state (Zustand + AsyncStorage)
│   │   ├── workspaceStore.ts  # Workspace management
│   │   └── themeStore.ts      # Theme preferences
│   ├── types/index.ts         # TypeScript types
│   ├── theme.ts               # Colors, typography, palettes
│   ├── app.json
│   └── package.json
└── README.md
```

## License

MIT
