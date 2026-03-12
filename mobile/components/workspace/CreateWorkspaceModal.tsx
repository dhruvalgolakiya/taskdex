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
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../theme';
import type { AgentTemplate } from '../../types';
import type { WorkspaceApprovalPolicy } from '../../features/workspace/types';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  colors: Palette;
  availableTemplates: AgentTemplate[];
  modelOptions: string[];
  selectedTemplateId: string;
  newWorkspaceName: string;
  newWorkspaceModel: string;
  newWorkspaceCwd: string;
  newWorkspaceApprovalPolicy: WorkspaceApprovalPolicy;
  newWorkspaceSystemPrompt: string;
  customTemplateName: string;
  savingTemplate: boolean;
  creatingWorkspace: boolean;
  connectionStatus: string;
  onApplyTemplate: (template: AgentTemplate) => void;
  onChangeNewWorkspaceName: (value: string) => void;
  onChangeNewWorkspaceModel: (value: string) => void;
  onChangeNewWorkspaceCwd: (value: string) => void;
  onChangeNewWorkspaceApprovalPolicy: (value: WorkspaceApprovalPolicy) => void;
  onChangeNewWorkspaceSystemPrompt: (value: string) => void;
  onChangeCustomTemplateName: (value: string) => void;
  onOpenDirectoryPicker: () => void;
  onOpenRepoManager: () => void;
  onSaveCustomTemplate: () => void;
  onCreateWorkspace: () => void;
  onClose: () => void;
}

export function CreateWorkspaceModal({
  visible,
  styles,
  colors,
  availableTemplates,
  modelOptions,
  selectedTemplateId,
  newWorkspaceName,
  newWorkspaceModel,
  newWorkspaceCwd,
  newWorkspaceApprovalPolicy,
  newWorkspaceSystemPrompt,
  customTemplateName,
  savingTemplate,
  creatingWorkspace,
  connectionStatus,
  onApplyTemplate,
  onChangeNewWorkspaceName,
  onChangeNewWorkspaceModel,
  onChangeNewWorkspaceCwd,
  onChangeNewWorkspaceApprovalPolicy,
  onChangeNewWorkspaceSystemPrompt,
  onChangeCustomTemplateName,
  onOpenDirectoryPicker,
  onOpenRepoManager,
  onSaveCustomTemplate,
  onCreateWorkspace,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.createAgentOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.createAgentSheet}>
          <View style={styles.createAgentHeader}>
            <Text style={styles.modalTitle}>New Agent</Text>
            <Pressable onPress={onClose} style={styles.createAgentClose}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            <Text style={styles.label}>Template</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateRow}>
              {availableTemplates.map((template) => {
                const selected = selectedTemplateId === template.id;
                return (
                  <Pressable
                    key={template.id}
                    style={[styles.templateChip, selected && styles.templateChipActive]}
                    onPress={() => onApplyTemplate(template)}
                  >
                    <Text style={styles.templateChipText}>{template.icon} {template.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Agent Name</Text>
            <TextInput
              style={styles.input}
              value={newWorkspaceName}
              onChangeText={onChangeNewWorkspaceName}
              placeholder="Frontend Assistant"
              placeholderTextColor={colors.textMuted}
              autoFocus={true}
            />

            <Text style={styles.label}>Model</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.modelOptionRow, { marginBottom: 8 }]}>
              {modelOptions.map((model) => {
                const selected = newWorkspaceModel === model;
                return (
                  <Pressable
                    key={model}
                    style={[styles.modelOptionChip, selected && styles.modelOptionChipActive]}
                    onPress={() => onChangeNewWorkspaceModel(model)}
                  >
                    <Text style={[styles.modelOptionText, selected && styles.modelOptionTextActive]}>{model}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              style={styles.input}
              value={newWorkspaceModel}
              onChangeText={onChangeNewWorkspaceModel}
              placeholder="or type custom model"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Working Directory</Text>
            <TextInput
              style={[styles.input, { marginBottom: 6 }]}
              value={newWorkspaceCwd}
              onChangeText={onChangeNewWorkspaceCwd}
              placeholder="/path/to/project"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {connectionStatus === 'connected' ? (
              <View style={styles.cwdActions}>
                <Pressable style={styles.cwdActionBtn} onPress={onOpenDirectoryPicker}>
                  <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
                  <Text style={styles.cwdActionText}>Browse</Text>
                </Pressable>
                <Pressable style={styles.cwdActionBtn} onPress={onOpenRepoManager}>
                  <Ionicons name="git-branch-outline" size={16} color={colors.accent} />
                  <Text style={styles.cwdActionText}>Repos</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.cwdHint}>Connect to bridge to browse directories</Text>
            )}

            <Text style={styles.label}>Approval Policy</Text>
            <View style={styles.themeModeRow}>
              <Pressable
                style={[styles.themeModeChip, newWorkspaceApprovalPolicy === 'never' && styles.themeModeChipActive]}
                onPress={() => onChangeNewWorkspaceApprovalPolicy('never')}
              >
                <Text style={[styles.themeModeChipText, newWorkspaceApprovalPolicy === 'never' && styles.themeModeChipTextActive]}>
                  Auto-approve
                </Text>
              </Pressable>
              <Pressable
                style={[styles.themeModeChip, newWorkspaceApprovalPolicy === 'on-request' && styles.themeModeChipActive]}
                onPress={() => onChangeNewWorkspaceApprovalPolicy('on-request')}
              >
                <Text style={[styles.themeModeChipText, newWorkspaceApprovalPolicy === 'on-request' && styles.themeModeChipTextActive]}>
                  Ask first
                </Text>
              </Pressable>
            </View>

            <Text style={styles.label}>System Prompt</Text>
            <TextInput
              style={[styles.input, styles.systemPromptInput]}
              value={newWorkspaceSystemPrompt}
              onChangeText={onChangeNewWorkspaceSystemPrompt}
              placeholder="Instructions prepended to every turn"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <View style={styles.templateSaveRow}>
              <TextInput
                style={[styles.input, styles.templateSaveInput, { marginBottom: 0 }]}
                value={customTemplateName}
                onChangeText={onChangeCustomTemplateName}
                placeholder="Save as template..."
                placeholderTextColor={colors.textMuted}
              />
              <Pressable
                style={[styles.cwdActionBtn, (savingTemplate || !customTemplateName.trim()) && styles.smallActionBtnDisabled]}
                onPress={onSaveCustomTemplate}
                disabled={savingTemplate || !customTemplateName.trim()}
              >
                <Text style={styles.cwdActionText}>{savingTemplate ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.createAgentFooter}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, { flex: 1 }, (creatingWorkspace || !newWorkspaceName.trim()) && { opacity: 0.55 }]}
              onPress={onCreateWorkspace}
              disabled={creatingWorkspace || !newWorkspaceName.trim()}
            >
              <Text style={[styles.primaryText, { textAlign: 'center' }]}>
                {creatingWorkspace ? 'Creating...' : 'Create Agent'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
