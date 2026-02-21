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

const pushTokens = new Set<string>();

export function registerPushToken(token: string) {
  if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
    pushTokens.add(token);
    console.log(`  📱 Push token registered: ${token.slice(0, 30)}...`);
  }
}

export function removePushToken(token: string) {
  pushTokens.delete(token);
}

export function getRegisteredTokenCount(): number {
  return pushTokens.size;
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
  if (pushTokens.size === 0) return;

  const messages: PushMessage[] = [];
  for (const token of pushTokens) {
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
