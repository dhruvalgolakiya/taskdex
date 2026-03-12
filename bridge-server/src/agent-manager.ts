import { spawn, ChildProcess } from 'child_process';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initializeRequest,
  initializedNotification,
  threadStartRequest,
  threadResumeRequest,
  threadListRequest,
  threadReadRequest,
  modelListRequest,
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
  serviceTier: string;
  reasoningEffort: string;
  systemPrompt: string;
  status: 'initializing' | 'ready' | 'working' | 'error' | 'stopped';
  threadId: string | null;
  currentTurnId: string | null;
  codexThreadId: string | null;
  codexPath: string | null;
  source: string | null;
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
const AGENTS_STATE_PATH = path.join(os.homedir(), '.taskdex', 'agents.json');

interface PersistedAgent {
  id: string;
  name: string;
  model: string;
  cwd: string;
  approvalPolicy?: string;
  serviceTier?: string;
  reasoningEffort?: string;
  systemPrompt?: string;
  codexThreadId?: string;
}

export interface CodexThreadSummary {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  path: string;
  source: string | null;
  createdAt: number;
  updatedAt: number;
  status: string;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  isDefault: boolean;
  supportsPersonality: boolean;
  inputModalities: string[];
}

export interface CodexThreadDetail extends CodexThreadSummary {
  model: string;
  approvalPolicy: string;
  serviceTier: string;
  reasoningEffort: string;
  messages: { role: string; type: string; text: string; timestamp: number }[];
}

function toTimestampMs(value: unknown, fallback = Date.now()): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (value > 1_000_000_000_000) return value;
  if (value > 1_000_000_000) return value * 1000;
  return fallback;
}

function extractThreadStatus(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'unknown';
  const type = (raw as Record<string, unknown>).type;
  return typeof type === 'string' && type.trim() ? type.trim() : 'unknown';
}

function contentItemsToText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const text = (entry as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function turnsToMessages(thread: Record<string, unknown> | undefined) {
  const baseTimestamp = toTimestampMs(thread?.createdAt, Date.now());
  const turns = Array.isArray(thread?.turns) ? thread?.turns : [];
  const messages: AgentInfo['messages'] = [];
  let index = 0;

  for (const turn of turns) {
    if (!turn || typeof turn !== 'object') continue;
    const items = Array.isArray((turn as Record<string, unknown>).items)
      ? ((turn as Record<string, unknown>).items as unknown[])
      : [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';

      if (type === 'userMessage') {
        const text = contentItemsToText(record.content);
        if (text) {
          messages.push({ role: 'user', type: 'user', text, timestamp: baseTimestamp + index++ });
        }
        continue;
      }

      if (type === 'agentMessage') {
        const text = typeof record.text === 'string' ? record.text : '';
        if (text) {
          messages.push({ role: 'agent', type: 'agent', text, timestamp: baseTimestamp + index++ });
        }
      }
    }
  }

  return messages;
}

function normalizeThreadSummary(thread: Record<string, unknown>): CodexThreadSummary {
  return {
    id: typeof thread.id === 'string' ? thread.id : '',
    name: typeof thread.name === 'string' ? thread.name : null,
    preview: typeof thread.preview === 'string' ? thread.preview : '',
    cwd: typeof thread.cwd === 'string' ? thread.cwd : '',
    path: typeof thread.path === 'string' ? thread.path : '',
    source: typeof thread.source === 'string' ? thread.source : null,
    createdAt: toTimestampMs(thread.createdAt),
    updatedAt: toTimestampMs(thread.updatedAt),
    status: extractThreadStatus(thread.status),
  };
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
    options?: {
      serviceTier?: string;
      reasoningEffort?: string;
      codexThreadId?: string;
    },
  ): Promise<Omit<AgentInfo, 'process' | 'buffer' | 'pendingResponses'>> {
    const id = agentId || uuid();
    if (this.agents.has(id)) {
      throw new Error(`Agent ${id} is already running`);
    }
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
      serviceTier: options?.serviceTier || 'fast',
      reasoningEffort: options?.reasoningEffort || 'medium',
      systemPrompt,
      status: 'initializing',
      threadId: null,
      currentTurnId: null,
      codexThreadId: options?.codexThreadId || null,
      codexPath: null,
      source: null,
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

      const threadRes = options?.codexThreadId
        ? await this.sendRequest(
          agent,
          threadResumeRequest(options.codexThreadId, {
            model,
            cwd,
            approvalPolicy,
            serviceTier: agent.serviceTier,
          }),
        )
        : await this.sendRequest(
          agent,
          threadStartRequest(model, cwd, approvalPolicy, agent.serviceTier),
        );

      if (threadRes.error) {
        throw new Error(`${options?.codexThreadId ? 'Thread resume' : 'Thread start'} failed: ${threadRes.error.message}`);
      }
      const threadData = threadRes.result as Record<string, unknown>;
      const thread = threadData.thread as Record<string, unknown> | undefined;
      agent.threadId = (thread?.id as string) || (threadData.threadId as string) || null;
      agent.codexThreadId = agent.threadId;
      agent.codexPath = typeof thread?.path === 'string' ? thread.path : null;
      agent.source = typeof thread?.source === 'string' ? thread.source : null;
      agent.cwd = (typeof threadData.cwd === 'string' ? threadData.cwd : cwd) || cwd;
      agent.model = (typeof threadData.model === 'string' ? threadData.model : model) || model;
      agent.approvalPolicy = (typeof threadData.approvalPolicy === 'string' ? threadData.approvalPolicy : approvalPolicy) || approvalPolicy;
      agent.serviceTier = (typeof threadData.serviceTier === 'string' ? threadData.serviceTier : agent.serviceTier) || 'fast';
      agent.reasoningEffort = (typeof threadData.reasoningEffort === 'string' ? threadData.reasoningEffort : agent.reasoningEffort) || 'medium';
      if (options?.codexThreadId) {
        agent.messages = turnsToMessages(thread);
      }
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
    const turnReq = turnStartRequest(agent.threadId, promptText, {
      model: agent.model,
      effort: agent.reasoningEffort,
      serviceTier: agent.serviceTier,
      approvalPolicy: agent.approvalPolicy,
      cwd: agent.cwd,
    });
    try {
      const res = await this.sendRequest(agent, turnReq);
      if (res.error) {
        throw new Error(res.error.message || 'Failed to start turn');
      }
      if (res.result) {
        const turnData = res.result as Record<string, unknown>;
        const turn = turnData.turn as Record<string, unknown> | undefined;
        agent.currentTurnId = (turn?.id as string) || (turnData.turnId as string) || null;
      }
    } catch (err) {
      agent.status = 'error';
      agent.currentTurnId = null;
      throw err;
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

  updateConfig(
    agentId: string,
    config: {
      model?: string;
      cwd?: string;
      approvalPolicy?: string;
      systemPrompt?: string;
      serviceTier?: string;
      reasoningEffort?: string;
    },
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    if (typeof config.model === 'string' && config.model.trim()) {
      agent.model = config.model.trim();
    }
    if (typeof config.cwd === 'string' && config.cwd.trim()) {
      agent.cwd = config.cwd.trim();
    }
    if (typeof config.approvalPolicy === 'string' && config.approvalPolicy.trim()) {
      agent.approvalPolicy = config.approvalPolicy.trim();
    }
    if (typeof config.serviceTier === 'string' && config.serviceTier.trim()) {
      agent.serviceTier = config.serviceTier.trim();
    }
    if (typeof config.reasoningEffort === 'string' && config.reasoningEffort.trim()) {
      agent.reasoningEffort = config.reasoningEffort.trim();
    }
    if (typeof config.systemPrompt === 'string') {
      agent.systemPrompt = config.systemPrompt;
    }
    this.persistAgentsToDisk();
  }

  async listCodexThreads(params: { limit?: number; cursor?: string; cwd?: string } = {}) {
    const response = await this.sendOneOffRequest(threadListRequest(params), params.cwd);
    if (response.error) throw new Error(response.error.message);
    const result = response.result as Record<string, unknown>;
    const data = Array.isArray(result?.data) ? result.data : [];
    return {
      data: data
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => normalizeThreadSummary(entry)),
      nextCursor: typeof result?.nextCursor === 'string' ? result.nextCursor : null,
    };
  }

  async readCodexThread(threadId: string): Promise<CodexThreadDetail> {
    const response = await this.sendOneOffRequest(threadReadRequest(threadId, true));
    if (response.error) throw new Error(response.error.message);
    const result = response.result as Record<string, unknown>;
    const thread = result?.thread as Record<string, unknown> | undefined;
    if (!thread) throw new Error('Thread not found');
    return {
      ...normalizeThreadSummary(thread),
      model: typeof result?.model === 'string' ? result.model : '',
      approvalPolicy: typeof result?.approvalPolicy === 'string' ? result.approvalPolicy : 'never',
      serviceTier: typeof result?.serviceTier === 'string' ? result.serviceTier : 'fast',
      reasoningEffort: typeof result?.reasoningEffort === 'string' ? result.reasoningEffort : 'medium',
      messages: turnsToMessages(thread),
    };
  }

  async listCodexModels(includeHidden = true): Promise<CodexModelInfo[]> {
    const response = await this.sendOneOffRequest(modelListRequest(includeHidden));
    if (response.error) throw new Error(response.error.message);
    const result = response.result as Record<string, unknown>;
    const data = Array.isArray(result?.data) ? result.data : [];
    return data
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : '',
        model: typeof entry.model === 'string' ? entry.model : '',
        displayName: typeof entry.displayName === 'string' ? entry.displayName : (typeof entry.model === 'string' ? entry.model : ''),
        description: typeof entry.description === 'string' ? entry.description : '',
        hidden: Boolean(entry.hidden),
        defaultReasoningEffort: typeof entry.defaultReasoningEffort === 'string' ? entry.defaultReasoningEffort : 'medium',
        supportedReasoningEfforts: Array.isArray(entry.supportedReasoningEfforts)
          ? entry.supportedReasoningEfforts
            .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
            .map((item) => ({
              reasoningEffort: typeof item.reasoningEffort === 'string' ? item.reasoningEffort : '',
              description: typeof item.description === 'string' ? item.description : '',
            }))
          : [],
        isDefault: Boolean(entry.isDefault),
        supportsPersonality: Boolean(entry.supportsPersonality),
        inputModalities: Array.isArray(entry.inputModalities)
          ? entry.inputModalities.filter((item): item is string => typeof item === 'string')
          : [],
      }));
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
      serviceTier: agent.serviceTier,
      reasoningEffort: agent.reasoningEffort,
      systemPrompt: agent.systemPrompt,
      status: agent.status,
      threadId: agent.threadId,
      currentTurnId: agent.currentTurnId,
      codexThreadId: agent.codexThreadId,
      codexPath: agent.codexPath,
      source: agent.source,
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
          serviceTier: agent.serviceTier,
          reasoningEffort: agent.reasoningEffort,
          systemPrompt: agent.systemPrompt,
          codexThreadId: agent.codexThreadId || undefined,
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
            {
              serviceTier: entry.serviceTier,
              reasoningEffort: entry.reasoningEffort,
              codexThreadId: entry.codexThreadId,
            },
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

  private sendOneOffRequest(request: string, cwd?: string): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const proc = spawn('codex', ['app-server'], {
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let buffer = '';
      const pending = new Map<number, (res: JsonRpcResponse) => void>();
      let settled = false;

      const finish = (value: JsonRpcResponse | Error, isError = false) => {
        if (settled) return;
        settled = true;
        try { proc.kill(); } catch {}
        if (isError) reject(value);
        else resolve(value as JsonRpcResponse);
      };

      proc.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = parseMessage(line.trim());
          if (!msg || !isResponse(msg)) continue;
          const cb = pending.get(msg.id!);
          if (cb) {
            pending.delete(msg.id!);
            cb(msg);
          }
        }
      });

      proc.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          console.log(`  ${RED}[codex-meta] stderr:${RESET} ${text}`);
        }
      });

      proc.on('error', (err) => finish(err, true));
      proc.on('exit', (code) => {
        if (!settled && code !== 0) {
          finish(new Error(`codex app-server exited with code ${code}`), true);
        }
      });

      const send = (raw: string) =>
        new Promise<JsonRpcResponse>((resolveResponse) => {
          const parsed = JSON.parse(raw);
          const id = parsed.id;
          pending.set(id, resolveResponse);
          proc.stdin!.write(raw + '\n');
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              resolveResponse({ error: { code: -1, message: 'Request timed out' } });
            }
          }, 30000);
        });

      (async () => {
        const initRes = await send(initializeRequest('codex-mobile-bridge-meta', '1.0.0'));
        if (initRes.error) {
          finish(new Error(`Initialize failed: ${initRes.error.message}`), true);
          return;
        }
        proc.stdin!.write(initializedNotification() + '\n');
        const result = await send(request);
        finish(result);
      })().catch((err) => finish(err instanceof Error ? err : new Error(String(err)), true));
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
