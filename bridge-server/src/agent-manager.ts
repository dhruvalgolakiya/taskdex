import { spawn, ChildProcess } from 'child_process';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initializeRequest,
  initializedNotification,
  threadStartRequest,
  turnStartRequest,
  turnInterruptRequest,
  parseMessage,
  isNotification,
  isResponse,
  JsonRpcResponse,
} from './protocol';
import { sendPushNotification } from './push';

interface AgentInfo {
  id: string;
  name: string;
  model: string;
  cwd: string;
  approvalPolicy: string;
  systemPrompt: string;
  status: 'initializing' | 'ready' | 'working' | 'error' | 'stopped';
  threadId: string | null;
  currentTurnId: string | null;
  messages: { role: string; type: string; text: string; timestamp: number }[];
  process: ChildProcess;
  buffer: string;
  pendingResponses: Map<number, (res: JsonRpcResponse) => void>;
}

type BroadcastFn = (agentId: string, event: string, data: unknown) => void;

// Terminal colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const BG_BLUE = '\x1b[44m';
const WHITE = '\x1b[37m';
const AGENTS_STATE_PATH = path.join(os.homedir(), '.pylon', 'agents.json');

interface PersistedAgent {
  id: string;
  name: string;
  model: string;
  cwd: string;
  approvalPolicy?: string;
  systemPrompt?: string;
}

export class AgentManager {
  private agents = new Map<string, AgentInfo>();
  private broadcast: BroadcastFn;

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
    void this.restoreAgentsFromDisk();
  }

  async createAgent(
    name: string,
    model: string,
    cwd: string,
    approvalPolicy = 'never',
    systemPrompt = '',
    agentId?: string,
  ): Promise<Omit<AgentInfo, 'process' | 'buffer' | 'pendingResponses'>> {
    const id = agentId || uuid();
    console.log(`\n${BG_BLUE}${WHITE}${BOLD} NEW AGENT ${RESET} ${CYAN}${name}${RESET} (${DIM}${id.slice(0, 8)}${RESET})`);
    console.log(`  ${DIM}Model: ${model} | CWD: ${cwd}${RESET}`);

    const proc = spawn('codex', ['app-server'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const agent: AgentInfo = {
      id,
      name,
      model,
      cwd,
      approvalPolicy,
      systemPrompt,
      status: 'initializing',
      threadId: null,
      currentTurnId: null,
      messages: [],
      process: proc,
      buffer: '',
      pendingResponses: new Map(),
    };

    this.agents.set(id, agent);
    this.persistAgentsToDisk();

    // Handle stdout (JSON-RPC messages)
    proc.stdout!.on('data', (chunk: Buffer) => {
      agent.buffer += chunk.toString();
      const lines = agent.buffer.split('\n');
      agent.buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) this.handleMessage(agent, line.trim());
      }
    });

    // Handle stderr
    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.log(`  ${RED}[${name}] stderr:${RESET} ${text}`);
      }
    });

    proc.on('exit', (code) => {
      console.log(`  ${YELLOW}[${name}] Process exited with code ${code}${RESET}`);
      agent.status = 'stopped';
      this.agents.delete(id);
      this.persistAgentsToDisk();
      this.broadcast(id, 'agent/stopped', { code });
      if (code !== 0 && code !== null) {
        sendPushNotification({
          title: `${name} — Error`,
          body: `Agent crashed with exit code ${code}.`,
          subtitle: 'Tap to open',
          agentId: id,
          categoryId: 'agent-error',
          priority: 'high',
          severity: 'error',
        }).catch(() => {});
      }
    });

    try {
      // Initialize handshake
      const initRes = await this.sendRequest(agent, initializeRequest('codex-mobile-bridge', '1.0.0'));
      if (initRes.error) {
        throw new Error(`Initialize failed: ${initRes.error.message}`);
      }
      console.log(`  ${GREEN}[${name}] Initialized${RESET}`);

      // Send initialized notification
      this.write(agent, initializedNotification());

      // Start thread
      const threadRes = await this.sendRequest(agent, threadStartRequest(model, cwd, approvalPolicy));
      if (threadRes.error) {
        throw new Error(`Thread start failed: ${threadRes.error.message}`);
      }
      const threadData = threadRes.result as Record<string, unknown>;
      const thread = threadData.thread as Record<string, unknown> | undefined;
      agent.threadId = (thread?.id as string) || (threadData.threadId as string) || null;
      agent.status = 'ready';
      console.log(`  ${GREEN}[${name}] Thread started: ${agent.threadId?.slice(0, 8)}...${RESET}\n`);

      return this.serialize(agent);
    } catch (err) {
      this.agents.delete(id);
      this.persistAgentsToDisk();
      try { agent.process.kill(); } catch {}
      throw err;
    }
  }

  async sendMessage(agentId: string, text: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    if (!agent.threadId) throw new Error('No active thread');

    console.log(`\n${BLUE}${BOLD}[${agent.name}]${RESET} ${BOLD}User:${RESET} ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);

    agent.status = 'working';
    agent.messages.push({ role: 'user', type: 'user', text, timestamp: Date.now() });

    const promptText = agent.systemPrompt?.trim()
      ? `${agent.systemPrompt.trim()}\n\n${text}`
      : text;
    const turnReq = turnStartRequest(agent.threadId, promptText, agent.model);
    const res = await this.sendRequest(agent, turnReq);
    if (res.result) {
      const turnData = res.result as Record<string, unknown>;
      const turn = turnData.turn as Record<string, unknown> | undefined;
      agent.currentTurnId = (turn?.id as string) || (turnData.turnId as string) || null;
    }
  }

  async interruptAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    if (!agent.threadId || !agent.currentTurnId) return;

    console.log(`  ${YELLOW}[${agent.name}] Interrupting...${RESET}`);
    this.write(agent, turnInterruptRequest(agent.threadId, agent.currentTurnId));
  }

  stopAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');

    console.log(`  ${RED}[${agent.name}] Stopping...${RESET}`);
    agent.process.kill();
    agent.status = 'stopped';
    this.agents.delete(agentId);
    this.persistAgentsToDisk();
  }

  updateModel(agentId: string, model: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    agent.model = model;
    console.log(`  ${MAGENTA}[${agent.name}] Model updated to: ${model}${RESET}`);
    this.persistAgentsToDisk();
  }

  updateConfig(agentId: string, config: { model?: string; approvalPolicy?: string; systemPrompt?: string }): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    if (typeof config.model === 'string' && config.model.trim()) {
      agent.model = config.model.trim();
    }
    if (typeof config.approvalPolicy === 'string' && config.approvalPolicy.trim()) {
      agent.approvalPolicy = config.approvalPolicy.trim();
    }
    if (typeof config.systemPrompt === 'string') {
      agent.systemPrompt = config.systemPrompt;
    }
    this.persistAgentsToDisk();
  }

  listAgents() {
    return Array.from(this.agents.values()).map((a) => this.serialize(a));
  }

  getAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    return agent ? this.serialize(agent) : null;
  }

  private serialize(agent: AgentInfo) {
    return {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      cwd: agent.cwd,
      approvalPolicy: agent.approvalPolicy,
      systemPrompt: agent.systemPrompt,
      status: agent.status,
      threadId: agent.threadId,
      currentTurnId: agent.currentTurnId,
      messages: agent.messages,
    };
  }

  private write(agent: AgentInfo, data: string) {
    agent.process.stdin!.write(data + '\n');
  }

  private persistAgentsToDisk() {
    try {
      fs.mkdirSync(path.dirname(AGENTS_STATE_PATH), { recursive: true });
      const payload: PersistedAgent[] = Array.from(this.agents.values())
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          model: agent.model,
          cwd: agent.cwd,
          approvalPolicy: agent.approvalPolicy,
          systemPrompt: agent.systemPrompt,
        }));
      fs.writeFileSync(AGENTS_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn('[agents] Failed to persist agent state:', err);
    }
  }

  private async restoreAgentsFromDisk() {
    try {
      if (!fs.existsSync(AGENTS_STATE_PATH)) return;
      const raw = fs.readFileSync(AGENTS_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PersistedAgent[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      console.log(`${DIM}[agents] Restoring ${parsed.length} saved agent(s) from ${AGENTS_STATE_PATH}${RESET}`);
      for (const entry of parsed) {
        try {
          await this.createAgent(
            entry.name,
            entry.model,
            entry.cwd,
            entry.approvalPolicy || 'never',
            entry.systemPrompt || '',
            entry.id,
          );
        } catch (err) {
          console.warn(`[agents] Failed to restore ${entry.name} (${entry.id}):`, err);
        }
      }
    } catch (err) {
      console.warn('[agents] Failed to restore saved agents:', err);
    }
  }

  private sendRequest(agent: AgentInfo, request: string): Promise<JsonRpcResponse> {
    return new Promise((resolve) => {
      const parsed = JSON.parse(request);
      const id = parsed.id;
      agent.pendingResponses.set(id, resolve);
      this.write(agent, request);

      // Timeout after 30s
      setTimeout(() => {
        if (agent.pendingResponses.has(id)) {
          agent.pendingResponses.delete(id);
          resolve({ error: { code: -1, message: 'Request timed out' } });
        }
      }, 30000);
    });
  }

  private handleMessage(agent: AgentInfo, line: string) {
    const msg = parseMessage(line);
    if (!msg) return;

    if (isResponse(msg)) {
      const cb = agent.pendingResponses.get(msg.id!);
      if (cb) {
        agent.pendingResponses.delete(msg.id!);
        cb(msg);
      }
      return;
    }

    if (isNotification(msg)) {
      this.handleNotification(agent, msg.method, msg.params);
    }
  }

  private handleNotification(agent: AgentInfo, method: string, params: Record<string, unknown>) {
    const tag = `${CYAN}[${agent.name}]${RESET}`;
    const p = params || {};

    try {
      switch (method) {
        case 'turn/started': {
          agent.status = 'working';
          const turn = p.turn as Record<string, unknown> | undefined;
          agent.currentTurnId = (turn?.id as string) || (p.turnId as string) || agent.currentTurnId;
          console.log(`${tag} ${BOLD}Turn started${RESET}`);
          this.broadcast(agent.id, 'turn/started', p);
          sendPushNotification({
            title: `${agent.name} is working`,
            body: 'Agent started processing your request.',
            subtitle: 'Tap to open',
            agentId: agent.id,
            categoryId: 'agent-working',
            priority: 'default',
            severity: 'info',
          }).catch(() => {});
          break;
        }

        case 'turn/completed': {
          agent.status = 'ready';
          agent.currentTurnId = null;
          console.log(`${tag} ${GREEN}${BOLD}Turn completed${RESET}`);
          this.broadcast(agent.id, 'turn/completed', p);
          // Send push notification so it arrives even if app is backgrounded/killed
          // Include last agent message as preview
          const lastAgentMsg = [...agent.messages].reverse().find(
            (m) => m.role === 'agent' && m.type === 'agent',
          );
          const preview = lastAgentMsg?.text
            ? lastAgentMsg.text.slice(0, 120).replace(/\s+/g, ' ').trim()
            : '';
          sendPushNotification({
            title: `${agent.name} finished`,
            body: preview || `${agent.name} completed the task.`,
            subtitle: 'Hold to reply',
            agentId: agent.id,
            categoryId: 'thread-reply',
            severity: 'info',
          }).catch(() => {});
          break;
        }

        case 'turn/failed': {
          agent.status = 'error';
          const errorMessage = typeof (p.error as Record<string, unknown> | undefined)?.message === 'string'
            ? String((p.error as Record<string, unknown>).message)
            : 'Agent turn failed.';
          this.broadcast(agent.id, 'turn/failed', p);
          sendPushNotification({
            title: `${agent.name} — Error`,
            body: errorMessage,
            subtitle: 'Tap to open',
            agentId: agent.id,
            categoryId: 'agent-error',
            priority: 'high',
            severity: 'error',
          }).catch(() => {});
          break;
        }

        case 'item/started': {
          const item = p.item as Record<string, unknown> | undefined;
          if (item) {
            const type = item.type as string || '';
            if (type === 'reasoning') {
              console.log(`${tag} ${YELLOW}Thinking...${RESET}`);
            } else if (type === 'command' || type === 'localShellCommand') {
              const cmd = (item.command || item.text || '') as string;
              console.log(`${tag} ${MAGENTA}$ ${cmd}${RESET}`);
            } else if (type === 'fileChange' || type === 'codeChange') {
              const path = (item.path || item.file || '') as string;
              console.log(`${tag} ${BLUE}File: ${path}${RESET}`);
              sendPushNotification({
                title: `${agent.name} — File changed`,
                body: path || 'Agent modified a file.',
                subtitle: 'Hold to follow up',
                agentId: agent.id,
                categoryId: 'file-change',
                priority: 'default',
                severity: 'info',
              }).catch(() => {});
            }
          }
          this.broadcast(agent.id, 'item/started', p);
          break;
        }

        case 'item/agentMessage/delta': {
          const delta = p.delta as string || '';
          if (delta) process.stdout.write(`${DIM}${delta}${RESET}`);
          this.broadcast(agent.id, 'item/agentMessage/delta', p);
          break;
        }

        case 'item/reasoning/delta': {
          const delta = p.delta as string || '';
          if (delta) process.stdout.write(`${YELLOW}${DIM}${delta}${RESET}`);
          this.broadcast(agent.id, 'item/reasoning/delta', p);
          break;
        }

        case 'item/commandOutput/delta': {
          const delta = p.delta as string || '';
          if (delta) process.stdout.write(`${GREEN}${DIM}${delta}${RESET}`);
          this.broadcast(agent.id, 'item/commandOutput/delta', p);
          break;
        }

        case 'item/completed': {
          const item = p.item as Record<string, unknown> | undefined;
          if (item) {
            const type = item.type as string || '';
            if (type === 'agentMessage') {
              console.log(`\n${tag} ${GREEN}Message complete${RESET}`);
            } else if (type === 'commandOutput' || type === 'localShellOutput') {
              console.log(`\n${tag} ${GREEN}Output complete${RESET}`);
            }
          }
          this.broadcast(agent.id, 'item/completed', p);
          break;
        }

        default: {
          // Forward any other notifications
          console.log(`${tag} ${DIM}${method}${RESET}`);
          this.broadcast(agent.id, method, p);
          break;
        }
      }
    } catch (err) {
      console.error(`${RED}[${agent.name}] Error handling ${method}:${RESET}`, err);
      // Still try to broadcast even if logging failed
      try { this.broadcast(agent.id, method, p); } catch {}
    }
  }
}
