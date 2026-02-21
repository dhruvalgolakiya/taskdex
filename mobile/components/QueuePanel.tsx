import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { QueuedMessage } from '../types';
import type { Palette } from '../theme';
import { typography } from '../theme';

interface Props {
  colors: Palette;
  items: QueuedMessage[];
  collapsed: boolean;
  isWorking: boolean;
  onToggle: () => void;
  onEdit: (item: QueuedMessage) => void;
  onRemove: (itemId: string) => void;
  onMove: (itemId: string, direction: -1 | 1) => void;
  onSendNext: () => void;
  onClear: () => void;
}

export function QueuePanel({
  colors,
  items,
  collapsed,
  isWorking,
  onToggle,
  onEdit,
  onRemove,
  onMove,
  onSendNext,
  onClear,
}: Props) {
  const s = useMemo(() => createStyles(colors), [colors]);
  const count = items.length;

  return (
    <View style={s.wrap}>
      <Pressable style={s.header} onPress={onToggle}>
        <View style={s.headerLeft}>
          <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
          <Text style={s.headerText}>Queued {count}</Text>
          {isWorking && <Text style={s.headerHint}>while running</Text>}
        </View>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={colors.textMuted}
        />
      </Pressable>

      {!collapsed && (
        <View style={s.body}>
          <View style={s.actions}>
            <Pressable style={s.actionBtn} onPress={onSendNext}>
              <Text style={s.actionText}>Send next</Text>
            </Pressable>
            <Pressable style={s.actionBtn} onPress={onClear}>
              <Text style={s.actionText}>Clear</Text>
            </Pressable>
          </View>

          {items.map((item, idx) => (
            <View key={item.id} style={s.row}>
              <View style={s.rowTextWrap}>
                <Text style={s.rowIndex}>{idx + 1}</Text>
                <Text style={s.rowText} numberOfLines={2}>{item.text}</Text>
              </View>
              <View style={s.rowActions}>
                <Pressable
                  style={[s.iconBtn, idx === 0 && s.iconBtnDisabled]}
                  onPress={() => onMove(item.id, -1)}
                  disabled={idx === 0}
                >
                  <Ionicons name="chevron-up" size={13} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  style={[s.iconBtn, idx === count - 1 && s.iconBtnDisabled]}
                  onPress={() => onMove(item.id, 1)}
                  disabled={idx === count - 1}
                >
                  <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
                </Pressable>
                <Pressable style={s.iconBtn} onPress={() => onEdit(item)}>
                  <Ionicons name="pencil-outline" size={13} color={colors.textSecondary} />
                </Pressable>
                <Pressable style={s.iconBtn} onPress={() => onRemove(item.id)}>
                  <Ionicons name="trash-outline" size={13} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  header: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceSubtle,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: typography.semibold,
  },
  headerHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: typography.medium,
  },
  body: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  actionText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  rowTextWrap: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  rowIndex: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
    minWidth: 10,
    fontFamily: typography.mono,
  },
  rowText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDisabled: {
    opacity: 0.45,
  },
});
