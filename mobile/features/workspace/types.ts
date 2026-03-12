export type ExecModeType = 'task' | 'flow';
export type ExecRunStatus = 'starting' | 'running' | 'completed' | 'failed';
export type WorkspaceApprovalPolicy = 'never' | 'on-request';

export interface ExecPreset {
  id: string;
  name: string;
  mode: ExecModeType;
  prompt: string;
  steps: string[];
  model: string;
  cwd: string;
  approvalPolicy: WorkspaceApprovalPolicy;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExecRunRecord {
  id: string;
  presetId?: string;
  name: string;
  mode: ExecModeType;
  status: ExecRunStatus;
  stepCount: number;
  startedAt: number;
  finishedAt?: number;
  threadId?: string;
  workspaceId?: string;
  error?: string;
}

export interface RepoEntry {
  name: string;
  path: string;
  remote?: string;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: string;
}

export interface WorkspaceSearchResult {
  id?: string;
  threadId: string;
  timestamp: number;
  itemId?: string;
  text?: string;
}

export interface GitStatusInfo {
  branch: string;
  isClean: boolean;
  modified: string[];
  notAdded: string[];
  deleted: string[];
  created: string[];
}

export type NotificationLevel = 'all' | 'errors' | 'muted';

export interface NotificationRow {
  agentId: string;
  label: string;
}

export interface NotificationHistoryEntry {
  id: string;
  timestamp: number;
  agentId: string;
  title: string;
  body: string;
  severity: 'info' | 'error';
  status: 'sent' | 'muted' | 'no_tokens' | 'error';
  deliveredCount: number;
}

export interface DashboardAgentRow {
  workspaceId: string;
  threadId: string;
  workspaceName: string;
  threadTitle: string;
  model: string;
  status: string;
  minutesAgo: number;
  averageResponseMs: number;
  errorCount: number;
  activeTimeMs: number;
  lastPreview?: string;
}

export interface UsageAgentSummary {
  agentId: string;
  model: string;
  turns: number;
  errorCount: number;
  activeTimeMs: number;
}

export interface UsageSummaryData {
  messagesSentToday?: number;
  messagesSentWeek?: number;
  today?: {
    turns?: number;
    estimatedCostUsd?: number;
  };
  week?: {
    turns?: number;
    estimatedCostUsd?: number;
  };
  agents?: UsageAgentSummary[];
}
