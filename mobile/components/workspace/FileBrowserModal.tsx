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
import SyntaxHighlighter from 'react-native-syntax-highlighter';
import atomOneDark from 'react-syntax-highlighter/styles/hljs/atom-one-dark';
import atomOneLight from 'react-syntax-highlighter/styles/hljs/atom-one-light';
import { typography, type ThemeMode } from '../../theme';
import { guessLanguageFromPath } from '../../features/workspace/utils';
import type { WorkspaceFileEntry } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  resolvedTheme: ThemeMode;
  fileBrowserPath: string;
  fileEntries: WorkspaceFileEntry[];
  selectedFilePath: string | null;
  selectedFileContent: string;
  loadingFileEntries: boolean;
  loadingFileContent: boolean;
  fileBrowserError: string | null;
  modifiedFiles: Set<string>;
  onSelectEntry: (entry: WorkspaceFileEntry) => void;
  onBackOrClose: () => void;
  onPrimaryAction: () => void;
  onClose: () => void;
}

export function FileBrowserModal({
  visible,
  styles,
  resolvedTheme,
  fileBrowserPath,
  fileEntries,
  selectedFilePath,
  selectedFileContent,
  loadingFileEntries,
  loadingFileContent,
  fileBrowserError,
  modifiedFiles,
  onSelectEntry,
  onBackOrClose,
  onPrimaryAction,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Files</Text>
          <Text style={styles.fileBrowserPathLabel}>{selectedFilePath || fileBrowserPath}</Text>

          {selectedFilePath ? (
            <ScrollView style={styles.fileViewerWrap}>
              <ScrollView
                horizontal
                bounces={false}
                directionalLockEnabled
                showsHorizontalScrollIndicator={false}
              >
                <SyntaxHighlighter
                  highlighter="hljs"
                  language={guessLanguageFromPath(selectedFilePath)}
                  style={(resolvedTheme === 'dark' ? atomOneDark : atomOneLight) as any}
                  fontFamily={typography.mono}
                  fontSize={12}
                  PreTag={View}
                  CodeTag={Text}
                >
                  {selectedFileContent}
                </SyntaxHighlighter>
              </ScrollView>
            </ScrollView>
          ) : (
            <ScrollView style={styles.fileListWrap}>
              {loadingFileEntries && <Text style={styles.fileHint}>Loading files...</Text>}
              {!loadingFileEntries && fileEntries.map((entry) => (
                <Pressable
                  key={entry.path}
                  style={styles.fileRow}
                  onPress={() => onSelectEntry(entry)}
                >
                  <Text style={styles.fileRowName} numberOfLines={1}>
                    {entry.type === 'directory' ? `[DIR] ${entry.name}` : `[FILE] ${entry.name}`}
                  </Text>
                  {modifiedFiles.has(entry.path) && <Text style={styles.fileRowBadge}>Modified</Text>}
                </Pressable>
              ))}
            </ScrollView>
          )}

          {!!fileBrowserError && <Text style={styles.fileErrorText}>{fileBrowserError}</Text>}

          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onBackOrClose}>
              <Text style={styles.cancelText}>{selectedFilePath ? 'Back' : 'Close'}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, loadingFileContent && styles.smallActionBtnDisabled]}
              onPress={onPrimaryAction}
              disabled={loadingFileContent}
            >
              <Text style={styles.primaryText}>{loadingFileContent ? 'Opening...' : (selectedFilePath ? 'List' : 'Refresh')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
