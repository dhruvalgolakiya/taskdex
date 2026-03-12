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
import {
  formatNotificationTimestamp,
} from '../../features/workspace/utils';
import type {
  NotificationHistoryEntry,
  NotificationLevel,
  NotificationRow,
} from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  notificationRows: NotificationRow[];
  notificationPrefs: Record<string, NotificationLevel>;
  notificationHistory: NotificationHistoryEntry[];
  loadingNotifications: boolean;
  onUpdateLevel: (agentId: string, level: NotificationLevel) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function NotificationsModal({
  visible,
  styles,
  notificationRows,
  notificationPrefs,
  notificationHistory,
  loadingNotifications,
  onUpdateLevel,
  onRefresh,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Notifications</Text>
          <Text style={styles.label}>Per-agent preferences</Text>
          <ScrollView style={styles.fileListWrap}>
            {notificationRows.map((row) => {
              const currentLevel = notificationPrefs[row.agentId] || 'all';
              return (
                <View key={row.agentId} style={styles.notificationPrefRow}>
                  <Text style={styles.notificationPrefTitle} numberOfLines={1}>{row.label}</Text>
                  <View style={styles.notificationPrefChips}>
                    {(['all', 'errors', 'muted'] as const).map((level) => (
                      <Pressable
                        key={level}
                        style={[styles.notificationPrefChip, currentLevel === level && styles.notificationPrefChipActive]}
                        onPress={() => onUpdateLevel(row.agentId, level)}
                      >
                        <Text style={[styles.notificationPrefChipText, currentLevel === level && styles.notificationPrefChipTextActive]}>
                          {level}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
            {notificationRows.length === 0 && (
              <Text style={styles.fileHint}>No agents available yet.</Text>
            )}
          </ScrollView>

          <Text style={styles.label}>History</Text>
          <ScrollView style={styles.fileListWrap}>
            {loadingNotifications && <Text style={styles.fileHint}>Loading notification history...</Text>}
            {!loadingNotifications && notificationHistory.map((entry) => (
              <View key={entry.id} style={styles.notificationHistoryRow}>
                <Text style={styles.notificationHistoryTitle} numberOfLines={1}>
                  {entry.title}
                </Text>
                <Text style={styles.notificationHistoryBody} numberOfLines={2}>
                  {entry.body}
                </Text>
                <Text style={styles.notificationHistoryMeta} numberOfLines={1}>
                  {formatNotificationTimestamp(entry.timestamp)} • {entry.severity} • {entry.status} • tokens {entry.deliveredCount}
                </Text>
              </View>
            ))}
            {!loadingNotifications && notificationHistory.length === 0 && (
              <Text style={styles.fileHint}>No notifications sent yet.</Text>
            )}
          </ScrollView>

          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onRefresh}>
              <Text style={styles.cancelText}>Refresh</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
