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
import type { UsageSummaryData } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  usageSummary: UsageSummaryData | null | undefined;
  threadLabelById: Map<string, string>;
  onClose: () => void;
}

export function UsageAnalyticsModal({
  visible,
  styles,
  usageSummary,
  threadLabelById,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Usage Analytics</Text>
          <View style={styles.usageSummaryGrid}>
            <View style={styles.usageSummaryCard}>
              <Text style={styles.usageSummaryLabel}>Messages (today)</Text>
              <Text style={styles.usageSummaryValue}>{usageSummary?.messagesSentToday ?? 0}</Text>
            </View>
            <View style={styles.usageSummaryCard}>
              <Text style={styles.usageSummaryLabel}>Messages (7d)</Text>
              <Text style={styles.usageSummaryValue}>{usageSummary?.messagesSentWeek ?? 0}</Text>
            </View>
            <View style={styles.usageSummaryCard}>
              <Text style={styles.usageSummaryLabel}>Turns (today)</Text>
              <Text style={styles.usageSummaryValue}>{usageSummary?.today?.turns ?? 0}</Text>
            </View>
            <View style={styles.usageSummaryCard}>
              <Text style={styles.usageSummaryLabel}>Turns (7d)</Text>
              <Text style={styles.usageSummaryValue}>{usageSummary?.week?.turns ?? 0}</Text>
            </View>
          </View>

          <View style={styles.usageCostBox}>
            <Text style={styles.usageCostText}>
              Est. cost today: ${(usageSummary?.today?.estimatedCostUsd ?? 0).toFixed(4)}
            </Text>
            <Text style={styles.usageCostText}>
              Est. cost 7d: ${(usageSummary?.week?.estimatedCostUsd ?? 0).toFixed(4)}
            </Text>
          </View>

          <Text style={styles.label}>Active Time per Agent (7d)</Text>
          <ScrollView style={styles.fileListWrap}>
            {(usageSummary?.agents || []).map((entry) => (
              <View key={entry.agentId} style={styles.usageAgentRow}>
                <View style={styles.usageAgentMeta}>
                  <Text style={styles.usageAgentTitle} numberOfLines={1}>
                    {threadLabelById.get(entry.agentId) || entry.agentId}
                  </Text>
                  <Text style={styles.usageAgentSub} numberOfLines={1}>
                    {entry.model} • turns {entry.turns} • errors {entry.errorCount}
                  </Text>
                </View>
                <Text style={styles.usageAgentTime}>{Math.round((entry.activeTimeMs || 0) / 60000)}m</Text>
              </View>
            ))}
            {(usageSummary?.agents || []).length === 0 && (
              <Text style={styles.fileHint}>No turn metrics yet. Send messages to start tracking.</Text>
            )}
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
