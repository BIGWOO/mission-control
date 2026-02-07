// OpenClaw Gateway WebSocket Client

import { EventEmitter } from 'events';
import type { OpenClawMessage, OpenClawSessionInfo } from '../types';

// Dynamic import to avoid Next.js bundling issues with ws module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebSocket: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebSocket = require('ws');
} catch {
  // ws module not available - will fail gracefully on connect
}

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageId = 0;
  private pendingRequests = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private connected = false;
  private authenticated = false; // Track auth state separately from connection state
  private connecting: Promise<void> | null = null; // Lock to prevent multiple simultaneous connection attempts
  private autoReconnect = true;
  private token: string;

  constructor(private url: string = GATEWAY_URL, token: string = GATEWAY_TOKEN) {
    super();
    this.token = token;
    this.setMaxListeners(20);
    // Prevent Node.js from throwing on unhandled 'error' events
    this.on('error', () => {});
  }

  async connect(): Promise<void> {
    // If already connected, return immediately
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // If a connection attempt is already in progress, wait for it
    if (this.connecting) {
      return this.connecting;
    }

    // Create a new connection attempt
    this.connecting = new Promise((resolve, reject) => {
      try {
        // Clean up any existing connection
        if (this.ws) {
          this.ws.onclose = null;
          this.ws.onerror = null;
          this.ws.onmessage = null;
          this.ws.onopen = null;
          if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
          }
          this.ws = null;
        }

        // Add token to URL query string for Gateway authentication
        const wsUrl = new URL(this.url);
        if (this.token) {
          wsUrl.searchParams.set('token', this.token);
        }
        console.log('[OpenClaw] Connecting to:', wsUrl.toString().replace(/token=[^&]+/, 'token=***'));
        console.log('[OpenClaw] Token in URL:', wsUrl.searchParams.has('token'));
        const ws = new WebSocket(wsUrl.toString());
        this.ws = ws;

        const connectionTimeout = setTimeout(() => {
          if (!this.connected) {
            ws.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000); // 10 second connection timeout

        ws.onopen = async () => {
          clearTimeout(connectionTimeout);
          console.log('[OpenClaw] WebSocket opened, waiting for challenge...');
          // Don't send anything yet - wait for Gateway challenge
          // Token is in URL query string
        };

        ws.onclose = (event: { code: number; reason: string; wasClean: boolean }) => {
          clearTimeout(connectionTimeout);
          const wasConnected = this.connected;
          this.connected = false;
          this.authenticated = false;
          this.connecting = null;
          this.emit('disconnected');
          // Log close reason for debugging
          console.log(`[OpenClaw] Disconnected from Gateway (code: ${event.code}, reason: "${event.reason}", wasClean: ${event.wasClean})`);
          // Only auto-reconnect if we were previously connected (not on initial connection failure)
          if (this.autoReconnect && wasConnected) {
            this.scheduleReconnect();
          }
        };

        ws.onerror = (error: unknown) => {
          clearTimeout(connectionTimeout);
          console.error('[OpenClaw] WebSocket error');
          this.emit('error', error);
          if (!this.connected) {
            this.connecting = null;
            reject(new Error('Failed to connect to OpenClaw Gateway'));
          }
        };

        ws.onmessage = (event: { data: unknown }) => {
          console.log('[OpenClaw] Received:', event.data);
          try {
            const data = JSON.parse(event.data as string);

            // Emit raw event frames as notifications (for waitForChatResponse)
            if (data.type === 'event' && data.event !== 'connect.challenge') {
              this.emit('notification', { method: data.event, params: data.payload || data });
            }

            // Handle challenge-response authentication (OpenClaw RequestFrame format)
            if (data.type === 'event' && data.event === 'connect.challenge') {
              console.log('[OpenClaw] Challenge received, responding...');
              const requestId = crypto.randomUUID();
              const response = {
                type: 'req',
                id: requestId,
                method: 'connect',
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: 'gateway-client',
                    version: '1.0.0',
                    platform: 'node',
                    mode: 'backend'
                  },
                  role: 'operator',
                  scopes: ['operator.read', 'operator.write'],
                  caps: [],
                  commands: [],
                  permissions: {},
                  auth: {
                    token: this.token,
                    password: this.token
                  }
                }
              };

              // Set up response handler
              this.pendingRequests.set(requestId, {
                resolve: () => {
                  this.connected = true;
                  this.authenticated = true;
                  this.connecting = null;
                  this.emit('connected');
                  console.log('[OpenClaw] Authenticated successfully');
                  resolve();
                },
                reject: (error: Error) => {
                  this.connecting = null;
                  this.ws?.close();
                  reject(new Error(`Authentication failed: ${error.message}`));
                }
              });

              console.log('[OpenClaw] Sending challenge response');
              this.ws!.send(JSON.stringify(response));
              return;
            }

            // Handle RPC responses and other messages
            this.handleMessage(data as OpenClawMessage);
          } catch (err) {
            console.error('[OpenClaw] Failed to parse message:', err);
          }
        };
      } catch (err) {
        this.connecting = null;
        reject(err);
      }
    });

    return this.connecting;
  }

  private handleMessage(data: OpenClawMessage & { type?: string; ok?: boolean; payload?: unknown }): void {
    // Handle OpenClaw ResponseFrame format (type: "res")
    if (data.type === 'res' && data.id !== undefined) {
      const requestId = data.id as string | number;
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        const { resolve, reject } = pending;
        this.pendingRequests.delete(requestId);

        if (data.ok === false && data.error) {
          reject(new Error(data.error.message));
        } else {
          resolve(data.payload);
        }
        return;
      }
    }

    // Handle legacy JSON-RPC responses
    const legacyId = data.id as string | number | undefined;
    if (legacyId !== undefined && this.pendingRequests.has(legacyId)) {
      const { resolve, reject } = this.pendingRequests.get(legacyId)!;
      this.pendingRequests.delete(legacyId);

      if (data.error) {
        reject(new Error(data.error.message));
      } else {
        resolve(data.result);
      }
      return;
    }

    // Handle events/notifications
    if (data.method) {
      this.emit('notification', data);
      this.emit(data.method, data.params);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.autoReconnect) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.autoReconnect) return;

      console.log('[OpenClaw] Attempting reconnect...');
      try {
        await this.connect();
      } catch {
        // Don't spam logs on reconnect failure, just schedule another attempt
        this.scheduleReconnect();
      }
    }, 10000); // 10 seconds between reconnect attempts
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new Error('Not connected to OpenClaw Gateway');
    }

    const id = crypto.randomUUID();
    const message = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);

      this.ws!.send(JSON.stringify(message));
    });
  }

  // Session management methods
  async listSessions(): Promise<OpenClawSessionInfo[]> {
    return this.call<OpenClawSessionInfo[]>('sessions.list');
  }

  async getSessionHistory(sessionId: string): Promise<unknown[]> {
    return this.call<unknown[]>('sessions.history', { session_id: sessionId });
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    await this.call('sessions.send', { session_id: sessionId, content });
  }

  async createSession(channel: string, peer?: string): Promise<OpenClawSessionInfo> {
    return this.call<OpenClawSessionInfo>('sessions.create', { channel, peer });
  }

  // Node methods (device capabilities)
  async listNodes(): Promise<unknown[]> {
    return this.call<unknown[]>('node.list');
  }

  async describeNode(nodeId: string): Promise<unknown> {
    return this.call('node.describe', { node_id: nodeId });
  }

  /**
   * Wait for a chat response by listening to WebSocket events.
   * Resolves with the assistant's text when a final event arrives for the given sessionKey.
   * Falls back to chat.history on timeout or if event doesn't contain the text directly.
   */
  waitForChatResponse(sessionKey: string, timeoutMs: number = 120000): Promise<string | null> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let settled = false;

      const settle = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.removeListener('notification', onNotification);
        resolve(value);
      };

      const onNotification = (data: { method?: string; params?: Record<string, unknown> }) => {
        // Listen for chat events matching our sessionKey
        if (data.method === 'chat' || data.method === 'event.chat') {
          const p = data.params || {};
          if (p.sessionKey === sessionKey && p.state === 'final') {
            // Got final event - fetch history to get the actual response
            this.call<{ messages: Array<{ role: string; content: Array<{ type: string; text?: string }>; timestamp?: number }> }>('chat.history', {
              sessionKey,
              limit: 5,
            }).then((result) => {
              const msgs = result.messages || [];
              const last = [...msgs].reverse().find(m => m.role === 'assistant');
              if (last) {
                // Check timestamp freshness in event path too
                const msgTimestamp = (last as { timestamp?: number }).timestamp || 0;
                if (msgTimestamp > 0 && msgTimestamp < startTime) {
                  // Stale response from before our request - ignore
                  return;
                }
                const text = last.content?.find(c => c.type === 'text')?.text;
                settle(text || null);
              } else {
                settle(null);
              }
            }).catch(() => {
              settle(null);
            });
          }
        }
      };

      // Subscribe BEFORE returning the promise so no events are missed
      this.on('notification', onNotification);

      const timer = setTimeout(async () => {
        if (settled) return;
        // Timeout: try one last fetch from history
        try {
          const result = await this.call<{ messages: Array<{ role: string; content: Array<{ type: string; text?: string }>; timestamp?: number }> }>('chat.history', {
            sessionKey,
            limit: 5,
          });
          const msgs = result.messages || [];
          const last = [...msgs].reverse().find(m => m.role === 'assistant');
          if (last) {
            // Check if the response is newer than when we started waiting
            const msgTimestamp = last.timestamp || 0;
            if (msgTimestamp > 0 && msgTimestamp < startTime) {
              // Stale response - older than our request
              settle(null);
              return;
            }
            const text = last.content?.find(c => c.type === 'text')?.text;
            settle(text || null);
            return;
          }
        } catch {
          // ignore
        }
        settle(null);
      }, timeoutMs);
    });
  }

  disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.connecting = null;
  }

  isConnected(): boolean {
    return this.connected && this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
    if (!enabled && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton instance for server-side usage
let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    clientInstance = new OpenClawClient();
  }
  return clientInstance;
}
