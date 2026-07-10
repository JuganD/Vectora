import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Send, Plus, Trash2, Wand2, GripVertical, Save, FolderOpen, Search, Clock } from 'lucide-react';
import Editor from '@monaco-editor/react';
import type { Connection, SelectedEntity, SendMessageRequest, ServiceBusMessage, MessageTemplate, ApplicationPropertyType } from '../types';
import { APPLICATION_PROPERTY_TYPES } from '../types';
import { sendToQueue, sendToTopic, getMessageTemplates, saveMessageTemplate, deleteMessageTemplate } from '../api/client';
import DateTimePicker from './DateTimePicker';

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

interface PropertyRow {
  key: string;
  value: string;
  type: ApplicationPropertyType;
}

interface SavedMessage {
  body: string;
  contentType: string;
  subject: string;
  messageId: string;
  correlationId: string;
  replyTo: string;
  sessionId: string;
  properties: PropertyRow[];
  sendMultiple?: boolean;
  sendCount?: string;
}

function normalizeType(type: unknown): ApplicationPropertyType {
  return APPLICATION_PROPERTY_TYPES.includes(type as ApplicationPropertyType)
    ? (type as ApplicationPropertyType)
    : 'string';
}

// Fallback when the backend didn't report a property type: infer it from the JSON value.
function inferType(value: unknown): ApplicationPropertyType {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'long' : 'double';
  return 'string';
}

// Client-side check mirroring the backend converter, so a bad value fails before the request.
// TimeSpan is left to the backend (its d.hh:mm:ss format is awkward to validate here).
const TYPE_VALIDATORS: Record<ApplicationPropertyType, (v: string) => boolean> = {
  string: () => true,
  bool: v => /^(true|false)$/i.test(v.trim()),
  int: v => /^-?\d+$/.test(v.trim()) && Number(v) >= -2147483648 && Number(v) <= 2147483647,
  long: v => /^-?\d+$/.test(v.trim()),
  double: v => v.trim() !== '' && !isNaN(Number(v)),
  decimal: v => v.trim() !== '' && !isNaN(Number(v)),
  guid: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim()),
  datetime: v => !isNaN(Date.parse(v.trim())),
  timespan: () => true,
};

interface SendMessageDialogProps {
  connection: Connection;
  entity: SelectedEntity;
  onClose: () => void;
  templateMessage?: ServiceBusMessage;
}

function loadSavedMessage(): SavedMessage {
  try {
    const saved = localStorage.getItem(LAST_MESSAGE_KEY);
    if (saved) {
      const parsed: SavedMessage = JSON.parse(saved);
      // Entries saved before properties were typed have no `type` field.
      parsed.properties = (parsed.properties ?? []).map(p => ({ ...p, type: normalizeType(p.type) }));
      return parsed;
    }
  } catch {}
  return {
    body: '{\n  \n}',
    contentType: 'application/json',
    subject: '',
    messageId: '',
    correlationId: '',
    replyTo: '',
    sessionId: '',
    properties: [],
    sendMultiple: false,
    sendCount: '5',
  };
}

function templateToSavedMessage(template: ServiceBusMessage): SavedMessage {
  return {
    body: template.body,
    contentType: template.contentType || 'application/json',
    subject: template.subject || '',
    messageId: '', // Don't copy messageId - should be unique per message
    correlationId: template.correlationId || '',
    replyTo: template.replyTo || '',
    sessionId: template.sessionId || '',
    properties: template.applicationProperties
      ? Object.entries(template.applicationProperties).map(([key, value]) => ({
          key,
          value: String(value),
          type: normalizeType(template.applicationPropertyTypes?.[key] ?? inferType(value)),
        }))
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
  const [replyTo, setReplyTo] = useState(initial.replyTo);
  const [sessionId, setSessionId] = useState(initial.sessionId);
  const [properties, setProperties] = useState<PropertyRow[]>(initial.properties);
  const [sendMultiple, setSendMultiple] = useState(initial.sendMultiple ?? false);
  const [sendCount, setSendCount] = useState(initial.sendCount ?? '5');
  // Scheduling: the message is only scheduled when the checkbox is on AND a future time is picked.
  const [scheduleForLater, setScheduleForLater] = useState(false);
  const [scheduledTime, setScheduledTime] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
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
    const msg: SavedMessage = { body, contentType, subject, messageId, correlationId, replyTo, sessionId, properties, sendMultiple, sendCount };
    localStorage.setItem(LAST_MESSAGE_KEY, JSON.stringify(msg));
  }, [body, contentType, subject, messageId, correlationId, replyTo, sessionId, properties, sendMultiple, sendCount]);

  // Load templates on mount
  useEffect(() => {
    getMessageTemplates().then(setTemplates).catch(() => {});
  }, []);



  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      const appProps = properties.filter(p => p.key).length > 0
        ? JSON.stringify(Object.fromEntries(properties.filter(p => p.key).map(p => [p.key, { value: p.value, type: p.type }])))
        : undefined;
      await saveMessageTemplate({
        name: templateName.trim(),
        body,
        contentType: contentType || undefined,
        subject: subject || undefined,
        messageId: messageId || undefined,
        correlationId: correlationId || undefined,
        sessionId: sessionId || undefined,
        applicationProperties: appProps,
        sendMultiple,
        sendCount: parseInt(sendCount) || 5,
      });
      const updated = await getMessageTemplates();
      setTemplates(updated);
      setShowSaveDialog(false);
      setTemplateName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    }
  };

  const handleLoadTemplate = (t: MessageTemplate) => {
    setBody(t.body);
    setContentType(t.contentType || 'application/json');
    setSubject(t.subject || '');
    setMessageId(t.messageId || '');
    setCorrelationId(t.correlationId || '');
    setSessionId(t.sessionId || '');
    setSendMultiple(t.sendMultiple);
    setSendCount(String(t.sendCount || 5));
    if (t.applicationProperties) {
      try {
        const parsed = JSON.parse(t.applicationProperties);
        // New templates store { value, type } per key; older ones store the bare string value.
        setProperties(Object.entries(parsed).map(([key, raw]) => {
          if (raw && typeof raw === 'object' && 'value' in raw) {
            const typed = raw as { value: unknown; type?: unknown };
            return { key, value: String(typed.value ?? ''), type: normalizeType(typed.type) };
          }
          return { key, value: String(raw), type: 'string' as ApplicationPropertyType };
        }));
      } catch {
        setProperties([]);
      }
    } else {
      setProperties([]);
    }
    setShowLoadModal(false);
    setTemplateSearch('');
  };

  const handleDeleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteMessageTemplate(id);
      const updated = await getMessageTemplates();
      setTemplates(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

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

  // Close when a click starts on the backdrop (mousedown, so a drag that
  // starts inside the dialog and ends outside doesn't close it)
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.button === 0) {
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

  // A scheduled send requires both the toggle and a future time; otherwise sending is blocked.
  const scheduleMissingTime = scheduleForLater && !scheduledTime;
  const schedulePastTime = scheduleForLater && !!scheduledTime && scheduledTime.getTime() <= Date.now();
  const scheduleBlocked = scheduleMissingTime || schedulePastTime;

  const handleSend = async () => {
    if (!body.trim()) {
      setError('Message body is required');
      return;
    }
    const count = sendMultiple ? (parseInt(sendCount) || 1) : 1;
    if (count < 1) {
      setError('Count must be at least 1');
      return;
    }
    if (scheduleMissingTime) {
      setError('Pick a date and time to schedule the message');
      return;
    }
    if (schedulePastTime) {
      setError('Scheduled time must be in the future');
      return;
    }
    for (const p of properties.filter(p => p.key)) {
      if (!TYPE_VALIDATORS[p.type](p.value)) {
        setError(`Application property '${p.key}': '${p.value}' is not a valid ${p.type} value`);
        return;
      }
    }
    setError('');
    setLoading(true);

    const message: SendMessageRequest = {
      body,
      contentType: contentType || undefined,
      subject: subject || undefined,
      messageId: messageId || undefined,
      correlationId: correlationId || undefined,
      replyTo: replyTo || undefined,
      sessionId: sessionId || undefined,
      scheduledEnqueueTime: scheduleForLater && scheduledTime ? scheduledTime.toISOString() : undefined,
      applicationProperties: properties.length > 0
        ? Object.fromEntries(properties.filter(p => p.key).map(p => [p.key, { value: p.value, type: p.type }]))
        : undefined,
    };

    try {
      if (entity.type === 'queue') {
        await sendToQueue(connection.id, entity.name, message, count);
      } else {
        await sendToTopic(connection.id, entity.name, message, count);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const addProperty = () => setProperties([...properties, { key: '', value: '', type: 'string' }]);
  const removeProperty = (index: number) => setProperties(properties.filter((_, i) => i !== index));
  const updateProperty = (index: number, field: 'key' | 'value' | 'type', value: string) => {
    const updated = [...properties];
    if (field === 'type') {
      updated[index].type = normalizeType(value);
    } else {
      updated[index][field] = value;
    }
    setProperties(updated);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-0 md:p-3" onMouseDown={handleBackdropMouseDown}>
      <div className="bg-dark-800 border border-dark-600 md:rounded-xl w-full h-full md:max-w-[95vw] md:h-[95vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header Toolbar with carbon fiber pattern */}
        <div className="relative shrink-0 border-b border-dark-600">
          {/* Carbon fiber dot pattern background */}
          <div className="absolute inset-0 carbon-fiber-header rounded-t-xl" />
          <div className="flex items-center px-3 md:px-5 py-2.5 md:py-3 gap-3 relative z-10">
            {/* Title */}
            <h2 className="text-sm md:text-base font-semibold text-white flex items-center gap-2 min-w-0">
              <Send className="w-4 h-4 text-primary-400 flex-shrink-0" />
              <span className="truncate">{entity.name}</span>
            </h2>

            {/* Divider */}
            <div className="w-px h-5 bg-dark-500/50 flex-shrink-0" />

            {/* Template actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setShowSaveDialog(true); setTemplateName(''); }}
                className="px-2.5 py-1.5 text-dark-300 hover:text-white hover:bg-white/5 rounded-lg flex items-center gap-1.5 transition-all text-sm"
                title="Save as template"
              >
                <Save className="w-3.5 h-3.5" /> <span className="hidden md:inline">Save</span>
              </button>
              <button
                onClick={() => { setShowLoadModal(true); setTemplateSearch(''); }}
                className="px-2.5 py-1.5 text-dark-300 hover:text-white hover:bg-white/5 rounded-lg flex items-center gap-1.5 transition-all text-sm"
                title="Load template"
              >
                <FolderOpen className="w-3.5 h-3.5" /> <span className="hidden md:inline">Load</span>
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={loading || !body.trim() || scheduleBlocked}
              className="px-4 md:px-6 py-1.5 md:py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg flex items-center gap-2 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {scheduleForLater ? <Clock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              <span>
                {loading
                  ? (scheduleForLater ? 'Scheduling...' : 'Sending...')
                  : scheduleForLater
                    ? (sendMultiple && parseInt(sendCount) > 1 ? `Schedule (${sendCount}×)` : 'Schedule')
                    : (sendMultiple && parseInt(sendCount) > 1 ? `Send (${sendCount}×)` : 'Send')}
              </span>
            </button>
          </div>
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
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Reply To</label>
                <input
                  type="text"
                  value={replyTo}
                  onChange={e => setReplyTo(e.target.value)}
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

              {/* Send Multiple */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-dark-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendMultiple}
                    onChange={e => setSendMultiple(e.target.checked)}
                    className="rounded border-dark-500"
                  />
                  Send multiple times
                </label>
                {sendMultiple && (
                  <div className="mt-2">
                    <input
                      type="number"
                      min="1"
                      value={sendCount}
                      onChange={e => setSendCount(e.target.value)}
                      placeholder="Count"
                      className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
              </div>

              {/* Schedule for later */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-dark-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleForLater}
                    onChange={e => {
                      setScheduleForLater(e.target.checked);
                      if (!e.target.checked) setScheduledTime(null);
                    }}
                    className="rounded border-dark-500"
                  />
                  <Clock className="w-3.5 h-3.5 text-primary-400" />
                  Schedule for later
                </label>
                {scheduleForLater && (
                  <div className="mt-2 space-y-1.5">
                    <DateTimePicker
                      value={scheduledTime}
                      onChange={setScheduledTime}
                      minDate={new Date()}
                    />
                    {schedulePastTime && (
                      <p className="text-xs text-red-400">Scheduled time must be in the future.</p>
                    )}
                    {scheduleMissingTime && (
                      <p className="text-xs text-dark-500">Pick a date and time — the message will be enqueued then.</p>
                    )}
                  </div>
                )}
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
                      className="flex-1 min-w-0 px-2 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={prop.value}
                      onChange={e => updateProperty(i, 'value', e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm"
                    />
                    <select
                      value={prop.type}
                      onChange={e => updateProperty(i, 'type', e.target.value)}
                      title="Property type"
                      className="w-[5.5rem] shrink-0 px-1.5 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {APPLICATION_PROPERTY_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <button onClick={() => removeProperty(i)} className="text-dark-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>


      </div>

      {/* Load Template Modal */}
      {showLoadModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onMouseDown={e => { if (e.target === e.currentTarget && e.button === 0) { setShowLoadModal(false); setTemplateSearch(''); } }}
        >
          <div
            className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-md mx-4 flex flex-col shadow-2xl max-h-[70vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary-400" />
                Load Template
              </h3>
              <button
                onClick={() => { setShowLoadModal(false); setTemplateSearch(''); }}
                className="text-dark-400 hover:text-white transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-dark-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input
                  type="text"
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full pl-9 pr-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:border-primary-500 placeholder-dark-400"
                  autoFocus
                />
              </div>
            </div>

            {/* Template List */}
            <div className="flex-1 overflow-y-auto">
              {templates.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-dark-400 italic">No saved templates</div>
              ) : (() => {
                const filtered = templates
                  .filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                  .sort((a, b) => a.name.localeCompare(b.name));
                return filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-dark-400 italic">No templates match your search</div>
                ) : (
                  filtered.map(t => (
                    <div
                      key={t.id}
                      onClick={() => handleLoadTemplate(t)}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-dark-700 cursor-pointer group border-b border-dark-700/50 last:border-b-0"
                    >
                      <span className="text-sm text-white truncate">{t.name}</span>
                      <button
                        onClick={(e) => handleDeleteTemplate(t.id, e)}
                        className="text-dark-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2 p-1"
                        title="Delete template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {showSaveDialog && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onMouseDown={e => { if (e.target === e.currentTarget && e.button === 0) { setShowSaveDialog(false); setTemplateName(''); } }}
        >
          <div
            className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-sm mx-4 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Save className="w-4 h-4 text-primary-400" />
                Save Template
              </h3>
              <button
                onClick={() => { setShowSaveDialog(false); setTemplateName(''); }}
                className="text-dark-400 hover:text-white transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Name Input */}
            <div className="px-5 py-4">
              <label className="block text-sm font-medium text-dark-300 mb-2">Template name</label>
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && templateName.trim() && handleSaveTemplate()}
                placeholder="Enter a name..."
                className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:border-primary-500 placeholder-dark-400"
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="px-5 py-3 border-t border-dark-700 flex justify-end gap-2">
              <button
                onClick={() => { setShowSaveDialog(false); setTemplateName(''); }}
                className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-white rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={!templateName.trim()}
                className="px-4 py-1.5 bg-primary-500 hover:bg-primary-400 text-white rounded-lg text-sm disabled:opacity-50 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
