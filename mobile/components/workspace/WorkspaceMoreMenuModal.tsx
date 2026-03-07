import React from 'react';
import { Modal, Pressable, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../theme';

interface WorkspaceMoreMenuItem {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  items: WorkspaceMoreMenuItem[];
  onClose: () => void;
}

export function WorkspaceMoreMenuModal({
  visible,
  styles,
  colors,
  items,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.moreMenuSheet} onPress={() => {}}>
          <View style={styles.moreMenuHandle} />
          {items.map((item) => (
            <Pressable
              key={item.label}
              style={({ pressed }: { pressed: boolean }) => [styles.moreMenuItem, item.disabled && styles.smallActionBtnDisabled, pressed && styles.pressed]}
              onPress={item.onPress}
              disabled={item.disabled}
            >
              <Ionicons name={item.icon} size={20} color={colors.textPrimary} />
              <Text style={styles.moreMenuItemText}>{item.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
