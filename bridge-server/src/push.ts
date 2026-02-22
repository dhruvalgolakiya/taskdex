// Expo Push Notification sender
// Uses Expo's free push API — no APNs/FCM keys needed

import fs from 'fs';
import os from 'os';
import path from 'path';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CONFIG_DIR = path.join(os.homedir(), '.taskdex');
const NOTIFICATION_PREFS_PATH = path.join(CONFIG_DIR, 'notification-prefs.json');
const MAX_HISTORY = 200;

export type NotificationLevel = 'all' | 'errors' | 'muted';
type NotificationSeverity = 'info' | 'error';

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
const notificationPrefs = new Map<string, NotificationLevel>();
const notificationHistory: Array<{
  id: string;
  timestamp: number;
  agentId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  status: 'sent' | 'muted' | 'no_tokens' | 'error';
  deliveredCount: number;
}> = [];

function normalizeLevel(input: string): NotificationLevel {
  if (input === 'errors' || input === 'muted') return input;
  return 'all';
}

function loadNotificationPrefs() {
  try {
    if (!fs.existsSync(NOTIFICATION_PREFS_PATH)) return;
    const raw = fs.readFileSync(NOTIFICATION_PREFS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [agentId, level] of Object.entries(parsed || {})) {
      if (!agentId.trim()) continue;
      notificationPrefs.set(agentId, normalizeLevel(level));
    }
  } catch (err) {
    console.warn('[push] Failed to load notification prefs:', err);
  }
}

function saveNotificationPrefs() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const payload: Record<string, NotificationLevel> = {};
    for (const [agentId, level] of notificationPrefs.entries()) {
      payload[agentId] = level;
    }
    fs.writeFileSync(NOTIFICATION_PREFS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('[push] Failed to save notification prefs:', err);
  }
}

function appendNotificationHistory(entry: {
  agentId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  status: 'sent' | 'muted' | 'no_tokens' | 'error';
  deliveredCount: number;
}) {
  notificationHistory.push({
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...entry,
  });
  if (notificationHistory.length > MAX_HISTORY) {
    notificationHistory.splice(0, notificationHistory.length - MAX_HISTORY);
  }
}

function shouldSendByLevel(level: NotificationLevel, severity: NotificationSeverity): boolean {
  if (level === 'muted') return false;
  if (level === 'errors' && severity !== 'error') return false;
  return true;
}

export function updateNotificationPreference(agentId: string, level: NotificationLevel) {
  if (!agentId.trim()) return;
  notificationPrefs.set(agentId.trim(), level);
  saveNotificationPrefs();
}

export function getNotificationPreferences(): Record<string, NotificationLevel> {
  const result: Record<string, NotificationLevel> = {};
  for (const [agentId, level] of notificationPrefs.entries()) {
    result[agentId] = level;
  }
  return result;
}

export function getNotificationLevel(agentId: string): NotificationLevel {
  return notificationPrefs.get(agentId) || 'all';
}

export function getNotificationHistory(limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_HISTORY);
  return notificationHistory.slice(-safeLimit).reverse();
}

loadNotificationPrefs();

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
  severity?: NotificationSeverity;
}) {
  const severity: NotificationSeverity = opts.severity || 'info';
  const agentId = opts.agentId || '';
  if (agentId) {
    const level = getNotificationLevel(agentId);
    if (!shouldSendByLevel(level, severity)) {
      appendNotificationHistory({
        agentId,
        title: opts.title,
        body: opts.body,
        severity,
        status: 'muted',
        deliveredCount: 0,
      });
      return;
    }
  }

  if (clientPushTokens.size === 0) {
    appendNotificationHistory({
      agentId,
      title: opts.title,
      body: opts.body,
      severity,
      status: 'no_tokens',
      deliveredCount: 0,
    });
    return;
  }

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
      appendNotificationHistory({
        agentId,
        title: opts.title,
        body: opts.body,
        severity,
        status: 'error',
        deliveredCount: 0,
      });
      return;
    }
    appendNotificationHistory({
      agentId,
      title: opts.title,
      body: opts.body,
      severity,
      status: 'sent',
      deliveredCount: messages.length,
    });
  } catch (err) {
    console.error('  Push send error:', err);
    appendNotificationHistory({
      agentId,
      title: opts.title,
      body: opts.body,
      severity,
      status: 'error',
      deliveredCount: 0,
    });
  }
}
