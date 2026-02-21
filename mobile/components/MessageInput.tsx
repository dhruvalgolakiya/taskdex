import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../theme';
import { typography } from '../theme';

interface Props {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  isWorking?: boolean;
  queueCount?: number;
  disabled?: boolean;
  bottomInset?: number;
  colors: Palette;
}

export function MessageInput({
  onSend,
  onInterrupt,
  isWorking = false,
  queueCount = 0,
  disabled,
  bottomInset = 0,
  colors,
}: Props) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState('');

  const handlePrimaryAction = () => {
    const trimmed = text.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setText('');
      return;
    }
    if (isWorking) {
      if (!disabled && onInterrupt) onInterrupt();
    }
  };

  const hasDraft = !!text.trim();
  const isPrimaryDisabled = !!disabled || (!hasDraft && (!isWorking || !onInterrupt));
  const primaryIcon = hasDraft ? 'arrow-up' : (isWorking ? 'stop-circle-outline' : 'arrow-up');
  const placeholder = isWorking ? 'Queue a message while working...' : 'Message Codex...';

  return (
    <View style={[styles.wrapper, { paddingBottom: bottomInset }]}>
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={10000}
          editable={!disabled}
          onSubmitEditing={handlePrimaryAction}
          blurOnSubmit={false}
        />
        {queueCount > 0 && (
          <View style={styles.queueBadge}>
            <Text style={styles.queueBadgeText}>{Math.min(queueCount, 99)}</Text>
          </View>
        )}
        <Pressable
          style={[
            styles.sendBtn,
            !hasDraft && isWorking && styles.sendBtnInterrupt,
            isPrimaryDisabled && styles.sendBtnDisabled,
          ]}
          onPress={handlePrimaryAction}
          disabled={isPrimaryDisabled}
        >
          <Ionicons
            name={primaryIcon}
            size={18}
            color={colors.background}
          />
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  wrapper: {
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: colors.background,
    borderTopWidth: 0,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 3,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
    fontFamily: typography.regular,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    marginLeft: 10,
    backgroundColor: colors.accent,
    borderRadius: 999,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnInterrupt: {
    backgroundColor: colors.textSecondary,
  },
  sendBtnDisabled: {
    backgroundColor: colors.textMuted,
  },
  queueBadge: {
    marginLeft: 8,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  queueBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.semibold,
  },
});
