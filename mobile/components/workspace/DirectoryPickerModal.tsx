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
import type { WorkspaceDirectoryEntry } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  directoryPath: string;
  directoryEntries: WorkspaceDirectoryEntry[];
  loadingDirectories: boolean;
  onNavigateUp: () => void;
  onNavigateTo: (path: string) => void;
  onConfirmSelection: () => void;
  onClose: () => void;
}

export function DirectoryPickerModal({
  visible,
  styles,
  directoryPath,
  directoryEntries,
  loadingDirectories,
  onNavigateUp,
  onNavigateTo,
  onConfirmSelection,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Choose Directory</Text>
          <Text style={styles.fileBrowserPathLabel}>{directoryPath}</Text>
          <ScrollView style={styles.fileListWrap}>
            <Pressable style={styles.fileRow} onPress={onNavigateUp}>
              <Text style={styles.fileRowName}>[DIR] ..</Text>
            </Pressable>
            {loadingDirectories && <Text style={styles.fileHint}>Loading directories...</Text>}
            {!loadingDirectories && directoryEntries.map((entry) => (
              <Pressable key={entry.path} style={styles.fileRow} onPress={() => onNavigateTo(entry.path)}>
                <Text style={styles.fileRowName}>[DIR] {entry.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={onConfirmSelection}>
              <Text style={styles.primaryText}>Select</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
