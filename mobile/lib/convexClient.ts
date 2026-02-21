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
