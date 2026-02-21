import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import { AgentManager } from './agent-manager';
import { registerPushToken, getRegisteredTokenCount } from './push';

const PORT = 3001;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track connected mobile clients
const clients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(agentId: string, event: string, data: unknown) {
  const message = JSON.stringify({ type: 'stream', agentId, event, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

const manager = new AgentManager(broadcast);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: manager.listAgents().length, pushTokens: getRegisteredTokenCount() });
});

wss.on('connection', (ws) => {
  console.log('Mobile client connected');
  clients.add(ws);

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
          registerPushToken(token);
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
    console.log('Mobile client disconnected');
    clients.delete(ws);
  });
});

// Get local IP for display
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

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n  Codex Bridge Server running`);
  console.log(`  Local:   ws://localhost:${PORT}`);
  console.log(`  Network: ws://${ip}:${PORT}\n`);
});
