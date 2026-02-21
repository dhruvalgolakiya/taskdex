import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Agent, AgentMessage, AgentStatus, MessageType, QueuedMessage } from '../types';
import { persistMessage } from '../lib/convexClient';

const BRIDGE_URL_KEY = 'codex_bridge_url';
const AGENTS_KEY = 'codex_agents';

interface AgentStore {
  agents: Agent[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  bridgeUrl: string;
  urlLoaded: boolean;
  agentsLoaded: boolean;

  setConnectionStatus: (status: AgentStore['connectionStatus']) => void;
  setBridgeUrl: (url: string) => void;
  loadBridgeUrl: () => Promise<void>;
  loadSavedAgents: () => Promise<void>;
  setAgents: (agents: Agent[]) => void;
  mergeWithBridgeAgents: (bridgeAgents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  updateAgentActivity: (agentId: string, activityLabel?: string) => void;
  updateAgentModel: (agentId: string, model: string) => void;
  enqueueQueuedMessage: (agentId: string, text: string) => number;
  prependQueuedMessage: (agentId: string, message: QueuedMessage) => void;
  dequeueQueuedMessage: (agentId: string) => QueuedMessage | null;
  peekQueuedMessage: (agentId: string) => QueuedMessage | null;
  updateQueuedMessage: (agentId: string, queueId: string, text: string) => void;
  removeQueuedMessage: (agentId: string, queueId: string) => void;
  moveQueuedMessage: (agentId: string, queueId: string, direction: -1 | 1) => void;
  clearQueuedMessages: (agentId: string) => void;
  appendMessage: (agentId: string, message: AgentMessage) => void;
  appendDelta: (agentId: string, itemId: string, delta: string, msgType: MessageType) => void;
  finalizeItem: (agentId: string, itemId: string, text: string, msgType: MessageType) => void;
}

function saveAgents(agents: Agent[]) {
  const persisted = agents.map(({ activityLabel: _activityLabel, ...agent }) => agent);
  AsyncStorage.setItem(AGENTS_KEY, JSON.stringify(persisted)).catch(() => {});
}

function createQueuedMessage(text: string): QueuedMessage {
  return {
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: Date.now(),
  };
}

function normalizeQueuedMessages(input: unknown): QueuedMessage[] {
  if (!Array.isArray(input)) return [];
  const result: QueuedMessage[] = [];
  for (const entry of input) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) result.push(createQueuedMessage(trimmed));
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const queued = entry as Partial<QueuedMessage> & { text?: unknown };
    const text = typeof queued.text === 'string' ? queued.text.trim() : '';
    if (!text) continue;
    result.push({
      id: typeof queued.id === 'string' && queued.id ? queued.id : createQueuedMessage(text).id,
      text,
      createdAt: typeof queued.createdAt === 'number' ? queued.createdAt : Date.now(),
    });
  }
  return result;
}

function mergeAgentRecords(base: Agent, incoming: Agent): Agent {
  const baseMessages = base.messages || [];
  const incomingMessages = incoming.messages || [];
  const baseQueued = normalizeQueuedMessages(base.queuedMessages);
  const incomingQueued = normalizeQueuedMessages(incoming.queuedMessages);
  const messages = incomingMessages.length >= baseMessages.length ? incomingMessages : baseMessages;

  return {
    ...base,
    ...incoming,
    // Keep whichever copy has more history if duplicates appear.
    messages,
    queuedMessages: baseQueued.length ? baseQueued : incomingQueued,
    status: incoming.status === 'stopped' && base.status !== 'stopped' ? base.status : incoming.status,
  };
}

function dedupeAgents(agents: Agent[]): Agent[] {
  const map = new Map<string, Agent>();
  for (const agent of agents) {
    const existing = map.get(agent.id);
    map.set(agent.id, existing ? mergeAgentRecords(existing, agent) : agent);
  }
  return Array.from(map.values());
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  connectionStatus: 'disconnected',
  bridgeUrl: 'ws://localhost:3001',
  urlLoaded: false,
  agentsLoaded: false,

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setBridgeUrl: (url) => {
    AsyncStorage.setItem(BRIDGE_URL_KEY, url);
    set({ bridgeUrl: url });
  },

  loadBridgeUrl: async () => {
    const saved = await AsyncStorage.getItem(BRIDGE_URL_KEY);
    if (saved) {
      set({ bridgeUrl: saved, urlLoaded: true });
    } else {
      set({ urlLoaded: true });
    }
  },

  loadSavedAgents: async () => {
    try {
      const saved = await AsyncStorage.getItem(AGENTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Agent[];
        // Mark all loaded agents as stopped initially (bridge will update live ones)
        const agents = dedupeAgents(parsed.map((a) => ({
          ...a,
          status: 'stopped' as AgentStatus,
          queuedMessages: normalizeQueuedMessages(a.queuedMessages),
        })));
        set({ agents, agentsLoaded: true });
      } else {
        set({ agentsLoaded: true });
      }
    } catch {
      set({ agentsLoaded: true });
    }
  },

  setAgents: (agents) => {
    const deduped = dedupeAgents(agents);
    set({ agents: deduped });
    saveAgents(deduped);
  },

  // Merge bridge agents with locally saved agents
  mergeWithBridgeAgents: (bridgeAgents) => {
    const local = dedupeAgents(get().agents);
    const normalizedBridgeAgents = dedupeAgents(bridgeAgents);
    const bridgeMap = new Map(normalizedBridgeAgents.map((a) => [a.id, a]));
    const merged: Agent[] = [];
    const seen = new Set<string>();

    // Update local agents with bridge status
    for (const localAgent of local) {
      const bridgeAgent = bridgeMap.get(localAgent.id);
      if (bridgeAgent) {
        // Agent still alive on bridge — use bridge status, keep local messages
        merged.push({
          ...bridgeAgent,
          messages: localAgent.messages.length > bridgeAgent.messages.length
            ? localAgent.messages
            : bridgeAgent.messages,
          queuedMessages: normalizeQueuedMessages(localAgent.queuedMessages).length
            ? normalizeQueuedMessages(localAgent.queuedMessages)
            : normalizeQueuedMessages(bridgeAgent.queuedMessages),
        });
      } else {
        // Agent not on bridge — mark stopped, keep for history
        merged.push({
          ...localAgent,
          status: 'stopped',
          queuedMessages: normalizeQueuedMessages(localAgent.queuedMessages),
        });
      }
      seen.add(localAgent.id);
    }

    // Add any bridge agents we don't have locally
    for (const bridgeAgent of normalizedBridgeAgents) {
      if (!seen.has(bridgeAgent.id)) {
        merged.push({
          ...bridgeAgent,
          queuedMessages: normalizeQueuedMessages(bridgeAgent.queuedMessages),
        });
      }
    }

    const deduped = dedupeAgents(merged);
    set({ agents: deduped });
    saveAgents(deduped);
  },

  addAgent: (agent) => {
    const agents = dedupeAgents([
      ...get().agents,
      { ...agent, queuedMessages: normalizeQueuedMessages(agent.queuedMessages) },
    ]);
    set({ agents });
    saveAgents(agents);
  },

  removeAgent: (agentId) => {
    const agents = get().agents.filter((a) => a.id !== agentId);
    set({ agents });
    saveAgents(agents);
  },

  updateAgentStatus: (agentId, status) => {
    const current = get().agents;
    let changed = false;
    const agents = current.map((a) => {
      if (a.id !== agentId) return a;
      const nextActivity = status === 'working' ? a.activityLabel : undefined;
      if (a.status === status && a.activityLabel === nextActivity) return a;
      changed = true;
      return {
        ...a,
        status,
        activityLabel: nextActivity,
      };
    });
    if (!changed) return;
    set({ agents });
    saveAgents(agents);
  },

  updateAgentActivity: (agentId, activityLabel) => {
    const current = get().agents;
    let changed = false;
    const agents = current.map((a) => {
      if (a.id !== agentId) return a;
      if (a.activityLabel === activityLabel) return a;
      changed = true;
      return { ...a, activityLabel };
    });
    if (!changed) return;
    set({ agents });
  },

  updateAgentModel: (agentId, model) => {
    const agents = get().agents.map((a) =>
      a.id === agentId ? { ...a, model } : a,
    );
    set({ agents });
    saveAgents(agents);
  },

  enqueueQueuedMessage: (agentId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    let nextLength = 0;
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const queuedMessages = [...normalizeQueuedMessages(a.queuedMessages), createQueuedMessage(trimmed)];
      nextLength = queuedMessages.length;
      return { ...a, queuedMessages };
    });
    set({ agents });
    saveAgents(agents);
    return nextLength;
  },

  prependQueuedMessage: (agentId, message) => {
    const trimmed = (message?.text || '').trim();
    if (!trimmed) return;
    const nextItem: QueuedMessage = {
      id: message.id || createQueuedMessage(trimmed).id,
      text: trimmed,
      createdAt: message.createdAt || Date.now(),
    };
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const queuedMessages = [nextItem, ...normalizeQueuedMessages(a.queuedMessages)];
      return { ...a, queuedMessages };
    });
    set({ agents });
    saveAgents(agents);
  },

  dequeueQueuedMessage: (agentId) => {
    let dequeued: QueuedMessage | null = null;
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const queuedMessages = normalizeQueuedMessages(a.queuedMessages);
      if (!queuedMessages.length) return a;
      dequeued = queuedMessages[0] || null;
      return { ...a, queuedMessages: queuedMessages.slice(1) };
    });
    if (dequeued !== null) {
      set({ agents });
      saveAgents(agents);
    }
    return dequeued;
  },

  peekQueuedMessage: (agentId) => {
    const agent = get().agents.find((a) => a.id === agentId);
    return normalizeQueuedMessages(agent?.queuedMessages)[0] || null;
  },

  updateQueuedMessage: (agentId, queueId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const queuedMessages = normalizeQueuedMessages(a.queuedMessages).map((item) =>
        item.id === queueId ? { ...item, text: trimmed } : item,
      );
      return { ...a, queuedMessages };
    });
    set({ agents });
    saveAgents(agents);
  },

  removeQueuedMessage: (agentId, queueId) => {
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const queuedMessages = normalizeQueuedMessages(a.queuedMessages).filter((item) => item.id !== queueId);
      return { ...a, queuedMessages };
    });
    set({ agents });
    saveAgents(agents);
  },

  moveQueuedMessage: (agentId, queueId, direction) => {
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const queuedMessages = [...normalizeQueuedMessages(a.queuedMessages)];
      const index = queuedMessages.findIndex((item) => item.id === queueId);
      if (index < 0) return a;
      const target = index + direction;
      if (target < 0 || target >= queuedMessages.length) return a;
      const [entry] = queuedMessages.splice(index, 1);
      queuedMessages.splice(target, 0, entry);
      return { ...a, queuedMessages };
    });
    set({ agents });
    saveAgents(agents);
  },

  clearQueuedMessages: (agentId) => {
    const agents = get().agents.map((a) =>
      a.id === agentId ? { ...a, queuedMessages: [] } : a,
    );
    set({ agents });
    saveAgents(agents);
  },

  appendMessage: (agentId, message) => {
    const agents = get().agents.map((a) =>
      a.id === agentId ? { ...a, messages: [...a.messages, message] } : a,
    );
    set({ agents });
    saveAgents(agents);
    void persistMessage(agentId, message);
  },

  appendDelta: (agentId, itemId, delta, msgType) => {
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const messages = [...a.messages];
      let existingIdx = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?._itemId === itemId) {
          existingIdx = i;
          break;
        }
      }

      if (existingIdx >= 0) {
        const existing = messages[existingIdx];
        messages[existingIdx] = {
          ...existing,
          role: 'agent',
          type: msgType,
          text: (existing.text || '') + delta,
          streaming: true,
        };
      } else {
        messages.push({
          role: 'agent',
          type: msgType,
          text: delta,
          timestamp: Date.now(),
          _itemId: itemId,
          streaming: true,
        });
      }
      return { ...a, messages };
    });
    set({ agents });
    // Don't save on every delta — too frequent. Save on finalize instead.
  },

  finalizeItem: (agentId, itemId, text, msgType) => {
    let finalizedMessage: AgentMessage | null = null;
    const agents = get().agents.map((a) => {
      if (a.id !== agentId) return a;
      const messages = [...a.messages];
      const matchingIndexes: number[] = [];
      for (let i = 0; i < messages.length; i += 1) {
        if (messages[i]?._itemId === itemId) matchingIndexes.push(i);
      }

      if (matchingIndexes.length > 0) {
        const keepIdx = matchingIndexes[0];
        messages[keepIdx] = {
          ...messages[keepIdx],
          text,
          type: msgType,
          streaming: false,
        };
        finalizedMessage = messages[keepIdx];
        // Guard against legacy duplicate fragments for the same item.
        for (let i = matchingIndexes.length - 1; i >= 1; i -= 1) {
          messages.splice(matchingIndexes[i], 1);
        }
      } else if (text) {
        const nextMessage: AgentMessage = {
          role: 'agent',
          type: msgType,
          text,
          timestamp: Date.now(),
          _itemId: itemId,
          streaming: false,
        };
        messages.push(nextMessage);
        finalizedMessage = nextMessage;
      }
      return { ...a, messages };
    });
    set({ agents });
    saveAgents(agents);
    if (finalizedMessage) {
      void persistMessage(agentId, finalizedMessage);
    }
  },
}));
