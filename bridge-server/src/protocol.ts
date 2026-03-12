// JSON-RPC 2.0 helpers for Codex app-server protocol

let nextId = 1;

export function createRequest(method: string, params: Record<string, unknown> = {}): string {
  const msg = { method, id: nextId++, params };
  return JSON.stringify(msg);
}

export function createNotification(method: string, params: Record<string, unknown> = {}): string {
  const msg = { method, params };
  return JSON.stringify(msg);
}

export interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  method: string;
  params: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

export function parseMessage(line: string): JsonRpcMessage | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg;
}

// Initialize handshake messages
export function initializeRequest(clientName: string, version: string): string {
  return createRequest('initialize', {
    clientInfo: { name: clientName, title: clientName, version },
    capabilities: { experimentalApi: true },
  });
}

export function initializedNotification(): string {
  return createNotification('initialized', {});
}

// Thread operations
export function threadStartRequest(
  model: string,
  cwd?: string,
  approvalPolicy = 'never',
  serviceTier?: string,
): string {
  const params: Record<string, unknown> = {
    model,
    approvalPolicy,
    sandbox: 'danger-full-access',
  };
  if (cwd) params.cwd = cwd;
  if (serviceTier) params.serviceTier = serviceTier;
  return createRequest('thread/start', params);
}

export function threadResumeRequest(
  threadId: string,
  options: {
    model?: string;
    cwd?: string;
    approvalPolicy?: string;
    serviceTier?: string;
  } = {},
): string {
  const params: Record<string, unknown> = { threadId };
  if (options.model) params.model = options.model;
  if (options.cwd) params.cwd = options.cwd;
  if (options.approvalPolicy) params.approvalPolicy = options.approvalPolicy;
  if (options.serviceTier) params.serviceTier = options.serviceTier;
  return createRequest('thread/resume', params);
}

export function threadListRequest(params: {
  limit?: number;
  cursor?: string;
  cwd?: string;
} = {}): string {
  return createRequest('thread/list', params);
}

export function threadReadRequest(threadId: string, includeTurns = true): string {
  return createRequest('thread/read', { threadId, includeTurns });
}

export function modelListRequest(includeHidden = true): string {
  return createRequest('model/list', { includeHidden });
}

// Turn operations
export function turnStartRequest(
  threadId: string,
  text: string,
  options: {
    model?: string;
    effort?: string;
    serviceTier?: string;
    approvalPolicy?: string;
    cwd?: string;
  } = {},
): string {
  const params: Record<string, unknown> = {
    threadId,
    input: [{ type: 'text', text }],
  };
  if (options.model) params.model = options.model;
  if (options.effort) params.effort = options.effort;
  if (options.serviceTier) params.serviceTier = options.serviceTier;
  if (options.approvalPolicy) params.approvalPolicy = options.approvalPolicy;
  if (options.cwd) params.cwd = options.cwd;
  return createRequest('turn/start', params);
}

export function turnInterruptRequest(threadId: string, turnId: string): string {
  return createRequest('turn/interrupt', { threadId, turnId });
}
