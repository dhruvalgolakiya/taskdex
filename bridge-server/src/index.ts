import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promises as fsPromises } from 'fs';
import simpleGit from 'simple-git';
import qrcode from 'qrcode-terminal';
import { AgentManager } from './agent-manager';
import {
  registerPushToken,
  getRegisteredTokenCount,
  getRegisteredClientCount,
  removeClientPushTokens,
  getNotificationPreferences,
  updateNotificationPreference,
  getNotificationHistory,
  type NotificationLevel,
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
  if (process.env.API_KEY && process.env.API_KEY.trim()) {
    console.log('[auth] Using API key from API_KEY environment variable.');
    return { apiKey: process.env.API_KEY.trim() };
  }

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

function resolveWithinCwd(cwd: string, relativePath?: string): string {
  const safeCwd = path.resolve(cwd || process.cwd());
  const resolved = path.resolve(safeCwd, relativePath || '.');
  if (resolved === safeCwd || resolved.startsWith(`${safeCwd}${path.sep}`)) {
    return resolved;
  }
  throw new Error('Path escapes cwd');
}

function getReposRoot(): string {
  const root = process.env.REPOS_DIR
    ? path.resolve(process.env.REPOS_DIR)
    : path.join(os.homedir(), '.pylon', 'repos');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function resolveWithinBase(base: string, targetPath: string): string {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(targetPath);
  if (resolved === resolvedBase || resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    return resolved;
  }
  throw new Error('Path escapes repository root');
}

function repoNameFromUrl(url: string): string {
  const normalized = url.replace(/\/$/, '');
  const base = normalized.split('/').pop() || 'repo';
  return base.replace(/\.git$/i, '') || 'repo';
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function maybeAutoPullRepo(cwd: string): Promise<void> {
  if (!parseBooleanEnv(process.env.AUTO_PULL_REPOS)) return;

  const reposRoot = getReposRoot();
  let safePath: string;
  try {
    safePath = resolveWithinBase(reposRoot, cwd);
  } catch {
    return;
  }

  if (!fs.existsSync(path.join(safePath, '.git'))) return;

  try {
    await simpleGit({ baseDir: safePath }).pull();
    console.log(`[bridge] Auto-pulled repo before agent start: ${safePath}`);
  } catch (err) {
    console.warn(`[bridge] Auto-pull failed for ${safePath}:`, err);
  }
}

function gitForCwd(cwd: string) {
  return simpleGit({
    baseDir: path.resolve(cwd || process.cwd()),
  });
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
          const {
            name,
            model,
            cwd,
            approvalPolicy,
            systemPrompt,
            agentId,
          } = params as {
            name: string;
            model: string;
            cwd: string;
            approvalPolicy?: string;
            systemPrompt?: string;
            agentId?: string;
          };
          const defaultCwd = process.env.CODEX_CWD || process.cwd();
          const resolvedCwd = cwd || defaultCwd;
          await maybeAutoPullRepo(resolvedCwd);
          const agent = await manager.createAgent(
            name || 'Agent',
            model || 'gpt-5.1-codex',
            resolvedCwd,
            approvalPolicy || 'never',
            systemPrompt || '',
            agentId,
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

        case 'update_agent_config': {
          const {
            agentId,
            model,
            approvalPolicy,
            systemPrompt,
          } = params as {
            agentId: string;
            model?: string;
            approvalPolicy?: string;
            systemPrompt?: string;
          };
          manager.updateConfig(agentId, { model, approvalPolicy, systemPrompt });
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

        case 'update_notification_prefs': {
          const { agentId, level } = params as { agentId: string; level: NotificationLevel };
          if (!agentId?.trim()) throw new Error('agentId is required');
          const normalizedLevel = (level || 'all').trim().toLowerCase();
          if (!['all', 'errors', 'muted'].includes(normalizedLevel)) {
            throw new Error('level must be one of: all, errors, muted');
          }
          updateNotificationPreference(agentId.trim(), normalizedLevel as NotificationLevel);
          reply({ ok: true, agentId: agentId.trim(), level: normalizedLevel });
          break;
        }

        case 'get_notification_prefs': {
          reply(getNotificationPreferences());
          break;
        }

        case 'list_notification_history': {
          const { limit } = params as { limit?: number };
          reply(getNotificationHistory(typeof limit === 'number' ? limit : 100));
          break;
        }

        case 'list_files': {
          const { cwd, path: relativePath } = params as { cwd: string; path?: string };
          const defaultCwd = process.env.CODEX_CWD || process.cwd();
          const target = resolveWithinCwd(cwd || defaultCwd, relativePath);
          const entries = await fsPromises.readdir(target, { withFileTypes: true });
          const serialized = entries
            .map((entry) => ({
              name: entry.name,
              path: path.join(relativePath || '.', entry.name),
              type: entry.isDirectory() ? 'directory' : 'file',
            }))
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          reply({
            cwd: path.resolve(cwd || defaultCwd),
            path: relativePath || '.',
            entries: serialized,
          });
          break;
        }

        case 'list_directories': {
          const { cwd, path: relativePath } = params as { cwd: string; path?: string };
          const defaultCwd = process.env.CODEX_CWD || process.cwd();
          const target = resolveWithinCwd(cwd || defaultCwd, relativePath);
          const entries = await fsPromises.readdir(target, { withFileTypes: true });
          const directories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
              name: entry.name,
              path: path.join(relativePath || '.', entry.name),
              type: 'directory',
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          reply({
            cwd: path.resolve(cwd || defaultCwd),
            path: relativePath || '.',
            entries: directories,
          });
          break;
        }

        case 'read_file': {
          const { cwd, path: relativePath } = params as { cwd: string; path: string };
          if (!relativePath) throw new Error('path is required');
          const defaultCwd = process.env.CODEX_CWD || process.cwd();
          const target = resolveWithinCwd(cwd || defaultCwd, relativePath);
          const stat = await fsPromises.stat(target);
          if (!stat.isFile()) throw new Error('Target is not a file');
          const content = await fsPromises.readFile(target, 'utf8');
          reply({
            cwd: path.resolve(cwd || defaultCwd),
            path: relativePath,
            content,
          });
          break;
        }

        case 'git_status': {
          const { cwd } = params as { cwd: string };
          const git = gitForCwd(cwd || process.cwd());
          const status = await git.status();
          reply({
            branch: status.current,
            isClean: status.isClean(),
            ahead: status.ahead,
            behind: status.behind,
            modified: status.modified,
            created: status.created,
            deleted: status.deleted,
            renamed: status.renamed,
            notAdded: status.not_added,
            conflicted: status.conflicted,
          });
          break;
        }

        case 'git_log': {
          const { cwd, limit } = params as { cwd: string; limit?: number };
          const git = gitForCwd(cwd || process.cwd());
          const history = await git.log({ maxCount: Math.min(Math.max(limit || 20, 1), 100) });
          reply(history.all);
          break;
        }

        case 'git_diff': {
          const { cwd, file } = params as { cwd: string; file?: string };
          const git = gitForCwd(cwd || process.cwd());
          const diff = file ? await git.diff([file]) : await git.diff();
          reply({ diff });
          break;
        }

        case 'git_commit': {
          const { cwd, message } = params as { cwd: string; message: string };
          const git = gitForCwd(cwd || process.cwd());
          await git.add('.');
          const result = await git.commit(message || 'chore: update via pylon mobile');
          reply(result);
          break;
        }

        case 'git_branches': {
          const { cwd } = params as { cwd: string };
          const git = gitForCwd(cwd || process.cwd());
          const branches = await git.branchLocal();
          reply({
            current: branches.current,
            all: branches.all,
          });
          break;
        }

        case 'git_checkout': {
          const { cwd, branch } = params as { cwd: string; branch: string };
          if (!branch) throw new Error('branch is required');
          const git = gitForCwd(cwd || process.cwd());
          await git.checkout(branch);
          reply({ ok: true });
          break;
        }

        case 'clone_repo': {
          const { url } = params as { url: string };
          if (!url?.trim()) throw new Error('url is required');
          const reposRoot = getReposRoot();
          const baseName = repoNameFromUrl(url.trim());
          let targetPath = path.join(reposRoot, baseName);
          let suffix = 1;
          while (fs.existsSync(targetPath)) {
            targetPath = path.join(reposRoot, `${baseName}-${suffix}`);
            suffix += 1;
          }
          await simpleGit().clone(url.trim(), targetPath);
          reply({ ok: true, path: targetPath, name: path.basename(targetPath) });
          break;
        }

        case 'list_repos': {
          const reposRoot = getReposRoot();
          const entries = await fsPromises.readdir(reposRoot, { withFileTypes: true });
          const repos = await Promise.all(
            entries
              .filter((entry) => entry.isDirectory())
              .map(async (entry) => {
                const repoPath = path.join(reposRoot, entry.name);
                if (!fs.existsSync(path.join(repoPath, '.git'))) return null;
                let remote = '';
                try {
                  const remoteOutput = await simpleGit({ baseDir: repoPath }).remote(['get-url', 'origin']);
                  remote = typeof remoteOutput === 'string' ? remoteOutput.trim() : '';
                } catch {}
                return {
                  name: entry.name,
                  path: repoPath,
                  remote,
                };
              }),
          );
          reply((repos.filter(Boolean) as Array<{ name: string; path: string; remote: string }>).sort((a, b) => a.name.localeCompare(b.name)));
          break;
        }

        case 'pull_repo': {
          const { path: repoPath } = params as { path: string };
          if (!repoPath?.trim()) throw new Error('path is required');
          const reposRoot = getReposRoot();
          const safePath = resolveWithinBase(reposRoot, repoPath.trim());
          const git = simpleGit({ baseDir: safePath });
          const result = await git.pull();
          reply({ ok: true, summary: result.summary });
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
  const networkUrl = `ws://${ip}:${PORT}`;
  const qrPayload = `pylon://connect?bridgeUrl=${encodeURIComponent(networkUrl)}&apiKey=${encodeURIComponent(config.apiKey)}`;
  console.log('\n  Codex Bridge Server running');
  console.log(`  Local:   ws://localhost:${PORT}`);
  console.log(`  Network: ${networkUrl}`);
  console.log(`  Config:  ${CONFIG_PATH}`);
  console.log(`  API key: ${config.apiKey}\n`);
  console.log('  Scan in mobile app (Settings -> Scan QR):');
  qrcode.generate(qrPayload, { small: true });
  console.log(`\n  QR payload: ${qrPayload}\n`);
});
