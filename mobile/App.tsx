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
} from 'react-native';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
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
import type { AgentMessage, QueuedMessage } from './types';
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

function getConnectionLabel(status: string) {
  if (status === 'connected') return 'Connected to bridge';
  if (status === 'connecting') return 'Connecting to bridge...';
  return 'Disconnected from bridge';
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

  const connectionStatus = useAgentStore((state) => state.connectionStatus);
  const agents = useAgentStore((state) => state.agents);
  const bridgeUrl = useAgentStore((state) => state.bridgeUrl);
  const setBridgeUrl = useAgentStore((state) => state.setBridgeUrl);
  const removeAgent = useAgentStore((state) => state.removeAgent);
  const updateQueuedMessage = useAgentStore((state) => state.updateQueuedMessage);
  const removeQueuedMessage = useAgentStore((state) => state.removeQueuedMessage);
  const moveQueuedMessage = useAgentStore((state) => state.moveQueuedMessage);
  const clearQueuedMessages = useAgentStore((state) => state.clearQueuedMessages);
  const prependQueuedMessage = useAgentStore((state) => state.prependQueuedMessage);
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
    ensureWorkspacesFromAgents,
    cleanupMissingAgentThreads,
  } = useWorkspaceStore();

  const { createAgent, sendMessage, interruptAgent, stopAgent, updateAgentModel } = useWebSocket();

  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showCreateThread, setShowCreateThread] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEditModel, setShowEditModel] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(null);
  const previousStatusesRef = useRef<Record<string, string>>({});
  const statusBootstrappedRef = useRef(false);
  const notificationPermissionRef = useRef(false);

  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceModel, setNewWorkspaceModel] = useState('gpt-5.1-codex');
  const [newWorkspaceCwd, setNewWorkspaceCwd] = useState('/Users/apple/Work/DhruvalPersonal');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const createWorkspaceInFlight = useRef(false);

  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [creatingThread, setCreatingThread] = useState(false);
  const createThreadInFlight = useRef(false);

  const [urlInput, setUrlInput] = useState(bridgeUrl);
  const [saved, setSaved] = useState(false);
  const [sendingTestNotification, setSendingTestNotification] = useState(false);
  const [modelInput, setModelInput] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [editingQueueItem, setEditingQueueItem] = useState<{ id: string; text: string } | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');

  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
  }, [workspaces, activeWorkspaceId]);

  const activeThreadId = activeWorkspace?.activeThreadId || activeWorkspace?.threads[0]?.id || null;
  const activeThread = useMemo(
    () => activeWorkspace?.threads.find((thread) => thread.id === activeThreadId) || null,
    [activeWorkspace, activeThreadId],
  );
  const activeAgent = useAgentStore(
    useCallback((state) => {
      if (!activeThreadId) return null;
      return state.agents.find((agent) => agent.id === activeThreadId) || null;
    }, [activeThreadId]),
  );

  const connectionColor = connectionColors[connectionStatus] || colors.textMuted;
  const statusColor = activeAgent ? statusColors[activeAgent.status] || colors.textMuted : colors.textMuted;
  const bottomInset = Math.min(Math.max(insets.bottom, 10), 18);

  useEffect(() => {
    const agents = useAgentStore.getState().agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      cwd: agent.cwd,
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
    if (!showEditModel) return;
    setModelInput(activeAgent?.model || activeWorkspace?.model || '');
  }, [showEditModel, activeAgent?.id, activeAgent?.model, activeWorkspace?.id, activeWorkspace?.model]);

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
    setShowActivity(false);
  }, [activeAgent?.id]);

  useEffect(() => {
    if (!activeWorkspace || !activeAgent) setShowSidebar(true);
  }, [activeWorkspace?.id, activeAgent?.id]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    setExpandedWorkspaceId((current) => current || activeWorkspace.id);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    setEditingQueueItem(null);
    setEditingQueueText('');
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
          // Navigate to the thread when notification is tapped
          const wsStore = useWorkspaceStore.getState();
          for (const workspace of wsStore.workspaces) {
            const thread = workspace.threads.find((t) => t.id === agentId);
            if (thread) {
              wsStore.setActiveWorkspace(workspace.id);
              wsStore.setActiveThread(workspace.id, agentId);
              break;
            }
          }
          break;
        }
      }
    });
    return () => subscription.remove();
  }, []);

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

  const handleCreateWorkspace = async () => {
    if (createWorkspaceInFlight.current || creatingWorkspace) return;
    const name = newWorkspaceName.trim();
    const model = newWorkspaceModel.trim() || 'gpt-5.1-codex';
    const cwd = newWorkspaceCwd.trim() || '/Users/apple/Work/DhruvalPersonal';
    if (!name) return;

    createWorkspaceInFlight.current = true;
    setCreatingWorkspace(true);
    try {
      const agent = await createAgent(name, model, cwd);
      createWorkspace({
        name,
        model,
        cwd,
        firstThreadAgentId: agent.id,
        firstThreadTitle: 'Thread 1',
      });
      setShowCreateWorkspace(false);
      setNewWorkspaceName('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create workspace');
    } finally {
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
      const agent = await createAgent(activeWorkspace.name, model, cwd);
      addThreadToWorkspace({
        workspaceId: activeWorkspace.id,
        threadAgentId: agent.id,
        title,
        makeActive: true,
      });
      setShowCreateThread(false);
      setNewThreadTitle('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create thread');
    } finally {
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

  const handleSaveBridgeUrl = () => {
    setBridgeUrl(urlInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

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
          body: 'Pylon mobile notifications are working.',
          sound: true,
          data: { kind: 'test' },
          ...(Platform.OS === 'android' ? { channelId: 'thread-updates' } : {}),
        },
        trigger: null,
      });
    } catch (err: any) {
      Alert.alert('Notification error', err?.message || 'Failed to send test notification');
    } finally {
      setSendingTestNotification(false);
    }
  };

  const handleSaveModel = async () => {
    if (!activeAgent) return;
    const nextModel = modelInput.trim();
    if (!nextModel) {
      Alert.alert('Invalid model', 'Model cannot be empty.');
      return;
    }
    if (nextModel === activeAgent.model) {
      setShowEditModel(false);
      return;
    }

    setSavingModel(true);
    try {
      await updateAgentModel(activeAgent.id, nextModel);
      if (activeWorkspace) updateWorkspaceModel(activeWorkspace.id, nextModel);
      setShowEditModel(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update model');
    } finally {
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
      Alert.alert('Error', err?.message || 'Failed to send queued message');
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

  const canSend = !!activeAgent
    && connectionStatus === 'connected'
    && activeAgent.status !== 'error';
  const isAgentWorking = activeAgent?.status === 'working';
  const queuedMessages = activeAgent?.queuedMessages || [];
  const queuedCount = queuedMessages.length;
  const activityCount = useMemo(
    () => activeAgent?.messages.filter((msg) => msg.role === 'agent' && msg.type && msg.type !== 'agent').length || 0,
    [activeAgent],
  );
  const visibleMessages = useMemo(() => {
    if (!activeAgent) return [];
    if (showActivity) return activeAgent.messages;
    return activeAgent.messages.filter((msg) => {
      if (msg.role === 'user') return true;
      return !msg.type || msg.type === 'agent';
    });
  }, [activeAgent, showActivity]);
  const hasAnyMessages = (activeAgent?.messages.length || 0) > 0;
  const typingLabel = useMemo(() => {
    if (!activeAgent || activeAgent.status !== 'working') return 'Working';
    if (activeAgent.activityLabel?.trim()) return activeAgent.activityLabel.trim();
    const lastAgentMessage = [...activeAgent.messages].reverse().find((msg) => msg.role === 'agent');
    if (lastAgentMessage?.type === 'thinking') return 'Thinking';
    if (lastAgentMessage?.type === 'command' || lastAgentMessage?.type === 'command_output') return 'Running';
    return 'Typing';
  }, [activeAgent]);
  const renderChatItem = useCallback(
    ({ item }: { item: AgentMessage }) => <ChatBubble message={item} colors={colors} />,
    [colors],
  );
  const keyExtractor = useCallback(
    (item: AgentMessage) => `${activeAgent?.id ?? 'agent'}_${item._itemId ?? `${item.role}_${item.timestamp}`}`,
    [activeAgent?.id],
  );

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
          <Pressable style={s.menuBtn} onPress={() => setShowSidebar(true)}>
            <Ionicons name="chatbubbles-outline" size={16} color={colors.background} />
          </Pressable>
          <View>
            <Text style={s.headerTitle}>Pylon</Text>
            <Text style={s.topSub} numberOfLines={1}>
              {activeWorkspace ? `${activeWorkspace.name} · ${activeThread?.title || 'No thread'}` : 'No workspace selected'}
            </Text>
          </View>
        </View>
        <View style={s.topActions}>
          <View style={[s.connectionPill, { borderColor: `${connectionColor}50` }]}>
            <Text style={[s.connectionPillText, { color: connectionColor }]}>
              {connectionStatus === 'connected' ? 'Live' : 'Offline'}
            </Text>
          </View>
          <Pressable onPress={() => setShowSettings(true)} style={({ pressed }) => [s.headerPillBtn, pressed && s.pressed]}>
            <Text style={s.headerPillText}>Settings</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowEditModel(true)}
            style={({ pressed }) => [s.headerPillBtn, !activeAgent && s.smallActionBtnDisabled, pressed && s.pressed]}
            disabled={!activeAgent}
          >
            <Text style={s.headerPillText}>Model</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[s.metaInline, { color: statusColor }]} numberOfLines={1}>
        {activeWorkspace
          ? `${activeWorkspace.model} • ${activeWorkspace.threads.length} threads • ${activeAgent ? activeAgent.status : 'idle'}${queuedCount > 0 ? ` • queued ${queuedCount}` : ''}`
          : getConnectionLabel(connectionStatus)}
      </Text>

      <View style={s.chatPanel}>
        {!activeAgent ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>No Thread Selected</Text>
              <Text style={s.emptySub}>Create an agent, then start a thread.</Text>
            </View>
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
            ListHeaderComponent={activityCount > 0 ? (
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
            }}
            windowSize={9}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={32}
            scrollEventThrottle={16}
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

      <MessageInput
        onSend={(text) => activeAgent && sendMessage(activeAgent.id, text)}
        onInterrupt={() => activeAgent && interruptAgent(activeAgent.id)}
        isWorking={isAgentWorking}
        queueCount={queuedCount}
        disabled={!canSend}
        bottomInset={bottomInset}
        colors={colors}
      />

      {showSidebar && (
        <View style={s.sidebarOverlay}>
          <View style={[s.sidebar, { paddingBottom: insets.bottom }]}>
            <View style={s.sidebarHeader}>
              <Text style={s.sidebarTitle}>Chats</Text>
              <Pressable style={s.sidebarCloseBtn} onPress={() => setShowSidebar(false)}>
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
                                  setShowSidebar(false);
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
          <Pressable style={s.sidebarScrim} onPress={() => setShowSidebar(false)} />
        </View>
      )}

      <Modal visible={showCreateWorkspace} transparent={true} animationType="fade">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>New Agent</Text>
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
            <TextInput
              style={s.input}
              value={newWorkspaceModel}
              onChangeText={setNewWorkspaceModel}
              placeholder="gpt-5.1-codex"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={s.label}>Working Directory</Text>
            <TextInput
              style={s.input}
              value={newWorkspaceCwd}
              onChangeText={setNewWorkspaceCwd}
              placeholder="~/projects"
              placeholderTextColor={colors.textMuted}
            />
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowCreateWorkspace(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, creatingWorkspace && { opacity: 0.55 }]}
                onPress={handleCreateWorkspace}
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
              >
                <Text style={s.primaryText}>{creatingWorkspace ? 'Creating...' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showCreateThread} transparent={true} animationType="fade">
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

      <Modal visible={showSettings} transparent={true} animationType="fade">
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

      <Modal visible={showEditModel} transparent={true} animationType="fade">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Edit Model</Text>
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
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setShowEditModel(false)} disabled={savingModel}>
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, (savingModel || !modelInput.trim()) && s.smallActionBtnDisabled]}
                onPress={handleSaveModel}
                disabled={savingModel || !modelInput.trim()}
              >
                <Text style={s.primaryText}>{savingModel ? 'Saving...' : 'Save Model'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editingQueueItem} transparent={true} animationType="fade">
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

function App() {
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
    gap: 6,
  },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  connectionPillText: {
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  headerPillBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerPillText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontFamily: typography.semibold,
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
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
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
  modal: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
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
    marginBottom: 8,
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
