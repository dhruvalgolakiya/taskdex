import React from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import type { GitStatusInfo } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  gitStatus: GitStatusInfo | null;
  gitDiff: string;
  gitBranches: string[];
  loadingGit: boolean;
  committingGit: boolean;
  onSwitchBranch: (branch: string) => void;
  onRefresh: () => void;
  onCommit: () => void;
  onClose: () => void;
}

export function GitModal({
  visible,
  styles,
  gitStatus,
  gitDiff,
  gitBranches,
  loadingGit,
  committingGit,
  onSwitchBranch,
  onRefresh,
  onCommit,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Git</Text>
          <View style={styles.gitStatusCard}>
            <Text style={styles.gitStatusTitle}>{gitStatus?.branch || 'No git data yet'}</Text>
            <Text style={styles.gitStatusSub}>
              {gitStatus ? (gitStatus.isClean ? 'Working tree clean' : 'Uncommitted changes detected') : 'Connect workspace to load repository status'}
            </Text>
          </View>

          <View style={styles.gitBlock}>
            {loadingGit && <Text style={styles.fileHint}>Loading git info...</Text>}

            {!loadingGit && (
              <>
                <Text style={styles.gitSectionTitle}>Branches</Text>
                {gitBranches.length > 0 ? (
                  <ScrollView style={styles.gitBranchList} contentContainerStyle={styles.gitBranchWrap}>
                    {gitBranches.map((branch) => {
                      const normalizedBranch = branch.replace(/^\*\s*/, '');
                      const isActiveBranch = normalizedBranch === gitStatus?.branch;
                      return (
                        <Pressable
                          key={branch}
                          style={[styles.gitBranchChip, isActiveBranch && styles.gitBranchChipActive]}
                          onPress={() => onSwitchBranch(normalizedBranch)}
                        >
                          <Text style={[styles.gitBranchText, isActiveBranch && styles.gitBranchTextActive]}>{normalizedBranch}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <Text style={styles.fileHint}>No branches available.</Text>
                )}

                <Text style={styles.gitSectionTitle}>Diff</Text>
                <ScrollView style={styles.gitDiffBox}>
                  <Text style={styles.gitDiffText}>{gitDiff || 'No diff'}</Text>
                </ScrollView>
              </>
            )}
          </View>

          <View style={styles.gitActionRow}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            <Pressable style={[styles.cancelBtn, loadingGit && styles.smallActionBtnDisabled]} onPress={onRefresh}>
              <Text style={styles.cancelText}>Refresh</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (committingGit || gitStatus?.isClean) && styles.smallActionBtnDisabled]}
              onPress={onCommit}
              disabled={committingGit || !!gitStatus?.isClean}
            >
              <Text style={styles.primaryText}>{committingGit ? 'Committing...' : 'Commit'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
