import { Platform } from 'react-native';

let LiveActivity: typeof import('expo-live-activity') | null = null;

// Lazy load — will be null in Expo Go or Android
try {
  LiveActivity = require('expo-live-activity');
} catch {
  LiveActivity = null;
}

type ActiveActivity = {
  id: string;
  title: string;
};

// Track active live activities by agentId.
const activeActivities = new Map<string, ActiveActivity>();

export function isLiveActivitySupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (!LiveActivity) return false;
  return typeof LiveActivity.startActivity === 'function';
}

export async function startAgentActivity(agentId: string, agentName: string, status: string) {
  if (!isLiveActivitySupported() || !LiveActivity) return;
  const title = agentName.trim() || 'Agent';
  // Don't start duplicate
  const existing = activeActivities.get(agentId);
  if (existing) {
    if (existing.title !== title) {
      activeActivities.set(agentId, { ...existing, title });
    }
    await updateAgentActivity(agentId, status);
    return;
  }

  try {
    const activityId = await LiveActivity.startActivity(
      {
        title,
        subtitle: status,
        progressBar: {
          date: Date.now(),
        },
      },
      {
        deepLinkUrl: `taskdex://thread/${agentId}`,
      },
    );
    if (activityId) {
      activeActivities.set(agentId, { id: activityId, title });
    }
  } catch (err) {
    console.warn('[LiveActivity] Failed to start:', err);
  }
}

export async function updateAgentActivity(agentId: string, status: string, subtitle?: string) {
  if (!LiveActivity) return;
  const activity = activeActivities.get(agentId);
  if (!activity) return;

  try {
    await LiveActivity.updateActivity(activity.id, {
      title: activity.title,
      subtitle: subtitle || status,
    });
  } catch {
    // Activity may have expired
    activeActivities.delete(agentId);
  }
}

export async function stopAgentActivity(agentId: string, finalStatus?: string) {
  if (!LiveActivity) return;
  const activity = activeActivities.get(agentId);
  if (!activity) return;

  try {
    await LiveActivity.stopActivity(activity.id, {
      title: activity.title,
      subtitle: finalStatus || 'Completed',
    });
  } catch {
    // Already stopped
  }
  activeActivities.delete(agentId);
}
