import React from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import type { DashboardAgentRow } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  filter: 'all' | 'active' | 'stopped';
  dashboardAgents: DashboardAgentRow[];
  onChangeFilter: (filter: 'all' | 'active' | 'stopped') => void;
  onOpenThread: (workspaceId: string, threadId: string) => void;
  onLongPressAgent: (workspaceId: string, threadId: string, status: string) => void;
  onClose: () => void;
}

export function AgentDashboardModal({
  visible,
  styles,
  filter,
  dashboardAgents,
  onChangeFilter,
  onOpenThread,
  onLongPressAgent,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Agent Dashboard</Text>
          <View style={styles.themeModeRow}>
            {(['all', 'active', 'stopped'] as const).map((nextFilter) => (
              <Pressable
                key={nextFilter}
                style={[styles.themeModeChip, filter === nextFilter && styles.themeModeChipActive]}
                onPress={() => onChangeFilter(nextFilter)}
              >
                <Text style={[styles.themeModeChipText, filter === nextFilter && styles.themeModeChipTextActive]}>
                  {nextFilter}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.fileListWrap}>
            {dashboardAgents.map((row) => (
              <Pressable
                key={`${row.workspaceId}_${row.threadId}`}
                style={styles.dashboardRow}
                onPress={() => onOpenThread(row.workspaceId, row.threadId)}
                onLongPress={() => onLongPressAgent(row.workspaceId, row.threadId, row.status)}
              >
                <View style={styles.dashboardRowTop}>
                  <Text style={styles.dashboardTitle} numberOfLines={1}>
                    {row.workspaceName} · {row.threadTitle}
                  </Text>
                  <Text style={[styles.dashboardStatusDot, row.status === 'stopped' && styles.dashboardStatusDotStopped]}>
                    ●
                  </Text>
                </View>
                <Text style={styles.dashboardMeta} numberOfLines={1}>
                  {row.model} • {row.status} • {row.minutesAgo}m ago
                </Text>
                <Text style={styles.dashboardMetricLine} numberOfLines={1}>
                  avg {(row.averageResponseMs / 1000).toFixed(1)}s • errors {row.errorCount} • active {Math.round(row.activeTimeMs / 60000)}m
                </Text>
                {!!row.lastPreview && (
                  <Text style={styles.dashboardPreview} numberOfLines={2}>
                    {row.lastPreview}
                  </Text>
                )}
              </Pressable>
            ))}
            {dashboardAgents.length === 0 && <Text style={styles.fileHint}>No agents for this filter.</Text>}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
