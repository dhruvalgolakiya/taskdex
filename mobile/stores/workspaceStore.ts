import { create } from 'zustand';
import type { AgentWorkspace, ReasoningEffort, ServiceTier } from '../types';

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
    approvalPolicy?: string;
    serviceTier?: ServiceTier;
    reasoningEffort?: ReasoningEffort;
    systemPrompt?: string;
    templateId?: string;
    templateIcon?: string;
    firstThreadAgentId: string;
    firstThreadTitle?: string;
    makeActive?: boolean;
  }) => string;
  addThreadToWorkspace: (params: {
    workspaceId: string;
    threadAgentId: string;
    title?: string;
    makeActive?: boolean;
  }) => void;
  setActiveThread: (workspaceId: string, threadAgentId: string) => void;
  updateWorkspaceModel: (workspaceId: string, model: string) => void;
  updateWorkspaceConfig: (
    workspaceId: string,
    config: Partial<Pick<AgentWorkspace, 'model' | 'cwd' | 'approvalPolicy' | 'serviceTier' | 'reasoningEffort' | 'systemPrompt' | 'templateId' | 'templateIcon'>>,
  ) => void;
  replaceWorkspaces: (workspaces: AgentWorkspace[]) => void;
  ensureWorkspacesFromAgents: (
    agents: { id: string; name: string; model: string; cwd: string; approvalPolicy?: string; serviceTier?: ServiceTier; reasoningEffort?: ReasoningEffort; systemPrompt?: string }[],
  ) => void;
  removeThreadFromWorkspace: (workspaceId: string, threadAgentId: string) => void;
  replaceThreadAgentId: (workspaceId: string, oldThreadAgentId: string, newThreadAgentId: string) => void;
  cleanupMissingAgentThreads: (agentIds: string[]) => void;
}

function persist(workspaces: AgentWorkspace[], activeWorkspaceId: string | null) {
  void workspaces;
  void activeWorkspaceId;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loaded: false,

  loadSavedWorkspaces: async () => {
    set({ workspaces: [], activeWorkspaceId: null, loaded: true });
  },

  setActiveWorkspace: (workspaceId) => {
    const { workspaces } = get();
    if (!workspaces.find((w) => w.id === workspaceId)) return;
    set({ activeWorkspaceId: workspaceId });
    persist(workspaces, workspaceId);
  },

  createWorkspace: ({
    name,
    model,
    cwd,
    approvalPolicy,
    serviceTier,
    reasoningEffort,
    systemPrompt,
    templateId,
    templateIcon,
    firstThreadAgentId,
    firstThreadTitle,
    makeActive = true,
  }) => {
    const threadTitle = firstThreadTitle?.trim() || 'Thread 1';
    const now = Date.now();
    const workspace: AgentWorkspace = {
      id: createId('ws'),
      name: name.trim() || 'Agent',
      model: model.trim() || 'gpt-5.1-codex',
      cwd: cwd.trim() || '.',
      approvalPolicy: approvalPolicy || 'never',
      serviceTier: serviceTier || 'fast',
      reasoningEffort: reasoningEffort || 'medium',
      systemPrompt: systemPrompt || '',
      templateId,
      templateIcon,
      threads: [{ id: firstThreadAgentId, title: threadTitle, createdAt: now }],
      activeThreadId: firstThreadAgentId,
      createdAt: now,
      updatedAt: now,
    };

    const workspaces = [...get().workspaces, workspace];
    const nextActiveWorkspaceId = makeActive ? workspace.id : (get().activeWorkspaceId || workspace.id);
    set({ workspaces, activeWorkspaceId: nextActiveWorkspaceId });
    persist(workspaces, nextActiveWorkspaceId);
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

  updateWorkspaceConfig: (workspaceId, config) => {
    const workspaces = get().workspaces.map((workspace) =>
      workspace.id === workspaceId
        ? {
          ...workspace,
          ...config,
          model: config.model?.trim() || workspace.model,
      cwd: config.cwd?.trim() || workspace.cwd,
          serviceTier: config.serviceTier || workspace.serviceTier,
          reasoningEffort: config.reasoningEffort || workspace.reasoningEffort,
          updatedAt: Date.now(),
        }
        : workspace,
    );
    set({ workspaces });
    persist(workspaces, get().activeWorkspaceId);
  },

  replaceWorkspaces: (workspaces) => {
    const prevActiveWorkspaceId = get().activeWorkspaceId;
    const activeWorkspaceId = prevActiveWorkspaceId && workspaces.some((workspace) => workspace.id === prevActiveWorkspaceId)
      ? prevActiveWorkspaceId
      : (workspaces[0]?.id || null);
    set({ workspaces, activeWorkspaceId });
    persist(workspaces, activeWorkspaceId);
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
      approvalPolicy: agent.approvalPolicy || 'never',
      serviceTier: agent.serviceTier || 'fast',
      reasoningEffort: agent.reasoningEffort || 'medium',
      systemPrompt: agent.systemPrompt || '',
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

  replaceThreadAgentId: (workspaceId, oldThreadAgentId, newThreadAgentId) => {
    const workspaces = get().workspaces.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      const threads = workspace.threads.map((thread) =>
        thread.id === oldThreadAgentId ? { ...thread, id: newThreadAgentId } : thread,
      );
      const activeThreadId = workspace.activeThreadId === oldThreadAgentId
        ? newThreadAgentId
        : workspace.activeThreadId;
      return { ...workspace, threads, activeThreadId, updatedAt: Date.now() };
    });
    set({ workspaces });
    persist(workspaces, get().activeWorkspaceId);
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
