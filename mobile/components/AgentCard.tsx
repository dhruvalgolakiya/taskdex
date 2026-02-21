import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { Agent } from '../types';
import { palette, STATUS_COLORS, typography } from '../theme';

interface Props {
  agent: Agent;
  onPress: () => void;
  onLongPress: () => void;
  onEditModel: () => void;
}

export function AgentCard({ agent, onPress, onLongPress, onEditModel }: Props) {
  const lastMessage = agent.messages[agent.messages.length - 1];
  const statusColor = STATUS_COLORS[agent.status] || palette.textMuted;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={styles.name} numberOfLines={1}>
            {agent.name}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.model} numberOfLines={1}>
            {agent.model}
          </Text>
          <Pressable onPress={onEditModel} style={styles.editButton}>
            <Text style={styles.editButtonText}>Edit</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.statusPill, { backgroundColor: `${statusColor}16` }]}>
        <View style={[styles.statusPillDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.status, { color: statusColor }]}>{agent.status}</Text>
      </View>

      {lastMessage && (
        <Text style={styles.preview} numberOfLines={2}>
          {lastMessage.role === 'user' ? 'You: ' : ''}
          {lastMessage.text}
        </Text>
      )}

      <View style={styles.cwdBox}>
        <Text style={styles.cwdLabel}>cwd</Text>
        <Text style={styles.cwd} numberOfLines={1}>
          {agent.cwd}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 8,
    marginRight: 10,
  },
  name: {
    color: palette.textPrimary,
    fontSize: 18,
    fontFamily: typography.display,
    flex: 1,
  },
  model: {
    color: palette.textMuted,
    fontSize: 11,
    fontFamily: typography.mono,
    maxWidth: 130,
  },
  editButton: {
    backgroundColor: palette.accentSoft,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  editButtonText: {
    color: palette.accent,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 10,
  },
  statusPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  status: {
    fontSize: 11,
    fontFamily: typography.semibold,
    textTransform: 'capitalize',
  },
  preview: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
    fontFamily: typography.regular,
  },
  cwdBox: {
    backgroundColor: palette.surfaceSubtle,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cwdLabel: {
    color: palette.textMuted,
    fontSize: 10,
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: typography.semibold,
  },
  cwd: {
    color: palette.textMuted,
    fontSize: 11,
    fontFamily: typography.mono,
  },
});
