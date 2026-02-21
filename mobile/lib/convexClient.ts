import { ConvexReactClient } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { AgentMessage } from '../types';

export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

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
  createdAt: number;
}

interface ThreadRecordInput {
  id: string;
  workspaceId: string;
  title: string;
  bridgeAgentId: string;
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
