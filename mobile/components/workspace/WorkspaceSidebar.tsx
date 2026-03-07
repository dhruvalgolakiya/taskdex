import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AgentWorkspace } from '../../types';
import type { Palette } from '../../theme';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  insetsBottom: number;
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  expandedWorkspaceId: string | null;
  onSetExpandedWorkspaceId: (workspaceId: string | null) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onRequestCreateWorkspace: () => void;
  onRequestCreateThread: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string, workspaceName: string) => void;
  onRemoveThread: (workspaceId: string, threadId: string, threadTitle: string) => void;
  onClose: () => void;
}

export function WorkspaceSidebar({
  visible,
  styles,
  colors,
  insetsBottom,
  workspaces,
  activeWorkspaceId,
  activeThreadId,
  expandedWorkspaceId,
  onSetExpandedWorkspaceId,
  onSelectWorkspace,
  onSelectThread,
  onRequestCreateWorkspace,
  onRequestCreateThread,
  onDeleteWorkspace,
  onRemoveThread,
  onClose,
}: Props) {
  if (!visible) return null;

  return (
    <View style={styles.sidebarOverlay}>
      <View style={[styles.sidebar, { paddingBottom: insetsBottom }]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>Chats</Text>
          <Pressable style={styles.sidebarCloseBtn} onPress={onClose}>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.sidebarContent} showsVerticalScrollIndicator={false}>
          <View style={styles.sidebarSection}>
            <View style={styles.sidebarSectionHeader}>
              <Text style={styles.sidebarSectionTitle}>Agents</Text>
              <Pressable style={styles.linkActionBtn} onPress={onRequestCreateWorkspace}>
                <Text style={styles.linkActionText}>+ New</Text>
              </Pressable>
            </View>
            {workspaces.map((workspace) => {
              const isActive = workspace.id === activeWorkspaceId;
              const isExpanded = expandedWorkspaceId === workspace.id;
              return (
                <View key={workspace.id} style={[styles.workspaceCard, isActive && styles.workspaceCardActive]}>
                  <View style={styles.workspaceCardHeader}>
                    <Pressable
                      style={styles.workspaceMainPress}
                      onPress={() => {
                        onSelectWorkspace(workspace.id);
                        onSetExpandedWorkspaceId(workspace.id);
                      }}
                    >
                      <View style={styles.sidebarItemRow}>
                        <View style={styles.sidebarItemTextWrap}>
                          <Text style={[styles.sidebarItemText, isActive && styles.sidebarItemTextActive]} numberOfLines={1}>
                            {workspace.name}
                          </Text>
                          <Text style={[styles.sidebarItemMeta, isActive && styles.sidebarItemMetaActive]} numberOfLines={1}>
                            {workspace.model} • {workspace.threads.length} threads
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                    <View style={styles.workspaceActions}>
                      <Pressable
                        style={({ pressed }) => [styles.sidebarIconBtn, pressed && styles.pressed]}
                        onPress={() => {
                          onSelectWorkspace(workspace.id);
                          onSetExpandedWorkspaceId(workspace.id);
                          onRequestCreateThread(workspace.id);
                        }}
                        hitSlop={6}
                      >
                        <Ionicons name="add" size={14} color={colors.accent} />
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.sidebarDeleteBtn, pressed && styles.pressed]}
                        onPress={() => onDeleteWorkspace(workspace.id, workspace.name)}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={14}
                          color={isActive ? colors.accent : colors.textMuted}
                        />
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.sidebarIconBtn, pressed && styles.pressed]}
                        onPress={() => onSetExpandedWorkspaceId(isExpanded ? null : workspace.id)}
                        hitSlop={6}
                      >
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color={isActive ? colors.accent : colors.textMuted}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {isExpanded && (
                    <View style={styles.threadDropdown}>
                      {workspace.threads.map((thread) => {
                        const isThreadActive = isActive && thread.id === activeThreadId;
                        return (
                          <Pressable
                            key={thread.id}
                            style={[styles.threadRow, isThreadActive && styles.threadRowActive]}
                            onPress={() => {
                              onSelectThread(workspace.id, thread.id);
                              onClose();
                            }}
                            onLongPress={() => onRemoveThread(workspace.id, thread.id, thread.title)}
                          >
                            <View style={styles.threadRowInner}>
                              <View style={styles.threadLeft}>
                                <View style={[styles.threadMarker, isThreadActive && styles.threadMarkerActive]} />
                                <View style={styles.sidebarItemTextWrap}>
                                  <Text style={[styles.threadTitle, isThreadActive && styles.sidebarItemTextActive]} numberOfLines={1}>
                                    {thread.title}
                                  </Text>
                                  <Text style={[styles.threadMeta, isThreadActive && styles.threadMetaActive]} numberOfLines={1}>
                                    {thread.id.slice(0, 8)}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </Pressable>
                        );
                      })}
                      {workspace.threads.length === 0 && <Text style={styles.sidebarEmpty}>No threads yet.</Text>}
                    </View>
                  )}
                </View>
              );
            })}
            {workspaces.length === 0 && <Text style={styles.sidebarEmpty}>No agents yet.</Text>}
          </View>
        </ScrollView>
      </View>
      <Pressable style={styles.sidebarScrim} onPress={onClose} />
    </View>
  );
}
