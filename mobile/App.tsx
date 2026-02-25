import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useColorScheme,
  AppState,
  Share,
  Linking,
  LayoutAnimation,
  UIManager,
  Keyboard,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { ConvexProvider, useQuery } from 'convex/react';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { useAgentStore } from './stores/agentStore';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useThemeStore } from './stores/themeStore';
import { useWebSocket, sendMessageToAgent, sendRequest } from './hooks/useWebSocket';
import { ChatBubble } from './components/ChatBubble';
import { QueuePanel } from './components/QueuePanel';
import { MessageInput } from './components/MessageInput';
import { TypingIndicator } from './components/TypingIndicator';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { setWidgetSummary, clearWidgetSummary } from 'taskdex-widget-bridge';
import type { Agent, AgentMessage, QueuedMessage, AgentTemplate } from './types';
import { api } from './convex/_generated/api';
import SyntaxHighlighter from 'react-native-syntax-highlighter';
import atomOneDark from 'react-syntax-highlighter/styles/hljs/atom-one-dark';
import atomOneLight from 'react-syntax-highlighter/styles/hljs/atom-one-light';
import {
  convexClient,
  fetchThreadMessages,
  deletePersistedMessage,
  persistWorkspaceRecord,
  persistThreadRecord,
  persistTemplateRecord,
} from './lib/convexClient';
import {
  getConnectionColors,
  getPalette,
  getStatusColors,
  resolveThemeMode,
  type Palette,
  type ThemeMode,
  type ThemePreference,
  typography,
} from './theme';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    const agentId = typeof data?.agentId === 'string' ? data.agentId : '';

    // Suppress push if the same thread is currently open in foreground
    if (AppState.currentState === 'active' && agentId) {
      const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
      const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0];
      const activeThreadId = activeWorkspace?.activeThreadId || activeWorkspace?.threads[0]?.id || '';
      if (activeThreadId === agentId) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
    }

    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

const ONBOARDING_DONE_KEY = 'taskdex_onboarding_done_v1';
const BRIDGE_START_COMMAND = 'npx taskdex setup';

function getConnectionLabel(status: string) {
  if (status === 'connected') return 'Connected to bridge';
  if (status === 'connecting') return 'Connecting to bridge...';
  return 'Disconnected from bridge';
}

function formatNotificationTimestamp(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function extractThreadIdFromUrl(url: string): string | null {
  const directMatch = url.match(/thread\/([^/?#]+)/i);
  if (directMatch?.[1]) {
    return decodeURIComponent(directMatch[1]);
  }
  const queryMatch = url.match(/[?&](threadId|agentId)=([^&#]+)/i);
  if (queryMatch?.[2]) {
    return decodeURIComponent(queryMatch[2]);
  }
  return null;
}

function parseBridgeQrPayload(raw: string): { bridgeUrl: string; apiKey: string } | null {
  try {
    const normalized = raw.trim();
    const queryMatch = normalized.match(/[?&]bridgeUrl=([^&#]+)/i);
    const keyMatch = normalized.match(/[?&]apiKey=([^&#]+)/i);
    if (queryMatch?.[1] && keyMatch?.[1]) {
      return {
        bridgeUrl: decodeURIComponent(queryMatch[1]),
        apiKey: decodeURIComponent(keyMatch[1]),
      };
    }

    if (normalized.startsWith('{') && normalized.endsWith('}')) {
      const parsed = JSON.parse(normalized) as { url?: string; bridgeUrl?: string; key?: string; apiKey?: string };
      const bridgeUrl = parsed.bridgeUrl || parsed.url || '';
      const apiKey = parsed.apiKey || parsed.key || '';
      if (bridgeUrl && apiKey) return { bridgeUrl, apiKey };
    }
  } catch {}
  return null;
}

function toUserErrorMessage(error: unknown, fallback: string): string {
  const raw = typeof error === 'string'
    ? error
    : (typeof (error as any)?.message === 'string' ? (error as any).message : '');
  const normalized = raw.toLowerCase();
  if (normalized.includes('not connected') || normalized.includes('websocket')) {
    return 'Bridge connection is unavailable. Check bridge URL, API key, and network reachability.';
  }
  if (normalized.includes('timed out')) {
    return 'The request timed out. Please try again in a moment.';
  }
  if (normalized.includes('unauthorized') || normalized.includes('api key')) {
    return 'Authentication failed. Verify your bridge API key in settings.';
  }
  if (normalized.includes('path escapes')) {
    return 'The selected path is outside the allowed workspace directory.';
  }
  if (raw.trim()) return raw;
  return fallback;
}

function guessLanguageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.sh')) return 'bash';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  return 'text';
}

const BUILT_IN_TEMPLATES: AgentTemplate[] = [
  {
    id: 'builtin_bug_fixer',
    name: 'Bug Fixer',
    model: 'gpt-5.1-codex',
    promptPrefix: 'Focus on root-cause debugging, minimal safe fixes, and regression checks.',
    icon: 'bug',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin_code_reviewer',
    name: 'Code Reviewer',
    model: 'gpt-5.1-codex',
    promptPrefix: 'Prioritize correctness risks, edge cases, and missing tests with actionable fixes.',
    icon: 'review',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'builtin_test_writer',
    name: 'Test Writer',
    model: 'gpt-5.1-codex',
    promptPrefix: 'Write focused tests for behavior, edge cases, and failures before implementation changes.',
    icon: 'test',
    builtIn: true,
    createdAt: 0,
  },
];

const MODEL_OPTIONS = ['gpt-5.1-codex', 'gpt-5-codex', 'gpt-4.1'];
const EXEC_PRESETS_KEY = 'taskdex_exec_presets_v1';
const EXEC_RUNS_KEY = 'taskdex_exec_runs_v1';

type ExecModeType = 'task' | 'flow';
type ExecRunStatus = 'starting' | 'running' | 'completed' | 'failed';

interface ExecPreset {
  id: string;
  name: string;
  mode: ExecModeType;
  prompt: string;
  steps: string[];
  model: string;
  cwd: string;
  approvalPolicy: 'never' | 'on-request';
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

interface ExecRunRecord {
  id: string;
  presetId?: string;
  name: string;
  mode: ExecModeType;
  status: ExecRunStatus;
  stepCount: number;
  startedAt: number;
  finishedAt?: number;
  threadId?: string;
  workspaceId?: string;
  error?: string;
}

function createExecId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseFlowSteps(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function formatExecRunTime(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function messageIdentity(message: AgentMessage): string {
  if (message._itemId) return `item:${message._itemId}`;
  return `${message.role}:${message.type}:${message.timestamp}:${message.text}`;
}

function mergeLocalAndLiveMessages(localMessages: AgentMessage[], liveMessages: AgentMessage[]): AgentMessage[] {
  const merged = new Map<string, AgentMessage>();
  for (const message of localMessages) {
    merged.set(messageIdentity(message), message);
  }
  for (const message of liveMessages) {
    const key = messageIdentity(message);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, ...message } : message);
  }
  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

interface WorkspaceScreenProps {
  colors: Palette;
  connectionColors: Record<string, string>;
  statusColors: Record<string, string>;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  resolvedTheme: ThemeMode;
}

function WorkspaceScreen({
  colors,
  connectionColors,
  statusColors,
  themePreference,
  setThemePreference,
  resolvedTheme,
}: WorkspaceScreenProps) {
  const insets = useSafeAreaInsets();
  const s = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<FlatList>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const threadScrollState = useRef<Record<string, { offset: number; atBottom: boolean }>>({});
  const threadPagingState = useRef<Record<string, { oldestTimestamp: number | null; hasMore: boolean; loading: boolean }>>({});
  const bootstrappedThreadIds = useRef<Set<string>>(new Set());

  const connectionStatus = useAgentStore((state) => state.connectionStatus);
  const agents = useAgentStore((state) => state.agents);
  const bridgeUrl = useAgentStore((state) => state.bridgeUrl);
  const bridgeApiKey = useAgentStore((state) => state.bridgeApiKey);
  const setBridgeUrl = useAgentStore((state) => state.setBridgeUrl);
  const setBridgeApiKey = useAgentStore((state) => state.setBridgeApiKey);
  const removeAgent = useAgentStore((state) => state.removeAgent);
  const setAgents = useAgentStore((state) => state.setAgents);
  const updateQueuedMessage = useAgentStore((state) => state.updateQueuedMessage);
  const removeQueuedMessage = useAgentStore((state) => state.removeQueuedMessage);
  const moveQueuedMessage = useAgentStore((state) => state.moveQueuedMessage);
  const enqueueQueuedMessage = useAgentStore((state) => state.enqueueQueuedMessage);
  const clearQueuedMessages = useAgentStore((state) => state.clearQueuedMessages);
  const prependQueuedMessage = useAgentStore((state) => state.prependQueuedMessage);
  const setAgentMessages = useAgentStore((state) => state.setAgentMessages);
  const prependAgentMessages = useAgentStore((state) => state.prependAgentMessages);
  const clearAgentMessages = useAgentStore((state) => state.clearAgentMessages);
  const removeMessage = useAgentStore((state) => state.removeMessage);
  const agentIdsSignature = useAgentStore((state) => state.agents.map((agent) => agent.id).sort().join('|'));
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    createWorkspace,
    addThreadToWorkspace,
    setActiveThread,
    removeThreadFromWorkspace,
    updateWorkspaceModel,
    updateWorkspaceConfig,
    replaceThreadAgentId,
    setWorkspacesFromConvex,
    ensureWorkspacesFromAgents,
    cleanupMissingAgentThreads,
  } = useWorkspaceStore();

  const { createAgent, sendMessage, interruptAgent, stopAgent, updateAgentModel } = useWebSocket();

  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showCreateThread, setShowCreateThread] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrScanEnabled, setQrScanEnabled] = useState(true);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showEditModel, setShowEditModel] = useState(false);
  const [showAgentDashboard, setShowAgentDashboard] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [showExecRunner, setShowExecRunner] = useState(false);
  const [agentDashboardFilter, setAgentDashboardFilter] = useState<'all' | 'active' | 'stopped'>('all');
  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(null);
  const previousStatusesRef = useRef<Record<string, string>>({});
  const statusBootstrappedRef = useRef(false);
  const notificationPermissionRef = useRef(false);

  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceModel, setNewWorkspaceModel] = useState('gpt-5.1-codex');
  const [newWorkspaceCwd, setNewWorkspaceCwd] = useState('/Users/apple/Work/DhruvalPersonal');
  const [newWorkspaceApprovalPolicy, setNewWorkspaceApprovalPolicy] = useState<'never' | 'on-request'>('never');
  const [newWorkspaceSystemPrompt, setNewWorkspaceSystemPrompt] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(BUILT_IN_TEMPLATES[0].id);
  const [customTemplateName, setCustomTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [directoryEntries, setDirectoryEntries] = useState<Array<{ name: string; path: string }>>([]);
  const [directoryPath, setDirectoryPath] = useState('.');
  const [directoryResolvedCwd, setDirectoryResolvedCwd] = useState('');
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [showRepoManager, setShowRepoManager] = useState(false);
  const [repoEntries, setRepoEntries] = useState<Array<{ name: string; path: string; remote?: string }>>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [cloneRepoUrl, setCloneRepoUrl] = useState('');
  const [cloningRepo, setCloningRepo] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const createWorkspaceInFlight = useRef(false);

  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [creatingThread, setCreatingThread] = useState(false);
  const createThreadInFlight = useRef(false);

  const [urlInput, setUrlInput] = useState(bridgeUrl);
  const [apiKeyInput, setApiKeyInput] = useState(bridgeApiKey);
  const [saved, setSaved] = useState(false);
  const [sendingTestNotification, setSendingTestNotification] = useState(false);
  const [bridgeHealth, setBridgeHealth] = useState<string>('Health unknown');
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [modelInput, setModelInput] = useState('');
  const [cwdInput, setCwdInput] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'thread' | 'all'>('thread');
  const [pendingSearchTarget, setPendingSearchTarget] = useState<{
    threadId: string;
    timestamp: number;
    itemId?: string;
  } | null>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [fileBrowserPath, setFileBrowserPath] = useState('.');
  const [fileEntries, setFileEntries] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [loadingFileEntries, setLoadingFileEntries] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [loadingFileContent, setLoadingFileContent] = useState(false);
  const [fileBrowserError, setFileBrowserError] = useState<string | null>(null);
  const [showGitModal, setShowGitModal] = useState(false);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    isClean: boolean;
    modified: string[];
    notAdded: string[];
    deleted: string[];
    created: string[];
  } | null>(null);
  const [gitDiff, setGitDiff] = useState('');
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [loadingGit, setLoadingGit] = useState(false);
  const [committingGit, setCommittingGit] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, 'all' | 'errors' | 'muted'>>({});
  const [notificationHistory, setNotificationHistory] = useState<Array<{
    id: string;
    timestamp: number;
    agentId: string;
    title: string;
    body: string;
    severity: 'info' | 'error';
    status: 'sent' | 'muted' | 'no_tokens' | 'error';
    deliveredCount: number;
  }>>([]);
  const [failedSend, setFailedSend] = useState<{ text: string; error: string } | null>(null);
  const [workspaceGraphEnabled, setWorkspaceGraphEnabled] = useState(false);
  const [editingQueueItem, setEditingQueueItem] = useState<{ id: string; text: string } | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const [execLoaded, setExecLoaded] = useState(false);
  const [runningExec, setRunningExec] = useState(false);
  const [execPresets, setExecPresets] = useState<ExecPreset[]>([]);
  const [execRuns, setExecRuns] = useState<ExecRunRecord[]>([]);
  const [execNameInput, setExecNameInput] = useState('');
  const [execModeInput, setExecModeInput] = useState<ExecModeType>('task');
  const [execPromptInput, setExecPromptInput] = useState('');
  const [execFlowInput, setExecFlowInput] = useState('');
  const [execModelInput, setExecModelInput] = useState('gpt-5.1-codex');
  const [execCwdInput, setExecCwdInput] = useState('/Users/apple/Work/DhruvalPersonal');
  const [execApprovalPolicyInput, setExecApprovalPolicyInput] = useState<'never' | 'on-request'>('never');
  const [execSystemPromptInput, setExecSystemPromptInput] = useState('');
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const openSidebar = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowSidebar(true);
  }, []);

  const closeSidebar = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowSidebar(false);
  }, []);

  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
  }, [workspaces, activeWorkspaceId]);

  const activeThreadId = activeWorkspace?.activeThreadId || activeWorkspace?.threads[0]?.id || null;
  const activeThread = useMemo(
    () => activeWorkspace?.threads.find((thread) => thread.id === activeThreadId) || null,
    [activeWorkspace, activeThreadId],
  );
  const liveWorkspaceGraph = useQuery(
    api.persistence.getWorkspaceGraph,
    workspaceGraphEnabled ? {} : 'skip',
  );
  const liveThreadMessages = useQuery(
    api.persistence.getMessages,
    activeThreadId ? { threadId: activeThreadId, limit: 50 } : 'skip',
  );
  const savedTemplates = useQuery(api.persistence.getTemplates, {}) || [];
  const globalSearchResults = useQuery(
    api.persistence.searchMessages,
    searchScope === 'all' && searchQuery.trim().length >= 2
      ? { query: searchQuery.trim() }
      : 'skip',
  );
  const usageSummary = useQuery(api.persistence.getUsageSummary, {});
  const activeAgent = useAgentStore(
    useCallback((state) => {
      if (!activeThreadId) return null;
      return state.agents.find((agent) => agent.id === activeThreadId) || null;
    }, [activeThreadId]),
  );

  const connectionColor = connectionColors[connectionStatus] || colors.textMuted;
  const statusColor = activeAgent ? statusColors[activeAgent.status] || colors.textMuted : colors.textMuted;
  const bottomInset = Math.min(Math.max(insets.bottom, 10), 18);
  const availableTemplates = useMemo(() => {
    const custom = savedTemplates
      .filter((template) => !template.builtIn)
      .map((template) => ({
        id: template.id,
        name: template.name,
        model: template.model,
        promptPrefix: template.promptPrefix,
        icon: template.icon,
        builtIn: false,
        createdAt: template.createdAt,
      }));
    return [...BUILT_IN_TEMPLATES, ...custom];
  }, [savedTemplates]);

  useEffect(() => {
    const agents = useAgentStore.getState().agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      cwd: agent.cwd,
      approvalPolicy: agent.approvalPolicy,
      systemPrompt: agent.systemPrompt,
    }));
    // Skip if a create is in flight — handleCreateWorkspace will call createWorkspace itself
    if (!createWorkspaceInFlight.current) {
      ensureWorkspacesFromAgents(agents);
    }
  }, [agentIdsSignature, ensureWorkspacesFromAgents]);

  useEffect(() => {
    if (!agentIdsSignature) return;
    cleanupMissingAgentThreads(agentIdsSignature ? agentIdsSignature.split('|') : []);
  }, [agentIdsSignature, cleanupMissingAgentThreads]);

  useEffect(() => {
    setUrlInput(bridgeUrl);
  }, [bridgeUrl]);

  useEffect(() => {
    setApiKeyInput(bridgeApiKey);
  }, [bridgeApiKey]);

  useEffect(() => {
    let cancelled = false;

    const loadExecState = async () => {
      try {
        const [savedPresets, savedRuns] = await Promise.all([
          AsyncStorage.getItem(EXEC_PRESETS_KEY),
          AsyncStorage.getItem(EXEC_RUNS_KEY),
        ]);
        if (cancelled) return;

        if (savedPresets) {
          const parsed = JSON.parse(savedPresets) as ExecPreset[];
          if (Array.isArray(parsed)) {
            setExecPresets(parsed);
          }
        }
        if (savedRuns) {
          const parsed = JSON.parse(savedRuns) as ExecRunRecord[];
          if (Array.isArray(parsed)) {
            setExecRuns(parsed);
          }
        }
      } catch {
        if (!cancelled) {
          setExecPresets([]);
          setExecRuns([]);
        }
      } finally {
        if (!cancelled) setExecLoaded(true);
      }
    };

    void loadExecState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!execLoaded) return;
    AsyncStorage.setItem(EXEC_PRESETS_KEY, JSON.stringify(execPresets)).catch(() => {});
  }, [execLoaded, execPresets]);

  useEffect(() => {
    if (!execLoaded) return;
    AsyncStorage.setItem(EXEC_RUNS_KEY, JSON.stringify(execRuns.slice(0, 80))).catch(() => {});
  }, [execLoaded, execRuns]);

  useEffect(() => {
    if (!execRuns.length) return;
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    let changed = false;

    const nextRuns = execRuns.map((run) => {
      if (run.status !== 'running' || !run.threadId) return run;
      const agent = agentById.get(run.threadId);
      if (!agent) return run;
      if (agent.status === 'error') {
        changed = true;
        return {
          ...run,
          status: 'failed' as const,
          error: run.error || 'Agent reported a turn failure',
          finishedAt: run.finishedAt || Date.now(),
        };
      }
      if (agent.status === 'ready' && (agent.queuedMessages?.length || 0) === 0) {
        changed = true;
        return {
          ...run,
          status: 'completed' as const,
          finishedAt: run.finishedAt || Date.now(),
        };
      }
      return run;
    });

    if (changed) {
      setExecRuns(nextRuns);
    }
  }, [agents, execRuns]);

  const openExecRunner = useCallback(() => {
    setShowMoreMenu(false);
    if (activeWorkspace) {
      setExecModelInput(activeWorkspace.model || 'gpt-5.1-codex');
      setExecCwdInput(activeWorkspace.cwd || '/Users/apple/Work/DhruvalPersonal');
      setExecApprovalPolicyInput(
        activeWorkspace.approvalPolicy === 'on-request' ? 'on-request' : 'never',
      );
      setExecSystemPromptInput(activeWorkspace.systemPrompt || '');
      setExecNameInput((current) => current || `${activeWorkspace.name} job`);
    }
    setShowExecRunner(true);
  }, [activeWorkspace]);

  const applyExecPresetToForm = useCallback((preset: ExecPreset) => {
    setExecNameInput(preset.name);
    setExecModeInput(preset.mode);
    setExecPromptInput(preset.prompt);
    setExecFlowInput(preset.steps.join('\n'));
    setExecModelInput(preset.model);
    setExecCwdInput(preset.cwd);
    setExecApprovalPolicyInput(preset.approvalPolicy);
    setExecSystemPromptInput(preset.systemPrompt);
  }, []);

  const handleSaveExecPreset = useCallback(() => {
    const name = execNameInput.trim();
    const mode = execModeInput;
    const prompt = execPromptInput.trim();
    const steps = parseFlowSteps(execFlowInput);
    const model = execModelInput.trim() || 'gpt-5.1-codex';
    const cwd = execCwdInput.trim() || '/Users/apple/Work/DhruvalPersonal';

    if (!name) {
      Alert.alert('Missing name', 'Add a preset name to save automation.');
      return;
    }
    if (mode === 'task' && !prompt) {
      Alert.alert('Missing prompt', 'Task mode needs a prompt.');
      return;
    }
    if (mode === 'flow' && steps.length === 0) {
      Alert.alert('Missing steps', 'Flow mode needs one or more steps.');
      return;
    }

    const now = Date.now();
    const preset: ExecPreset = {
      id: createExecId('exec'),
      name,
      mode,
      prompt,
      steps,
      model,
      cwd,
      approvalPolicy: execApprovalPolicyInput,
      systemPrompt: execSystemPromptInput,
      createdAt: now,
      updatedAt: now,
    };
    setExecPresets((current) => [preset, ...current].slice(0, 40));
  }, [
    execApprovalPolicyInput,
    execCwdInput,
    execFlowInput,
    execModeInput,
    execModelInput,
    execNameInput,
    execPromptInput,
    execSystemPromptInput,
  ]);

  const handleDeleteExecPreset = useCallback((presetId: string) => {
    setExecPresets((current) => current.filter((entry) => entry.id !== presetId));
  }, []);

  const handleRunExec = useCallback(async (preset?: ExecPreset) => {
    const mode = preset?.mode || execModeInput;
    const name = (preset?.name || execNameInput || '').trim() || 'Exec run';
    const model = (preset?.model || execModelInput || '').trim() || 'gpt-5.1-codex';
    const cwd = (preset?.cwd || execCwdInput || '').trim() || '/Users/apple/Work/DhruvalPersonal';
    const approvalPolicy = preset?.approvalPolicy || execApprovalPolicyInput;
    const systemPrompt = preset?.systemPrompt || execSystemPromptInput;
    const prompt = (preset?.prompt || execPromptInput || '').trim();
    const steps = mode === 'flow'
      ? (preset?.steps?.length ? preset.steps : parseFlowSteps(execFlowInput))
      : [prompt];

    if (mode === 'task' && !prompt) {
      Alert.alert('Missing prompt', 'Task mode needs a prompt.');
      return;
    }
    if (mode === 'flow' && steps.length === 0) {
      Alert.alert('Missing steps', 'Flow mode needs one or more steps.');
      return;
    }

    const runId = createExecId('run');
    const startedAt = Date.now();
    const nextRun: ExecRunRecord = {
      id: runId,
      presetId: preset?.id,
      name,
      mode,
      status: 'starting',
      stepCount: steps.length,
      startedAt,
    };
    setExecRuns((current) => [nextRun, ...current].slice(0, 80));
    setRunningExec(true);

    try {
      const createdAgent = await createAgent(`Exec · ${name}`, model, cwd, {
        approvalPolicy,
        systemPrompt,
      });

      const threadTitle = `${name} • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const existingExecWorkspace = workspaces.find((workspace) => workspace.name === 'Exec Mode');
      let workspaceId = existingExecWorkspace?.id;
      if (workspaceId) {
        addThreadToWorkspace({
          workspaceId,
          threadAgentId: createdAgent.id,
          title: threadTitle,
          makeActive: false,
        });
      } else {
        workspaceId = createWorkspace({
          name: 'Exec Mode',
          model,
          cwd,
          approvalPolicy,
          systemPrompt,
          templateId: 'exec_mode',
          templateIcon: 'flash',
          firstThreadAgentId: createdAgent.id,
          firstThreadTitle: threadTitle,
          makeActive: false,
        });
        await persistWorkspaceRecord({
          id: workspaceId,
          bridgeUrl,
          name: 'Exec Mode',
          model,
          cwd,
          approvalPolicy,
          systemPrompt,
          templateId: 'exec_mode',
          templateIcon: 'flash',
          createdAt: Date.now(),
        });
      }

      await persistThreadRecord({
        id: createdAgent.id,
        workspaceId,
        title: threadTitle,
        bridgeAgentId: createdAgent.id,
        createdAt: Date.now(),
      });

      await sendMessage(createdAgent.id, steps[0] || prompt);
      for (let i = 1; i < steps.length; i += 1) {
        enqueueQueuedMessage(createdAgent.id, steps[i] || '');
      }
      if (steps.length > 1) {
        useAgentStore.getState().updateAgentActivity(
          createdAgent.id,
          `Queued ${steps.length - 1} message${steps.length - 1 === 1 ? '' : 's'}`,
        );
      }

      setExecRuns((current) =>
        current.map((run) =>
          run.id === runId
            ? {
              ...run,
              status: 'running',
              threadId: createdAgent.id,
              workspaceId,
            }
            : run,
        ));
    } catch (err) {
      setExecRuns((current) =>
        current.map((run) =>
          run.id === runId
            ? {
              ...run,
              status: 'failed',
              finishedAt: Date.now(),
              error: toUserErrorMessage(err, 'Could not start exec run'),
            }
            : run,
        ));
      Alert.alert('Exec run failed', toUserErrorMessage(err, 'Could not start exec run'));
    } finally {
      setRunningExec(false);
    }
  }, [
    addThreadToWorkspace,
    bridgeUrl,
    createAgent,
    createWorkspace,
    enqueueQueuedMessage,
    execApprovalPolicyInput,
    execCwdInput,
    execFlowInput,
    execModeInput,
    execModelInput,
    execNameInput,
    execPromptInput,
    execSystemPromptInput,
    sendMessage,
    workspaces,
  ]);

  const handleClearExecRuns = useCallback(() => {
    setExecRuns([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_DONE_KEY)
      .then((value) => {
        if (cancelled) return;
        if (value !== 'done') {
          setShowOnboarding(true);
          setOnboardingStep(0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setWorkspaceGraphEnabled(true), 240);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!liveWorkspaceGraph) return;
    const existingWorkspaces = useWorkspaceStore.getState().workspaces;
    const existingActiveThreadByWorkspace = new Map(
      existingWorkspaces.map((workspace) => [workspace.id, workspace.activeThreadId]),
    );

    const nextWorkspaces = liveWorkspaceGraph.map((workspace) => {
      const threads = workspace.threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
      }));
      const existingActiveThreadId = existingActiveThreadByWorkspace.get(workspace.id);
      const activeThreadId = existingActiveThreadId && threads.some((thread) => thread.id === existingActiveThreadId)
        ? existingActiveThreadId
        : (threads[0]?.id || null);
      return {
        id: workspace.id,
        name: workspace.name,
        model: workspace.model,
        cwd: workspace.cwd,
        approvalPolicy: workspace.approvalPolicy,
        systemPrompt: workspace.systemPrompt,
        templateId: workspace.templateId,
        templateIcon: workspace.templateIcon,
        threads,
        activeThreadId,
        createdAt: workspace.createdAt,
        updatedAt: threads[threads.length - 1]?.createdAt || workspace.createdAt,
      };
    });

    setWorkspacesFromConvex(nextWorkspaces);
  }, [liveWorkspaceGraph, setWorkspacesFromConvex]);

  useEffect(() => {
    const threadSnapshots = workspaces.flatMap((workspace) =>
      workspace.threads.map((thread) => ({
        threadId: thread.id,
        workspaceName: workspace.name,
        model: workspace.model,
        cwd: workspace.cwd,
        approvalPolicy: workspace.approvalPolicy || 'never',
        systemPrompt: workspace.systemPrompt || '',
      })));
    if (!threadSnapshots.length) return;

    const currentAgents = useAgentStore.getState().agents;
    const existingAgentsById = new Map(currentAgents.map((agent) => [agent.id, agent]));
    const missingAgents: Agent[] = [];
    const threadsToHydrate: string[] = [];

    for (const thread of threadSnapshots) {
      if (bootstrappedThreadIds.current.has(thread.threadId)) continue;
      const existingAgent = existingAgentsById.get(thread.threadId);

      if (!existingAgent) {
        missingAgents.push({
          id: thread.threadId,
          name: thread.workspaceName,
          model: thread.model,
          cwd: thread.cwd,
          approvalPolicy: thread.approvalPolicy,
          systemPrompt: thread.systemPrompt,
          status: 'stopped',
          threadId: null,
          currentTurnId: null,
          messages: [],
          queuedMessages: [],
        });
        threadsToHydrate.push(thread.threadId);
        continue;
      }

      if (existingAgent.messages.length > 0) {
        bootstrappedThreadIds.current.add(thread.threadId);
        continue;
      }

      threadsToHydrate.push(thread.threadId);
    }

    if (missingAgents.length > 0) {
      setAgents([...currentAgents, ...missingAgents]);
    }

    if (!threadsToHydrate.length) return;
    for (const threadId of threadsToHydrate) {
      bootstrappedThreadIds.current.add(threadId);
    }

    let cancelled = false;
    const hydrateThreadMessages = async () => {
      const results = await Promise.all(
        threadsToHydrate.map(async (threadId) => ({
          threadId,
          result: await fetchThreadMessages(threadId, { limit: 50 }),
        })),
      );
      if (cancelled) return;

      const latestAgents = useAgentStore.getState().agents;
      const updatedById = new Map(latestAgents.map((agent) => [agent.id, agent]));
      let hasChanges = false;

      for (const { threadId, result } of results) {
        const target = updatedById.get(threadId);
        if (!target || target.messages.length > 0) continue;
        const fetchedMessages = result?.messages || [];
        if (!fetchedMessages.length) continue;
        updatedById.set(threadId, {
          ...target,
          messages: fetchedMessages,
        });
        hasChanges = true;
      }

      if (hasChanges) {
        setAgents(Array.from(updatedById.values()));
      }
    };

    void hydrateThreadMessages();
    return () => {
      cancelled = true;
    };
  }, [setAgents, workspaces]);

  useEffect(() => {
    if (!activeThreadId || !liveThreadMessages) return;
    const liveMessages = liveThreadMessages.map((message) => ({
      role: message.role,
      type: message.type,
      text: message.text,
      timestamp: message.timestamp,
      _itemId: message.itemId,
      streaming: message.streaming,
    })) as AgentMessage[];

    const localMessages = useAgentStore
      .getState()
      .agents.find((agent) => agent.id === activeThreadId)?.messages || [];
    const mergedMessages = mergeLocalAndLiveMessages(localMessages, liveMessages);

    setAgentMessages(activeThreadId, mergedMessages);
    const paging = threadPagingState.current[activeThreadId];
    threadPagingState.current[activeThreadId] = {
      oldestTimestamp: mergedMessages[0]?.timestamp || null,
      hasMore: liveThreadMessages.length === 50,
      loading: paging?.loading || false,
    };
  }, [activeThreadId, liveThreadMessages, setAgentMessages]);

  useEffect(() => {
    if (!showEditModel) return;
    setModelInput(activeAgent?.model || activeWorkspace?.model || '');
    setCwdInput(activeAgent?.cwd || activeWorkspace?.cwd || '');
  }, [showEditModel, activeAgent?.id, activeAgent?.model, activeAgent?.cwd, activeWorkspace?.id, activeWorkspace?.model, activeWorkspace?.cwd]);

  useEffect(() => {
    if (!activeThreadId || !activeAgent) return;
    const saved = threadScrollState.current[activeThreadId];
    isNearBottomRef.current = saved?.atBottom ?? true;
    setShowScrollToBottom(!isNearBottomRef.current && activeAgent.messages.length > 0);

    const timer = setTimeout(() => {
      if (typeof saved?.offset === 'number') {
        listRef.current?.scrollToOffset({ offset: Math.max(0, saved.offset), animated: false });
        return;
      }
      if (activeAgent.messages.length > 0) {
        listRef.current?.scrollToEnd({ animated: false });
      }
    }, 40);

    return () => clearTimeout(timer);
  }, [activeThreadId, activeAgent?.id, activeAgent?.messages.length]);

  useEffect(() => {
    if (!activeThreadId) return;
    if (liveThreadMessages) return;
    let cancelled = false;

    const loadMessages = async () => {
      const convexResult = await fetchThreadMessages(activeThreadId, { limit: 50 });
      if (cancelled || !convexResult) return;

      threadPagingState.current[activeThreadId] = {
        oldestTimestamp: convexResult.oldestTimestamp,
        hasMore: convexResult.hasMore,
        loading: false,
      };

      if (convexResult.messages.length === 0) return;
      setAgentMessages(activeThreadId, convexResult.messages);
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, liveThreadMessages, setAgentMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (!activeThreadId) return;
    const currentState = threadPagingState.current[activeThreadId];
    if (!currentState || !currentState.hasMore || currentState.loading || currentState.oldestTimestamp === null) return;

    threadPagingState.current[activeThreadId] = { ...currentState, loading: true };
    setLoadingMoreMessages(true);

    try {
      const olderResult = await fetchThreadMessages(activeThreadId, {
        limit: 50,
        beforeTimestamp: currentState.oldestTimestamp,
      });

      if (!olderResult || olderResult.messages.length === 0) {
        threadPagingState.current[activeThreadId] = {
          ...threadPagingState.current[activeThreadId],
          hasMore: false,
          loading: false,
        };
        return;
      }

      prependAgentMessages(activeThreadId, olderResult.messages);
      threadPagingState.current[activeThreadId] = {
        oldestTimestamp: olderResult.oldestTimestamp,
        hasMore: olderResult.hasMore,
        loading: false,
      };
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [activeThreadId, prependAgentMessages]);

  useEffect(() => {
    setShowActivity(false);
  }, [activeAgent?.id]);

  useEffect(() => {
    if (!activeWorkspace || !activeAgent) openSidebar();
  }, [activeWorkspace?.id, activeAgent?.id, openSidebar]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    setExpandedWorkspaceId((current) => current || activeWorkspace.id);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    setEditingQueueItem(null);
    setEditingQueueText('');
    setFailedSend(null);
  }, [activeThreadId]);

  const ensureNotificationPermission = useCallback(async () => {
    try {
      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.granted
        || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

      if (!granted) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.granted
          || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
      }

      notificationPermissionRef.current = granted;
      return granted;
    } catch {
      notificationPermissionRef.current = false;
      return false;
    }
  }, []);

  // Push notifications are now sent by the bridge server directly via Expo Push API.
  // No local scheduling needed — the bridge sends push on every turn/completed.

  useEffect(() => {
    let cancelled = false;

    async function setupNotifications() {
      try {
        const granted = await ensureNotificationPermission();
        if (!cancelled) notificationPermissionRef.current = granted;

        // Register interactive notification category with text reply
        // Thread completed — reply inline, stop, or open
        await Notifications.setNotificationCategoryAsync('thread-reply', [
          {
            identifier: 'reply',
            buttonTitle: 'Reply',
            textInput: {
              submitButtonTitle: 'Send',
              placeholder: 'Type a reply...',
            },
            options: { opensAppToForeground: false },
          },
          {
            identifier: 'stop',
            buttonTitle: 'Stop Agent',
            options: { opensAppToForeground: false, isDestructive: true },
          },
          {
            identifier: 'open',
            buttonTitle: 'Open',
            options: { opensAppToForeground: true },
          },
        ]);

        // Agent started working
        await Notifications.setNotificationCategoryAsync('agent-working', [
          {
            identifier: 'stop',
            buttonTitle: 'Stop',
            options: { opensAppToForeground: false, isDestructive: true },
          },
          {
            identifier: 'open',
            buttonTitle: 'Open',
            options: { opensAppToForeground: true },
          },
        ]);

        // Agent error
        await Notifications.setNotificationCategoryAsync('agent-error', [
          {
            identifier: 'open',
            buttonTitle: 'Open',
            options: { opensAppToForeground: true },
          },
        ]);

        // File changes
        await Notifications.setNotificationCategoryAsync('file-change', [
          {
            identifier: 'reply',
            buttonTitle: 'Reply',
            textInput: {
              submitButtonTitle: 'Send',
              placeholder: 'Follow up...',
            },
            options: { opensAppToForeground: false },
          },
          {
            identifier: 'open',
            buttonTitle: 'Open',
            options: { opensAppToForeground: true },
          },
        ]);

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('thread-updates', {
            name: 'Thread Updates',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }
      } catch {
        if (!cancelled) notificationPermissionRef.current = false;
      }
    }

    setupNotifications();
    return () => {
      cancelled = true;
    };
  }, [ensureNotificationPermission]);

  const openThreadById = useCallback((threadId: string) => {
    const wsStore = useWorkspaceStore.getState();
    for (const workspace of wsStore.workspaces) {
      const thread = workspace.threads.find((t) => t.id === threadId);
      if (thread) {
        wsStore.setActiveWorkspace(workspace.id);
        wsStore.setActiveThread(workspace.id, threadId);
        return;
      }
    }
  }, []);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      const threadId = extractThreadIdFromUrl(url || '');
      if (threadId) openThreadById(threadId);
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL()
      .then((url) => {
        if (!url) return;
        const threadId = extractThreadIdFromUrl(url);
        if (threadId) openThreadById(threadId);
      })
      .catch(() => {});

    return () => subscription.remove();
  }, [openThreadById]);

  // Handle notification actions (reply, stop, open) from lock screen
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const { actionIdentifier, userText } = response;
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      const agentId = data?.agentId;

      if (!agentId) return;

      switch (actionIdentifier) {
        case 'reply':
          if (userText?.trim()) {
            sendMessageToAgent(agentId, userText.trim()).catch(() => {});
          }
          break;
        case 'stop':
          sendRequest('stop_agent', { agentId }).catch(() => {});
          useAgentStore.getState().updateAgentStatus(agentId, 'stopped');
          break;
        case 'open':
        case Notifications.DEFAULT_ACTION_IDENTIFIER: {
          openThreadById(agentId);
          break;
        }
      }
    });
    return () => subscription.remove();
  }, [openThreadById]);

  useEffect(() => {
    if (!statusBootstrappedRef.current) {
      const initial: Record<string, string> = {};
      for (const agent of agents) initial[agent.id] = agent.status;
      previousStatusesRef.current = initial;
      statusBootstrappedRef.current = true;
      return;
    }

    const prevStatuses = previousStatusesRef.current;
    const nextStatuses: Record<string, string> = {};

    for (const agent of agents) {
      const prev = prevStatuses[agent.id];
      const next = agent.status;
      nextStatuses[agent.id] = next;

      // Push notifications for turn completion are sent by the bridge server.
    }

    previousStatusesRef.current = nextStatuses;
  }, [agents, workspaces]);

  const applyTemplate = useCallback((template: AgentTemplate) => {
    setSelectedTemplateId(template.id);
    setNewWorkspaceModel(template.model);
    setNewWorkspaceSystemPrompt(template.promptPrefix || '');
    if (!newWorkspaceName.trim()) {
      setNewWorkspaceName(template.name);
    }
  }, [newWorkspaceName]);

  const loadDirectoryOptions = useCallback(async (targetPath: string) => {
    setLoadingDirectories(true);
    try {
      const res = await sendRequest('list_directories', {
        cwd: newWorkspaceCwd.trim() || '.',
        path: targetPath,
      });
      if (res.type !== 'response' || !res.data) {
        throw new Error(res.error || 'Failed to list directories');
      }
      const payload = res.data as { entries?: Array<{ name: string; path: string }>; cwd?: string; path?: string };
      const responsePath = payload.path || targetPath || '.';
      const baseCwd = payload.cwd || newWorkspaceCwd.trim() || '.';
      const normalizedPath = responsePath === '.' ? '' : responsePath.replace(/^\.\//, '');
      setDirectoryResolvedCwd(normalizedPath ? `${baseCwd.replace(/\/$/, '')}/${normalizedPath}` : baseCwd);
      setDirectoryPath(responsePath);
      setDirectoryEntries(payload.entries || []);
    } catch (err: any) {
      setDirectoryEntries([]);
      Alert.alert('Browse failed', err?.message || 'Could not list directories from bridge.');
    } finally {
      setLoadingDirectories(false);
    }
  }, [newWorkspaceCwd]);

  const refreshRepoEntries = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await sendRequest('list_repos');
      if (res.type === 'response' && Array.isArray(res.data)) {
        setRepoEntries(res.data as Array<{ name: string; path: string; remote?: string }>);
      } else {
        setRepoEntries([]);
      }
    } catch (err: any) {
      setRepoEntries([]);
      Alert.alert('Repos failed', err?.message || 'Could not list repos from bridge.');
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const handleCloneRepo = useCallback(async () => {
    const url = cloneRepoUrl.trim();
    if (!url) return;
    setCloningRepo(true);
    try {
      await sendRequest('clone_repo', { url });
      setCloneRepoUrl('');
      await refreshRepoEntries();
    } catch (err: any) {
      Alert.alert('Clone failed', toUserErrorMessage(err, 'Could not clone repository'));
    } finally {
      setCloningRepo(false);
    }
  }, [cloneRepoUrl, refreshRepoEntries]);

  const handlePullRepo = useCallback(async (repoPath: string) => {
    try {
      await sendRequest('pull_repo', { path: repoPath });
      await refreshRepoEntries();
    } catch (err: any) {
      Alert.alert('Pull failed', toUserErrorMessage(err, 'Could not pull repository'));
    }
  }, [refreshRepoEntries]);

  const handleSaveCustomTemplate = useCallback(async () => {
    const name = customTemplateName.trim();
    if (!name) return;
    setSavingTemplate(true);
    try {
      await persistTemplateRecord({
        id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        model: newWorkspaceModel.trim() || 'gpt-5.1-codex',
        promptPrefix: newWorkspaceSystemPrompt.trim(),
        icon: 'custom',
        builtIn: false,
        createdAt: Date.now(),
      });
      setCustomTemplateName('');
    } finally {
      setSavingTemplate(false);
    }
  }, [customTemplateName, newWorkspaceModel, newWorkspaceSystemPrompt]);

  const handleCreateWorkspace = async () => {
    if (createWorkspaceInFlight.current || creatingWorkspace) return;
    const name = newWorkspaceName.trim();
    const model = newWorkspaceModel.trim() || 'gpt-5.1-codex';
    const cwd = newWorkspaceCwd.trim() || '/Users/apple/Work/DhruvalPersonal';
    const template = availableTemplates.find((entry) => entry.id === selectedTemplateId);
    if (!name) return;

    createWorkspaceInFlight.current = true;
    setCreatingWorkspace(true);
    try {
      const agent = await createAgent(name, model, cwd, {
        approvalPolicy: newWorkspaceApprovalPolicy,
        systemPrompt: newWorkspaceSystemPrompt.trim(),
      });
      const workspaceId = createWorkspace({
        name,
        model,
        cwd,
        approvalPolicy: newWorkspaceApprovalPolicy,
        systemPrompt: newWorkspaceSystemPrompt.trim(),
        templateId: template?.id,
        templateIcon: template?.icon,
        firstThreadAgentId: agent.id,
        firstThreadTitle: 'Thread 1',
      });
      const createdAt = Date.now();
      await persistWorkspaceRecord({
        id: workspaceId,
        bridgeUrl,
        name,
        model,
        cwd,
        approvalPolicy: newWorkspaceApprovalPolicy,
        systemPrompt: newWorkspaceSystemPrompt.trim(),
        templateId: template?.id,
        templateIcon: template?.icon,
        createdAt,
      });
      await persistThreadRecord({
        id: agent.id,
        workspaceId,
        title: 'Thread 1',
        bridgeAgentId: agent.id,
        createdAt,
      });
      setNewWorkspaceName('');
      setNewWorkspaceSystemPrompt('');
      setNewWorkspaceApprovalPolicy('never');
      setSelectedTemplateId(BUILT_IN_TEMPLATES[0].id);
    } catch (err: any) {
      Alert.alert('Error', toUserErrorMessage(err, 'Failed to create workspace'));
    } finally {
      setShowCreateWorkspace(false);
      setCreatingWorkspace(false);
      createWorkspaceInFlight.current = false;
    }
  };

  const handleCreateThread = async () => {
    if (createThreadInFlight.current || creatingThread) return;
    if (!activeWorkspace) return;
    const model = activeWorkspace.model;
    const cwd = activeWorkspace.cwd;
    const title = newThreadTitle.trim() || `Thread ${activeWorkspace.threads.length + 1}`;

    createThreadInFlight.current = true;
    setCreatingThread(true);
    try {
      const agent = await createAgent(activeWorkspace.name, model, cwd, {
        approvalPolicy: activeWorkspace.approvalPolicy || 'never',
        systemPrompt: activeWorkspace.systemPrompt || '',
      });
      addThreadToWorkspace({
        workspaceId: activeWorkspace.id,
        threadAgentId: agent.id,
        title,
        makeActive: true,
      });
      await persistThreadRecord({
        id: agent.id,
        workspaceId: activeWorkspace.id,
        title,
        bridgeAgentId: agent.id,
        createdAt: Date.now(),
      });
      setNewThreadTitle('');
    } catch (err: any) {
      Alert.alert('Error', toUserErrorMessage(err, 'Failed to create thread'));
    } finally {
      setShowCreateThread(false);
      setCreatingThread(false);
      createThreadInFlight.current = false;
    }
  };

  const handleRemoveThread = (workspaceId: string, threadId: string, threadTitle: string) => {
    Alert.alert(
      'Remove Thread',
      `Remove "${threadTitle}"? Messages stay saved until this thread is removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await stopAgent(threadId);
            } catch {
              // Thread may already be stopped on bridge.
            }
            removeAgent(threadId);
            removeThreadFromWorkspace(workspaceId, threadId);
          },
        },
      ],
    );
  };

  const handleDeleteWorkspace = (workspaceId: string, workspaceName: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return;

    Alert.alert(
      'Delete Agent',
      `Delete "${workspaceName}" and all its threads? This removes saved chats for this agent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const thread of workspace.threads) {
              try {
                await stopAgent(thread.id);
              } catch {
                // Agent may already be stopped or unavailable on bridge.
              }
              removeAgent(thread.id);
              removeThreadFromWorkspace(workspace.id, thread.id);
            }
          },
        },
      ],
    );
  };

  const getHealthEndpoint = useCallback((socketUrl: string) => {
    const parsed = new URL(socketUrl);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.pathname = '/health';
    parsed.search = '';
    return parsed.toString();
  }, []);

  const handleCheckBridgeHealth = useCallback(async () => {
    const trimmedUrl = urlInput.trim();
    const trimmedKey = apiKeyInput.trim();
    if (!trimmedUrl) {
      setBridgeHealth('Bridge URL is required');
      return;
    }
    if (!trimmedKey) {
      setBridgeHealth('API key is required');
      return;
    }

    setCheckingHealth(true);
    try {
      const endpoint = getHealthEndpoint(trimmedUrl);
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${trimmedKey}` },
      });
      if (!res.ok) {
        setBridgeHealth(`Health check failed (${res.status})`);
        return;
      }
      const payload = await res.json() as {
        agents?: number;
        connectedClients?: number;
        system?: { hostname?: string };
      };
      setBridgeHealth(
        `OK • agents ${payload.agents ?? 0} • clients ${payload.connectedClients ?? 0} • ${payload.system?.hostname || 'unknown host'}`,
      );
    } catch (err: any) {
      setBridgeHealth(toUserErrorMessage(err, 'Health check failed'));
    } finally {
      setCheckingHealth(false);
    }
  }, [apiKeyInput, getHealthEndpoint, urlInput]);

  useEffect(() => {
    if (!showSettings) return;
    void handleCheckBridgeHealth();
  }, [showSettings, handleCheckBridgeHealth]);

  useEffect(() => {
    if (!showRepoManager) return;
    void refreshRepoEntries();
  }, [refreshRepoEntries, showRepoManager]);

  const handleSaveBridgeUrl = () => {
    setBridgeUrl(urlInput.trim());
    setBridgeApiKey(apiKeyInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    void handleCheckBridgeHealth();
  };

  const completeOnboarding = useCallback((openCreateAgent: boolean) => {
    AsyncStorage.setItem(ONBOARDING_DONE_KEY, 'done').catch(() => {});
    setShowOnboarding(false);
    setOnboardingStep(0);
    if (openCreateAgent) {
      setShowCreateWorkspace(true);
    }
  }, []);

  const handleOpenQrScanner = useCallback(async () => {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!permission?.granted) {
      Alert.alert('Camera permission required', 'Enable camera access to scan bridge QR codes.');
      return;
    }
    setQrScanEnabled(true);
    setShowQrScanner(true);
  }, [cameraPermission, requestCameraPermission]);

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (!qrScanEnabled) return;
    setQrScanEnabled(false);
    const parsed = parseBridgeQrPayload(data || '');
    if (!parsed) {
      Alert.alert('Invalid QR', 'QR code does not contain bridge connection data.');
      setTimeout(() => setQrScanEnabled(true), 800);
      return;
    }
    setUrlInput(parsed.bridgeUrl);
    setApiKeyInput(parsed.apiKey);
    setShowQrScanner(false);
    Alert.alert('Bridge details detected', 'Bridge URL and API key were filled from QR.');
  }, [qrScanEnabled]);

  const handleSendTestNotification = async () => {
    if (sendingTestNotification) return;
    setSendingTestNotification(true);
    try {
      const hasPermission = await ensureNotificationPermission();
      if (!hasPermission) {
        Alert.alert('Notifications disabled', 'Enable notifications for this app in system settings.');
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Test notification',
          body: 'Taskdex mobile notifications are working.',
          sound: true,
          data: { kind: 'test' },
          ...(Platform.OS === 'android' ? { channelId: 'thread-updates' } : {}),
        },
        trigger: null,
      });
    } catch (err: any) {
      Alert.alert('Notification error', toUserErrorMessage(err, 'Failed to send test notification'));
    } finally {
      setSendingTestNotification(false);
    }
  };

  const handleSaveModel = async () => {
    if (!activeAgent) return;
    const nextModel = modelInput.trim();
    const nextCwd = cwdInput.trim();
    if (!nextModel) {
      Alert.alert('Invalid model', 'Model cannot be empty.');
      return;
    }
    if (!nextCwd) {
      Alert.alert('Invalid path', 'Working directory cannot be empty.');
      return;
    }
    const modelChanged = nextModel !== activeAgent.model;
    const cwdChanged = nextCwd !== (activeAgent.cwd || activeWorkspace?.cwd);
    if (!modelChanged && !cwdChanged) {
      setShowEditModel(false);
      return;
    }

    setSavingModel(true);
    try {
      if (modelChanged) {
        await updateAgentModel(activeAgent.id, nextModel);
      }
      if (activeWorkspace) {
        updateWorkspaceConfig(activeWorkspace.id, {
          ...(modelChanged ? { model: nextModel } : {}),
          ...(cwdChanged ? { cwd: nextCwd } : {}),
        });
        await persistWorkspaceRecord({
          id: activeWorkspace.id,
          bridgeUrl,
          name: activeWorkspace.name,
          model: modelChanged ? nextModel : activeWorkspace.model,
          cwd: cwdChanged ? nextCwd : activeWorkspace.cwd,
          approvalPolicy: activeWorkspace.approvalPolicy,
          systemPrompt: activeWorkspace.systemPrompt,
          templateId: activeWorkspace.templateId,
          templateIcon: activeWorkspace.templateIcon,
          createdAt: activeWorkspace.createdAt,
        });
      }
    } catch (err: any) {
      Alert.alert('Error', toUserErrorMessage(err, 'Failed to update agent config'));
    } finally {
      setShowEditModel(false);
      setSavingModel(false);
    }
  };

  const handleEditQueuedMessage = useCallback((item: QueuedMessage) => {
    setEditingQueueItem({ id: item.id, text: item.text });
    setEditingQueueText(item.text);
  }, []);

  const handleSaveQueuedMessageEdit = () => {
    if (!activeAgent || !editingQueueItem) return;
    const text = editingQueueText.trim();
    if (!text) {
      Alert.alert('Invalid message', 'Queued message cannot be empty.');
      return;
    }
    updateQueuedMessage(activeAgent.id, editingQueueItem.id, text);
    setEditingQueueItem(null);
    setEditingQueueText('');
  };

  const handleSendNextQueued = async () => {
    if (!activeAgent) return;
    const nextQueued = activeAgent.queuedMessages?.[0];
    if (!nextQueued) return;

    if (activeAgent.status === 'working') {
      Alert.alert('Agent is busy', 'Interrupt current run to send queued message immediately.');
      return;
    }

    removeQueuedMessage(activeAgent.id, nextQueued.id);
    try {
      await sendMessage(activeAgent.id, nextQueued.text);
    } catch (err: any) {
      prependQueuedMessage(activeAgent.id, nextQueued);
      Alert.alert('Error', toUserErrorMessage(err, 'Failed to send queued message'));
    }
  };

  const handleClearQueue = () => {
    if (!activeAgent || !activeAgent.queuedMessages?.length) return;
    Alert.alert('Clear queue', 'Remove all queued messages for this thread?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => clearQueuedMessages(activeAgent.id),
      },
    ]);
  };

  const handleRetryFailedSend = useCallback(async () => {
    if (!activeAgent || !failedSend?.text?.trim()) return;
    try {
      await sendMessage(activeAgent.id, failedSend.text.trim());
      setFailedSend(null);
    } catch (err: any) {
      setFailedSend({
        text: failedSend.text.trim(),
        error: toUserErrorMessage(err, 'Retry failed. Check connection and try again.'),
      });
    }
  }, [activeAgent, failedSend, sendMessage]);

  const handleInputSend = useCallback((text: string) => {
    if (!activeAgent) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed === '/stop') {
      void interruptAgent(activeAgent.id);
      return;
    }
    if (trimmed === '/clear') {
      clearAgentMessages(activeAgent.id);
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void sendMessage(activeAgent.id, trimmed)
      .then(() => setFailedSend(null))
      .catch((err: any) => {
        setFailedSend({
          text: trimmed,
          error: toUserErrorMessage(err, 'Failed to send message.'),
        });
      });
  }, [activeAgent, clearAgentMessages, interruptAgent, sendMessage]);

  const resolveFilenameMentions = useCallback(async (query: string) => {
    if (!activeWorkspace?.cwd) return [];
    const res = await sendRequest('list_files', { cwd: activeWorkspace.cwd, path: '.' });
    if (res.type !== 'response' || !res.data) return [];
    const entries = ((res.data as { entries?: Array<{ name?: string; type?: string }> }).entries || []);
    const normalizedQuery = query.trim().toLowerCase();
    return entries
      .filter((entry) => typeof entry.name === 'string')
      .map((entry) => ({
        name: entry.name as string,
        type: entry.type as string,
      }))
      .filter((entry) => entry.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8)
      .map((entry) => (entry.type === 'directory' ? `${entry.name}/` : entry.name));
  }, [activeWorkspace?.cwd]);

  const modifiedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const message of activeAgent?.messages || []) {
      if (message.type !== 'file_change') continue;
      const candidate = (message.text || '').split('\n')[0]?.trim();
      if (candidate) files.add(candidate);
    }
    return files;
  }, [activeAgent?.messages]);

  const loadDirectoryEntries = useCallback(async (relativePath: string) => {
    if (!activeWorkspace?.cwd) return;
    setLoadingFileEntries(true);
    setFileBrowserError(null);
    try {
      const res = await sendRequest('list_files', { cwd: activeWorkspace.cwd, path: relativePath });
      if (res.type !== 'response' || !res.data) {
        throw new Error(res.error || 'Unable to list files');
      }
      const entries = ((res.data as { entries?: Array<{ name: string; path: string; type: string }> }).entries || []);
      setFileEntries(entries);
      setFileBrowserPath(relativePath || '.');
    } catch (err: any) {
      setFileBrowserError(toUserErrorMessage(err, 'Failed to load files'));
      setFileEntries([]);
    } finally {
      setLoadingFileEntries(false);
    }
  }, [activeWorkspace?.cwd]);

  const openFilePath = useCallback(async (relativePath: string) => {
    if (!activeWorkspace?.cwd) return;
    setLoadingFileContent(true);
    setFileBrowserError(null);
    try {
      const res = await sendRequest('read_file', { cwd: activeWorkspace.cwd, path: relativePath });
      if (res.type !== 'response' || !res.data) {
        throw new Error(res.error || 'Unable to read file');
      }
      const payload = res.data as { content?: string; path?: string };
      setSelectedFilePath(payload.path || relativePath);
      setSelectedFileContent(payload.content || '');
      setShowFileBrowser(true);
    } catch (err: any) {
      setFileBrowserError(toUserErrorMessage(err, 'Failed to open file'));
    } finally {
      setLoadingFileContent(false);
    }
  }, [activeWorkspace?.cwd]);

  const handleOpenFileBrowser = useCallback(() => {
    setShowFileBrowser(true);
    setSelectedFilePath(null);
    setSelectedFileContent('');
    void loadDirectoryEntries('.');
  }, [loadDirectoryEntries]);

  const handleFileChangePress = useCallback((path: string) => {
    const normalized = path.replace(/\\/g, '/');
    const slashIndex = normalized.lastIndexOf('/');
    const parent = slashIndex > 0 ? normalized.slice(0, slashIndex) : '.';
    setShowFileBrowser(true);
    setSelectedFilePath(null);
    void loadDirectoryEntries(parent);
    void openFilePath(path);
  }, [loadDirectoryEntries, openFilePath]);

  const refreshGitInfo = useCallback(async () => {
    if (!activeWorkspace?.cwd || connectionStatus !== 'connected') return;
    setLoadingGit(true);
    try {
      const [statusRes, diffRes, branchesRes] = await Promise.all([
        sendRequest('git_status', { cwd: activeWorkspace.cwd }),
        sendRequest('git_diff', { cwd: activeWorkspace.cwd }),
        sendRequest('git_branches', { cwd: activeWorkspace.cwd }),
      ]);

      if (statusRes.type === 'response' && statusRes.data) {
        setGitStatus(statusRes.data as any);
      }
      if (diffRes.type === 'response' && diffRes.data) {
        setGitDiff(((diffRes.data as { diff?: string }).diff || '').trim());
      }
      if (branchesRes.type === 'response' && branchesRes.data) {
        setGitBranches((((branchesRes.data as { all?: string[] }).all) || []).slice(0, 40));
      }
    } catch (err: any) {
      setGitDiff(toUserErrorMessage(err, 'Unable to fetch git info'));
    } finally {
      setLoadingGit(false);
    }
  }, [activeWorkspace?.cwd, connectionStatus]);

  const handleCommitGitChanges = useCallback(async () => {
    if (!activeWorkspace?.cwd) return;
    setCommittingGit(true);
    try {
      const message = `chore: mobile commit ${new Date().toISOString()}`;
      await sendRequest('git_commit', { cwd: activeWorkspace.cwd, message });
      await refreshGitInfo();
    } catch (err: any) {
      Alert.alert('Git commit failed', toUserErrorMessage(err, 'Unable to commit changes'));
    } finally {
      setCommittingGit(false);
    }
  }, [activeWorkspace?.cwd, refreshGitInfo]);

  const handleSwitchBranch = useCallback(async (branch: string) => {
    if (!activeWorkspace?.cwd) return;
    try {
      await sendRequest('git_checkout', { cwd: activeWorkspace.cwd, branch });
      await refreshGitInfo();
    } catch (err: any) {
      Alert.alert('Branch switch failed', toUserErrorMessage(err, 'Unable to switch branch'));
    }
  }, [activeWorkspace?.cwd, refreshGitInfo]);

  const loadNotificationCenterData = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const [prefsRes, historyRes] = await Promise.all([
        sendRequest('get_notification_prefs'),
        sendRequest('list_notification_history', { limit: 120 }),
      ]);

      if (prefsRes.type === 'response' && prefsRes.data && typeof prefsRes.data === 'object') {
        const rawPrefs = prefsRes.data as Record<string, string>;
        const nextPrefs: Record<string, 'all' | 'errors' | 'muted'> = {};
        for (const [agentId, level] of Object.entries(rawPrefs)) {
          if (level === 'errors' || level === 'muted') nextPrefs[agentId] = level;
          else nextPrefs[agentId] = 'all';
        }
        setNotificationPrefs(nextPrefs);
      } else {
        setNotificationPrefs({});
      }

      if (historyRes.type === 'response' && Array.isArray(historyRes.data)) {
        setNotificationHistory(historyRes.data as Array<{
          id: string;
          timestamp: number;
          agentId: string;
          title: string;
          body: string;
          severity: 'info' | 'error';
          status: 'sent' | 'muted' | 'no_tokens' | 'error';
          deliveredCount: number;
        }>);
      } else {
        setNotificationHistory([]);
      }
    } catch {
      setNotificationPrefs({});
      setNotificationHistory([]);
    } finally {
      setLoadingNotifications(false);
    }
  }, []);

  const handleUpdateNotificationLevel = useCallback(async (agentId: string, level: 'all' | 'errors' | 'muted') => {
    const previous = notificationPrefs[agentId] || 'all';
    setNotificationPrefs((current) => ({ ...current, [agentId]: level }));
    try {
      const res = await sendRequest('update_notification_prefs', { agentId, level });
      if (res.type !== 'response') {
        throw new Error(res.error || 'Failed to update notification preference');
      }
    } catch (err: any) {
      setNotificationPrefs((current) => ({ ...current, [agentId]: previous }));
      Alert.alert('Notification setting failed', toUserErrorMessage(err, 'Could not update notification preference'));
    }
  }, [notificationPrefs]);

  useEffect(() => {
    if (!activeWorkspace?.cwd || connectionStatus !== 'connected') return;
    void refreshGitInfo();
  }, [activeWorkspace?.cwd, connectionStatus, refreshGitInfo]);

  useEffect(() => {
    if (!showNotificationsModal) return;
    void loadNotificationCenterData();
  }, [loadNotificationCenterData, showNotificationsModal]);

  const canSend = !!activeAgent
    && connectionStatus === 'connected'
    && activeAgent.status !== 'error';
  const isAgentWorking = activeAgent?.status === 'working';
  const queuedMessages = activeAgent?.queuedMessages || [];
  const queuedCount = queuedMessages.length;
  const offlineQueuedCount = useMemo(
    () => agents.reduce((sum, agent) => sum + (agent.queuedMessages?.length || 0), 0),
    [agents],
  );
  const activityCount = useMemo(
    () => activeAgent?.messages.filter((msg) => msg.role === 'agent' && msg.type && msg.type !== 'agent').length || 0,
    [activeAgent],
  );
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleMessages = useMemo(() => {
    if (!activeAgent) return [];
    const base = showActivity ? activeAgent.messages : activeAgent.messages.filter((msg) => {
      if (msg.role === 'user') return true;
      return !msg.type || msg.type === 'agent';
    });
    if (searchScope !== 'thread' || !normalizedSearch) return base;
    return base.filter((msg) => (msg.text || '').toLowerCase().includes(normalizedSearch));
  }, [activeAgent, normalizedSearch, searchScope, showActivity]);
  const hasAnyMessages = (activeAgent?.messages.length || 0) > 0;
  const isThreadHydrating = !!activeThreadId && !liveThreadMessages && !hasAnyMessages;
  const typingLabel = useMemo(() => {
    if (!activeAgent || activeAgent.status !== 'working') return 'Working';
    if (activeAgent.activityLabel?.trim()) return activeAgent.activityLabel.trim();
    const lastAgentMessage = [...activeAgent.messages].reverse().find((msg) => msg.role === 'agent');
    if (lastAgentMessage?.type === 'thinking') return 'Thinking';
    if (lastAgentMessage?.type === 'command' || lastAgentMessage?.type === 'command_output') return 'Running';
    return 'Typing';
  }, [activeAgent]);
  const threadLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const workspace of workspaces) {
      for (const thread of workspace.threads) {
        labels.set(thread.id, `${workspace.name} · ${thread.title}`);
      }
    }
    return labels;
  }, [workspaces]);
  useEffect(() => {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const summaries = workspaces.flatMap((workspace) =>
      workspace.threads.map((thread) => {
        const agent = byId.get(thread.id);
        return {
          id: thread.id,
          name: `${workspace.name} · ${thread.title}`,
          status: agent?.status || 'stopped',
          deepLinkUrl: `taskdex://thread/${thread.id}`,
        };
      }));

    if (summaries.length > 0) {
      setWidgetSummary(summaries);
    } else {
      clearWidgetSummary();
    }
  }, [agents, workspaces]);
  const notificationRows = useMemo(
    () => workspaces.flatMap((workspace) =>
      workspace.threads.map((thread) => ({
        agentId: thread.id,
        label: `${workspace.name} · ${thread.title}`,
      }))),
    [workspaces],
  );
  const dashboardAgents = useMemo(() => {
    const metricByAgent = new Map(
      (usageSummary?.agents || []).map((entry: any) => [entry.agentId, entry]),
    );
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const rows = workspaces.flatMap((workspace) =>
      workspace.threads.map((thread) => {
        const agent = byId.get(thread.id);
        const metric = metricByAgent.get(thread.id);
        const lastMessage = [...(agent?.messages || [])].reverse()[0];
        const lastTimestamp = lastMessage?.timestamp || thread.createdAt;
        return {
          workspaceId: workspace.id,
          threadId: thread.id,
          workspaceName: workspace.name,
          threadTitle: thread.title,
          model: agent?.model || workspace.model,
          status: agent?.status || 'stopped',
          lastPreview: (lastMessage?.text || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          minutesAgo: Math.max(0, Math.round((Date.now() - lastTimestamp) / 60000)),
          averageResponseMs: typeof metric?.averageResponseMs === 'number' ? metric.averageResponseMs : 0,
          errorCount: typeof metric?.errorCount === 'number' ? metric.errorCount : 0,
          activeTimeMs: typeof metric?.activeTimeMs === 'number' ? metric.activeTimeMs : 0,
        };
      }),
    );
    return rows.filter((row) => {
      if (agentDashboardFilter === 'active') return row.status !== 'stopped';
      if (agentDashboardFilter === 'stopped') return row.status === 'stopped';
      return true;
    });
  }, [agentDashboardFilter, agents, usageSummary?.agents, workspaces]);

  const handleOpenDashboardThread = useCallback((workspaceId: string, threadId: string) => {
    setActiveWorkspace(workspaceId);
    setActiveThread(workspaceId, threadId);
    setShowAgentDashboard(false);
  }, [setActiveThread, setActiveWorkspace]);

  const handleRestartStoppedThread = useCallback(async (workspaceId: string, threadId: string) => {
    const workspace = workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return;
    try {
      const newAgent = await createAgent(
        workspace.name,
        workspace.model,
        workspace.cwd,
        {
          approvalPolicy: workspace.approvalPolicy,
          systemPrompt: workspace.systemPrompt,
        },
      );
      const nextAgents = agents.map((entry) =>
        entry.id === threadId
          ? {
            ...entry,
            id: newAgent.id,
            status: newAgent.status,
            threadId: newAgent.threadId,
            currentTurnId: null,
          }
          : entry,
      );
      setAgents(nextAgents);
      replaceThreadAgentId(workspaceId, threadId, newAgent.id);
      await persistThreadRecord({
        id: newAgent.id,
        workspaceId,
        title: workspace.threads.find((thread) => thread.id === threadId)?.title || 'Thread',
        bridgeAgentId: newAgent.id,
        createdAt: Date.now(),
      });
    } catch (err: any) {
      Alert.alert('Restart failed', toUserErrorMessage(err, 'Could not restart agent'));
    }
  }, [agents, createAgent, replaceThreadAgentId, setAgents, workspaces]);

  const handleDashboardLongPress = useCallback((workspaceId: string, threadId: string, status: string) => {
    Alert.alert('Agent actions', undefined, [
      ...(status === 'stopped'
        ? [{
          text: 'Restart',
          onPress: () => {
            void handleRestartStoppedThread(workspaceId, threadId);
          },
        }]
        : [{
          text: 'Stop',
          style: 'destructive' as const,
          onPress: () => {
            void stopAgent(threadId);
          },
        }]),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleRestartStoppedThread, stopAgent]);

  const handleMessageActions = useCallback((message: AgentMessage) => {
    if (!activeAgent) return;
    Alert.alert('Message actions', undefined, [
      {
        text: 'Copy',
        onPress: () => {
          void Clipboard.setStringAsync(message.text || '');
        },
      },
      {
        text: 'Share',
        onPress: () => {
          void Share.share({ message: message.text || '' });
        },
      },
      ...(message.role === 'user'
        ? [{
          text: 'Retry',
          onPress: () => {
            if (message.text?.trim()) {
              void sendMessage(activeAgent.id, message.text.trim());
            }
          },
        }]
        : []),
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeMessage(activeAgent.id, message);
          void deletePersistedMessage(activeAgent.id, message);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [activeAgent, removeMessage, sendMessage]);
  const renderChatItem = useCallback(
    ({ item }: { item: AgentMessage }) => (
      <Pressable onLongPress={() => handleMessageActions(item)} delayLongPress={280}>
        <ChatBubble message={item} colors={colors} onFilePress={handleFileChangePress} />
      </Pressable>
    ),
    [colors, handleFileChangePress, handleMessageActions],
  );
  const keyExtractor = useCallback(
    (item: AgentMessage) => `${activeAgent?.id ?? 'agent'}_${item._itemId ?? `${item.role}_${item.timestamp}`}`,
    [activeAgent?.id],
  );

  const handleOpenSearchResult = useCallback((result: {
    threadId: string;
    timestamp: number;
    itemId?: string;
  }) => {
    const workspace = workspaces.find((entry) =>
      entry.threads.some((thread) => thread.id === result.threadId));
    if (!workspace) return;
    setActiveWorkspace(workspace.id);
    setActiveThread(workspace.id, result.threadId);
    setShowActivity(true);
    setSearchScope('thread');
    setSearchQuery('');
    setPendingSearchTarget(result);
  }, [setActiveThread, setActiveWorkspace, workspaces]);

  useEffect(() => {
    if (!pendingSearchTarget) return;
    if (pendingSearchTarget.threadId !== activeThreadId) return;
    const index = visibleMessages.findIndex((message) =>
      (pendingSearchTarget.itemId && message._itemId === pendingSearchTarget.itemId)
      || message.timestamp === pendingSearchTarget.timestamp,
    );
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true });
    setPendingSearchTarget(null);
  }, [activeThreadId, pendingSearchTarget, visibleMessages]);

  useEffect(() => {
    if (!activeAgent?.messages.length) return;
    if (!isNearBottomRef.current) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(timer);
  }, [activeThreadId, activeAgent?.messages.length, showActivity]);

  return (
    <KeyboardAvoidingView
      style={s.screenRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <View style={s.topBar}>
        <View style={s.topLeft}>
          <Pressable style={s.menuBtn} onPress={openSidebar}>
            <Ionicons name="chatbubbles-outline" size={16} color={colors.background} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Taskdex</Text>
            <Text style={s.topSub} numberOfLines={1}>
              {activeWorkspace ? `${activeWorkspace.name} · ${activeThread?.title || 'No thread'}` : 'No workspace selected'}
            </Text>
          </View>
        </View>
        <View style={s.topActions}>
          <View style={[s.connectionDot, { backgroundColor: connectionColor }]} />
          <Pressable onPress={() => setShowSettings(true)} style={({ pressed }) => [s.headerIconBtn, pressed && s.pressed]}>
            <Ionicons name="settings-outline" size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={() => setShowMoreMenu(true)} style={({ pressed }) => [s.headerIconBtn, pressed && s.pressed]}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={s.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={searchScope === 'thread' ? 'Search this thread' : 'Search all threads'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={s.searchScopeChip}
          onPress={() => setSearchScope((scope) => (scope === 'thread' ? 'all' : 'thread'))}
        >
          <Text style={s.searchScopeText}>{searchScope === 'thread' ? 'Thread' : 'All'}</Text>
        </Pressable>
      </View>

      <Text style={[s.metaInline, { color: statusColor }]} numberOfLines={1}>
        {activeWorkspace
          ? `${activeWorkspace.model} • ${activeWorkspace.threads.length} threads • ${activeAgent ? activeAgent.status : 'idle'}${queuedCount > 0 ? ` • queued ${queuedCount}` : ''}${gitStatus?.branch ? ` • ${gitStatus.branch} ${gitStatus.isClean ? 'clean' : 'dirty'}` : ''}`
          : getConnectionLabel(connectionStatus)}
      </Text>
      {connectionStatus !== 'connected' && (
        <View style={s.offlineBanner}>
          <Text style={s.offlineBannerText}>
            Bridge offline. New messages will queue locally{offlineQueuedCount > 0 ? ` (${offlineQueuedCount} queued)` : ''}.
          </Text>
        </View>
      )}

      {searchScope === 'all' && searchQuery.trim().length >= 2 && (
        <View style={s.searchResultsPanel}>
          {(globalSearchResults || []).slice(0, 8).map((result: any, index: number) => (
            <Pressable
              key={`${result.id || result.threadId}_${result.timestamp}_${index}`}
              style={s.searchResultRow}
              onPress={() => handleOpenSearchResult({
                threadId: result.threadId,
                timestamp: result.timestamp,
                itemId: result.itemId,
              })}
            >
              <Text style={s.searchResultTitle} numberOfLines={1}>
                {(result.text || '').replace(/\s+/g, ' ').trim() || '(empty message)'}
              </Text>
              <Text style={s.searchResultMeta} numberOfLines={1}>
                {result.threadId}
              </Text>
            </Pressable>
          ))}
          {globalSearchResults && globalSearchResults.length === 0 && (
            <Text style={s.searchEmptyText}>No cross-thread results</Text>
          )}
        </View>
      )}

      <View style={s.chatPanel}>
        {!activeAgent ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>No Thread Selected</Text>
              <Text style={s.emptySub}>Create an agent, then start a thread.</Text>
            </View>
          </View>
        ) : isThreadHydrating ? (
          <View style={s.skeletonWrap}>
            <View style={s.skeletonBubbleWide} />
            <View style={s.skeletonBubbleMid} />
            <View style={s.skeletonBubbleShort} />
          </View>
        ) : !hasAnyMessages && isAgentWorking ? (
          <View style={s.emptyWrap}>
            <TypingIndicator label={typingLabel} colors={colors} />
          </View>
        ) : !hasAnyMessages ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>Start Chatting</Text>
              <Text style={s.emptySub}>Each thread keeps its own context.</Text>
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={keyExtractor}
            renderItem={renderChatItem}
            getItemLayout={(_, index) => ({ length: 104, offset: 104 * index, index })}
            ListHeaderComponent={loadingMoreMessages || activityCount > 0 ? (
              <View>
                {loadingMoreMessages && (
                  <View style={s.paginationLoadingWrap}>
                    <Text style={s.paginationLoadingText}>Loading older messages...</Text>
                  </View>
                )}
                {activityCount > 0 && (
                  <View style={s.thinkingToggleWrap}>
                    <Pressable
                      style={s.thinkingToggleBtn}
                      onPress={() => setShowActivity((current) => !current)}
                    >
                      <Ionicons
                        name={showActivity ? 'chevron-down' : 'chevron-forward'}
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={s.thinkingToggleText}>
                        {showActivity ? `Hide activity (${activityCount})` : `Show activity (${activityCount})`}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}
            ListEmptyComponent={!showActivity && activityCount > 0 ? (
              <View style={s.thinkingCollapsedEmpty}>
                <Text style={s.thinkingCollapsedTitle}>Activity is collapsed</Text>
                <Text style={s.thinkingCollapsedSub}>Expand to inspect thinking, commands, and outputs.</Text>
              </View>
            ) : null}
            ListFooterComponent={isAgentWorking ? <TypingIndicator label={typingLabel} colors={colors} /> : null}
            contentContainerStyle={s.chatListContent}
            onContentSizeChange={() => {
              if (isNearBottomRef.current) {
                listRef.current?.scrollToEnd({ animated: false });
              }
            }}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const isNearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 28;
              isNearBottomRef.current = isNearBottom;
              if (activeThreadId) {
                threadScrollState.current = {
                  ...threadScrollState.current,
                  [activeThreadId]: {
                    ...threadScrollState.current[activeThreadId],
                    offset: contentOffset.y,
                    atBottom: isNearBottom,
                  },
                };
              }
              setShowScrollToBottom((current) => (current === !isNearBottom ? current : !isNearBottom));
              if (contentOffset.y <= 80) {
                void loadOlderMessages();
              }
            }}
            windowSize={9}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={32}
            removeClippedSubviews={true}
            scrollEventThrottle={16}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: Math.max(0, info.averageItemLength * info.index),
                animated: true,
              });
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {showScrollToBottom && !!activeAgent && (
        <Pressable
          style={[s.scrollToBottomBtn, { bottom: bottomInset + 70 }]}
          onPress={() => {
            isNearBottomRef.current = true;
            setShowScrollToBottom(false);
            listRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <Ionicons name="chevron-down" size={18} color={colors.background} />
        </Pressable>
      )}

      {!!activeAgent && queuedCount > 0 && (
        <QueuePanel
          colors={colors}
          items={queuedMessages}
          collapsed={queueCollapsed}
          isWorking={!!isAgentWorking}
          onToggle={() => setQueueCollapsed((current) => !current)}
          onEdit={handleEditQueuedMessage}
          onRemove={(queueId) => removeQueuedMessage(activeAgent.id, queueId)}
          onMove={(queueId, direction) => moveQueuedMessage(activeAgent.id, queueId, direction)}
          onSendNext={handleSendNextQueued}
          onClear={handleClearQueue}
        />
      )}

      {!!failedSend && (
        <View style={s.failedSendBanner}>
          <View style={s.failedSendTextWrap}>
            <Text style={s.failedSendTitle}>Message failed to send</Text>
            <Text style={s.failedSendBody} numberOfLines={2}>{failedSend.error}</Text>
          </View>
          <View style={s.failedSendActions}>
            <Pressable style={s.cancelBtn} onPress={() => setFailedSend(null)}>
              <Text style={s.cancelText}>Dismiss</Text>
            </Pressable>
            <Pressable style={s.primaryBtn} onPress={() => void handleRetryFailedSend()}>
              <Text style={s.primaryText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      )}

      <MessageInput
        onSend={handleInputSend}
        onInterrupt={() => activeAgent && interruptAgent(activeAgent.id)}
        isWorking={isAgentWorking}
        queueCount={queuedCount}
        disabled={!canSend}
        bottomInset={bottomInset}
        onResolveFileMentions={resolveFilenameMentions}
        colors={colors}
      />

      {showSidebar && (
        <View style={s.sidebarOverlay}>
          <View style={[s.sidebar, { paddingBottom: insets.bottom }]}>
            <View style={s.sidebarHeader}>
              <Text style={s.sidebarTitle}>Chats</Text>
              <Pressable style={s.sidebarCloseBtn} onPress={closeSidebar}>
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={s.sidebarContent} showsVerticalScrollIndicator={false}>
              <View style={s.sidebarSection}>
                <View style={s.sidebarSectionHeader}>
                  <Text style={s.sidebarSectionTitle}>Agents</Text>
                  <Pressable style={s.linkActionBtn} onPress={() => setShowCreateWorkspace(true)}>
                    <Text style={s.linkActionText}>+ New</Text>
                  </Pressable>
                </View>
                {workspaces.map((workspace) => {
                  const isActive = workspace.id === activeWorkspace?.id;
                  const isExpanded = expandedWorkspaceId === workspace.id;
                  return (
                    <View key={workspace.id} style={[s.workspaceCard, isActive && s.workspaceCardActive]}>
                      <View style={s.workspaceCardHeader}>
                        <Pressable
                          style={s.workspaceMainPress}
                          onPress={() => {
                            setActiveWorkspace(workspace.id);
                            setExpandedWorkspaceId(workspace.id);
                          }}
                        >
                          <View style={s.sidebarItemRow}>
                            <View style={s.sidebarItemTextWrap}>
                              <Text style={[s.sidebarItemText, isActive && s.sidebarItemTextActive]} numberOfLines={1}>
                                {workspace.name}
                              </Text>
                              <Text style={[s.sidebarItemMeta, isActive && s.sidebarItemMetaActive]} numberOfLines={1}>
                                {workspace.model} • {workspace.threads.length} threads
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                        <View style={s.workspaceActions}>
                          <Pressable
                            style={({ pressed }) => [s.sidebarIconBtn, pressed && s.pressed]}
                            onPress={() => {
                              setActiveWorkspace(workspace.id);
                              setExpandedWorkspaceId(workspace.id);
                              setShowCreateThread(true);
                            }}
                            hitSlop={6}
                          >
                            <Ionicons name="add" size={14} color={colors.accent} />
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [s.sidebarDeleteBtn, pressed && s.pressed]}
                            onPress={() => handleDeleteWorkspace(workspace.id, workspace.name)}
                            hitSlop={6}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={14}
                              color={isActive ? colors.accent : colors.textMuted}
                            />
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [s.sidebarIconBtn, pressed && s.pressed]}
                            onPress={() =>
                              setExpandedWorkspaceId((current) => (current === workspace.id ? null : workspace.id))
                            }
                            hitSlop={6}
                          >
                            <Ionicons
                              name={isExpanded ? 'chevron-up' : 'chevron-down'}
                              size={14}
                              color={isActive ? colors.accent : colors.textMuted}
                            />
                          </Pressable>
                        </View>
                      </View>

                      {isExpanded && (
                        <View style={s.threadDropdown}>
                          {workspace.threads.map((thread) => {
                            const isThreadActive = isActive && thread.id === activeThreadId;
                            return (
                              <Pressable
                                key={thread.id}
                                style={[s.threadRow, isThreadActive && s.threadRowActive]}
                                onPress={() => {
                                  setActiveWorkspace(workspace.id);
                                  setActiveThread(workspace.id, thread.id);
                                  closeSidebar();
                                }}
                                onLongPress={() => handleRemoveThread(workspace.id, thread.id, thread.title)}
                              >
                                <View style={s.threadRowInner}>
                                  <View style={s.threadLeft}>
                                    <View style={[s.threadMarker, isThreadActive && s.threadMarkerActive]} />
                                    <View style={s.sidebarItemTextWrap}>
                                      <Text style={[s.threadTitle, isThreadActive && s.sidebarItemTextActive]} numberOfLines={1}>
                                        {thread.title}
                                      </Text>
                                      <Text style={[s.threadMeta, isThreadActive && s.threadMetaActive]} numberOfLines={1}>
                                        {thread.id.slice(0, 8)}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              </Pressable>
                            );
                          })}
                          {workspace.threads.length === 0 && <Text style={s.sidebarEmpty}>No threads yet.</Text>}
                        </View>
                      )}
                    </View>
                  );
                })}
                {workspaces.length === 0 && <Text style={s.sidebarEmpty}>No agents yet.</Text>}
              </View>
            </ScrollView>
          </View>
          <Pressable style={s.sidebarScrim} onPress={closeSidebar} />
        </View>
      )}

      <Modal visible={showOnboarding} transparent={true} animationType="fade" onRequestClose={() => setShowOnboarding(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Welcome to Taskdex</Text>
            <View style={s.onboardingDots}>
              {[0, 1, 2].map((step) => (
                <View key={step} style={[s.onboardingDot, onboardingStep === step && s.onboardingDotActive]} />
              ))}
            </View>

            {onboardingStep === 0 && (
              <View style={s.onboardingStepWrap}>
                <Text style={s.onboardingStepTitle}>Control Codex agents from your phone</Text>
                <Text style={s.onboardingStepBody}>
                  Taskdex has two parts: this mobile app and a bridge server running where your code lives.
                </Text>
                <Text style={s.onboardingStepBody}>
                  This walkthrough will help you start the bridge, verify connection, and create your first agent.
                </Text>
              </View>
            )}

            {onboardingStep === 1 && (
              <View style={s.onboardingStepWrap}>
                <Text style={s.onboardingStepTitle}>Start the Bridge</Text>
                <Text style={s.onboardingStepBody}>
                  Run this command on your computer terminal. It installs dependencies, starts bridge + Expo, and prints the QR to open the app:
                </Text>
                <View style={s.onboardingCommandBox}>
                  <Text style={s.onboardingCommandText}>{BRIDGE_START_COMMAND}</Text>
                </View>
                <Pressable
                  style={s.cancelBtn}
                  onPress={() => {
                    void Clipboard.setStringAsync(BRIDGE_START_COMMAND);
                  }}
                >
                  <Text style={s.cancelText}>Copy Command</Text>
                </Pressable>
              </View>
            )}

            {onboardingStep === 2 && (
              <View style={s.onboardingStepWrap}>
                <Text style={s.onboardingStepTitle}>Review Connection and Create Your First Agent</Text>
                <Text style={s.label}>Bridge WebSocket URL</Text>
                <TextInput
                  style={s.input}
                  value={urlInput}
                  onChangeText={setUrlInput}
                  placeholder="ws://192.168.1.x:3001"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={s.label}>Bridge API Key</Text>
                <TextInput
                  style={s.input}
                  value={apiKeyInput}
                  onChangeText={setApiKeyInput}
                  placeholder="Paste bridge API key"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={true}
                />
                <Text style={s.themeHint}>{bridgeHealth}</Text>
                <Pressable
                  style={[s.cancelBtn, checkingHealth && s.smallActionBtnDisabled]}
                  onPress={() => void handleCheckBridgeHealth()}
                  disabled={checkingHealth}
                >
                  <Text style={s.cancelText}>{checkingHealth ? 'Checking...' : 'Test Connection'}</Text>
                </Pressable>
              </View>
            )}

            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => completeOnboarding(false)}>
                <Text style={s.cancelText}>Skip</Text>
              </Pressable>
              {onboardingStep > 0 && (
                <Pressable
                  style={s.cancelBtn}
                  onPress={() => setOnboardingStep((step) => Math.max(0, step - 1))}
                >
                  <Text style={s.cancelText}>Back</Text>
                </Pressable>
              )}
              {onboardingStep < 2 ? (
                <Pressable
                  style={s.primaryBtn}
                  onPress={() => setOnboardingStep((step) => Math.min(2, step + 1))}
                >
                  <Text style={s.primaryText}>Next</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[s.primaryBtn, (!urlInput.trim() || !apiKeyInput.trim()) && s.smallActionBtnDisabled]}
                  disabled={!urlInput.trim() || !apiKeyInput.trim()}
                  onPress={() => {
                    handleSaveBridgeUrl();
                    completeOnboarding(true);
                  }}
                >
                  <Text style={s.primaryText}>Save & Start</Text>
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showCreateWorkspace} transparent={true} animationType="slide" onRequestClose={() => setShowCreateWorkspace(false)}>
        <KeyboardAvoidingView style={s.createAgentOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.createAgentSheet}>
            <View style={s.createAgentHeader}>
              <Text style={s.modalTitle}>New Agent</Text>
              <Pressable onPress={() => setShowCreateWorkspace(false)} style={s.createAgentClose}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={s.label}>Template</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.templateRow}>
                {availableTemplates.map((template) => {
                  const selected = selectedTemplateId === template.id;
                  return (
                    <Pressable
                      key={template.id}
                      style={[s.templateChip, selected && s.templateChipActive]}
                      onPress={() => applyTemplate(template)}
                    >
                      <Text style={s.templateChipText}>{template.icon} {template.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={s.label}>Agent Name</Text>
              <TextInput
                style={s.input}
                value={newWorkspaceName}
                onChangeText={setNewWorkspaceName}
                placeholder="Frontend Assistant"
                placeholderTextColor={colors.textMuted}
                autoFocus={true}
              />

              <Text style={s.label}>Model</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.modelOptionRow, { marginBottom: 8 }]}>
                {MODEL_OPTIONS.map((model) => {
                  const selected = newWorkspaceModel === model;
                  return (
                    <Pressable
                      key={model}
                      style={[s.modelOptionChip, selected && s.modelOptionChipActive]}
                      onPress={() => setNewWorkspaceModel(model)}
                    >
                      <Text style={[s.modelOptionText, selected && s.modelOptionTextActive]}>{model}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <TextInput
                style={s.input}
                value={newWorkspaceModel}
                onChangeText={setNewWorkspaceModel}
                placeholder="or type custom model"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={s.label}>Working Directory</Text>
              <TextInput
                style={[s.input, { marginBottom: 6 }]}
                value={newWorkspaceCwd}
                onChangeText={setNewWorkspaceCwd}
                placeholder="/path/to/project"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {connectionStatus === 'connected' ? (
                <View style={s.cwdActions}>
                  <Pressable
                    style={s.cwdActionBtn}
                    onPress={() => {
                      setShowDirectoryPicker(true);
                      setDirectoryResolvedCwd(newWorkspaceCwd.trim() || '.');
                      void loadDirectoryOptions('.');
                    }}
                  >
                    <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
                    <Text style={s.cwdActionText}>Browse</Text>
                  </Pressable>
                  <Pressable
                    style={s.cwdActionBtn}
                    onPress={() => {
                      setShowRepoManager(true);
                      void refreshRepoEntries();
                    }}
                  >
                    <Ionicons name="git-branch-outline" size={16} color={colors.accent} />
                    <Text style={s.cwdActionText}>Repos</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={s.cwdHint}>Connect to bridge to browse directories</Text>
              )}

              <Text style={s.label}>Approval Policy</Text>
              <View style={s.themeModeRow}>
                <Pressable
                  style={[s.themeModeChip, newWorkspaceApprovalPolicy === 'never' && s.themeModeChipActive]}
                  onPress={() => setNewWorkspaceApprovalPolicy('never')}
                >
                  <Text style={[s.themeModeChipText, newWorkspaceApprovalPolicy === 'never' && s.themeModeChipTextActive]}>
                    Auto-approve
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.themeModeChip, newWorkspaceApprovalPolicy === 'on-request' && s.themeModeChipActive]}
                  onPress={() => setNewWorkspaceApprovalPolicy('on-request')}
                >
                  <Text style={[s.themeModeChipText, newWorkspaceApprovalPolicy === 'on-request' && s.themeModeChipTextActive]}>
                    Ask first
                  </Text>
                </Pressable>
              </View>

              <Text style={s.label}>System Prompt</Text>
              <TextInput
                style={[s.input, s.systemPromptInput]}
                value={newWorkspaceSystemPrompt}
                onChangeText={setNewWorkspaceSystemPrompt}
                placeholder="Instructions prepended to every turn"
                placeholderTextColor={colors.textMuted}
                multiline
              />

              <View style={s.templateSaveRow}>
                <TextInput
                  style={[s.input, s.templateSaveInput, { marginBottom: 0 }]}
                  value={customTemplateName}
                  onChangeText={setCustomTemplateName}
                  placeholder="Save as template..."
                  placeholderTextColor={colors.textMuted}
                />
                <Pressable
                  style={[s.cwdActionBtn, (savingTemplate || !customTemplateName.trim()) && s.smallActionBtnDisabled]}
                  onPress={() => void handleSaveCustomTemplate()}
                  disabled={savingTemplate || !customTemplateName.trim()}
                >
                  <Text style={s.cwdActionText}>{savingTemplate ? 'Saving...' : 'Save'}</Text>
                </Pressable>
              </View>
            </ScrollView>

            <View style={s.createAgentFooter}>
              <Pressable style={s.cancelBtn} onPress={() => setShowCreateWorkspace(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, { flex: 1 }, (creatingWorkspace || !newWorkspaceName.trim()) && { opacity: 0.55 }]}
                onPress={handleCreateWorkspace}
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
              >
                <Text style={[s.primaryText, { textAlign: 'center' }]}>{creatingWorkspace ? 'Creating...' : 'Create Agent'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDirectoryPicker} transparent={true} animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setShowDirectoryPicker(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Choose Directory</Text>
            <Text style={s.fileBrowserPathLabel}>{directoryPath}</Text>
            <ScrollView style={s.fileListWrap}>
              <Pressable
                style={s.fileRow}
                onPress={() => {
                  if (directoryPath === '.') return;
                  const parent = directoryPath.split('/').slice(0, -1).join('/') || '.';
                  void loadDirectoryOptions(parent);
                }}
              >
                <Text style={s.fileRowName}>[DIR] ..</Text>
              </Pressable>
              {loadingDirectories && <Text style={s.fileHint}>Loading directories...</Text>}
              {!loadingDirectories && directoryEntries.map((entry) => (
                <Pressable
                  key={entry.path}
                  style={s.fileRow}
                  onPress={() => {
                    void loadDirectoryOptions(entry.path);
                  }}
                >
                  <Text style={s.fileRowName}>[DIR] {entry.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowDirectoryPicker(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={s.primaryBtn}
                onPress={() => {
                  const selected = directoryResolvedCwd || newWorkspaceCwd;
                  setNewWorkspaceCwd(selected);
                  setCwdInput(selected);
                  setShowDirectoryPicker(false);
                }}
              >
                <Text style={s.primaryText}>Select</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showRepoManager} transparent={true} animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setShowRepoManager(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Repositories</Text>
            <TextInput
              style={s.input}
              value={cloneRepoUrl}
              onChangeText={setCloneRepoUrl}
              placeholder="https://github.com/org/repo.git"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={s.settingsInlineActions}>
              <Pressable
                style={[s.cancelBtn, (cloningRepo || !cloneRepoUrl.trim()) && s.smallActionBtnDisabled]}
                onPress={() => void handleCloneRepo()}
                disabled={cloningRepo || !cloneRepoUrl.trim()}
              >
                <Text style={s.cancelText}>{cloningRepo ? 'Cloning...' : 'Clone Repo'}</Text>
              </Pressable>
              <Pressable style={s.cancelBtn} onPress={() => void refreshRepoEntries()}>
                <Text style={s.cancelText}>Refresh</Text>
              </Pressable>
            </View>
            <ScrollView style={s.fileListWrap}>
              {loadingRepos && <Text style={s.fileHint}>Loading repositories...</Text>}
              {!loadingRepos && repoEntries.map((repo) => (
                <View key={repo.path} style={s.repoRow}>
                  <View style={s.repoMeta}>
                    <Text style={s.repoName} numberOfLines={1}>{repo.name}</Text>
                    <Text style={s.repoPath} numberOfLines={1}>{repo.path}</Text>
                  </View>
                  <Pressable style={s.cancelBtn} onPress={() => void handlePullRepo(repo.path)}>
                    <Text style={s.cancelText}>Pull</Text>
                  </Pressable>
                  <Pressable
                    style={s.primaryBtn}
                    onPress={() => {
                      setNewWorkspaceCwd(repo.path);
                      setShowRepoManager(false);
                    }}
                  >
                    <Text style={s.primaryText}>Use</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowRepoManager(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showCreateThread} transparent={true} animationType="fade" onRequestClose={() => setShowCreateThread(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>New Thread</Text>
            <Text style={s.label}>Thread Name (optional)</Text>
            <TextInput
              style={s.input}
              value={newThreadTitle}
              onChangeText={setNewThreadTitle}
              placeholder={`Thread ${(activeWorkspace?.threads.length || 0) + 1}`}
              placeholderTextColor={colors.textMuted}
              autoFocus={true}
            />
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowCreateThread(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, creatingThread && { opacity: 0.55 }]}
                onPress={handleCreateThread}
                disabled={creatingThread || !activeWorkspace}
              >
                <Text style={s.primaryText}>{creatingThread ? 'Creating...' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showFileBrowser} transparent={true} animationType="fade" onRequestClose={() => setShowFileBrowser(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Files</Text>
            <Text style={s.fileBrowserPathLabel}>{selectedFilePath || fileBrowserPath}</Text>

            {selectedFilePath ? (
              <ScrollView style={s.fileViewerWrap}>
                <SyntaxHighlighter
                  highlighter="hljs"
                  language={guessLanguageFromPath(selectedFilePath)}
                  style={(resolvedTheme === 'dark' ? atomOneDark : atomOneLight) as any}
                  fontFamily={typography.mono}
                  fontSize={12}
                >
                  {selectedFileContent}
                </SyntaxHighlighter>
              </ScrollView>
            ) : (
              <ScrollView style={s.fileListWrap}>
                {loadingFileEntries && <Text style={s.fileHint}>Loading files...</Text>}
                {!loadingFileEntries && fileEntries.map((entry) => (
                  <Pressable
                    key={entry.path}
                    style={s.fileRow}
                    onPress={() => {
                      if (entry.type === 'directory') {
                        void loadDirectoryEntries(entry.path);
                        return;
                      }
                      void openFilePath(entry.path);
                    }}
                  >
                    <Text style={s.fileRowName} numberOfLines={1}>
                      {entry.type === 'directory' ? `[DIR] ${entry.name}` : `[FILE] ${entry.name}`}
                    </Text>
                    {modifiedFiles.has(entry.path) && <Text style={s.fileRowBadge}>Modified</Text>}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {!!fileBrowserError && <Text style={s.fileErrorText}>{fileBrowserError}</Text>}

            <View style={s.modalActions}>
              <Pressable
                style={s.cancelBtn}
                onPress={() => {
                  if (selectedFilePath) {
                    setSelectedFilePath(null);
                    setSelectedFileContent('');
                  } else {
                    setShowFileBrowser(false);
                  }
                }}
              >
                <Text style={s.cancelText}>{selectedFilePath ? 'Back' : 'Close'}</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, loadingFileContent && s.smallActionBtnDisabled]}
                onPress={() => {
                  if (selectedFilePath) {
                    setSelectedFilePath(null);
                    setSelectedFileContent('');
                    return;
                  }
                  void loadDirectoryEntries(fileBrowserPath);
                }}
                disabled={loadingFileContent}
              >
                <Text style={s.primaryText}>{loadingFileContent ? 'Opening...' : (selectedFilePath ? 'List' : 'Refresh')}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showGitModal} transparent={true} animationType="fade" onRequestClose={() => setShowGitModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Git</Text>
            <View style={s.gitStatusCard}>
              <Text style={s.gitStatusTitle}>{gitStatus?.branch || 'No git data yet'}</Text>
              <Text style={s.gitStatusSub}>
                {gitStatus ? (gitStatus.isClean ? 'Working tree clean' : 'Uncommitted changes detected') : 'Connect workspace to load repository status'}
              </Text>
            </View>

            <View style={s.gitBlock}>
              {loadingGit && <Text style={s.fileHint}>Loading git info...</Text>}

              {!loadingGit && (
                <>
                  <Text style={s.gitSectionTitle}>Branches</Text>
                  {gitBranches.length > 0 ? (
                    <ScrollView style={s.gitBranchList} contentContainerStyle={s.gitBranchWrap}>
                      {gitBranches.map((branch) => {
                        const normalizedBranch = branch.replace(/^\*\s*/, '');
                        const isActiveBranch = normalizedBranch === gitStatus?.branch;
                        return (
                          <Pressable
                            key={branch}
                            style={[s.gitBranchChip, isActiveBranch && s.gitBranchChipActive]}
                            onPress={() => void handleSwitchBranch(normalizedBranch)}
                          >
                            <Text style={[s.gitBranchText, isActiveBranch && s.gitBranchTextActive]}>{normalizedBranch}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <Text style={s.fileHint}>No branches available.</Text>
                  )}

                  <Text style={s.gitSectionTitle}>Diff</Text>
                  <ScrollView style={s.gitDiffBox}>
                    <Text style={s.gitDiffText}>{gitDiff || 'No diff'}</Text>
                  </ScrollView>
                </>
              )}
            </View>

            <View style={s.gitActionRow}>
              <Pressable style={s.cancelBtn} onPress={() => setShowGitModal(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
              <Pressable style={[s.cancelBtn, loadingGit && s.smallActionBtnDisabled]} onPress={() => void refreshGitInfo()}>
                <Text style={s.cancelText}>Refresh</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, (committingGit || gitStatus?.isClean) && s.smallActionBtnDisabled]}
                onPress={() => void handleCommitGitChanges()}
                disabled={committingGit || !!gitStatus?.isClean}
              >
                <Text style={s.primaryText}>{committingGit ? 'Committing...' : 'Commit'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAgentDashboard} transparent={true} animationType="fade" onRequestClose={() => setShowAgentDashboard(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Agent Dashboard</Text>
            <View style={s.themeModeRow}>
              {(['all', 'active', 'stopped'] as const).map((filter) => (
                <Pressable
                  key={filter}
                  style={[s.themeModeChip, agentDashboardFilter === filter && s.themeModeChipActive]}
                  onPress={() => setAgentDashboardFilter(filter)}
                >
                  <Text style={[s.themeModeChipText, agentDashboardFilter === filter && s.themeModeChipTextActive]}>
                    {filter}
                  </Text>
                </Pressable>
              ))}
            </View>
            <ScrollView style={s.fileListWrap}>
              {dashboardAgents.map((row) => (
                <Pressable
                  key={`${row.workspaceId}_${row.threadId}`}
                  style={s.dashboardRow}
                  onPress={() => handleOpenDashboardThread(row.workspaceId, row.threadId)}
                  onLongPress={() => handleDashboardLongPress(row.workspaceId, row.threadId, row.status)}
                >
                  <View style={s.dashboardRowTop}>
                    <Text style={s.dashboardTitle} numberOfLines={1}>
                      {row.workspaceName} · {row.threadTitle}
                    </Text>
                    <Text style={[s.dashboardStatusDot, row.status === 'stopped' && s.dashboardStatusDotStopped]}>
                      ●
                    </Text>
                  </View>
                  <Text style={s.dashboardMeta} numberOfLines={1}>
                    {row.model} • {row.status} • {row.minutesAgo}m ago
                  </Text>
                  <Text style={s.dashboardMetricLine} numberOfLines={1}>
                    avg {(row.averageResponseMs / 1000).toFixed(1)}s • errors {row.errorCount} • active {Math.round(row.activeTimeMs / 60000)}m
                  </Text>
                  {!!row.lastPreview && (
                    <Text style={s.dashboardPreview} numberOfLines={2}>
                      {row.lastPreview}
                    </Text>
                  )}
                </Pressable>
              ))}
              {dashboardAgents.length === 0 && <Text style={s.fileHint}>No agents for this filter.</Text>}
            </ScrollView>
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowAgentDashboard(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showUsageModal} transparent={true} animationType="fade" onRequestClose={() => setShowUsageModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Usage Analytics</Text>
            <View style={s.usageSummaryGrid}>
              <View style={s.usageSummaryCard}>
                <Text style={s.usageSummaryLabel}>Messages (today)</Text>
                <Text style={s.usageSummaryValue}>{usageSummary?.messagesSentToday ?? 0}</Text>
              </View>
              <View style={s.usageSummaryCard}>
                <Text style={s.usageSummaryLabel}>Messages (7d)</Text>
                <Text style={s.usageSummaryValue}>{usageSummary?.messagesSentWeek ?? 0}</Text>
              </View>
              <View style={s.usageSummaryCard}>
                <Text style={s.usageSummaryLabel}>Turns (today)</Text>
                <Text style={s.usageSummaryValue}>{usageSummary?.today?.turns ?? 0}</Text>
              </View>
              <View style={s.usageSummaryCard}>
                <Text style={s.usageSummaryLabel}>Turns (7d)</Text>
                <Text style={s.usageSummaryValue}>{usageSummary?.week?.turns ?? 0}</Text>
              </View>
            </View>

            <View style={s.usageCostBox}>
              <Text style={s.usageCostText}>
                Est. cost today: ${(usageSummary?.today?.estimatedCostUsd ?? 0).toFixed(4)}
              </Text>
              <Text style={s.usageCostText}>
                Est. cost 7d: ${(usageSummary?.week?.estimatedCostUsd ?? 0).toFixed(4)}
              </Text>
            </View>

            <Text style={s.label}>Active Time per Agent (7d)</Text>
            <ScrollView style={s.fileListWrap}>
              {(usageSummary?.agents || []).map((entry: any) => (
                <View key={entry.agentId} style={s.usageAgentRow}>
                  <View style={s.usageAgentMeta}>
                    <Text style={s.usageAgentTitle} numberOfLines={1}>
                      {threadLabelById.get(entry.agentId) || entry.agentId}
                    </Text>
                    <Text style={s.usageAgentSub} numberOfLines={1}>
                      {entry.model} • turns {entry.turns} • errors {entry.errorCount}
                    </Text>
                  </View>
                  <Text style={s.usageAgentTime}>{Math.round((entry.activeTimeMs || 0) / 60000)}m</Text>
                </View>
              ))}
              {(usageSummary?.agents || []).length === 0 && (
                <Text style={s.fileHint}>No turn metrics yet. Send messages to start tracking.</Text>
              )}
            </ScrollView>

            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowUsageModal(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showNotificationsModal} transparent={true} animationType="fade" onRequestClose={() => setShowNotificationsModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Notifications</Text>
            <Text style={s.label}>Per-agent preferences</Text>
            <ScrollView style={s.fileListWrap}>
              {notificationRows.map((row) => {
                const currentLevel = notificationPrefs[row.agentId] || 'all';
                return (
                  <View key={row.agentId} style={s.notificationPrefRow}>
                    <Text style={s.notificationPrefTitle} numberOfLines={1}>{row.label}</Text>
                    <View style={s.notificationPrefChips}>
                      {(['all', 'errors', 'muted'] as const).map((level) => (
                        <Pressable
                          key={level}
                          style={[s.notificationPrefChip, currentLevel === level && s.notificationPrefChipActive]}
                          onPress={() => void handleUpdateNotificationLevel(row.agentId, level)}
                        >
                          <Text style={[s.notificationPrefChipText, currentLevel === level && s.notificationPrefChipTextActive]}>
                            {level}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })}
              {notificationRows.length === 0 && (
                <Text style={s.fileHint}>No agents available yet.</Text>
              )}
            </ScrollView>

            <Text style={s.label}>History</Text>
            <ScrollView style={s.fileListWrap}>
              {loadingNotifications && <Text style={s.fileHint}>Loading notification history...</Text>}
              {!loadingNotifications && notificationHistory.map((entry) => (
                <View key={entry.id} style={s.notificationHistoryRow}>
                  <Text style={s.notificationHistoryTitle} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={s.notificationHistoryBody} numberOfLines={2}>
                    {entry.body}
                  </Text>
                  <Text style={s.notificationHistoryMeta} numberOfLines={1}>
                    {formatNotificationTimestamp(entry.timestamp)} • {entry.severity} • {entry.status} • tokens {entry.deliveredCount}
                  </Text>
                </View>
              ))}
              {!loadingNotifications && notificationHistory.length === 0 && (
                <Text style={s.fileHint}>No notifications sent yet.</Text>
              )}
            </ScrollView>

            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowNotificationsModal(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
              <Pressable style={s.cancelBtn} onPress={() => void loadNotificationCenterData()}>
                <Text style={s.cancelText}>Refresh</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showQrScanner} transparent={true} animationType="fade" onRequestClose={() => setShowQrScanner(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <Text style={s.modalTitle}>Scan Bridge QR</Text>
            <Text style={s.themeHint}>Point camera at the QR code shown in bridge terminal output.</Text>
            <View style={s.qrScannerWrap}>
              <CameraView
                onBarcodeScanned={handleBarCodeScanned}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                style={StyleSheet.absoluteFillObject}
              />
            </View>
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowQrScanner(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
              <Pressable
                style={s.cancelBtn}
                onPress={() => setQrScanEnabled(true)}
              >
                <Text style={s.cancelText}>Rescan</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showExecRunner} transparent={true} animationType="fade" onRequestClose={() => setShowExecRunner(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modal, s.fileBrowserModal]}>
            <View style={s.execHeaderRow}>
              <Text style={[s.modalTitle, s.execModalTitle]}>Exec Mode</Text>
              <Pressable style={s.cancelBtn} onPress={dismissKeyboard}>
                <Text style={s.cancelText}>Done</Text>
              </Pressable>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.execModalContent}
            >
              <Text style={s.themeHint}>Run non-interactive Codex jobs and multi-step automation flows.</Text>

              <Text style={s.label}>Job Name</Text>
              <TextInput
                style={s.input}
                value={execNameInput}
                onChangeText={setExecNameInput}
                placeholder="Nightly bug sweep"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={dismissKeyboard}
              />

              <Text style={s.label}>Mode</Text>
              <View style={s.themeModeRow}>
                {(['task', 'flow'] as ExecModeType[]).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[s.themeModeChip, execModeInput === mode && s.themeModeChipActive]}
                    onPress={() => setExecModeInput(mode)}
                  >
                    <Text style={[s.themeModeChipText, execModeInput === mode && s.themeModeChipTextActive]}>
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {execModeInput === 'task' ? (
                <>
                  <Text style={s.label}>Prompt</Text>
                  <TextInput
                    style={[s.input, s.systemPromptInput]}
                    value={execPromptInput}
                    onChangeText={setExecPromptInput}
                    placeholder="Run full code review and commit safe fixes."
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                </>
              ) : (
                <>
                  <Text style={s.label}>Flow Steps (one per line)</Text>
                  <TextInput
                    style={[s.input, s.systemPromptInput]}
                    value={execFlowInput}
                    onChangeText={setExecFlowInput}
                    placeholder={`Audit current branch\nFix P0/P1 issues\nRun tests and commit`}
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                </>
              )}

              <Text style={s.label}>Model</Text>
              <TextInput
                style={s.input}
                value={execModelInput}
                onChangeText={setExecModelInput}
                placeholder="gpt-5.1-codex"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={dismissKeyboard}
              />

              <Text style={s.label}>Working Directory</Text>
              <TextInput
                style={s.input}
                value={execCwdInput}
                onChangeText={setExecCwdInput}
                placeholder="/Users/apple/Work/DhruvalPersonal"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={dismissKeyboard}
              />

              <Text style={s.label}>Approval Policy</Text>
              <View style={s.themeModeRow}>
                {(['never', 'on-request'] as const).map((policy) => (
                  <Pressable
                    key={policy}
                    style={[s.themeModeChip, execApprovalPolicyInput === policy && s.themeModeChipActive]}
                    onPress={() => setExecApprovalPolicyInput(policy)}
                  >
                    <Text style={[s.themeModeChipText, execApprovalPolicyInput === policy && s.themeModeChipTextActive]}>
                      {policy}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.label}>System Prompt (optional)</Text>
              <TextInput
                style={[s.input, s.systemPromptInput]}
                value={execSystemPromptInput}
                onChangeText={setExecSystemPromptInput}
                placeholder="Always include tests and concise summary."
                placeholderTextColor={colors.textMuted}
                multiline
              />

              <View style={s.execActionRow}>
                <Pressable style={s.cancelBtn} onPress={handleSaveExecPreset}>
                  <Text style={s.cancelText}>Save Preset</Text>
                </Pressable>
                <Pressable
                  style={[s.primaryBtn, runningExec && s.smallActionBtnDisabled]}
                  onPress={() => void handleRunExec()}
                  disabled={runningExec}
                >
                  <Text style={s.primaryText}>{runningExec ? 'Starting...' : 'Run Now'}</Text>
                </Pressable>
              </View>

              <Text style={s.label}>Saved Automations</Text>
              <ScrollView style={s.execListWrap} keyboardShouldPersistTaps="handled">
                {execPresets.map((preset) => (
                  <View key={preset.id} style={s.execListRow}>
                    <View style={s.execListRowTop}>
                      <Text style={s.execListTitle} numberOfLines={1}>{preset.name}</Text>
                      <Text style={s.execListBadge}>{preset.mode}</Text>
                    </View>
                    <Text style={s.execListMeta} numberOfLines={1}>
                      {preset.model} • {preset.cwd}
                    </Text>
                    <Text style={s.execListMeta} numberOfLines={1}>
                      {preset.mode === 'flow' ? `${preset.steps.length} steps` : 'Single task'}
                    </Text>
                    <View style={s.execListActions}>
                      <Pressable style={s.cancelBtn} onPress={() => applyExecPresetToForm(preset)}>
                        <Text style={s.cancelText}>Load</Text>
                      </Pressable>
                      <Pressable style={s.cancelBtn} onPress={() => void handleRunExec(preset)}>
                        <Text style={s.cancelText}>Run</Text>
                      </Pressable>
                      <Pressable style={s.cancelBtn} onPress={() => handleDeleteExecPreset(preset.id)}>
                        <Text style={s.cancelText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                {execPresets.length === 0 && (
                  <Text style={s.fileHint}>Save a preset to reuse job/flow definitions.</Text>
                )}
              </ScrollView>

              <Text style={s.label}>Recent Runs</Text>
              <ScrollView style={s.execRunsWrap} keyboardShouldPersistTaps="handled">
                {execRuns.map((run) => (
                  <View key={run.id} style={s.execListRow}>
                    <View style={s.execListRowTop}>
                      <Text style={s.execListTitle} numberOfLines={1}>{run.name}</Text>
                      <Text
                        style={[
                          s.execRunStatus,
                          run.status === 'completed' && s.execRunStatusCompleted,
                          run.status === 'failed' && s.execRunStatusFailed,
                        ]}
                      >
                        {run.status}
                      </Text>
                    </View>
                    <Text style={s.execListMeta} numberOfLines={1}>
                      {run.mode} • {run.stepCount} step{run.stepCount === 1 ? '' : 's'}
                    </Text>
                    <Text style={s.execListMeta} numberOfLines={1}>
                      started {formatExecRunTime(run.startedAt)}
                    </Text>
                    {!!run.finishedAt && (
                      <Text style={s.execListMeta} numberOfLines={1}>
                        finished {formatExecRunTime(run.finishedAt)}
                      </Text>
                    )}
                    {!!run.error && (
                      <Text style={s.fileErrorText} numberOfLines={2}>
                        {run.error}
                      </Text>
                    )}
                    {!!run.workspaceId && !!run.threadId && (
                      <View style={s.execListActions}>
                        <Pressable
                          style={s.cancelBtn}
                          onPress={() => {
                            setActiveWorkspace(run.workspaceId!);
                            setActiveThread(run.workspaceId!, run.threadId!);
                            setShowExecRunner(false);
                          }}
                        >
                          <Text style={s.cancelText}>Open Thread</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
                {execRuns.length === 0 && (
                  <Text style={s.fileHint}>No runs yet.</Text>
                )}
              </ScrollView>

              <View style={s.modalActions}>
                <Pressable style={s.cancelBtn} onPress={handleClearExecRuns}>
                  <Text style={s.cancelText}>Clear Runs</Text>
                </Pressable>
                <Pressable style={s.cancelBtn} onPress={() => setShowExecRunner(false)}>
                  <Text style={s.cancelText}>Close</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showMoreMenu} transparent={true} animationType="fade" onRequestClose={() => setShowMoreMenu(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowMoreMenu(false)}>
          <Pressable style={s.moreMenuSheet} onPress={() => {}}>
            <View style={s.moreMenuHandle} />
            {[
              { icon: 'folder-outline' as const, label: 'Files', onPress: () => { setShowMoreMenu(false); handleOpenFileBrowser(); }, disabled: !activeWorkspace },
              { icon: 'git-branch-outline' as const, label: 'Git', onPress: () => { setShowMoreMenu(false); setShowGitModal(true); void refreshGitInfo(); }, disabled: !activeWorkspace },
              { icon: 'people-outline' as const, label: 'Agents', onPress: () => { setShowMoreMenu(false); setShowAgentDashboard(true); } },
              { icon: 'bar-chart-outline' as const, label: 'Usage', onPress: () => { setShowMoreMenu(false); setShowUsageModal(true); } },
              { icon: 'notifications-outline' as const, label: 'Notifications', onPress: () => { setShowMoreMenu(false); setShowNotificationsModal(true); } },
              { icon: 'flash-outline' as const, label: 'Exec Mode', onPress: openExecRunner },
              { icon: 'build-outline' as const, label: 'Agent Config', onPress: () => { setShowMoreMenu(false); setShowEditModel(true); }, disabled: !activeAgent },
            ].map((item) => (
              <Pressable
                key={item.label}
                style={({ pressed }) => [s.moreMenuItem, item.disabled && s.smallActionBtnDisabled, pressed && s.pressed]}
                onPress={item.onPress}
                disabled={item.disabled}
              >
                <Ionicons name={item.icon} size={20} color={colors.textPrimary} />
                <Text style={s.moreMenuItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showSettings} transparent={true} animationType="fade" onRequestClose={() => setShowSettings(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Settings</Text>
            <Text style={s.label}>Bridge WebSocket URL</Text>
            <TextInput
              style={s.input}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="ws://192.168.1.x:3001"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={s.label}>Bridge API Key</Text>
            <TextInput
              style={s.input}
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              placeholder="Paste bridge API key"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={true}
            />
            <Text style={s.themeHint}>{bridgeHealth}</Text>
            <Text style={s.label}>Appearance</Text>
            <View style={s.themeModeRow}>
              {(['system', 'light', 'dark'] as ThemePreference[]).map((mode) => {
                const active = mode === themePreference;
                return (
                  <Pressable
                    key={mode}
                    style={[s.themeModeChip, active && s.themeModeChipActive]}
                    onPress={() => setThemePreference(mode)}
                  >
                    <Text style={[s.themeModeChipText, active && s.themeModeChipTextActive]}>
                      {mode[0].toUpperCase() + mode.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.themeHint}>Current theme: {resolvedTheme}</Text>
            <View style={s.settingsInlineActions}>
              <Pressable
                style={[s.cancelBtn, checkingHealth && s.smallActionBtnDisabled]}
                onPress={() => void handleCheckBridgeHealth()}
                disabled={checkingHealth}
              >
                <Text style={s.cancelText}>{checkingHealth ? 'Checking...' : 'Check Health'}</Text>
              </Pressable>
              <Pressable
                style={[s.cancelBtn, sendingTestNotification && s.smallActionBtnDisabled]}
                onPress={handleSendTestNotification}
                disabled={sendingTestNotification}
              >
                <Text style={s.cancelText}>
                  {sendingTestNotification ? 'Sending...' : 'Test Notification'}
                </Text>
              </Pressable>
            </View>
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowSettings(false)}>
                <Text style={s.cancelText}>Close</Text>
              </Pressable>
              <Pressable style={s.primaryBtn} onPress={handleSaveBridgeUrl}>
                <Text style={s.primaryText}>{saved ? 'Saved' : 'Save & Connect'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEditModel} transparent={true} animationType="fade" onRequestClose={() => setShowEditModel(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Edit Agent</Text>
            <Text style={s.label}>Model</Text>
            <TextInput
              style={s.input}
              value={modelInput}
              onChangeText={setModelInput}
              placeholder="gpt-5.1-codex"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={true}
            />
            <Text style={s.label}>Working Directory</Text>
            <TextInput
              style={s.input}
              value={cwdInput}
              onChangeText={setCwdInput}
              placeholder="/path/to/project"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {connectionStatus === 'connected' && (
              <View style={s.cwdActions}>
                <Pressable
                  style={s.cwdActionBtn}
                  onPress={() => {
                    setShowDirectoryPicker(true);
                    setDirectoryResolvedCwd(cwdInput.trim() || '.');
                    void loadDirectoryOptions('.');
                  }}
                >
                  <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
                  <Text style={s.cwdActionText}>Browse</Text>
                </Pressable>
              </View>
            )}
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowEditModel(false)} disabled={savingModel}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, (savingModel || !modelInput.trim() || !cwdInput.trim()) && s.smallActionBtnDisabled]}
                onPress={handleSaveModel}
                disabled={savingModel || !modelInput.trim() || !cwdInput.trim()}
              >
                <Text style={s.primaryText}>{savingModel ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editingQueueItem} transparent={true} animationType="fade" onRequestClose={() => { setEditingQueueItem(null); setEditingQueueText(''); }}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Edit Queued Message</Text>
            <Text style={s.label}>Message</Text>
            <TextInput
              style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
              value={editingQueueText}
              onChangeText={setEditingQueueText}
              placeholder="Update queued message..."
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus={true}
            />
            <View style={s.modalActions}>
              <Pressable
                style={s.cancelBtn}
                onPress={() => {
                  setEditingQueueItem(null);
                  setEditingQueueText('');
                }}
              >
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, !editingQueueText.trim() && s.smallActionBtnDisabled]}
                onPress={handleSaveQueuedMessageEdit}
                disabled={!editingQueueText.trim()}
              >
                <Text style={s.primaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function AppContent() {
  const systemTheme = useColorScheme();
  const { loadBridgeUrl, loadSavedAgents, urlLoaded, agentsLoaded } = useAgentStore();
  const { loadSavedWorkspaces, loaded: workspacesLoaded } = useWorkspaceStore();
  const {
    preference: themePreference,
    loaded: themeLoaded,
    loadPreference,
    setPreference: setThemePreference,
  } = useThemeStore();
  const resolvedTheme = useMemo(
    () => resolveThemeMode(themePreference, systemTheme),
    [themePreference, systemTheme],
  );
  const colors = useMemo(() => getPalette(resolvedTheme), [resolvedTheme]);
  const connectionColors = useMemo(() => getConnectionColors(resolvedTheme), [resolvedTheme]);
  const statusColors = useMemo(() => getStatusColors(resolvedTheme), [resolvedTheme]);
  const s = useMemo(() => createStyles(colors), [colors]);

  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    JetBrainsMono_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    loadPreference();
    loadBridgeUrl();
    loadSavedAgents();
    loadSavedWorkspaces();
  }, [loadPreference, loadBridgeUrl, loadSavedAgents, loadSavedWorkspaces]);

  if (!themeLoaded || !urlLoaded || !agentsLoaded || !workspacesLoaded || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.container}>
          <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
          <View style={s.center}>
            <Text style={s.emptySub}>Loading workspace...</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.container} edges={['top', 'left', 'right']}>
        <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
        <WorkspaceScreen
          colors={colors}
          connectionColors={connectionColors}
          statusColors={statusColors}
          themePreference={themePreference}
          setThemePreference={setThemePreference}
          resolvedTheme={resolvedTheme}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function App() {
  return (
    <ConvexProvider client={convexClient}>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </ConvexProvider>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  screenRoot: {
    flex: 1,
    paddingTop: 4,
  },

  topBar: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingTop: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 10,
  },
  menuBtn: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 26,
    fontFamily: typography.display,
  },
  topSub: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.medium,
    maxWidth: 170,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  moreMenuSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  moreMenuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  moreMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  moreMenuItemText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontFamily: typography.medium,
  },

  linkActionBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  smallActionBtnDisabled: {
    opacity: 0.5,
  },
  linkActionText: {
    color: colors.accent,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  metaInline: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingHorizontal: 2,
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  offlineBanner: {
    marginTop: 6,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  offlineBannerText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  searchRow: {
    marginTop: 8,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    fontFamily: typography.medium,
    paddingVertical: 0,
  },
  searchScopeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  searchScopeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: typography.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchResultsPanel: {
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    overflow: 'hidden',
  },
  searchResultRow: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  searchResultTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.medium,
  },
  searchResultMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  searchEmptyText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.medium,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },

  sidebarOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 20,
  },
  sidebarScrim: {
    flex: 1,
    backgroundColor: 'rgba(10, 14, 20, 0.26)',
  },
  sidebar: {
    width: 296,
    backgroundColor: colors.surface,
  },
  sidebarHeader: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sidebarTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontFamily: typography.display,
  },
  sidebarCloseBtn: {
    backgroundColor: 'transparent',
    borderRadius: 999,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarContent: {
    flex: 1,
  },
  sidebarSection: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sidebarSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sidebarSectionTitle: {
    color: colors.textPrimary,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: typography.semibold,
  },
  workspaceCard: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingTop: 2,
    paddingBottom: 3,
    marginBottom: 4,
  },
  workspaceCardActive: {
    backgroundColor: colors.surfaceSubtle,
  },
  workspaceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  workspaceMainPress: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  workspaceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 2,
  },
  sidebarIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarDeleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sidebarItemTextWrap: {
    flex: 1,
  },
  threadDropdown: {
    marginTop: 2,
    marginBottom: 2,
    marginLeft: 16,
    paddingLeft: 10,
  },
  threadRow: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
  },
  threadRowActive: {
    backgroundColor: colors.accentSoft,
  },
  threadRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  threadLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  threadMarker: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 1,
  },
  threadMarkerActive: {
    backgroundColor: colors.accent,
  },
  threadTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.medium,
  },
  threadMeta: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.medium,
  },
  threadMetaActive: {
    color: colors.textSecondary,
  },
  sidebarItemText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontFamily: typography.semibold,
  },
  sidebarItemTextActive: {
    color: colors.accent,
  },
  sidebarItemMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.medium,
  },
  sidebarItemMetaActive: {
    color: colors.textSecondary,
  },
  sidebarEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.medium,
    paddingVertical: 4,
  },

  chatPanel: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 8,
    marginBottom: 6,
    backgroundColor: colors.background,
  },
  chatListContent: {
    paddingVertical: 10,
    paddingBottom: 6,
  },
  paginationLoadingWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  paginationLoadingText: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  thinkingToggleWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  thinkingToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  thinkingToggleText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  thinkingCollapsedEmpty: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  thinkingCollapsedTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    marginBottom: 2,
    fontFamily: typography.semibold,
  },
  thinkingCollapsedSub: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 9,
    elevation: 3,
    zIndex: 5,
  },
  failedSendBanner: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  failedSendTextWrap: {
    gap: 2,
  },
  failedSendTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  failedSendBody: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: typography.regular,
  },
  failedSendActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  skeletonWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  skeletonBubbleWide: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    width: '88%',
  },
  skeletonBubbleMid: {
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    width: '74%',
  },
  skeletonBubbleShort: {
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    width: '62%',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    marginBottom: 5,
    textAlign: 'center',
    fontFamily: typography.display,
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: typography.medium,
  },

  pressed: {
    opacity: 0.86,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(15, 24, 18, 0.28)',
  },
  createAgentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 24, 18, 0.28)',
  },
  createAgentSheet: {
    flex: 1,
    marginTop: 60,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  createAgentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  createAgentClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createAgentFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cwdActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  cwdActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
  },
  cwdActionText: {
    color: colors.accent,
    fontSize: 13,
    fontFamily: typography.semibold,
  },
  cwdHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.regular,
    marginBottom: 14,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  templateRow: {
    gap: 8,
    marginBottom: 10,
  },
  templateChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceSubtle,
  },
  templateChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  templateChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.medium,
  },
  templateSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  templateSaveInput: {
    flex: 1,
    marginBottom: 0,
  },
  modelOptionRow: {
    gap: 8,
    marginBottom: 8,
  },
  modelOptionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceSubtle,
  },
  modelOptionChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  modelOptionText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  modelOptionTextActive: {
    color: colors.accent,
    fontFamily: typography.semibold,
  },
  cwdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cwdInput: {
    flex: 1,
    marginBottom: 0,
  },
  systemPromptInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  fileBrowserModal: {
    maxHeight: '88%',
  },
  fileBrowserPathLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 8,
    fontFamily: typography.mono,
  },
  fileListWrap: {
    maxHeight: 360,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
  },
  fileViewerWrap: {
    maxHeight: 360,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  fileRowName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.medium,
  },
  fileRowBadge: {
    color: colors.accent,
    fontSize: 10,
    fontFamily: typography.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fileHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.medium,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  fileErrorText: {
    marginTop: 8,
    color: '#c23a3a',
    fontSize: 12,
    fontFamily: typography.medium,
  },
  execHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  execModalTitle: {
    marginBottom: 0,
    flex: 1,
  },
  execModalContent: {
    paddingBottom: 8,
  },
  execActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 10,
  },
  execListWrap: {
    maxHeight: 210,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 10,
  },
  execRunsWrap: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
  },
  execListRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  execListRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  execListTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  execListBadge: {
    color: colors.accent,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: typography.semibold,
  },
  execListMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  execListActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 6,
  },
  execRunStatus: {
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: typography.semibold,
  },
  execRunStatusCompleted: {
    color: '#2f9f5d',
  },
  execRunStatusFailed: {
    color: '#c23a3a',
  },
  repoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  repoMeta: {
    flex: 1,
    gap: 2,
  },
  repoName: {
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  repoPath: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  gitStatusCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    gap: 2,
  },
  gitStatusTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontFamily: typography.semibold,
  },
  gitStatusSub: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  gitBlock: {
    maxHeight: 390,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
  },
  gitBranchList: {
    maxHeight: 108,
    marginBottom: 10,
  },
  gitBranchWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 2,
  },
  gitBranchChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  gitBranchChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  gitBranchText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  gitBranchTextActive: {
    color: colors.accent,
    fontFamily: typography.semibold,
  },
  gitSectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: typography.semibold,
  },
  gitDiffBox: {
    maxHeight: 230,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 8,
  },
  gitDiffText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.mono,
  },
  gitActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  dashboardRow: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  dashboardRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dashboardTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  dashboardStatusDot: {
    color: '#2f9f5d',
    fontSize: 14,
    lineHeight: 16,
    fontFamily: typography.semibold,
  },
  dashboardStatusDotStopped: {
    color: colors.textMuted,
  },
  dashboardMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  dashboardMetricLine: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.medium,
  },
  dashboardPreview: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.medium,
  },
  usageSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  usageSummaryCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceSubtle,
  },
  usageSummaryLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 2,
    fontFamily: typography.medium,
  },
  usageSummaryValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontFamily: typography.semibold,
  },
  usageCostBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 10,
    gap: 2,
  },
  usageCostText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: typography.mono,
  },
  usageAgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  usageAgentMeta: {
    flex: 1,
    gap: 2,
  },
  usageAgentTitle: {
    color: colors.textPrimary,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  usageAgentSub: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  usageAgentTime: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  notificationPrefRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  notificationPrefTitle: {
    color: colors.textPrimary,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  notificationPrefChips: {
    flexDirection: 'row',
    gap: 6,
  },
  notificationPrefChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSubtle,
  },
  notificationPrefChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  notificationPrefChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: typography.medium,
  },
  notificationPrefChipTextActive: {
    color: colors.accent,
  },
  notificationHistoryRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  notificationHistoryTitle: {
    color: colors.textPrimary,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  notificationHistoryBody: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: typography.regular,
  },
  notificationHistoryMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.mono,
  },
  onboardingDots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  onboardingDotActive: {
    backgroundColor: colors.accent,
  },
  onboardingStepWrap: {
    marginBottom: 10,
    gap: 8,
  },
  onboardingStepTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontFamily: typography.semibold,
  },
  onboardingStepBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: typography.regular,
  },
  onboardingCommandBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  onboardingCommandText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: typography.mono,
  },
  qrScannerWrap: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    height: 280,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 8,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    marginBottom: 12,
    fontFamily: typography.display,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontFamily: typography.semibold,
  },
  input: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 12,
    fontFamily: typography.regular,
  },
  themeModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  themeModeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  themeModeChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  themeModeChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  themeModeChipTextActive: {
    color: colors.accent,
  },
  themeHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 4,
    fontFamily: typography.medium,
  },
  settingsInlineActions: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: typography.semibold,
  },
  primaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: colors.background,
    fontSize: 13,
    fontFamily: typography.semibold,
  },
});

registerRootComponent(App);
