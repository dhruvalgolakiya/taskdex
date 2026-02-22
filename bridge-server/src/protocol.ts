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
export function threadStartRequest(model: string, cwd?: string, approvalPolicy = 'never'): string {
  const params: Record<string, unknown> = {
    model,
    approvalPolicy,
    sandbox: 'danger-full-access',
  };
  if (cwd) params.cwd = cwd;
  return createRequest('thread/start', params);
}

// Turn operations
export function turnStartRequest(threadId: string, text: string, model?: string): string {
  const params: Record<string, unknown> = {
    threadId,
    input: [{ type: 'text', text }],
  };
  if (model) params.model = model;
  return createRequest('turn/start', params);
}

export function turnInterruptRequest(threadId: string, turnId: string): string {
  return createRequest('turn/interrupt', { threadId, turnId });
}
