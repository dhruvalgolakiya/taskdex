import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AgentManager } from './agent-manager';
import {
  registerPushToken,
  getRegisteredTokenCount,
  getRegisteredClientCount,
  removeClientPushTokens,
} from './push';

const PORT = Number(process.env.PORT || 3001);
const CONFIG_DIR = path.join(os.homedir(), '.pylon');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

interface BridgeConfig {
  apiKey: string;
}

interface ClientSession {
  ws: WebSocket;
  authenticated: boolean;
  clientId: string | null;
  connectedAt: number;
  remoteAddress: string;
}

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

function loadOrCreateConfig(): BridgeConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0) {
        return { apiKey: parsed.apiKey };
      }
    }
  } catch (err) {
    console.warn('[config] Failed to read existing config, regenerating:', err);
  }

  const apiKey = generateApiKey();
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ apiKey }, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log('\n[auth] Generated bridge API key for first start.');
  console.log(`[auth] Saved to ${CONFIG_PATH}`);
  console.log(`[auth] API key: ${apiKey}\n`);
  return { apiKey };
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function extractAuthKey(req: express.Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  const queryKey = req.query.key;
  if (typeof queryKey === 'string' && queryKey.trim()) {
    return queryKey.trim();
  }
  return null;
}

const config = loadOrCreateConfig();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Map<WebSocket, ClientSession>();

function getConnectedAuthenticatedCount(): number {
  let count = 0;
  for (const session of clients.values()) {
    if (session.authenticated) count += 1;
  }
  return count;
}

function broadcast(agentId: string, event: string, data: unknown) {
  const message = JSON.stringify({ type: 'stream', agentId, event, data });
  for (const session of clients.values()) {
    if (!session.authenticated) continue;
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(message);
    }
  }
}

const manager = new AgentManager(broadcast);
const startedAt = Date.now();

app.get('/health', (req, res) => {
  const key = extractAuthKey(req);
  if (!key || key !== config.apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    status: 'ok',
    uptimeMs: Date.now() - startedAt,
    agents: manager.listAgents().length,
    connectedClients: getConnectedAuthenticatedCount(),
    pushClients: getRegisteredClientCount(),
    pushTokens: getRegisteredTokenCount(),
    system: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    },
  });
});

wss.on('connection', (ws, req) => {
  const remoteAddress = req.socket.remoteAddress || 'unknown';
  const session: ClientSession = {
    ws,
    authenticated: false,
    clientId: null,
    connectedAt: Date.now(),
    remoteAddress,
  };
  clients.set(ws, session);
  console.log(`Client connected from ${remoteAddress}`);

  const authTimeout = setTimeout(() => {
    if (!session.authenticated && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: 'Authentication required' }));
      ws.close(4001, 'Authentication required');
    }
  }, 10000);

  ws.on('message', async (raw) => {
    let msg: { action: string; params?: Record<string, unknown>; requestId?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    const { action, params = {}, requestId } = msg;

    const reply = (data: unknown) => {
      ws.send(JSON.stringify({ type: 'response', action, requestId, data }));
    };

    const replyError = (error: string) => {
      ws.send(JSON.stringify({ type: 'error', action, requestId, error }));
    };

    if (!session.authenticated) {
      if (action !== 'auth') {
        replyError('Unauthenticated: first message must be auth');
        ws.close(4001, 'Unauthenticated');
        return;
      }

      const key = typeof params.key === 'string' ? params.key : '';
      const requestedClientId = typeof params.clientId === 'string' ? params.clientId.trim() : '';
      if (!key || key !== config.apiKey) {
        replyError('Invalid API key');
        ws.close(4001, 'Invalid API key');
        return;
      }

      session.authenticated = true;
      session.clientId = requestedClientId || crypto.randomUUID();
      clearTimeout(authTimeout);
      console.log(`Authenticated client ${session.clientId} (${remoteAddress})`);
      reply({ ok: true, clientId: session.clientId });
      return;
    }

    try {
      switch (action) {
        case 'create_agent': {
          const { name, model, cwd } = params as { name: string; model: string; cwd: string };
          const agent = await manager.createAgent(
            name || 'Agent',
            model || 'gpt-5.1-codex',
            cwd || process.cwd(),
          );
          reply(agent);
          break;
        }

        case 'list_agents': {
          reply(manager.listAgents());
          break;
        }

        case 'send_message': {
          const { agentId, text } = params as { agentId: string; text: string };
          await manager.sendMessage(agentId, text);
          reply({ ok: true });
          break;
        }

        case 'interrupt': {
          const { agentId } = params as { agentId: string };
          await manager.interruptAgent(agentId);
          reply({ ok: true });
          break;
        }

        case 'stop_agent': {
          const { agentId } = params as { agentId: string };
          manager.stopAgent(agentId);
          reply({ ok: true });
          break;
        }

        case 'update_agent_model': {
          const { agentId, model } = params as { agentId: string; model: string };
          manager.updateModel(agentId, model);
          reply({ ok: true });
          break;
        }

        case 'register_push_token': {
          const { token } = params as { token: string };
          if (!session.clientId) {
            replyError('Client is missing an id');
            break;
          }
          registerPushToken(session.clientId, token);
          reply({ ok: true });
          break;
        }

        case 'get_agent': {
          const { agentId } = params as { agentId: string };
          const agent = manager.getAgent(agentId);
          if (agent) reply(agent);
          else replyError('Agent not found');
          break;
        }

        default:
          replyError(`Unknown action: ${action}`);
      }
    } catch (err) {
      replyError(err instanceof Error ? err.message : String(err));
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (session.clientId) {
      removeClientPushTokens(session.clientId);
    }
    clients.delete(ws);
    console.log(`Client disconnected (${session.clientId || 'unauthenticated'})`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n  Codex Bridge Server running');
  console.log(`  Local:   ws://localhost:${PORT}`);
  console.log(`  Network: ws://${ip}:${PORT}`);
  console.log(`  Config:  ${CONFIG_PATH}`);
  console.log(`  API key: ${config.apiKey}\n`);
});
