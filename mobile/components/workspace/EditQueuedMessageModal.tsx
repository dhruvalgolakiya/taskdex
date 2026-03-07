import React from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
} from 'react-native';
import type { Palette } from '../../theme';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  editingQueueText: string;
  onChangeEditingQueueText: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function EditQueuedMessageModal({
  visible,
  styles,
  colors,
  editingQueueText,
  onChangeEditingQueueText,
  onSave,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Edit Queued Message</Text>
          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={editingQueueText}
            onChangeText={onChangeEditingQueueText}
            placeholder="Update queued message..."
            placeholderTextColor={colors.textMuted}
            multiline
            autoFocus={true}
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, !editingQueueText.trim() && styles.smallActionBtnDisabled]}
              onPress={onSave}
              disabled={!editingQueueText.trim()}
            >
              <Text style={styles.primaryText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
