import { useMemo, useState } from 'react';
import { Copy, Check, FileJson, Code, FileInput } from 'lucide-react';
import Editor from '@monaco-editor/react';
import type { ServiceBusMessage } from '../types';

export type ViewMode = 'body' | 'properties';

interface MessageViewerProps {
  message: ServiceBusMessage;
  onUseAsTemplate?: (message: ServiceBusMessage) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

export default function MessageViewer({ message, onUseAsTemplate, viewMode: controlledViewMode, onViewModeChange }: MessageViewerProps) {
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('body');
  const [copied, setCopied] = useState(false);

  // Use controlled mode if props are provided, otherwise use internal state
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { formattedBody, language } = useMemo(() => {
    try {
      const parsed = JSON.parse(message.body);
      return { formattedBody: JSON.stringify(parsed, null, 2), language: 'json' };
    } catch {
      // Check if XML
      if (message.body.trim().startsWith('<')) {
        return { formattedBody: message.body, language: 'xml' };
      }
      return { formattedBody: message.body, language: 'plaintext' };
    }
  }, [message.body]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Toolbar - height matches MessagePanel counter bar */}
      <div className="px-3 h-[46px] border-b border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-dark-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode('body')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${viewMode === 'body' ? 'bg-primary-500 text-white' : 'text-dark-400 hover:text-white'}`}
          >
            <FileJson className="w-4 h-4 inline mr-1" />
            Body
          </button>
          <button
            onClick={() => setViewMode('properties')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${viewMode === 'properties' ? 'bg-primary-500 text-white' : 'text-dark-400 hover:text-white'}`}
          >
            <Code className="w-4 h-4 inline mr-1" />
            Properties
          </button>
        </div>
        <div className="flex items-center gap-2">
          {onUseAsTemplate && (
            <button
              onClick={() => onUseAsTemplate(message)}
              className="flex items-center gap-1 px-2 py-1 text-sm text-dark-400 hover:text-white transition-colors"
              title="Use as template for new message"
            >
              <FileInput className="w-4 h-4" />
              Template
            </button>
          )}
          <button
            onClick={() => copyToClipboard(viewMode === 'properties' ? JSON.stringify(message, null, 2) : message.body)}
            className="flex items-center gap-1 px-2 py-1 text-sm text-dark-400 hover:text-white transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {viewMode === 'properties' ? (
          <div className="h-full overflow-auto p-4 space-y-4">
            <PropertySection title="System Properties">
              <PropertyRow label="Message ID" value={message.messageId} />
              <PropertyRow label="Sequence Number" value={message.sequenceNumber.toString()} />
              <PropertyRow label="Enqueued Time" value={new Date(message.enqueuedTime).toLocaleString()} />
              <PropertyRow label="Content Type" value={message.contentType} />
              <PropertyRow label="Subject" value={message.subject} />
              <PropertyRow label="Correlation ID" value={message.correlationId} />
              <PropertyRow label="Session ID" value={message.sessionId} />
              <PropertyRow label="Reply To" value={message.replyTo} />
              <PropertyRow label="To" value={message.to} />
              <PropertyRow label="Time To Live" value={message.timeToLive} />
              <PropertyRow label="Delivery Count" value={message.deliveryCount.toString()} />
            </PropertySection>

            {message.deadLetterReason && (
              <PropertySection title="Dead Letter Info">
                <PropertyRow label="Reason" value={message.deadLetterReason} />
                <PropertyRow label="Error Description" value={message.deadLetterErrorDescription} />
              </PropertySection>
            )}

            {message.applicationProperties && Object.keys(message.applicationProperties).length > 0 && (
              <PropertySection title="Application Properties">
                {Object.entries(message.applicationProperties).map(([key, value]) => (
                  <PropertyRow key={key} label={key} value={String(value)} />
                ))}
              </PropertySection>
            )}
          </div>
        ) : (
          <Editor
            height="100%"
            language={language}
            value={formattedBody}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on',
              padding: { top: 12 },
            }}
          />
        )}
      </div>
    </div>
  );
}

function PropertySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-dark-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className="bg-dark-800 rounded-lg divide-y divide-dark-700">{children}</div>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[minmax(120px,auto)_1fr] gap-3 px-3 py-2">
      <span className="text-sm text-dark-400 break-all">{label}</span>
      <span className="text-sm text-white break-all">{value}</span>
    </div>
  );
}

