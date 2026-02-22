import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type WidgetBridgeModule = {
  setSummaryJson: (summaryJson: string) => boolean;
  clearSummary: () => boolean;
  getSummaryJson: () => string;
};

export type AgentWidgetSummary = {
  id: string;
  name: string;
  status: string;
  deepLinkUrl: string;
};

const nativeModule: WidgetBridgeModule | null = Platform.OS === 'ios'
  ? requireOptionalNativeModule<WidgetBridgeModule>('PylonWidgetBridge')
  : null;

export function setWidgetSummary(agents: AgentWidgetSummary[]) {
  if (!nativeModule) return;
  const normalized = agents
    .filter((entry) => !!entry.id && !!entry.name)
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      status: entry.status || 'stopped',
      deepLinkUrl: entry.deepLinkUrl || `pylon://thread/${entry.id}`,
    }));
  nativeModule.setSummaryJson(JSON.stringify(normalized));
}

export function clearWidgetSummary() {
  if (!nativeModule) return;
  nativeModule.clearSummary();
}

export function getWidgetSummaryJson(): string {
  if (!nativeModule) return '[]';
  return nativeModule.getSummaryJson();
}
