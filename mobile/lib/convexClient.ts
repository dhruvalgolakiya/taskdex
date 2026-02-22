import { ConvexReactClient } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { AgentMessage, AgentWorkspace, AgentThread, AgentTemplate } from '../types';

export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || 'http://127.0.0.1:3210';
export const convexClient = new ConvexReactClient(convexUrl);

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function toMessageId(threadId: string, message: AgentMessage): string {
  if (message._itemId) {
    return `item:${threadId}:${message._itemId}`;
  }
  return `msg:${threadId}:${message.role}:${message.timestamp}:${hashText(message.text || '')}`;
}

export async function persistMessage(threadId: string, message: AgentMessage): Promise<void> {
  if (!convexClient) return;
  try {
    await convexClient.mutation(api.persistence.saveMessage, {
      id: toMessageId(threadId, message),
      threadId,
      role: message.role,
      type: message.type,
      text: message.text,
      itemId: message._itemId,
      timestamp: message.timestamp,
      streaming: message.streaming,
    });
  } catch {
    // Best-effort persistence; local state remains source of truth if network fails.
  }
}

export async function deletePersistedMessage(threadId: string, message: AgentMessage): Promise<void> {
  try {
    await convexClient.mutation(api.persistence.deleteMessage, {
      id: toMessageId(threadId, message),
    });
  } catch {
    // Best-effort delete; local state is updated first.
  }
}

interface FetchThreadMessagesParams {
  beforeTimestamp?: number;
  limit?: number;
}

interface FetchThreadMessagesResult {
  messages: AgentMessage[];
  hasMore: boolean;
  oldestTimestamp: number | null;
}

interface WorkspaceRecordInput {
  id: string;
  bridgeUrl: string;
  name: string;
  model: string;
  cwd: string;
  approvalPolicy?: string;
  systemPrompt?: string;
  templateId?: string;
  templateIcon?: string;
  createdAt: number;
}

interface ThreadRecordInput {
  id: string;
  workspaceId: string;
  title: string;
  bridgeAgentId: string;
  createdAt: number;
}

interface BridgeSettingInput {
  bridgeUrl: string;
  apiKey?: string;
}

interface BridgeSettingsResult {
  bridgeUrl: string;
  apiKey: string;
}

interface TemplateRecordInput {
  id: string;
  name: string;
  model: string;
  promptPrefix: string;
  icon: string;
  builtIn?: boolean;
  createdAt: number;
}

export async function fetchThreadMessages(
  threadId: string,
  params: FetchThreadMessagesParams = {},
): Promise<FetchThreadMessagesResult | null> {
  if (!convexClient) return null;
  try {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const rows = await convexClient.query(api.persistence.getMessages, {
      threadId,
      beforeTimestamp: params.beforeTimestamp,
      limit,
    });
    const messages = rows.map((row) => ({
      role: row.role,
      type: row.type,
      text: row.text,
      timestamp: row.timestamp,
      _itemId: row.itemId,
      streaming: row.streaming,
    }));
    return {
      messages,
      hasMore: rows.length === limit,
      oldestTimestamp: messages[0]?.timestamp ?? null,
    };
  } catch {
    return null;
  }
}

export async function persistWorkspaceRecord(input: WorkspaceRecordInput): Promise<void> {
  if (!convexClient) return;
  try {
    await convexClient.mutation(api.persistence.saveWorkspace, input);
  } catch {
    // Best-effort persistence; local state remains source of truth if network fails.
  }
}

export async function persistThreadRecord(input: ThreadRecordInput): Promise<void> {
  if (!convexClient) return;
  try {
    await convexClient.mutation(api.persistence.saveThread, input);
  } catch {
    // Best-effort persistence; local state remains source of truth if network fails.
  }
}

export async function persistTemplateRecord(input: TemplateRecordInput): Promise<void> {
  try {
    await convexClient.mutation(api.persistence.saveTemplate, input);
  } catch {
    // Best-effort persistence; local state remains source of truth if network fails.
  }
}

export async function deleteTemplateRecord(id: string): Promise<void> {
  try {
    await convexClient.mutation(api.persistence.deleteTemplate, { id });
  } catch {
    // Best-effort delete.
  }
}

export async function fetchTemplates(): Promise<AgentTemplate[] | null> {
  try {
    const rows = await convexClient.query(api.persistence.getTemplates, {});
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      model: row.model,
      promptPrefix: row.promptPrefix,
      icon: row.icon,
      builtIn: row.builtIn,
      createdAt: row.createdAt,
    }));
  } catch {
    return null;
  }
}

export async function fetchWorkspaceGraph(): Promise<AgentWorkspace[] | null> {
  if (!convexClient) return null;
  try {
    const graphRows = await convexClient.query(api.persistence.getWorkspaceGraph, {});
    const workspaces: AgentWorkspace[] = graphRows
      .map((workspace) => {
        const threads: AgentThread[] = [...workspace.threads]
          .map((thread) => ({
            id: thread.id,
            title: thread.title,
            createdAt: thread.createdAt,
          }));

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
          activeThreadId: threads[0]?.id || null,
          createdAt: workspace.createdAt,
          updatedAt: threads[threads.length - 1]?.createdAt || workspace.createdAt,
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);

    return workspaces;
  } catch {
    return null;
  }
}

export async function persistBridgeSetting(input: BridgeSettingInput): Promise<void> {
  try {
    const current = await convexClient.query(api.persistence.getSettings, { id: 'default' });
    const currentPreferences = (current?.preferences && typeof current.preferences === 'object')
      ? (current.preferences as Record<string, unknown>)
      : {};
    const apiKey = input.apiKey !== undefined
      ? input.apiKey
      : (typeof currentPreferences.apiKey === 'string' ? currentPreferences.apiKey : '');

    await convexClient.mutation(api.persistence.saveSettings, {
      id: 'default',
      bridgeUrl: input.bridgeUrl,
      preferences: {
        ...currentPreferences,
        apiKey,
      },
    });
  } catch {
    // Best-effort persistence; local state remains source of truth if network fails.
  }
}

export async function fetchBridgeSetting(): Promise<BridgeSettingsResult | null> {
  try {
    const settings = await convexClient.query(api.persistence.getSettings, { id: 'default' });
    if (!settings) return null;
    const preferences = settings.preferences && typeof settings.preferences === 'object'
      ? (settings.preferences as Record<string, unknown>)
      : {};
    return {
      bridgeUrl: settings.bridgeUrl || '',
      apiKey: typeof preferences.apiKey === 'string' ? preferences.apiKey : '',
    };
  } catch {
    return null;
  }
}
