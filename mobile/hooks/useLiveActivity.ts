import { Platform } from 'react-native';

let LiveActivity: typeof import('expo-live-activity') | null = null;

// Lazy load — will be null in Expo Go or Android
try {
  LiveActivity = require('expo-live-activity');
} catch {
  LiveActivity = null;
}

// Track active live activities by agentId
const activeActivities = new Map<string, string>(); // agentId -> activityId

export function isLiveActivitySupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (!LiveActivity) return false;
  try {
    return LiveActivity.areActivitiesEnabled?.() ?? false;
  } catch {
    return false;
  }
}

export async function startAgentActivity(agentId: string, agentName: string, status: string) {
  if (!isLiveActivitySupported() || !LiveActivity) return;
  // Don't start duplicate
  if (activeActivities.has(agentId)) {
    await updateAgentActivity(agentId, status);
    return;
  }

  try {
    const activityId = await LiveActivity.startActivity(
      {
        title: agentName,
        subtitle: status,
        progressBar: {
          elapsedTimer: true,
          date: new Date().toISOString(),
        },
      },
      {
        deepLinkUrl: `nova-chat://thread/${agentId}`,
      },
    );
    if (activityId) {
      activeActivities.set(agentId, activityId);
    }
  } catch (err) {
    console.warn('[LiveActivity] Failed to start:', err);
  }
}

export async function updateAgentActivity(agentId: string, status: string, subtitle?: string) {
  if (!LiveActivity) return;
  const activityId = activeActivities.get(agentId);
  if (!activityId) return;

  try {
    await LiveActivity.updateActivity(activityId, {
      subtitle: subtitle || status,
    });
  } catch {
    // Activity may have expired
    activeActivities.delete(agentId);
  }
}

export async function stopAgentActivity(agentId: string, finalStatus?: string) {
  if (!LiveActivity) return;
  const activityId = activeActivities.get(agentId);
  if (!activityId) return;

  try {
    await LiveActivity.stopActivity(activityId, {
      subtitle: finalStatus || 'Completed',
    });
  } catch {
    // Already stopped
  }
  activeActivities.delete(agentId);
}
