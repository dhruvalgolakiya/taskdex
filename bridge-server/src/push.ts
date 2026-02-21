// Expo Push Notification sender
// Uses Expo's free push API — no APNs/FCM keys needed

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  subtitle?: string;
  sound?: 'default' | null;
  categoryId?: string;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  data?: Record<string, unknown>;
}

const clientPushTokens = new Map<string, Set<string>>();

export function registerPushToken(clientId: string, token: string) {
  if (!clientId) return;
  if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
    const existing = clientPushTokens.get(clientId) || new Set<string>();
    existing.add(token);
    clientPushTokens.set(clientId, existing);
    console.log(`  📱 Push token registered for ${clientId.slice(0, 8)}: ${token.slice(0, 30)}...`);
  }
}

export function removePushToken(clientId: string, token: string) {
  const existing = clientPushTokens.get(clientId);
  if (!existing) return;
  existing.delete(token);
  if (existing.size === 0) {
    clientPushTokens.delete(clientId);
  }
}

export function removeClientPushTokens(clientId: string) {
  clientPushTokens.delete(clientId);
}

export function getRegisteredTokenCount(): number {
  let total = 0;
  for (const tokens of clientPushTokens.values()) {
    total += tokens.size;
  }
  return total;
}

export function getRegisteredClientCount(): number {
  return clientPushTokens.size;
}

export async function sendPushNotification(opts: {
  title: string;
  body: string;
  subtitle?: string;
  agentId?: string;
  categoryId?: string;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  replyHint?: string;
}) {
  if (clientPushTokens.size === 0) return;

  const messages: PushMessage[] = [];
  for (const tokens of clientPushTokens.values()) {
    for (const token of tokens) {
      messages.push({
        to: token,
        title: opts.title,
        body: opts.body,
        subtitle: opts.subtitle,
        sound: 'default',
        categoryId: opts.categoryId || 'thread-reply',
        channelId: opts.channelId || 'thread-updates',
        priority: opts.priority || 'high',
        data: {
          kind: 'thread_complete',
          agentId: opts.agentId || '',
          canReply: true,
          replyHint: opts.replyHint || 'Tap and hold to reply',
        },
      });
    }
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.error(`  Push send failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('  Push send error:', err);
  }
}
