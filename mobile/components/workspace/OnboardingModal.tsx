import React, { useEffect, useState } from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Palette } from '../../theme';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  bridgeStartCommand: string;
  urlInput: string;
  apiKeyInput: string;
  bridgeHealth: string;
  checkingHealth: boolean;
  onChangeUrlInput: (value: string) => void;
  onChangeApiKeyInput: (value: string) => void;
  onCheckHealth: () => void;
  onSkip: () => void;
  onComplete: () => void;
  onClose: () => void;
}

export function OnboardingModal({
  visible,
  styles,
  colors,
  bridgeStartCommand,
  urlInput,
  apiKeyInput,
  bridgeHealth,
  checkingHealth,
  onChangeUrlInput,
  onChangeApiKeyInput,
  onCheckHealth,
  onSkip,
  onComplete,
  onClose,
}: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (visible) {
      setStep(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Welcome to Taskdex</Text>
          <View style={styles.onboardingDots}>
            {[0, 1, 2].map((currentStep) => (
              <View key={currentStep} style={[styles.onboardingDot, step === currentStep && styles.onboardingDotActive]} />
            ))}
          </View>

          {step === 0 && (
            <View style={styles.onboardingStepWrap}>
              <Text style={styles.onboardingStepTitle}>Control Codex agents from your phone</Text>
              <Text style={styles.onboardingStepBody}>
                Taskdex has two parts: this mobile app and a bridge server running where your code lives.
              </Text>
              <Text style={styles.onboardingStepBody}>
                This walkthrough will help you start the bridge, verify connection, and create your first agent.
              </Text>
            </View>
          )}

          {step === 1 && (
            <View style={styles.onboardingStepWrap}>
              <Text style={styles.onboardingStepTitle}>Start the Bridge</Text>
              <Text style={styles.onboardingStepBody}>
                Run this command on your computer terminal. It installs dependencies, starts bridge + Expo, and prints the QR to open the app:
              </Text>
              <View style={styles.onboardingCommandBox}>
                <Text style={styles.onboardingCommandText}>{bridgeStartCommand}</Text>
              </View>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => {
                  void Clipboard.setStringAsync(bridgeStartCommand);
                }}
              >
                <Text style={styles.cancelText}>Copy Command</Text>
              </Pressable>
            </View>
          )}

          {step === 2 && (
            <View style={styles.onboardingStepWrap}>
              <Text style={styles.onboardingStepTitle}>Review Connection and Create Your First Agent</Text>
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
              <Pressable
                style={[styles.cancelBtn, checkingHealth && styles.smallActionBtnDisabled]}
                onPress={onCheckHealth}
                disabled={checkingHealth}
              >
                <Text style={styles.cancelText}>{checkingHealth ? 'Checking...' : 'Test Connection'}</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onSkip}>
              <Text style={styles.cancelText}>Skip</Text>
            </Pressable>
            {step > 0 && (
              <Pressable style={styles.cancelBtn} onPress={() => setStep((currentStep) => Math.max(0, currentStep - 1))}>
                <Text style={styles.cancelText}>Back</Text>
              </Pressable>
            )}
            {step < 2 ? (
              <Pressable style={styles.primaryBtn} onPress={() => setStep((currentStep) => Math.min(2, currentStep + 1))}>
                <Text style={styles.primaryText}>Next</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.primaryBtn, (!urlInput.trim() || !apiKeyInput.trim()) && styles.smallActionBtnDisabled]}
                disabled={!urlInput.trim() || !apiKeyInput.trim()}
                onPress={onComplete}
              >
                <Text style={styles.primaryText}>Save & Start</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
