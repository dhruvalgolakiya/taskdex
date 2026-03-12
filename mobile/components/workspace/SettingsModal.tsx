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
import type { Palette, ThemeMode, ThemePreference } from '../../theme';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  urlInput: string;
  apiKeyInput: string;
  bridgeHealth: string;
  themePreference: ThemePreference;
  resolvedTheme: ThemeMode;
  checkingHealth: boolean;
  sendingTestNotification: boolean;
  saved: boolean;
  onChangeUrlInput: (value: string) => void;
  onChangeApiKeyInput: (value: string) => void;
  onChangeThemePreference: (preference: ThemePreference) => void;
  onCheckHealth: () => void;
  onSendTestNotification: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function SettingsModal({
  visible,
  styles,
  colors,
  urlInput,
  apiKeyInput,
  bridgeHealth,
  themePreference,
  resolvedTheme,
  checkingHealth,
  sendingTestNotification,
  saved,
  onChangeUrlInput,
  onChangeApiKeyInput,
  onChangeThemePreference,
  onCheckHealth,
  onSendTestNotification,
  onSave,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Settings</Text>
          <Text style={styles.label}>Bridge WebSocket URL</Text>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={onChangeUrlInput}
            placeholder="ws://192.168.1.x:3001"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.label}>Bridge API Key</Text>
          <TextInput
            style={styles.input}
            value={apiKeyInput}
            onChangeText={onChangeApiKeyInput}
            placeholder="Paste bridge API key"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={true}
          />
          <Text style={styles.themeHint}>{bridgeHealth}</Text>
          <Text style={styles.label}>Appearance</Text>
          <View style={styles.themeModeRow}>
            {(['system', 'light', 'dark'] as ThemePreference[]).map((mode) => {
              const active = mode === themePreference;
              return (
                <Pressable
                  key={mode}
                  style={[styles.themeModeChip, active && styles.themeModeChipActive]}
                  onPress={() => onChangeThemePreference(mode)}
                >
                  <Text style={[styles.themeModeChipText, active && styles.themeModeChipTextActive]}>
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.themeHint}>Current theme: {resolvedTheme}</Text>
          <View style={styles.settingsInlineActions}>
            <Pressable
              style={[styles.cancelBtn, checkingHealth && styles.smallActionBtnDisabled]}
              onPress={onCheckHealth}
              disabled={checkingHealth}
            >
              <Text style={styles.cancelText}>{checkingHealth ? 'Checking...' : 'Check Health'}</Text>
            </Pressable>
            <Pressable
              style={[styles.cancelBtn, sendingTestNotification && styles.smallActionBtnDisabled]}
              onPress={onSendTestNotification}
              disabled={sendingTestNotification}
            >
              <Text style={styles.cancelText}>
                {sendingTestNotification ? 'Sending...' : 'Test Notification'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={onSave}>
              <Text style={styles.primaryText}>{saved ? 'Saved' : 'Save & Connect'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
