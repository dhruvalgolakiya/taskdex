import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentWorkspace } from '../types';

const WORKSPACES_KEY = 'codex_workspaces_v1';

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface WorkspaceStore {
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  loaded: boolean;

  loadSavedWorkspaces: () => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => void;
  createWorkspace: (params: {
    name: string;
    model: string;
    cwd: string;
    firstThreadAgentId: string;
    firstThreadTitle?: string;
  }) => string;
  addThreadToWorkspace: (params: {
    workspaceId: string;
    threadAgentId: string;
    title?: string;
    makeActive?: boolean;
  }) => void;
  setActiveThread: (workspaceId: string, threadAgentId: string) => void;
  updateWorkspaceModel: (workspaceId: string, model: string) => void;
  ensureWorkspacesFromAgents: (
    agents: { id: string; name: string; model: string; cwd: string }[],
  ) => void;
  removeThreadFromWorkspace: (workspaceId: string, threadAgentId: string) => void;
  cleanupMissingAgentThreads: (agentIds: string[]) => void;
}

function persist(workspaces: AgentWorkspace[], activeWorkspaceId: string | null) {
  AsyncStorage.setItem(
    WORKSPACES_KEY,
    JSON.stringify({ workspaces, activeWorkspaceId }),
  ).catch(() => {});
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loaded: false,

  loadSavedWorkspaces: async () => {
    try {
      const raw = await AsyncStorage.getItem(WORKSPACES_KEY);
      if (!raw) {
        set({ loaded: true });
        return;
      }
      const parsed = JSON.parse(raw) as {
        workspaces?: AgentWorkspace[];
        activeWorkspaceId?: string | null;
      };
      const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
      const activeWorkspaceId = parsed.activeWorkspaceId || workspaces[0]?.id || null;
      set({ workspaces, activeWorkspaceId, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setActiveWorkspace: (workspaceId) => {
    const { workspaces } = get();
    if (!workspaces.find((w) => w.id === workspaceId)) return;
    set({ activeWorkspaceId: workspaceId });
    persist(workspaces, workspaceId);
  },

  createWorkspace: ({ name, model, cwd, firstThreadAgentId, firstThreadTitle }) => {
    const threadTitle = firstThreadTitle?.trim() || 'Thread 1';
    const now = Date.now();
    const workspace: AgentWorkspace = {
      id: createId('ws'),
      name: name.trim() || 'Agent',
      model: model.trim() || 'gpt-5.1-codex',
      cwd: cwd.trim() || '.',
      threads: [{ id: firstThreadAgentId, title: threadTitle, createdAt: now }],
      activeThreadId: firstThreadAgentId,
      createdAt: now,
      updatedAt: now,
    };

    const workspaces = [...get().workspaces, workspace];
    set({ workspaces, activeWorkspaceId: workspace.id });
    persist(workspaces, workspace.id);
    return workspace.id;
  },

  addThreadToWorkspace: ({ workspaceId, threadAgentId, title, makeActive = true }) => {
    const workspaces = get().workspaces.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      if (workspace.threads.some((t) => t.id === threadAgentId)) return workspace;
      const nextIndex = workspace.threads.length + 1;
      const threadTitle = title?.trim() || `Thread ${nextIndex}`;
      const threads = [
        ...workspace.threads,
        { id: threadAgentId, title: threadTitle, createdAt: Date.now() },
      ];
      return {
        ...workspace,
        threads,
        activeThreadId: makeActive ? threadAgentId : workspace.activeThreadId,
        updatedAt: Date.now(),
      };
    });
    set({ workspaces });
    persist(workspaces, get().activeWorkspaceId);
  },

  setActiveThread: (workspaceId, threadAgentId) => {
    const workspaces = get().workspaces.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      if (!workspace.threads.some((t) => t.id === threadAgentId)) return workspace;
      return { ...workspace, activeThreadId: threadAgentId, updatedAt: Date.now() };
    });
    set({ workspaces });
    persist(workspaces, get().activeWorkspaceId);
  },

  updateWorkspaceModel: (workspaceId, model) => {
    const trimmedModel = model.trim();
    if (!trimmedModel) return;
    const workspaces = get().workspaces.map((workspace) =>
      workspace.id === workspaceId
        ? { ...workspace, model: trimmedModel, updatedAt: Date.now() }
        : workspace,
    );
    set({ workspaces });
    persist(workspaces, get().activeWorkspaceId);
  },

  ensureWorkspacesFromAgents: (agents) => {
    if (!agents.length) return;
    const current = get().workspaces;
    if (current.length > 0) return;

    const now = Date.now();
    const workspaces: AgentWorkspace[] = agents.map((agent) => ({
      id: createId('ws'),
      name: agent.name,
      model: agent.model,
      cwd: agent.cwd,
      threads: [{ id: agent.id, title: 'Thread 1', createdAt: now }],
      activeThreadId: agent.id,
      createdAt: now,
      updatedAt: now,
    }));

    const activeWorkspaceId = workspaces[0]?.id || null;
    set({ workspaces, activeWorkspaceId });
    persist(workspaces, activeWorkspaceId);
  },

  removeThreadFromWorkspace: (workspaceId, threadAgentId) => {
    const prevActiveWorkspaceId = get().activeWorkspaceId;
    const workspaces = get().workspaces
      .map((workspace) => {
        if (workspace.id !== workspaceId) return workspace;
        const threads = workspace.threads.filter((t) => t.id !== threadAgentId);
        const activeThreadId = workspace.activeThreadId === threadAgentId
          ? threads[0]?.id || null
          : workspace.activeThreadId;
        return { ...workspace, threads, activeThreadId, updatedAt: Date.now() };
      })
      .filter((workspace) => workspace.threads.length > 0);

    const activeWorkspaceExists = prevActiveWorkspaceId
      ? workspaces.some((w) => w.id === prevActiveWorkspaceId)
      : false;
    const activeWorkspaceId = activeWorkspaceExists
      ? prevActiveWorkspaceId
      : (workspaces[0]?.id || null);

    set({ workspaces, activeWorkspaceId });
    persist(workspaces, activeWorkspaceId);
  },

  cleanupMissingAgentThreads: (agentIds) => {
    const idSet = new Set(agentIds);
    const prevActiveWorkspaceId = get().activeWorkspaceId;
    const workspaces = get().workspaces
      .map((workspace) => {
        const threads = workspace.threads.filter((t) => idSet.has(t.id));
        const activeThreadId = threads.some((t) => t.id === workspace.activeThreadId)
          ? workspace.activeThreadId
          : (threads[0]?.id || null);
        return { ...workspace, threads, activeThreadId };
      })
      .filter((workspace) => workspace.threads.length > 0);

    const activeWorkspaceExists = prevActiveWorkspaceId
      ? workspaces.some((w) => w.id === prevActiveWorkspaceId)
      : false;
    const activeWorkspaceId = activeWorkspaceExists
      ? prevActiveWorkspaceId
      : (workspaces[0]?.id || null);

    set({ workspaces, activeWorkspaceId });
    persist(workspaces, activeWorkspaceId);
  },
}));
