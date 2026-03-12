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
import { formatExecRunTime } from '../../features/workspace/utils';
import type { ExecModeType, ExecPreset, ExecRunRecord } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  execNameInput: string;
  execModeInput: ExecModeType;
  execPromptInput: string;
  execFlowInput: string;
  execModelInput: string;
  execCwdInput: string;
  execApprovalPolicyInput: 'never' | 'on-request';
  execSystemPromptInput: string;
  runningExec: boolean;
  execPresets: ExecPreset[];
  execRuns: ExecRunRecord[];
  setExecNameInput: (value: string) => void;
  setExecModeInput: (value: ExecModeType) => void;
  setExecPromptInput: (value: string) => void;
  setExecFlowInput: (value: string) => void;
  setExecModelInput: (value: string) => void;
  setExecCwdInput: (value: string) => void;
  setExecApprovalPolicyInput: (value: 'never' | 'on-request') => void;
  setExecSystemPromptInput: (value: string) => void;
  onDismissKeyboard: () => void;
  onSavePreset: () => void;
  onRunNow: () => void;
  onApplyPresetToForm: (preset: ExecPreset) => void;
  onRunPreset: (preset: ExecPreset) => void;
  onDeletePreset: (presetId: string) => void;
  onOpenRunThread: (workspaceId: string, threadId: string) => void;
  onClearRuns: () => void;
  onClose: () => void;
}

export function ExecRunnerModal({
  visible,
  styles,
  colors,
  execNameInput,
  execModeInput,
  execPromptInput,
  execFlowInput,
  execModelInput,
  execCwdInput,
  execApprovalPolicyInput,
  execSystemPromptInput,
  runningExec,
  execPresets,
  execRuns,
  setExecNameInput,
  setExecModeInput,
  setExecPromptInput,
  setExecFlowInput,
  setExecModelInput,
  setExecCwdInput,
  setExecApprovalPolicyInput,
  setExecSystemPromptInput,
  onDismissKeyboard,
  onSavePreset,
  onRunNow,
  onApplyPresetToForm,
  onRunPreset,
  onDeletePreset,
  onOpenRunThread,
  onClearRuns,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <View style={styles.execHeaderRow}>
            <Text style={[styles.modalTitle, styles.execModalTitle]}>Exec Mode</Text>
            <Pressable style={styles.cancelBtn} onPress={onDismissKeyboard}>
              <Text style={styles.cancelText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.execModalContent}
          >
            <Text style={styles.themeHint}>Run non-interactive Codex jobs and multi-step automation flows.</Text>

            <Text style={styles.label}>Job Name</Text>
            <TextInput
              style={styles.input}
              value={execNameInput}
              onChangeText={setExecNameInput}
              placeholder="Nightly bug sweep"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={onDismissKeyboard}
            />

            <Text style={styles.label}>Mode</Text>
            <View style={styles.themeModeRow}>
              {(['task', 'flow'] as ExecModeType[]).map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.themeModeChip, execModeInput === mode && styles.themeModeChipActive]}
                  onPress={() => setExecModeInput(mode)}
                >
                  <Text style={[styles.themeModeChipText, execModeInput === mode && styles.themeModeChipTextActive]}>
                    {mode}
                  </Text>
                </Pressable>
              ))}
            </View>

            {execModeInput === 'task' ? (
              <>
                <Text style={styles.label}>Prompt</Text>
                <TextInput
                  style={[styles.input, styles.systemPromptInput]}
                  value={execPromptInput}
                  onChangeText={setExecPromptInput}
                  placeholder="Run full code review and commit safe fixes."
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>Flow Steps (one per line)</Text>
                <TextInput
                  style={[styles.input, styles.systemPromptInput]}
                  value={execFlowInput}
                  onChangeText={setExecFlowInput}
                  placeholder={`Audit current branch\nFix P0/P1 issues\nRun tests and commit`}
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
              </>
            )}

            <Text style={styles.label}>Model</Text>
            <TextInput
              style={styles.input}
              value={execModelInput}
              onChangeText={setExecModelInput}
              placeholder="gpt-5.1-codex"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={onDismissKeyboard}
            />

            <Text style={styles.label}>Working Directory</Text>
            <TextInput
              style={styles.input}
              value={execCwdInput}
              onChangeText={setExecCwdInput}
              placeholder="/Users/apple/Work/DhruvalPersonal"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={onDismissKeyboard}
            />

            <Text style={styles.label}>Approval Policy</Text>
            <View style={styles.themeModeRow}>
              {(['never', 'on-request'] as const).map((policy) => (
                <Pressable
                  key={policy}
                  style={[styles.themeModeChip, execApprovalPolicyInput === policy && styles.themeModeChipActive]}
                  onPress={() => setExecApprovalPolicyInput(policy)}
                >
                  <Text style={[styles.themeModeChipText, execApprovalPolicyInput === policy && styles.themeModeChipTextActive]}>
                    {policy}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>System Prompt (optional)</Text>
            <TextInput
              style={[styles.input, styles.systemPromptInput]}
              value={execSystemPromptInput}
              onChangeText={setExecSystemPromptInput}
              placeholder="Always include tests and concise summary."
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <View style={styles.execActionRow}>
              <Pressable style={styles.cancelBtn} onPress={onSavePreset}>
                <Text style={styles.cancelText}>Save Preset</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, runningExec && styles.smallActionBtnDisabled]}
                onPress={onRunNow}
                disabled={runningExec}
              >
                <Text style={styles.primaryText}>{runningExec ? 'Starting...' : 'Run Now'}</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Saved Automations</Text>
            <ScrollView style={styles.execListWrap} keyboardShouldPersistTaps="handled">
              {execPresets.map((preset) => (
                <View key={preset.id} style={styles.execListRow}>
                  <View style={styles.execListRowTop}>
                    <Text style={styles.execListTitle} numberOfLines={1}>{preset.name}</Text>
                    <Text style={styles.execListBadge}>{preset.mode}</Text>
                  </View>
                  <Text style={styles.execListMeta} numberOfLines={1}>
                    {preset.model} • {preset.cwd}
                  </Text>
                  <Text style={styles.execListMeta} numberOfLines={1}>
                    {preset.mode === 'flow' ? `${preset.steps.length} steps` : 'Single task'}
                  </Text>
                  <View style={styles.execListActions}>
                    <Pressable style={styles.cancelBtn} onPress={() => onApplyPresetToForm(preset)}>
                      <Text style={styles.cancelText}>Load</Text>
                    </Pressable>
                    <Pressable style={styles.cancelBtn} onPress={() => onRunPreset(preset)}>
                      <Text style={styles.cancelText}>Run</Text>
                    </Pressable>
                    <Pressable style={styles.cancelBtn} onPress={() => onDeletePreset(preset.id)}>
                      <Text style={styles.cancelText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {execPresets.length === 0 && (
                <Text style={styles.fileHint}>Save a preset to reuse job/flow definitions.</Text>
              )}
            </ScrollView>

            <Text style={styles.label}>Recent Runs</Text>
            <ScrollView style={styles.execRunsWrap} keyboardShouldPersistTaps="handled">
              {execRuns.map((run) => (
                <View key={run.id} style={styles.execListRow}>
                  <View style={styles.execListRowTop}>
                    <Text style={styles.execListTitle} numberOfLines={1}>{run.name}</Text>
                    <Text
                      style={[
                        styles.execRunStatus,
                        run.status === 'completed' && styles.execRunStatusCompleted,
                        run.status === 'failed' && styles.execRunStatusFailed,
                      ]}
                    >
                      {run.status}
                    </Text>
                  </View>
                  <Text style={styles.execListMeta} numberOfLines={1}>
                    {run.mode} • {run.stepCount} step{run.stepCount === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.execListMeta} numberOfLines={1}>
                    started {formatExecRunTime(run.startedAt)}
                  </Text>
                  {!!run.finishedAt && (
                    <Text style={styles.execListMeta} numberOfLines={1}>
                      finished {formatExecRunTime(run.finishedAt)}
                    </Text>
                  )}
                  {!!run.error && (
                    <Text style={styles.fileErrorText} numberOfLines={2}>
                      {run.error}
                    </Text>
                  )}
                  {!!run.workspaceId && !!run.threadId && (
                    <View style={styles.execListActions}>
                      <Pressable
                        style={styles.cancelBtn}
                        onPress={() => onOpenRunThread(run.workspaceId!, run.threadId!)}
                      >
                        <Text style={styles.cancelText}>Open Thread</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
              {execRuns.length === 0 && (
                <Text style={styles.fileHint}>No runs yet.</Text>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={onClearRuns}>
                <Text style={styles.cancelText}>Clear Runs</Text>
              </Pressable>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Close</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
