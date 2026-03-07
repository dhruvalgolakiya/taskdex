import React from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import type { Palette } from '../../theme';
import type { RepoEntry } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  cloneRepoUrl: string;
  cloningRepo: boolean;
  loadingRepos: boolean;
  repoEntries: RepoEntry[];
  onChangeCloneRepoUrl: (value: string) => void;
  onCloneRepo: () => void;
  onRefreshRepos: () => void;
  onPullRepo: (repoPath: string) => void;
  onUseRepo: (repoPath: string) => void;
  onClose: () => void;
}

export function RepoManagerModal({
  visible,
  styles,
  colors,
  cloneRepoUrl,
  cloningRepo,
  loadingRepos,
  repoEntries,
  onChangeCloneRepoUrl,
  onCloneRepo,
  onRefreshRepos,
  onPullRepo,
  onUseRepo,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Repositories</Text>
          <TextInput
            style={styles.input}
            value={cloneRepoUrl}
            onChangeText={onChangeCloneRepoUrl}
            placeholder="https://github.com/org/repo.git"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.settingsInlineActions}>
            <Pressable
              style={[styles.cancelBtn, (cloningRepo || !cloneRepoUrl.trim()) && styles.smallActionBtnDisabled]}
              onPress={onCloneRepo}
              disabled={cloningRepo || !cloneRepoUrl.trim()}
            >
              <Text style={styles.cancelText}>{cloningRepo ? 'Cloning...' : 'Clone Repo'}</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onRefreshRepos}>
              <Text style={styles.cancelText}>Refresh</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.fileListWrap}>
            {loadingRepos && <Text style={styles.fileHint}>Loading repositories...</Text>}
            {!loadingRepos && repoEntries.map((repo) => (
              <View key={repo.path} style={styles.repoRow}>
                <View style={styles.repoMeta}>
                  <Text style={styles.repoName} numberOfLines={1}>{repo.name}</Text>
                  <Text style={styles.repoPath} numberOfLines={1}>{repo.path}</Text>
                </View>
                <Pressable style={styles.cancelBtn} onPress={() => onPullRepo(repo.path)}>
                  <Text style={styles.cancelText}>Pull</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => onUseRepo(repo.path)}
                >
                  <Text style={styles.primaryText}>Use</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
