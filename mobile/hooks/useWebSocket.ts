import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useAgentStore } from '../stores/agentStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { startAgentActivity, updateAgentActivity, stopAgentActivity, isLiveActivitySupported } from './useLiveActivity';
import type { BridgeRequest, BridgeResponse, Agent, CodexModelInfo, CodexThreadDetail, CodexThreadSummary, MessageType } from '../types';

let requestCounter = 0;
const STREAM_LOG_LIMIT = 160;
let streamSeq = 0;
type PendingCallback = (response: BridgeResponse) => void;

let globalWs: WebSocket | null = null;
let globalPending = new Map<string, PendingCallback>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const queuedDispatchInFlight = new Set<string>();
const pendingDeltaBuffer = new Map<string, { agentId: string; itemId: string; delta: string; msgType: MessageType }>();
let pendingDeltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
const activeTurnsByAgent = new Map<string, {
  turnId?: string;
  startedAt: number;
  model: string;
  hadError: boolean;
}>();

type StreamLogEntry = {
  seq: number;
  ts: number;
  agentId: string;
  event: string;
  itemId?: string;
  dataType?: string;
};

const streamLog: StreamLogEntry[] = [];

function rememberStreamLog(entry: StreamLogEntry) {
  if (!__DEV__) return;
  streamLog.push(entry);
  if (streamLog.length > STREAM_LOG_LIMIT) {
    streamLog.splice(0, streamLog.length - STREAM_LOG_LIMIT);
  }
  if (typeof console !== 'undefined') {
    console.debug(
      `[codex-stream] #${entry.seq} ${entry.agentId} ${entry.event}`,
      entry.itemId ? `item=${entry.itemId}` : '',
      entry.dataType ? `type=${entry.dataType}` : '',
    );
  }
}

function logStreamEvent(agentId: string, event: string, data: unknown) {
  const payload = data as Record<string, any>;
  const itemId = typeof payload === 'object' && payload
    ? String(payload.item?.id || payload.itemId || payload.eventId || '')
    : '';
  const dataType = payload?.item?.type || payload?.type || payload?.itemType;
  const entry: StreamLogEntry = {
    seq: ++streamSeq,
    ts: Date.now(),
    agentId,
    event,
    itemId: itemId || undefined,
    dataType: typeof dataType === 'string' ? dataType : undefined,
  };
  rememberStreamLog(entry);
}

function cleanup() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pendingDeltaFlushTimer) {
    clearTimeout(pendingDeltaFlushTimer);
    pendingDeltaFlushTimer = null;
  }
  pendingDeltaBuffer.clear();
  if (globalWs) {
    globalWs.onclose = null;
    globalWs.onerror = null;
    globalWs.onopen = null;
    globalWs.onmessage = null;
    globalWs.close();
    globalWs = null;
  }
}

function getReconnectDelayMs(): number {
  const base = Math.min(1000 * (2 ** reconnectAttempt), 30000);
  reconnectAttempt += 1;
  const jitter = Math.floor(Math.random() * 300);
  return base + jitter;
}

function flushPendingDeltas() {
  if (pendingDeltaFlushTimer) {
    clearTimeout(pendingDeltaFlushTimer);
    pendingDeltaFlushTimer = null;
  }
  if (pendingDeltaBuffer.size === 0) return;
  const store = useAgentStore.getState();
  for (const entry of pendingDeltaBuffer.values()) {
    store.appendDelta(entry.agentId, entry.itemId, entry.delta, entry.msgType);
  }
  pendingDeltaBuffer.clear();
}

function queueDelta(agentId: string, itemId: string, delta: string, msgType: MessageType) {
  const key = `${agentId}:${itemId}`;
  const existing = pendingDeltaBuffer.get(key);
  if (existing) {
    existing.delta += delta;
    existing.msgType = msgType;
  } else {
    pendingDeltaBuffer.set(key, { agentId, itemId, delta, msgType });
  }
  if (!pendingDeltaFlushTimer) {
    pendingDeltaFlushTimer = setTimeout(() => {
      flushPendingDeltas();
    }, 60);
  }
}

function connectWs(url: string) {
  cleanup();

  useAgentStore.getState().setConnectionStatus('connecting');

  const ws = new WebSocket(url);
  globalWs = ws;

  ws.onopen = () => {
    if (globalWs !== ws) return;
    reconnectAttempt = 0;
    const { bridgeApiKey, clientId } = useAgentStore.getState();
    const requestId = `req_${++requestCounter}`;
    globalPending.set(requestId, (res) => {
      if (res.type === 'response') {
        useAgentStore.getState().setConnectionStatus('connected');
        syncAgents();
        syncCodexThreads();
        registerPushToken();
        return;
      }
      useAgentStore.getState().setConnectionStatus('disconnected');
      ws.close();
    });
    ws.send(JSON.stringify({
      action: 'auth',
      params: { key: bridgeApiKey, clientId },
      requestId,
    }));
  };

  ws.onmessage = (event) => {
    if (globalWs !== ws) return;
    let msg: BridgeResponse;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
    } catch {
      return;
    }

    if ((msg.type === 'response' || msg.type === 'error') && msg.requestId) {
      const cb = globalPending.get(msg.requestId);
      if (cb) {
        globalPending.delete(msg.requestId);
        cb(msg);
      }
      return;
    }

    if (msg.type === 'stream' && msg.agentId && msg.event) {
      logStreamEvent(msg.agentId, msg.event, msg.data);
      handleStreamEvent(msg.agentId, msg.event, msg.data);
    }
  };

  ws.onclose = () => {
    if (globalWs !== ws) return;
    globalWs = null;
    useAgentStore.getState().setConnectionStatus('disconnected');
    const delay = getReconnectDelayMs();
    reconnectTimer = setTimeout(() => connectWs(url), delay);
  };

  ws.onerror = () => {
    if (globalWs !== ws) return;
    ws.close();
  };
}

// Register push token with bridge so it can send notifications even when app is killed
async function registerPushToken() {
  if (!globalWs || globalWs.readyState !== WebSocket.OPEN) return;
  if (!Device.isDevice) return; // Push tokens only work on real devices

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      ...(projectId ? { projectId } : {}),
    });
    if (token) {
      const requestId = `req_${++requestCounter}`;
      globalWs.send(JSON.stringify({ action: 'register_push_token', params: { token }, requestId }));
      console.log('[push] Token registered with bridge');
    }
  } catch (err) {
    console.warn('[push] Failed to get push token:', err);
  }
}

// Fetch running agents from bridge on reconnect
function syncAgents() {
  if (!globalWs || globalWs.readyState !== WebSocket.OPEN) return;

  const requestId = `req_${++requestCounter}`;
  globalPending.set(requestId, (res) => {
    if (res.type === 'response' && Array.isArray(res.data)) {
      const bridgeAgents = res.data as Agent[];
      useAgentStore.getState().mergeWithBridgeAgents(bridgeAgents);
      for (const agent of bridgeAgents) {
        void flushQueuedIfReady(agent.id);
      }
    }
  });
  globalWs.send(JSON.stringify({ action: 'list_agents', requestId }));
}

function pathBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || value || 'Project';
}

function deriveWorkspaceName(thread: CodexThreadSummary): string {
  const firstLine = thread.preview.split('\n')[0]?.trim() || '';
  if (firstLine.toLowerCase().startsWith('workspace:')) {
    return firstLine.slice('workspace:'.length).trim() || pathBasename(thread.cwd);
  }
  return pathBasename(thread.cwd) || 'Mac Session';
}

function deriveThreadTitle(thread: CodexThreadSummary): string {
  if (thread.name?.trim()) return thread.name.trim();
  const lines = thread.preview
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.find((line) => !line.toLowerCase().startsWith('workspace:'));
  return (candidate || thread.preview || 'Codex Thread').slice(0, 80).trim() || 'Codex Thread';
}

function unwrapBridgeData<T>(input: unknown): T | null {
  if (input && typeof input === 'object' && 'data' in (input as Record<string, unknown>)) {
    return (((input as { data?: unknown }).data) ?? null) as T | null;
  }
  return (input ?? null) as T | null;
}

async function syncCodexThreads() {
  if (!globalWs || globalWs.readyState !== WebSocket.OPEN) return;

  const requestId = `req_${++requestCounter}`;
  globalPending.set(requestId, (res) => {
    if (res.type !== 'response' || !res.data || typeof res.data !== 'object') return;
    const payload = res.data as { data?: CodexThreadSummary[] };
    if (!Array.isArray(payload.data)) return;
    void reconcileCodexThreads(payload.data);
  });
  globalWs.send(JSON.stringify({ action: 'list_codex_threads', params: { limit: 100 }, requestId }));
}

async function reconcileCodexThreads(threads: CodexThreadSummary[]) {
  const agentStore = useAgentStore.getState();
  const workspaceStore = useWorkspaceStore.getState();
  const existingAgentsById = new Map(agentStore.agents.map((agent) => [agent.id, agent]));
  const existingWorkspaces = workspaceStore.workspaces;
  const nextAgents: Agent[] = threads.map((thread) => {
    const existingAgent = existingAgentsById.get(thread.id);
    return existingAgent
      ? {
        ...existingAgent,
        name: deriveWorkspaceName(thread),
        cwd: thread.cwd || existingAgent.cwd,
        codexThreadId: existingAgent.codexThreadId || thread.id,
        codexPath: thread.path || existingAgent.codexPath,
        source: thread.source || existingAgent.source,
        syncedFromCodex: true,
      }
      : {
        id: thread.id,
        name: deriveWorkspaceName(thread),
        model: 'gpt-5.4',
        cwd: thread.cwd || '.',
        approvalPolicy: 'on-request',
        serviceTier: 'fast',
        reasoningEffort: 'medium',
        systemPrompt: '',
        status: 'stopped',
        threadId: thread.id,
        currentTurnId: null,
        codexThreadId: thread.id,
        codexPath: thread.path,
        source: thread.source,
        syncedFromCodex: true,
        messages: [],
        queuedMessages: [],
      };
  });
  agentStore.setAgents(nextAgents);

  const workspaceGroups = new Map<string, {
    id?: string;
    name: string;
    cwd: string;
    model: string;
    approvalPolicy?: string;
    serviceTier?: string;
    reasoningEffort?: string;
    systemPrompt?: string;
    threads: Array<{ id: string; title: string; createdAt: number }>;
  }>();

  for (const thread of threads) {
    const workspaceName = deriveWorkspaceName(thread);
    const key = `${thread.cwd || '.'}::${workspaceName}`;
    const existingWorkspace = existingWorkspaces.find((entry) => entry.cwd === (thread.cwd || '.') && entry.name === workspaceName);
    const agent = nextAgents.find((entry) => entry.id === thread.id);
    if (!workspaceGroups.has(key)) {
      workspaceGroups.set(key, {
        id: existingWorkspace?.id,
        name: workspaceName,
        cwd: thread.cwd || agent?.cwd || '.',
        model: agent?.model || 'gpt-5.4',
        approvalPolicy: agent?.approvalPolicy || 'on-request',
        serviceTier: agent?.serviceTier || 'fast',
        reasoningEffort: agent?.reasoningEffort || 'medium',
        systemPrompt: agent?.systemPrompt || '',
        threads: [],
      });
    }
    workspaceGroups.get(key)!.threads.push({
      id: thread.id,
      title: deriveThreadTitle(thread),
      createdAt: thread.updatedAt || thread.createdAt || Date.now(),
    });
  }

  const nextWorkspaces = Array.from(workspaceGroups.values()).map((workspace) => {
    const fallbackThreadId = workspace.threads[0]?.id || null;
    const preservedActiveThreadId = existingWorkspaces.find((entry) => entry.id === workspace.id)?.activeThreadId;
    return {
      id: workspace.id || `ws_${workspace.name}_${workspace.cwd}`.replace(/[^a-zA-Z0-9_./-]+/g, '_'),
      name: workspace.name,
      model: workspace.model,
      cwd: workspace.cwd,
      approvalPolicy: workspace.approvalPolicy,
      serviceTier: workspace.serviceTier,
      reasoningEffort: workspace.reasoningEffort,
      systemPrompt: workspace.systemPrompt,
      threads: workspace.threads.sort((left, right) => right.createdAt - left.createdAt),
      activeThreadId: preservedActiveThreadId && workspace.threads.some((thread) => thread.id === preservedActiveThreadId)
        ? preservedActiveThreadId
        : fallbackThreadId,
      createdAt: workspace.threads[workspace.threads.length - 1]?.createdAt || Date.now(),
      updatedAt: workspace.threads[0]?.createdAt || Date.now(),
    };
  }).sort((left, right) => right.updatedAt - left.updatedAt);

  workspaceStore.replaceWorkspaces(nextWorkspaces);
}

export function sendRequest(action: string, params?: Record<string, unknown>): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'));
      return;
    }

    const requestId = `req_${++requestCounter}`;
    const msg: BridgeRequest = { action, params, requestId };

    globalPending.set(requestId, resolve);
    globalWs.send(JSON.stringify(msg));

    setTimeout(() => {
      if (globalPending.has(requestId)) {
        globalPending.delete(requestId);
        reject(new Error('Request timed out'));
      }
    }, 60000);
  });
}

function getMessageType(itemType: string): 'agent' | 'thinking' | 'command' | 'command_output' | 'file_change' {
  const normalized = (itemType || '').toLowerCase();
  if (normalized.includes('reasoning')) return 'thinking';
  if (normalized.includes('commandoutput') || normalized.includes('shelloutput')) return 'command_output';
  if (normalized.includes('command') || normalized.includes('shellcommand')) return 'command';
  if (normalized.includes('filechange') || normalized.includes('codechange')) return 'file_change';

  switch (itemType) {
    case 'reasoning': return 'thinking';
    case 'command': case 'localShellCommand': return 'command';
    case 'commandOutput': case 'localShellOutput': return 'command_output';
    case 'fileChange': case 'codeChange': return 'file_change';
    default: return 'agent';
  }
}

function compactLabel(text: string, max = 44): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function parseNumberToken(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value;
}

function extractTokenUsage(data: Record<string, any>): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  const candidates = [
    data,
    data?.usage,
    data?.turn,
    data?.turn?.usage,
    data?.result,
    data?.result?.usage,
    data?.response,
    data?.response?.usage,
    data?.metrics,
    data?.metrics?.usage,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const c = candidate as Record<string, unknown>;
    const inputTokens = parseNumberToken(c.inputTokens) ?? parseNumberToken(c.prompt_tokens) ?? parseNumberToken(c.promptTokens);
    const outputTokens = parseNumberToken(c.outputTokens) ?? parseNumberToken(c.completion_tokens) ?? parseNumberToken(c.completionTokens);
    const totalTokens = parseNumberToken(c.totalTokens) ?? parseNumberToken(c.total_tokens);
    if (
      inputTokens !== undefined
      || outputTokens !== undefined
      || totalTokens !== undefined
    ) {
      const resolvedTotal = totalTokens ?? ((inputTokens || 0) + (outputTokens || 0) || undefined);
      return {
        inputTokens,
        outputTokens,
        totalTokens: resolvedTotal,
      };
    }
  }

  return {};
}

function extractTurnId(data: Record<string, any>): string | undefined {
  const candidates = [
    data?.turnId,
    data?.turn?.id,
    data?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function resolveModelForAgent(agentId: string): string {
  const agent = useAgentStore.getState().agents.find((entry) => entry.id === agentId);
  return agent?.model || 'unknown';
}

function buildTurnMetricId(agentId: string, startedAt: number, completedAt: number, turnId?: string): string {
  const turnPart = turnId || `${startedAt}`;
  return `turn:${agentId}:${turnPart}:${completedAt}`;
}

function getActivityLabelFromItem(item: Record<string, any> | undefined): string {
  const itemType = String(item?.type || '');
  const normalized = itemType.toLowerCase();
  if (normalized.includes('reasoning')) return 'Thinking';
  if (normalized.includes('agentmessage')) return 'Writing response';
  if (normalized.includes('commandoutput') || normalized.includes('shelloutput')) return 'Reading command output';
  if (normalized.includes('command') || normalized.includes('shellcommand')) {
    const command = compactLabel(String(item?.command || item?.text || ''));
    return command ? `Running: ${command}` : 'Running command';
  }
  if (normalized.includes('filechange') || normalized.includes('codechange')) return 'Applying file changes';

  switch (itemType) {
    case 'reasoning':
      return 'Thinking';
    case 'agentMessage':
      return 'Writing response';
    case 'command':
    case 'localShellCommand': {
      const command = compactLabel(String(item?.command || item?.text || ''));
      return command ? `Running: ${command}` : 'Running command';
    }
    case 'commandOutput':
    case 'localShellOutput':
      return 'Reading command output';
    case 'fileChange':
    case 'codeChange':
      return 'Applying file changes';
    default:
      return 'Working';
  }
}

async function deliverQueuedMessage(agentId: string, text: string) {
  const store = useAgentStore.getState();
  store.appendMessage(agentId, { role: 'user', type: 'user', text, timestamp: Date.now() });
  store.updateAgentStatus(agentId, 'working');
  store.updateAgentActivity(agentId, 'Thinking');
  await sendRequest('send_message', { agentId, text });
}

function reconcileThreadAgentIdIfChanged(previousAgentId: string, nextAgentId: string) {
  if (!previousAgentId || !nextAgentId || previousAgentId === nextAgentId) return;
  const workspaceStore = useWorkspaceStore.getState();
  const workspace = workspaceStore.workspaces.find((entry) =>
    entry.threads.some((thread) => thread.id === previousAgentId));
  if (!workspace) return;
  workspaceStore.replaceThreadAgentId(workspace.id, previousAgentId, nextAgentId);
}

async function flushQueuedIfReady(agentId: string) {
  if (queuedDispatchInFlight.has(agentId)) return;
  const store = useAgentStore.getState();
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent || agent.status !== 'ready') return;

  const nextQueued = store.dequeueQueuedMessage(agentId);
  if (!nextQueued) return;

  queuedDispatchInFlight.add(agentId);
  try {
    await deliverQueuedMessage(agentId, nextQueued.text);
  } catch {
    store.prependQueuedMessage(agentId, nextQueued);
    store.updateAgentActivity(agentId, 'Queued message retry pending');
  } finally {
    queuedDispatchInFlight.delete(agentId);
  }
}

function handleStreamEvent(agentId: string, event: string, data: unknown) {
  const store = useAgentStore.getState();
  const d = data as Record<string, any>;

  switch (event) {
    case 'turn/started': {
      const turnId = extractTurnId(d);
      activeTurnsByAgent.set(agentId, {
        turnId,
        startedAt: Date.now(),
        model: resolveModelForAgent(agentId),
        hadError: false,
      });
      store.updateAgentStatus(agentId, 'working');
      store.updateAgentActivity(agentId, 'Thinking');
      const agentForLA = store.agents.find((a) => a.id === agentId);
      void startAgentActivity(agentId, agentForLA?.name || 'Agent', 'Thinking');
      break;
    }
    case 'turn/completed': {
      const completedAt = Date.now();
      const turn = activeTurnsByAgent.get(agentId);
      const turnId = extractTurnId(d) || turn?.turnId;
      const model = turn?.model || resolveModelForAgent(agentId);
      const startedAt = turn?.startedAt || completedAt;
      const responseTimeMs = Math.max(0, completedAt - startedAt);
      const usage = extractTokenUsage(d);
      const hadError = !!d?.error || !!turn?.hadError;

      activeTurnsByAgent.delete(agentId);
      store.updateAgentStatus(agentId, 'ready');
      void stopAgentActivity(agentId, 'Completed');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void flushQueuedIfReady(agentId);
      break;
    }
    case 'turn/failed': {
      const completedAt = Date.now();
      const turn = activeTurnsByAgent.get(agentId);
      const turnId = extractTurnId(d) || turn?.turnId;
      const model = turn?.model || resolveModelForAgent(agentId);
      const startedAt = turn?.startedAt || completedAt;
      const responseTimeMs = Math.max(0, completedAt - startedAt);
      const usage = extractTokenUsage(d);

      activeTurnsByAgent.delete(agentId);
      store.updateAgentStatus(agentId, 'error');
      store.updateAgentActivity(agentId, 'Turn failed');
      void stopAgentActivity(agentId, 'Failed');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      break;
    }
    case 'item/started': {
      const item = d?.item;
      if (!item?.id) break;
      const activityLabel = getActivityLabelFromItem(item);
      store.updateAgentActivity(agentId, activityLabel);
      void updateAgentActivity(agentId, activityLabel);
      const msgType = getMessageType(item.type || '');
      // Show command being run
      if (msgType === 'command' && (item.command || item.text)) {
        store.appendDelta(agentId, item.id, item.command || item.text || '', 'command');
      }
      break;
    }
    case 'item/agentMessage/delta':
      if (d?.itemId && d?.delta) {
        store.updateAgentActivity(agentId, 'Writing response');
        void updateAgentActivity(agentId, 'Writing response');
        queueDelta(agentId, d.itemId, d.delta, 'agent');
      }
      break;
    case 'item/reasoning/delta':
      if (d?.itemId && d?.delta) {
        store.updateAgentActivity(agentId, 'Thinking');
        void updateAgentActivity(agentId, 'Thinking');
        queueDelta(agentId, d.itemId, d.delta, 'thinking');
      }
      break;
    case 'item/commandOutput/delta':
      if (d?.itemId && d?.delta) {
        store.updateAgentActivity(agentId, 'Reading command output');
        void updateAgentActivity(agentId, 'Reading command output');
        queueDelta(agentId, d.itemId, d.delta, 'command_output');
      }
      break;
    case 'item/completed': {
      flushPendingDeltas();
      const item = d?.item;
      if (!item?.id) break;
      const msgType = getMessageType(item.type || '');
      const text = item.text || item.command || item.output || item.path || '';
      if (text) {
        store.finalizeItem(agentId, item.id, text, msgType);
      }
      break;
    }
    case 'agent/stopped':
      activeTurnsByAgent.delete(agentId);
      store.updateAgentStatus(agentId, 'stopped');
      void stopAgentActivity(agentId, 'Stopped');
      break;
    default:
      if (event.includes('error') || event.includes('failed')) {
        const current = activeTurnsByAgent.get(agentId);
        if (current) {
          activeTurnsByAgent.set(agentId, { ...current, hadError: true });
        }
      }
      break;
  }
}

/** Standalone function callable outside React (e.g. from notification reply) */
export async function sendMessageToAgent(agentId: string, text: string) {
  const store = useAgentStore.getState();
  const trimmed = text.trim();
  if (!trimmed) return;

  const agent = store.agents.find((a) => a.id === agentId);
  if (agent?.status === 'working') {
    const queuedCount = store.enqueueQueuedMessage(agentId, trimmed);
    store.updateAgentActivity(agentId, `Queued ${queuedCount} message${queuedCount === 1 ? '' : 's'}`);
    return;
  }

  // Re-create stopped agents on bridge before sending
  if (agent?.status === 'stopped') {
    try {
      const res = await sendRequest('create_agent', {
        agentId,
        name: agent.name,
        model: agent.model,
        cwd: agent.cwd,
        approvalPolicy: agent.approvalPolicy,
        serviceTier: agent.serviceTier,
        reasoningEffort: agent.reasoningEffort,
        systemPrompt: agent.systemPrompt,
        codexThreadId: agent.codexThreadId,
      });
      if (res.type === 'response' && res.data) {
        const newAgent = res.data as Agent;
        const agents = store.agents.map((a) =>
          a.id === agentId
            ? { ...a, id: newAgent.id, status: newAgent.status as Agent['status'], threadId: newAgent.threadId, currentTurnId: null }
            : a,
        );
        store.setAgents(agents);
        reconcileThreadAgentIdIfChanged(agentId, newAgent.id);
        await deliverQueuedMessage(newAgent.id, trimmed);
        return;
      }
    } catch {
      // Can't restart — ignore from notification context
      return;
    }
  }

  await deliverQueuedMessage(agentId, trimmed);
}

export function useWebSocket() {
  const bridgeUrl = useAgentStore((s) => s.bridgeUrl);
  const bridgeApiKey = useAgentStore((s) => s.bridgeApiKey);
  const clientId = useAgentStore((s) => s.clientId);

  useEffect(() => {
    connectWs(bridgeUrl);
    return () => cleanup();
  }, [bridgeUrl, bridgeApiKey, clientId]);

  const send = useCallback(
    async (action: string, params?: Record<string, unknown>): Promise<BridgeResponse> => {
      const response = await sendRequest(action, params);
      if (response.type === 'error') {
        throw new Error(response.error || `Bridge action failed: ${action}`);
      }
      return response;
    },
    [],
  );

  const createAgent = useCallback(
    async (
      name: string,
      model: string,
      cwd: string,
      config?: {
        approvalPolicy?: string;
        serviceTier?: string;
        reasoningEffort?: string;
        systemPrompt?: string;
        codexThreadId?: string;
      },
    ) => {
      const res = await send('create_agent', {
        name,
        model,
        cwd,
        approvalPolicy: config?.approvalPolicy,
        serviceTier: config?.serviceTier,
        reasoningEffort: config?.reasoningEffort,
        systemPrompt: config?.systemPrompt,
        codexThreadId: config?.codexThreadId,
      });
      if (res.type === 'response' && res.data) {
        useAgentStore.getState().addAgent(res.data as Agent);
        return res.data as Agent;
      }
      throw new Error(res.error || 'Failed to create agent');
    },
    [send],
  );

  const sendMessage = useCallback(
    async (agentId: string, text: string) => {
      const store = useAgentStore.getState();
      const trimmed = text.trim();
      if (!trimmed) return;

      const agent = store.agents.find((a) => a.id === agentId);
      if (store.connectionStatus !== 'connected') {
        const queuedCount = store.enqueueQueuedMessage(agentId, trimmed);
        store.updateAgentActivity(agentId, `Offline queue (${queuedCount})`);
        return;
      }
      if (agent?.status === 'working') {
        const queuedCount = store.enqueueQueuedMessage(agentId, trimmed);
        store.updateAgentActivity(agentId, `Queued ${queuedCount} message${queuedCount === 1 ? '' : 's'}`);
        return;
      }

      // If agent is stopped (e.g. after app/bridge restart), re-create it on the bridge
      if (agent?.status === 'stopped') {
        store.updateAgentActivity(agentId, 'Reconnecting agent...');
        try {
          const res = await sendRequest('create_agent', {
            agentId,
            name: agent.name,
            model: agent.model,
            cwd: agent.cwd,
            approvalPolicy: agent.approvalPolicy,
            serviceTier: agent.serviceTier,
            reasoningEffort: agent.reasoningEffort,
            systemPrompt: agent.systemPrompt,
            codexThreadId: agent.codexThreadId,
          });
          if (res.type === 'response' && res.data) {
            const newAgent = res.data as Agent;
            // Update the existing agent entry with the new bridge ID and status
            // We keep the old messages but update connection info
            const agents = store.agents.map((a) =>
              a.id === agentId
                ? { ...a, id: newAgent.id, status: newAgent.status as Agent['status'], threadId: newAgent.threadId, currentTurnId: null }
                : a,
            );
            store.setAgents(agents);
            reconcileThreadAgentIdIfChanged(agentId, newAgent.id);
            // Send the message to the new agent
            await deliverQueuedMessage(newAgent.id, trimmed);
            return;
          }
        } catch {
          store.updateAgentActivity(agentId, undefined);
          throw new Error('Agent is stopped and could not be restarted. Create a new agent.');
        }
      }

      await deliverQueuedMessage(agentId, trimmed);
    },
    [],
  );

  const stopAgent = useCallback(
    async (agentId: string) => {
      await send('stop_agent', { agentId });
      useAgentStore.getState().updateAgentStatus(agentId, 'stopped');
    },
    [send],
  );

  const updateAgentModel = useCallback(
    async (agentId: string, model: string) => {
      const trimmedModel = model.trim();
      if (!trimmedModel) throw new Error('Model cannot be empty');
      await send('update_agent_model', { agentId, model: trimmedModel });
      useAgentStore.getState().updateAgentModel(agentId, trimmedModel);
    },
    [send],
  );

  const updateAgentConfig = useCallback(
    async (agentId: string, config: { model?: string; cwd?: string; approvalPolicy?: string; serviceTier?: string; reasoningEffort?: string; systemPrompt?: string }) => {
      await send('update_agent_config', { agentId, ...config });
      const store = useAgentStore.getState();
      const agents = store.agents.map((agent) =>
        agent.id === agentId
          ? {
            ...agent,
            ...(config.model?.trim() ? { model: config.model.trim() } : {}),
            ...(config.cwd?.trim() ? { cwd: config.cwd.trim() } : {}),
            ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
            ...(config.serviceTier ? { serviceTier: config.serviceTier } : {}),
            ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
            ...(config.systemPrompt !== undefined ? { systemPrompt: config.systemPrompt } : {}),
          }
          : agent,
      );
      store.setAgents(agents);
    },
    [send],
  );

  const listCodexModels = useCallback(async (): Promise<CodexModelInfo[]> => {
    const res = await send('list_codex_models');
    const data = unwrapBridgeData<CodexModelInfo[]>(res.data);
    return Array.isArray(data) ? data : [];
  }, [send]);

  const readCodexThread = useCallback(async (threadId: string): Promise<CodexThreadDetail | null> => {
    const res = await send('read_codex_thread', { threadId });
    const data = unwrapBridgeData<CodexThreadDetail>(res.data);
    return data && typeof data === 'object' ? data : null;
  }, [send]);

  const interruptAgent = useCallback(
    async (agentId: string) => {
      await send('interrupt', { agentId });
    },
    [send],
  );

  const refreshCodexSessions = useCallback(async () => {
    syncAgents();
    await syncCodexThreads();
  }, []);

  return {
    send,
    createAgent,
    sendMessage,
    stopAgent,
    interruptAgent,
    updateAgentModel,
    updateAgentConfig,
    listCodexModels,
    readCodexThread,
    refreshCodexSessions,
  };
}
