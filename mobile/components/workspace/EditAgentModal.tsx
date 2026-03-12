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
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../theme';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  modelInput: string;
  cwdInput: string;
  connectionStatus: string;
  savingModel: boolean;
  onChangeModelInput: (value: string) => void;
  onChangeCwdInput: (value: string) => void;
  onOpenDirectoryPicker: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function EditAgentModal({
  visible,
  styles,
  colors,
  modelInput,
  cwdInput,
  connectionStatus,
  savingModel,
  onChangeModelInput,
  onChangeCwdInput,
  onOpenDirectoryPicker,
  onSave,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Edit Agent</Text>
          <Text style={styles.label}>Model</Text>
          <TextInput
            style={styles.input}
            value={modelInput}
            onChangeText={onChangeModelInput}
            placeholder="gpt-5.1-codex"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={true}
          />
          <Text style={styles.label}>Working Directory</Text>
          <TextInput
            style={styles.input}
            value={cwdInput}
            onChangeText={onChangeCwdInput}
            placeholder="/path/to/project"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {connectionStatus === 'connected' && (
            <View style={styles.cwdActions}>
              <Pressable style={styles.cwdActionBtn} onPress={onOpenDirectoryPicker}>
                <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
                <Text style={styles.cwdActionText}>Browse</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose} disabled={savingModel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (savingModel || !modelInput.trim() || !cwdInput.trim()) && styles.smallActionBtnDisabled]}
              onPress={onSave}
              disabled={savingModel || !modelInput.trim() || !cwdInput.trim()}
            >
              <Text style={styles.primaryText}>{savingModel ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
