import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Send, Plus, Trash2, Wand2, GripVertical } from 'lucide-react';
import Editor from '@monaco-editor/react';
import type { Connection, SelectedEntity, SendMessageRequest, ServiceBusMessage } from '../types';
import { sendToQueue, sendToTopic } from '../api/client';

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
}

const LAST_MESSAGE_KEY = 'vectora_last_message';
const PANEL_RATIO_KEY = 'vectora_send_panel_ratio';

interface SavedMessage {
  body: string;
  contentType: string;
  subject: string;
  messageId: string;
  correlationId: string;
  sessionId: string;
  properties: { key: string; value: string }[];
}

interface SendMessageDialogProps {
  connection: Connection;
  entity: SelectedEntity;
  onClose: () => void;
  templateMessage?: ServiceBusMessage;
}

function loadSavedMessage(): SavedMessage {
  try {
    const saved = localStorage.getItem(LAST_MESSAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {
    body: '{\n  \n}',
    contentType: 'application/json',
    subject: '',
    messageId: '',
    correlationId: '',
    sessionId: '',
    properties: [],
  };
}

function templateToSavedMessage(template: ServiceBusMessage): SavedMessage {
  return {
    body: template.body,
    contentType: template.contentType || 'application/json',
    subject: template.subject || '',
    messageId: '', // Don't copy messageId - should be unique per message
    correlationId: template.correlationId || '',
    sessionId: template.sessionId || '',
    properties: template.applicationProperties
      ? Object.entries(template.applicationProperties).map(([key, value]) => ({ key, value: String(value) }))
      : [],
  };
}

export default function SendMessageDialog({ connection, entity, onClose, templateMessage }: SendMessageDialogProps) {
  const initial = templateMessage ? templateToSavedMessage(templateMessage) : loadSavedMessage();
  const [body, setBody] = useState(initial.body);
  const [contentType, setContentType] = useState(initial.contentType);
  const [subject, setSubject] = useState(initial.subject);
  const [messageId, setMessageId] = useState(initial.messageId);
  const [correlationId, setCorrelationId] = useState(initial.correlationId);
  const [sessionId, setSessionId] = useState(initial.sessionId);
  const [properties, setProperties] = useState<{ key: string; value: string }[]>(initial.properties);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMobile = useIsMobile();

  // Panel resizing state
  const [leftPanelRatio, setLeftPanelRatio] = useState(() => {
    const saved = localStorage.getItem(PANEL_RATIO_KEY);
    return saved ? parseFloat(saved) : 0.65; // Default 65% for editor
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save panel ratio to localStorage
  useEffect(() => {
    localStorage.setItem(PANEL_RATIO_KEY, leftPanelRatio.toString());
  }, [leftPanelRatio]);

  // Save message state to localStorage on changes
  useEffect(() => {
    const msg: SavedMessage = { body, contentType, subject, messageId, correlationId, sessionId, properties };
    localStorage.setItem(LAST_MESSAGE_KEY, JSON.stringify(msg));
  }, [body, contentType, subject, messageId, correlationId, sessionId, properties]);

  // Handle panel resizing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = (e.clientX - rect.left) / rect.width;
      // Clamp between 20% and 80%
      setLeftPanelRatio(Math.max(0.2, Math.min(0.8, newRatio)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getEditorLanguage = () => {
    if (contentType.includes('json')) return 'json';
    if (contentType.includes('xml')) return 'xml';
    return 'plaintext';
  };

  const formatBody = () => {
    if (contentType.includes('json')) {
      try {
        const formatted = JSON.stringify(JSON.parse(body), null, 2);
        setBody(formatted);
      } catch {
        // ignore parse errors
      }
    }
  };

  const handleSend = async () => {
    if (!body.trim()) {
      setError('Message body is required');
      return;
    }
    setError('');
    setLoading(true);

    const message: SendMessageRequest = {
      body,
      contentType: contentType || undefined,
      subject: subject || undefined,
      messageId: messageId || undefined,
      correlationId: correlationId || undefined,
      sessionId: sessionId || undefined,
      applicationProperties: properties.length > 0
        ? Object.fromEntries(properties.filter(p => p.key).map(p => [p.key, p.value]))
        : undefined,
    };

    try {
      if (entity.type === 'queue') {
        await sendToQueue(connection.id, entity.name, message);
      } else if (entity.type === 'topic') {
        await sendToTopic(connection.id, entity.name, message);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const addProperty = () => setProperties([...properties, { key: '', value: '' }]);
  const removeProperty = (index: number) => setProperties(properties.filter((_, i) => i !== index));
  const updateProperty = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...properties];
    updated[index][field] = value;
    setProperties(updated);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-0 md:p-3" onClick={handleBackdropClick}>
      <div className="bg-dark-800 border border-dark-600 md:rounded-xl w-full h-full md:max-w-[95vw] md:h-[95vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 md:px-5 py-3 md:py-4 border-b border-dark-600">
          <h2 className="text-base md:text-lg font-semibold text-white flex items-center gap-2 min-w-0">
            <Send className="w-4 h-4 md:w-5 md:h-5 text-primary-400 flex-shrink-0" />
            <span className="truncate">Send to {entity.name}</span>
          </h2>
          <button onClick={onClose} className="text-dark-400 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-3 md:mx-5 mt-3 md:mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
        )}

        {/* Layout: stacked on mobile, side-by-side on desktop */}
        <div ref={containerRef} className={`flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden ${isResizing ? 'select-none' : ''}`}>
          {/* Editor section - fixed height on mobile portrait, flex on landscape/desktop */}
          <div
            className="flex flex-col min-w-0 md:flex-none shrink-0"
            style={isMobile ? { height: '45%', minHeight: '150px' } : { width: `${leftPanelRatio * 100}%` }}
          >
            <div className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-dark-700 bg-dark-850 shrink-0">
              <span className="text-sm font-medium text-dark-300">Message Body</span>
              <button
                onClick={formatBody}
                className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-dark-700"
                title="Format JSON"
              >
                <Wand2 className="w-3 h-3" /> Format
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                language={getEditorLanguage()}
                value={body}
                onChange={(value) => setBody(value || '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: isMobile ? 12 : 13,
                  lineNumbers: isMobile ? 'off' : 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  padding: { top: 8 },
                }}
              />
            </div>
          </div>

          {/* Resize Handle - hidden on mobile */}
          {!isMobile && (
            <div
              onMouseDown={handleMouseDown}
              className={`w-1 bg-dark-600 hover:bg-primary-500 cursor-col-resize flex items-center justify-center group transition-colors ${isResizing ? 'bg-primary-500' : ''}`}
            >
              <GripVertical className="w-3 h-3 text-dark-400 group-hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* Options section - scrollable, takes remaining space on mobile */}
          <div
            className="flex flex-col overflow-hidden bg-dark-850 min-w-0 border-t md:border-t-0 border-dark-700 flex-1"
            style={isMobile ? {} : { width: `${(1 - leftPanelRatio) * 100}%` }}
          >
            {/* Mobile toggle for options - removed, always show options */}
            <div className="flex-1 overflow-auto p-3 md:p-4 space-y-3 md:space-y-4">
              {/* Content Type */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Content Type</label>
                <select
                  value={contentType}
                  onChange={e => setContentType(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="application/json">application/json</option>
                  <option value="text/plain">text/plain</option>
                  <option value="application/xml">application/xml</option>
                </select>
              </div>

              {/* Message Properties */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Message ID</label>
                <input
                  type="text"
                  value={messageId}
                  onChange={e => setMessageId(e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Correlation ID</label>
                <input
                  type="text"
                  value={correlationId}
                  onChange={e => setCorrelationId(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Session ID</label>
                <input
                  type="text"
                  value={sessionId}
                  onChange={e => setSessionId(e.target.value)}
                  placeholder="Required for session-enabled queues"
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Application Properties */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-dark-300">Application Properties</label>
                  <button onClick={addProperty} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                {properties.length === 0 && (
                  <p className="text-xs text-dark-500 italic">No custom properties</p>
                )}
                {properties.map((prop, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Key"
                      value={prop.key}
                      onChange={e => updateProperty(i, 'key', e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={prop.value}
                      onChange={e => updateProperty(i, 'value', e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm"
                    />
                    <button onClick={() => removeProperty(i)} className="text-dark-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer - compact on mobile, especially landscape */}
        <div className="px-3 md:px-5 py-2 md:py-4 border-t border-dark-600 flex justify-end gap-2 md:gap-3 shrink-0 bg-dark-800">
          <button onClick={onClose} className="px-3 md:px-4 py-1.5 md:py-2 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors text-sm">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={loading || !body.trim()}
            className="px-3 md:px-5 py-1.5 md:py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg flex items-center gap-1.5 md:gap-2 disabled:opacity-50 transition-colors text-sm"
          >
            <Send className="w-4 h-4" /> {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

