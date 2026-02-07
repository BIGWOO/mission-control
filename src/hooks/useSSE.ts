/**
 * useSSE Hook
 * Establishes and maintains Server-Sent Events connection for real-time updates
 */

'use client';

import { useEffect, useRef } from 'react';
import { useMissionControl } from '@/lib/store';
import { debug } from '@/lib/debug';
import type { SSEEvent, Task } from '@/lib/types';

export function useSSE() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    let isConnecting = false;

    const connect = () => {
      if (isConnecting || eventSourceRef.current?.readyState === EventSource.OPEN) {
        return;
      }

      isConnecting = true;
      debug.sse('Connecting to event stream...');

      const eventSource = new EventSource('/api/events/stream');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        debug.sse('Connected');
        useMissionControl.getState().setIsOnline(true);
        isConnecting = false;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
      };

      eventSource.onmessage = (event) => {
        try {
          const sseEvent: SSEEvent = JSON.parse(event.data);

          if (sseEvent.type === 'ping') {
            return;
          }
          debug.sse(`Received event: ${sseEvent.type}`, sseEvent.payload);

          const store = useMissionControl.getState();

          switch (sseEvent.type) {
            case 'task_created':
              store.addTask(sseEvent.payload as Task);
              break;

            case 'task_updated': {
              const incomingTask = sseEvent.payload as Task;
              store.updateTask(incomingTask);
              if (store.selectedTask?.id === incomingTask.id) {
                store.setSelectedTask(incomingTask);
              }
              break;
            }

            case 'activity_logged':
            case 'deliverable_added':
            case 'agent_spawned':
            case 'agent_completed':
              debug.sse(sseEvent.type, sseEvent.payload);
              break;

            default:
              debug.sse('Unknown event type', sseEvent);
          }
        } catch (error) {
          console.error('[SSE] Error parsing event:', error);
        }
      };

      eventSource.onerror = () => {
        debug.sse('Connection error');
        useMissionControl.getState().setIsOnline(false);
        isConnecting = false;

        eventSource.close();
        eventSourceRef.current = null;

        reconnectTimeoutRef.current = setTimeout(() => {
          debug.sse('Attempting to reconnect...');
          connect();
        }, 5000);
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        debug.sse('Disconnecting...');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);
}
