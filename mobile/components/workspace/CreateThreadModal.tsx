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
  newThreadTitle: string;
  placeholder: string;
  creatingThread: boolean;
  createDisabled: boolean;
  onChangeNewThreadTitle: (value: string) => void;
  onCreateThread: () => void;
  onClose: () => void;
}

export function CreateThreadModal({
  visible,
  styles,
  colors,
  newThreadTitle,
  placeholder,
  creatingThread,
  createDisabled,
  onChangeNewThreadTitle,
  onCreateThread,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>New Thread</Text>
          <Text style={styles.label}>Thread Name (optional)</Text>
          <TextInput
            style={styles.input}
            value={newThreadTitle}
            onChangeText={onChangeNewThreadTitle}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            autoFocus={true}
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, creatingThread && { opacity: 0.55 }]}
              onPress={onCreateThread}
              disabled={createDisabled}
            >
              <Text style={styles.primaryText}>{creatingThread ? 'Creating...' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
