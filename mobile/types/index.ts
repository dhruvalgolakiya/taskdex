export type AgentStatus = 'initializing' | 'ready' | 'working' | 'error' | 'stopped';

export type MessageType = 'user' | 'agent' | 'thinking' | 'command' | 'command_output' | 'file_change';

export interface AgentMessage {
  role: 'user' | 'agent';
  type: MessageType;
  text: string;
  timestamp: number;
  _itemId?: string;
  streaming?: boolean;
}

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: number;
}

export interface Agent {
  id: string;
  name: string;
  model: string;
  cwd: string;
  approvalPolicy?: 'never' | 'on-request' | string;
  systemPrompt?: string;
  status: AgentStatus;
  activityLabel?: string;
  queuedMessages?: QueuedMessage[];
  threadId: string | null;
  currentTurnId: string | null;
  messages: AgentMessage[];
}

export interface AgentThread {
  id: string; // Bridge agentId backing this thread
  title: string;
  createdAt: number;
}

export interface AgentWorkspace {
  id: string;
  name: string;
  model: string;
  cwd: string;
  approvalPolicy?: 'never' | 'on-request' | string;
  systemPrompt?: string;
  templateId?: string;
  templateIcon?: string;
  threads: AgentThread[];
  activeThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTemplate {
  id: string;
  name: string;
  model: string;
  promptPrefix: string;
  icon: string;
  builtIn?: boolean;
  createdAt: number;
}

// Messages sent TO the bridge server
export interface BridgeRequest {
  action: string;
  params?: Record<string, unknown>;
  requestId?: string;
}

// Messages received FROM the bridge server
export interface BridgeResponse {
  type: 'response' | 'error' | 'stream';
  action?: string;
  requestId?: string;
  data?: unknown;
  error?: string;
  agentId?: string;
  event?: string;
}
