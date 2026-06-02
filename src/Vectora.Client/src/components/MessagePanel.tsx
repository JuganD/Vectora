import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Send, RefreshCw, Trash2, RotateCcw, Inbox, MessageSquare, Users, Skull, X, ChevronLeft, Menu, Layers, Clock } from 'lucide-react';
import type { Connection, QueueInfo, TopicInfo, SelectedEntity, ServiceBusMessage, SessionInfo } from '../types';
import { peekQueueMessages, peekSubscriptionMessages, receiveQueueMessages, receiveSubscriptionMessages, returnQueueDeadLetter, returnSubscriptionDeadLetter, returnQueueDeadLetterBatch, returnSubscriptionDeadLetterBatch, receiveQueueDeadLetterBatch, receiveSubscriptionDeadLetterBatch, deleteQueueMessagesBatch, deleteSubscriptionMessagesBatch, cancelQueueScheduledBatch, scanQueueSessions, scanSubscriptionSessions, peekQueueSessionMessages, peekSubscriptionSessionMessages } from '../api/client';
import MessageViewer from './MessageViewer';
import SendMessageDialog from './SendMessageDialog';

interface MessagePanelProps {
  connection: Connection | null;
  selectedEntity: SelectedEntity | null;
  queues: QueueInfo[];
  topics: TopicInfo[];
  onUpdateEntityCount?: (entity: SelectedEntity) => void;
  isMobile?: boolean;
  onOpenSidebar?: () => void;
}

export default function MessagePanel({ connection, selectedEntity, queues, topics, onUpdateEntityCount, isMobile = false, onOpenSidebar }: MessagePanelProps) {
  // Mobile view state: 'list' shows message list, 'detail' shows message detail
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [messages, setMessages] = useState<ServiceBusMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<ServiceBusMessage | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showDeadLetter, setShowDeadLetter] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<ServiceBusMessage | null>(null);
  const [showConsumePopup, setShowConsumePopup] = useState(false);
  const [consumeCount, setConsumeCount] = useState('10');
  const [clearAll, setClearAll] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'body' | 'properties'>('body');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Session view: browse messages grouped by session id. Everything here is peek-only
  // (read-only) and pages through the entity by sequence number, so it never locks a
  // session or disrupts live consumers.
  const [sessionView, setSessionView] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [sessionCursor, setSessionCursor] = useState<number | null>(null);
  const [sessionsReachedEnd, setSessionsReachedEnd] = useState(false);
  const [sessionScannedTotal, setSessionScannedTotal] = useState(0);
  // When a session is opened, its messages are loaded into `messages` for reuse of the
  // existing list/detail panes; these track that drill-in's own paging cursor.
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMsgLoading, setSessionMsgLoading] = useState(false);
  const [loadingMoreSessionMsgs, setLoadingMoreSessionMsgs] = useState(false);
  const [sessionMsgCursor, setSessionMsgCursor] = useState<number | null>(null);
  const [sessionMsgReachedEnd, setSessionMsgReachedEnd] = useState(false);
  const [sessionMsgScannedTotal, setSessionMsgScannedTotal] = useState(0);

  const PAGE_SIZE = 50;
  const SESSION_SCAN_LIMIT = 1000;

  const getEntityInfo = () => {
    if (!selectedEntity) return null;
    if (selectedEntity.type === 'queue') {
      return queues.find(q => q.name === selectedEntity.name);
    } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
      const topic = topics.find(t => t.name === selectedEntity.topicName);
      return topic?.subscriptions.find(s => s.name === selectedEntity.name);
    }
    return null;
  };

  const entityInfo = getEntityInfo();
  // Sessions only apply to session-enabled queues/subscriptions; topics are never selectable here.
  const isSessionEntity = !!entityInfo?.requiresSession;
  // True once a session has been opened and we're showing that session's messages.
  const inSessionMessages = sessionView && selectedSession !== null;
  // Any in-flight load, used for the header spinner/refresh state across all modes.
  const busy = loading || sessionsLoading || sessionMsgLoading;

  const loadMessages = async () => {
    if (!connection || !selectedEntity) return;
    setLoading(true);
    setHasMore(true);
    try {
      let msgs: ServiceBusMessage[];
      if (selectedEntity.type === 'queue') {
        msgs = await peekQueueMessages(connection.id, selectedEntity.name, PAGE_SIZE, showDeadLetter);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        msgs = await peekSubscriptionMessages(connection.id, selectedEntity.topicName, selectedEntity.name, PAGE_SIZE, showDeadLetter);
      } else {
        msgs = [];
      }
      setMessages(msgs);
      setHasMore(msgs.length === PAGE_SIZE);
      setSelectedMessage(null);
      setSelectedMessages(new Set());
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!connection || !selectedEntity || loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const lastSequenceNumber = messages[messages.length - 1].sequenceNumber;
      let moreMsgs: ServiceBusMessage[];
      if (selectedEntity.type === 'queue') {
        moreMsgs = await peekQueueMessages(connection.id, selectedEntity.name, PAGE_SIZE, showDeadLetter, lastSequenceNumber + 1);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        moreMsgs = await peekSubscriptionMessages(connection.id, selectedEntity.topicName, selectedEntity.name, PAGE_SIZE, showDeadLetter, lastSequenceNumber + 1);
      } else {
        moreMsgs = [];
      }
      if (moreMsgs.length > 0) {
        setMessages(prev => [...prev, ...moreMsgs]);
      }
      setHasMore(moreMsgs.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load more messages:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  // Peek one page of messages and fold the per-session counts into the running list.
  // `reset` starts a fresh scan; otherwise it continues from the last sequence number.
  const scanSessions = async (reset: boolean) => {
    if (!connection || !selectedEntity) return;
    if (reset) {
      setSessionsLoading(true);
      setSessions([]);
      setSessionScannedTotal(0);
      setSessionsReachedEnd(false);
      setSessionCursor(null);
    } else {
      setLoadingMoreSessions(true);
    }
    try {
      const from = reset ? undefined : (sessionCursor != null ? sessionCursor + 1 : undefined);
      const result = selectedEntity.type === 'queue'
        ? await scanQueueSessions(connection.id, selectedEntity.name, showDeadLetter, from, SESSION_SCAN_LIMIT)
        : selectedEntity.type === 'subscription' && selectedEntity.topicName
          ? await scanSubscriptionSessions(connection.id, selectedEntity.topicName, selectedEntity.name, showDeadLetter, from, SESSION_SCAN_LIMIT)
          : null;
      if (!result) return;
      setSessions(prev => mergeSessions(reset ? [] : prev, result.sessions));
      setSessionScannedTotal(prev => (reset ? 0 : prev) + result.scannedCount);
      setSessionsReachedEnd(result.reachedEnd);
      setSessionCursor(result.lastSequenceNumber);
    } catch (error) {
      console.error('Failed to scan sessions:', error);
    } finally {
      setSessionsLoading(false);
      setLoadingMoreSessions(false);
    }
  };

  // Peek a page and keep only the chosen session's messages, paging the same way.
  const loadSessionMessages = async (sessionId: string, reset: boolean) => {
    if (!connection || !selectedEntity) return;
    if (reset) {
      setSessionMsgLoading(true);
      setMessages([]);
      setSelectedMessage(null);
      setSessionMsgScannedTotal(0);
      setSessionMsgReachedEnd(false);
      setSessionMsgCursor(null);
    } else {
      setLoadingMoreSessionMsgs(true);
    }
    try {
      const from = reset ? undefined : (sessionMsgCursor != null ? sessionMsgCursor + 1 : undefined);
      const result = selectedEntity.type === 'queue'
        ? await peekQueueSessionMessages(connection.id, selectedEntity.name, sessionId, showDeadLetter, from, SESSION_SCAN_LIMIT)
        : selectedEntity.type === 'subscription' && selectedEntity.topicName
          ? await peekSubscriptionSessionMessages(connection.id, selectedEntity.topicName, selectedEntity.name, sessionId, showDeadLetter, from, SESSION_SCAN_LIMIT)
          : null;
      if (!result) return;
      setMessages(prev => reset ? result.messages : [...prev, ...result.messages]);
      setSessionMsgScannedTotal(prev => (reset ? 0 : prev) + result.scannedCount);
      setSessionMsgReachedEnd(result.reachedEnd);
      setSessionMsgCursor(result.lastSequenceNumber);
    } catch (error) {
      console.error('Failed to load session messages:', error);
    } finally {
      setSessionMsgLoading(false);
      setLoadingMoreSessionMsgs(false);
    }
  };

  const openSession = (sessionId: string) => {
    setSelectedSession(sessionId);
    if (isMobile) setMobileView('list');
    loadSessionMessages(sessionId, true);
  };

  const backToSessions = () => {
    setSelectedSession(null);
    setMessages([]);
    setSelectedMessage(null);
  };

  // Toggle the session list on/off; turning it off returns to the flat message list.
  const toggleSessionView = () => {
    setSelectedSession(null);
    setSessionView(v => !v);
  };

  const handleRefresh = () => {
    if (sessionView) {
      if (selectedSession) {
        loadSessionMessages(selectedSession, true);
      } else {
        scanSessions(true);
      }
      // Session view bypasses loadMessages/refreshAfterAction, so refresh the
      // left-panel Active/DLQ counters here too.
      if (selectedEntity) onUpdateEntityCount?.(selectedEntity);
    } else {
      refreshAfterAction();
    }
  };

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadMoreMessages();
    }
  }, [loadingMore, hasMore, messages]);

  useEffect(() => {
    // Any change to the entity, connection, DLQ flag, or session toggle drops back to the
    // session list (if in session view) or the flat message list, and clears selections.
    setSelectedSession(null);
    setSelectedMessage(null);
    setSelectedMessages(new Set());
    if (!connection || !selectedEntity) {
      setMessages([]);
      setSessions([]);
      return;
    }
    if (sessionView && !isSessionEntity) {
      // Selected a non-session entity while session view was on — fall back to messages.
      setSessionView(false);
      return;
    }
    if (sessionView) {
      scanSessions(true);
    } else {
      loadMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, selectedEntity, showDeadLetter, sessionView, isSessionEntity]);

  // Keyboard navigation for message list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in select mode and we have messages
      if (selectMode || messages.length === 0) return;

      // Don't handle if focus is in an input, textarea, or the editor
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' ||
          activeElement?.closest('.monaco-editor')) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();

        const currentIndex = selectedMessage
          ? messages.findIndex(m => m.sequenceNumber === selectedMessage.sequenceNumber)
          : -1;

        let newIndex: number;
        if (e.key === 'ArrowDown') {
          newIndex = currentIndex < messages.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
          newIndex = currentIndex > 0 ? currentIndex - 1 : (currentIndex === -1 ? 0 : currentIndex);
        }

        if (newIndex !== currentIndex && newIndex >= 0 && newIndex < messages.length) {
          setSelectedMessage(messages[newIndex]);

          // Scroll the message into view
          const messageElements = scrollContainerRef.current?.querySelectorAll('[data-message-item]');
          if (messageElements && messageElements[newIndex]) {
            messageElements[newIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [messages, selectedMessage, selectMode]);

  const refreshAfterAction = async () => {
    await loadMessages();
    if (selectedEntity) {
      onUpdateEntityCount?.(selectedEntity);
    }
  };

  const closeConsumePopup = () => {
    setShowConsumePopup(false);
    setConsumeCount('10');
    setClearAll(false);
  };

  // Close popups on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showConsumePopup) closeConsumePopup();
    }
  }, [showConsumePopup]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConsumeSubmit = async () => {
    if (!connection || !selectedEntity) return;
    const count = clearAll ? 10000 : parseInt(consumeCount) || 0;
    if (count <= 0) return;
    setLoading(true);
    closeConsumePopup();
    try {
      if (selectedEntity.type === 'queue') {
        await receiveQueueMessages(connection.id, selectedEntity.name, count, showDeadLetter);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        await receiveSubscriptionMessages(connection.id, selectedEntity.topicName, selectedEntity.name, count, showDeadLetter);
      }
      await refreshAfterAction();
    } catch (error) {
      console.error('Failed to receive messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConsumeSelected = async () => {
    if (!connection || !selectedEntity || selectedMessages.size === 0) return;
    setLoading(true);
    try {
      const sequenceNumbers = Array.from(selectedMessages);
      if (selectedEntity.type === 'queue') {
        await receiveQueueDeadLetterBatch(connection.id, selectedEntity.name, sequenceNumbers);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        await receiveSubscriptionDeadLetterBatch(connection.id, selectedEntity.topicName, selectedEntity.name, sequenceNumbers);
      }
      setSelectedMessages(new Set());
      setSelectMode(false);
      await refreshAfterAction();
    } catch (error) {
      console.error('Failed to consume selected messages:', error);
    } finally {
      setLoading(false);
    }
  };

  // Delete the selected active-queue messages. Scheduled messages can't be received, so they
  // are cancelled by their scheduled sequence number; everything else is received + completed.
  const handleDeleteSelected = async () => {
    if (!connection || !selectedEntity || selectedMessages.size === 0) return;
    setLoading(true);
    try {
      const selected = messages.filter(m => selectedMessages.has(m.sequenceNumber));
      const scheduled = selected.filter(m => m.state === 'Scheduled').map(m => m.sequenceNumber);
      const active = selected.filter(m => m.state !== 'Scheduled').map(m => m.sequenceNumber);

      if (selectedEntity.type === 'queue') {
        if (scheduled.length > 0) await cancelQueueScheduledBatch(connection.id, selectedEntity.name, scheduled);
        if (active.length > 0) await deleteQueueMessagesBatch(connection.id, selectedEntity.name, active);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        // Subscriptions never hold scheduled messages (scheduling targets the topic).
        if (active.length > 0) await deleteSubscriptionMessagesBatch(connection.id, selectedEntity.topicName, selectedEntity.name, active);
      }
      setSelectedMessages(new Set());
      setSelectMode(false);
      await refreshAfterAction();
    } catch (error) {
      console.error('Failed to delete selected messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleMessageSelection = (seqNum: number) => {
    setSelectedMessages(prev => {
      const next = new Set(prev);
      if (next.has(seqNum)) {
        next.delete(seqNum);
      } else {
        next.add(seqNum);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedMessages.size === messages.length) {
      setSelectedMessages(new Set());
    } else {
      setSelectedMessages(new Set(messages.map(m => m.sequenceNumber)));
    }
  };

  const toggleSelectMode = () => {
    if (selectMode) {
      // Exiting select mode - clear selections
      setSelectedMessages(new Set());
    }
    setSelectMode(!selectMode);
  };

  const handleReturnToQueue = async (msg: ServiceBusMessage) => {
    if (!connection || !selectedEntity || !showDeadLetter) return;
    setLoading(true);
    try {
      if (selectedEntity.type === 'queue') {
        await returnQueueDeadLetter(connection.id, selectedEntity.name, msg.sequenceNumber);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        await returnSubscriptionDeadLetter(connection.id, selectedEntity.topicName, selectedEntity.name, msg.sequenceNumber);
      }
      await refreshAfterAction();
    } catch (error) {
      console.error('Failed to return message:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnSelectedToQueue = async () => {
    if (!connection || !selectedEntity || selectedMessages.size === 0 || !showDeadLetter) return;
    setLoading(true);
    try {
      const sequenceNumbers = [...selectedMessages];
      if (selectedEntity.type === 'queue') {
        await returnQueueDeadLetterBatch(connection.id, selectedEntity.name, sequenceNumbers);
      } else if (selectedEntity.type === 'subscription' && selectedEntity.topicName) {
        await returnSubscriptionDeadLetterBatch(connection.id, selectedEntity.topicName, selectedEntity.name, sequenceNumbers);
      }
      setSelectMode(false);
      setSelectedMessages(new Set());
      await refreshAfterAction();
    } catch (error) {
      console.error('Failed to return messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEntityIcon = () => {
    if (!selectedEntity) return null;
    switch (selectedEntity.type) {
      case 'queue': return <Inbox className="w-5 h-5" />;
      case 'topic': return <MessageSquare className="w-5 h-5" />;
      case 'subscription': return <Users className="w-5 h-5" />;
    }
  };

  if (!connection || !selectedEntity) {
    return (
      <div className="h-full flex items-center justify-center text-dark-500 p-4">
        <div className="text-center">
          {isMobile && (
            <button
              onClick={onOpenSidebar}
              className="mb-4 px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg text-dark-300 hover:text-white hover:border-dark-500 transition-colors flex items-center gap-2 mx-auto"
            >
              <Menu className="w-4 h-4" />
              Open Entity Browser
            </button>
          )}
          <Eye className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-4 opacity-50" />
          <p className="text-base md:text-lg">Select an entity to view messages</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Death gradient overlay - subtle horror vibe */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${
          showDeadLetter ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: 'linear-gradient(180deg, rgba(80, 20, 20, 0.2) 0%, rgba(60, 15, 15, 0.08) 35%, transparent 65%)',
        }}
      />
      {/* Top edge glow */}
      <div
        className={`absolute top-0 left-0 right-0 h-px transition-opacity duration-500 ${
          showDeadLetter ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(180, 30, 30, 0.4), transparent)',
          boxShadow: '0 0 15px 2px rgba(150, 25, 25, 0.25)',
        }}
      />

      {/* Header - responsive layout */}
      <div className={`px-3 md:px-4 py-2 md:py-0 md:h-[73px] ${busy ? '' : 'border-b border-dark-700'} flex flex-col md:flex-row md:items-center md:justify-between relative z-10 gap-2 md:gap-0`}>
        {/* Loading wave replaces the border line */}
        {busy && (
          <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden bg-dark-700">
            <div className="loading-wave-line h-full w-full">
              <div className="wave-sweep h-full w-full bg-gradient-to-r from-transparent via-primary-400 to-transparent" />
            </div>
          </div>
        )}
        {/* Top row: Entity info + primary actions */}
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          {/* Mobile back button */}
          {isMobile && mobileView === 'detail' && (
            <button
              onClick={() => setMobileView('list')}
              className="p-1.5 -ml-1 text-dark-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className={`transition-colors duration-300 ${showDeadLetter ? 'text-red-400' : 'text-primary-400'}`}>{getEntityIcon()}</div>
          <div className="min-w-0 flex-shrink">
            <h2 className="font-semibold text-white text-sm md:text-base truncate">{selectedEntity.name}</h2>
            {selectedEntity.topicName && <p className="text-xs md:text-sm text-dark-400 truncate">Topic: {selectedEntity.topicName}</p>}
            <p className={`text-xs font-medium transition-all duration-300 overflow-hidden ${
              showDeadLetter ? 'text-red-400/80 max-h-6 opacity-100 mt-0.5' : 'max-h-0 opacity-0'
            }`}>Dead Letter Queue</p>
          </div>
          {/* Message counts - hidden on very small screens */}
          {!connection.isEmulator && entityInfo && 'activeMessageCount' in entityInfo && (
            <div className="hidden sm:flex items-center gap-2 ml-2 md:ml-4">
              <span className="text-xs bg-dark-600 px-2 py-1 rounded">Active: {entityInfo.activeMessageCount}</span>
              <span className={`text-xs px-2 py-1 rounded ${entityInfo.deadLetterMessageCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-red-500/10 text-red-300'}`}>
                DLQ: {entityInfo.deadLetterMessageCount}
              </span>
            </div>
          )}
          {/* Refresh button */}
          <button onClick={handleRefresh} disabled={busy} className="flex items-center gap-1.5 ml-auto md:ml-3 px-2 md:px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-300 hover:text-white text-sm rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Refresh</span>
          </button>
          {/* Sessions Toggle - only for session-enabled entities */}
          {isSessionEntity && (
            <button
              onClick={toggleSessionView}
              className={`flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-lg transition-colors ${
                sessionView
                  ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                  : 'bg-dark-600 hover:bg-dark-500 text-dark-300 hover:text-white'
              }`}
              title={sessionView ? 'Show flat message list' : 'Group messages by session'}
            >
              {sessionView ? (
                <>
                  <Inbox className="w-4 h-4" />
                  <span className="hidden md:inline">Messages</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4" />
                  <span className="hidden md:inline">Sessions</span>
                </>
              )}
            </button>
          )}
          {/* DLQ Toggle Button */}
          <button
            onClick={() => setShowDeadLetter(!showDeadLetter)}
            className={`flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm rounded-lg transition-colors ${
              showDeadLetter
                ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            }`}
          >
            {showDeadLetter ? (
              <>
                <Inbox className="w-4 h-4" />
                <span className="hidden md:inline">Switch to Queue</span>
              </>
            ) : (
              <>
                <Skull className="w-4 h-4" />
                <span className="hidden md:inline">Switch to DLQ</span>
              </>
            )}
          </button>
        </div>
        {/* Action buttons - scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 -mx-3 px-3 md:mx-0 md:px-0">
          {selectedEntity.type !== 'subscription' && (
            <button onClick={() => setShowSendDialog(true)} className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-primary-500 hover:bg-primary-400 text-white text-sm rounded-lg whitespace-nowrap flex-shrink-0">
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          )}
          {/* Mutating actions are hidden in session view, which is browse-only */}
          {!sessionView && showDeadLetter && selectedMessages.size > 0 && (
            <button onClick={handleReturnSelectedToQueue} disabled={loading} className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm rounded-lg disabled:opacity-50 whitespace-nowrap flex-shrink-0">
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">Return</span> ({selectedMessages.size})
            </button>
          )}
          {!sessionView && (selectedMessages.size > 0 ? (
            // Selected messages: DLQ "Consumes" them; the active queue "Deletes" them
            // (cancelling scheduled ones, receiving + completing the rest).
            <button
              onClick={showDeadLetter ? handleConsumeSelected : handleDeleteSelected}
              disabled={loading}
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-lg disabled:opacity-50 whitespace-nowrap flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">{showDeadLetter ? 'Consume' : 'Delete'}</span> ({selectedMessages.size})
            </button>
          ) : (
            <button
              onClick={() => setShowConsumePopup(true)}
              disabled={loading || messages.length === 0}
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-lg disabled:opacity-50 whitespace-nowrap flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Consume</span>
            </button>
          ))}

        </div>
      </div>

      {/* Content - stacked on mobile, side-by-side on desktop */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 relative z-10">
        {/* Message List - full width on mobile when in list view */}
        <div className={`
          ${isMobile
            ? mobileView === 'list' ? 'flex-1' : 'hidden'
            : 'w-1/2'
          }
          border-r border-dark-700 flex flex-col min-h-0
        `}>
          {sessionView && !selectedSession ? (
            /* ===== Session list ===== */
            <>
              {sessions.length > 0 && (
                <div className="px-3 h-[46px] border-b border-dark-700 flex items-center">
                  <span className="text-sm text-dark-400">{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>
                </div>
              )}
              <div className="flex-1 overflow-auto">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-8 text-dark-500"><p>Loading sessions...</p></div>
                ) : sessions.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-dark-500"><p>No sessions found</p></div>
                ) : (
                  <div className="divide-y divide-dark-700">
                    {sessions.map(s => (
                      <button
                        key={s.sessionId}
                        onClick={() => openSession(s.sessionId)}
                        className="w-full text-left p-3 hover:bg-dark-800 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <Layers className="w-4 h-4 text-primary-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">{s.sessionId || '(no session id)'}</div>
                            {s.lastEnqueuedTime && <div className="text-xs text-dark-500">Last: {new Date(s.lastEnqueuedTime).toLocaleString()}</div>}
                          </div>
                        </div>
                        <span className="text-xs bg-dark-600 px-2 py-1 rounded flex-shrink-0" title={sessionsReachedEnd ? undefined : 'At least this many (scan not finished)'}>
                          {s.messageCount.toLocaleString()}{!sessionsReachedEnd ? '+' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!sessionsLoading && (sessions.length > 0 || sessionScannedTotal > 0) && (
                  <div className="p-3 border-t border-dark-700">
                    <div className="text-xs text-dark-500 text-center mb-2">
                      Scanned {sessionScannedTotal.toLocaleString()} message{sessionScannedTotal === 1 ? '' : 's'}{sessionsReachedEnd ? ' · reached end of queue' : ''}
                    </div>
                    {!sessionsReachedEnd && (
                      <button
                        onClick={() => scanSessions(false)}
                        disabled={loadingMoreSessions}
                        className="w-full px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-200 text-sm rounded-lg transition-colors disabled:opacity-50"
                      >
                        {loadingMoreSessions ? 'Scanning…' : 'Load more sessions'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ===== Message list (flat, or a single session's messages) ===== */
            <>
              {inSessionMessages ? (
                <div className="px-3 h-[46px] border-b border-dark-700 flex items-center gap-2">
                  <button onClick={backToSessions} className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors flex-shrink-0">
                    <ChevronLeft className="w-4 h-4" /> Sessions
                  </button>
                  <span className="text-sm text-dark-400 truncate">· {selectedSession || '(no session id)'} ({messages.length.toLocaleString()}{!sessionMsgReachedEnd ? '+' : ''})</span>
                </div>
              ) : (
                messages.length > 0 && (
                  <div className="px-3 h-[46px] border-b border-dark-700 flex items-center justify-between">
                    <span className="text-sm text-dark-400">
                      {selectMode && selectedMessages.size > 0 ? `${selectedMessages.size} selected` : `${messages.length} messages`}
                    </span>
                    <div className="flex items-center gap-2">
                      {selectMode && (
                        <button
                          onClick={toggleSelectAll}
                          className="text-xs px-2 py-1 text-primary-400 hover:text-primary-300 hover:bg-dark-600 rounded transition-colors"
                        >
                          {selectedMessages.size === messages.length ? 'Deselect All' : 'Select All'}
                        </button>
                      )}
                      <button
                        onClick={toggleSelectMode}
                        className={`text-xs px-3 py-1.5 rounded transition-colors ${
                          selectMode
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-dark-600 text-dark-300 hover:bg-dark-500 hover:text-white'
                        }`}
                      >
                        {selectMode ? 'Cancel' : 'Select'}
                      </button>
                    </div>
                  </div>
                )
              )}
              <div ref={scrollContainerRef} onScroll={inSessionMessages ? undefined : handleScroll} className="flex-1 overflow-auto">
                {(inSessionMessages ? sessionMsgLoading : loading) ? (
                  <div className="flex items-center justify-center py-8 text-dark-500"><p>Loading...</p></div>
                ) : (
                  <>
                    {messages.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-dark-500"><p>{inSessionMessages ? 'No messages for this session in the scanned window' : 'No messages found'}</p></div>
                    ) : (
                      <div className="divide-y divide-dark-700">
                        {messages.map(msg => (
                          <MessageListItem
                            key={msg.sequenceNumber}
                            message={msg}
                            isSelected={selectedMessage?.sequenceNumber === msg.sequenceNumber}
                            isChecked={selectedMessages.has(msg.sequenceNumber)}
                            selectMode={!inSessionMessages && selectMode}
                            onClick={() => {
                              if (!inSessionMessages && selectMode) {
                                toggleMessageSelection(msg.sequenceNumber);
                              } else {
                                setSelectedMessage(msg);
                                if (isMobile) setMobileView('detail');
                              }
                            }}
                            showDeadLetter={!inSessionMessages && showDeadLetter}
                            onReturn={() => handleReturnToQueue(msg)}
                          />
                        ))}
                        {!inSessionMessages && loadingMore && (
                          <div className="flex items-center justify-center py-4 text-dark-400">
                            <div className="animate-pulse">Loading more...</div>
                          </div>
                        )}
                        {!inSessionMessages && !hasMore && messages.length > 0 && (
                          <div className="flex items-center justify-center py-4 text-dark-500 text-sm">
                            No more messages
                          </div>
                        )}
                      </div>
                    )}
                    {inSessionMessages && (
                      <div className="p-3 border-t border-dark-700">
                        <div className="text-xs text-dark-500 text-center mb-2">
                          Scanned {sessionMsgScannedTotal.toLocaleString()} message{sessionMsgScannedTotal === 1 ? '' : 's'}{sessionMsgReachedEnd ? ' · reached end of queue' : ''}
                        </div>
                        {!sessionMsgReachedEnd && (
                          <button
                            onClick={() => selectedSession != null && loadSessionMessages(selectedSession, false)}
                            disabled={loadingMoreSessionMsgs}
                            className="w-full px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-200 text-sm rounded-lg transition-colors disabled:opacity-50"
                          >
                            {loadingMoreSessionMsgs ? 'Scanning…' : 'Load more'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Message Detail - full width on mobile when in detail view */}
        <div className={`
          ${isMobile
            ? mobileView === 'detail' ? 'flex-1' : 'hidden'
            : 'w-1/2'
          }
          flex flex-col min-h-0
        `}>
          {selectedMessage ? (
            <>
              {/* Mobile back button in detail view */}
              {isMobile && (
                <div className="px-3 py-2 border-b border-dark-700 flex items-center gap-2">
                  <button
                    onClick={() => setMobileView('list')}
                    className="flex items-center gap-1 text-sm text-dark-400 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back to list
                  </button>
                </div>
              )}
              <MessageViewer
                message={selectedMessage}
                onUseAsTemplate={(msg) => { setTemplateMessage(msg); setShowSendDialog(true); }}
                viewMode={detailsTab}
                onViewModeChange={setDetailsTab}
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-dark-500 p-4">
              <p className="text-center">Select a message to view details</p>
            </div>
          )}
        </div>
      </div>

      {showSendDialog && connection && selectedEntity && (
        <SendMessageDialog connection={connection} entity={selectedEntity} templateMessage={templateMessage ?? undefined} onClose={() => { setShowSendDialog(false); setTemplateMessage(null); refreshAfterAction(); }} />
      )}

      {/* Consume Popup */}
      {showConsumePopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && closeConsumePopup()}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Consume Messages</h3>
              <button onClick={closeConsumePopup} className="text-dark-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-dark-400 mb-1">Number of messages</label>
                <input
                  type="number"
                  min="1"
                  value={consumeCount}
                  onChange={e => setConsumeCount(e.target.value)}
                  disabled={clearAll}
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Enter count..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-dark-300">
                <input
                  type="checkbox"
                  checked={clearAll}
                  onChange={e => setClearAll(e.target.checked)}
                  className="rounded border-dark-500"
                />
                Clear all messages
              </label>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={closeConsumePopup} className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-white text-sm rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleConsumeSubmit}
                disabled={!clearAll && (!consumeCount || parseInt(consumeCount) <= 0)}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white text-sm rounded-lg disabled:opacity-50"
              >
                Consume
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

// Combine session summaries from successive peek pages: sum counts per session id and
// keep the most recent enqueue time. Sorted by count (desc) so the biggest sessions lead.
function mergeSessions(existing: SessionInfo[], incoming: SessionInfo[]): SessionInfo[] {
  const map = new Map<string, SessionInfo>();
  for (const s of existing) map.set(s.sessionId, { ...s });
  for (const s of incoming) {
    const cur = map.get(s.sessionId);
    if (cur) {
      cur.messageCount += s.messageCount;
      if (s.lastEnqueuedTime && (!cur.lastEnqueuedTime || s.lastEnqueuedTime > cur.lastEnqueuedTime)) {
        cur.lastEnqueuedTime = s.lastEnqueuedTime;
      }
    } else {
      map.set(s.sessionId, { ...s });
    }
  }
  return [...map.values()].sort((a, b) => b.messageCount - a.messageCount || a.sessionId.localeCompare(b.sessionId));
}

interface MessageListItemProps {
  message: ServiceBusMessage;
  isSelected: boolean;
  isChecked: boolean;
  selectMode: boolean;
  onClick: () => void;
  showDeadLetter: boolean;
  onReturn: () => void;
}

function MessageListItem({ message, isSelected, isChecked, selectMode, onClick, showDeadLetter, onReturn }: MessageListItemProps) {
  const bodyPreview = message.body.length > 100 ? message.body.substring(0, 100) + '...' : message.body;
  const isScheduled = message.state === 'Scheduled';

  const handleReturnClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onReturn();
  };

  const scheduledBadge = isScheduled ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
      <Clock className="w-3 h-3" />
      {message.scheduledEnqueueTime ? new Date(message.scheduledEnqueueTime).toLocaleString() : 'Scheduled'}
    </span>
  ) : null;

  // In select mode: show large checkbox, glow when checked
  if (selectMode) {
    return (
      <div
        data-message-item
        className={`flex items-stretch cursor-pointer transition-all ${
          isChecked
            ? 'bg-primary-500/20 ring-1 ring-primary-500/50 ring-inset'
            : 'hover:bg-dark-800'
        }`}
        onClick={onClick}
      >
        {/* Large checkbox area */}
        <div className={`w-12 flex items-center justify-center border-r transition-colors ${
          isChecked ? 'bg-primary-500/30 border-primary-500/30' : 'bg-dark-850 border-dark-700'
        }`}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => {}}
            className="w-5 h-5 rounded border-dark-500 cursor-pointer accent-primary-500"
          />
        </div>
        {/* Message content */}
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-dark-400">#{message.sequenceNumber}</span>
              {scheduledBadge}
            </div>
            {!isScheduled && <span className="text-xs text-dark-500 flex-shrink-0">{new Date(message.enqueuedTime).toLocaleString()}</span>}
          </div>
          {message.subject && <div className="text-sm font-medium text-white mb-1">{message.subject}</div>}
          <div className="text-sm text-dark-300 truncate">{bodyPreview}</div>
          {message.deadLetterReason && <div className="text-xs text-red-400 mt-1">Reason: {message.deadLetterReason}</div>}
        </div>
      </div>
    );
  }

  // Normal mode: no checkbox
  return (
    <div data-message-item className={`p-3 cursor-pointer transition-colors ${isSelected ? 'bg-primary-500/20' : 'hover:bg-dark-800'}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-dark-400">#{message.sequenceNumber}</span>
          {scheduledBadge}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isScheduled && <span className="text-xs text-dark-500">{new Date(message.enqueuedTime).toLocaleString()}</span>}
          {showDeadLetter && (
            <button
              type="button"
              onClick={handleReturnClick}
              className="p-1.5 text-dark-400 hover:text-green-400 hover:bg-dark-600 rounded transition-colors"
              title="Return to queue"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {message.subject && <div className="text-sm font-medium text-white mb-1">{message.subject}</div>}
      <div className="text-sm text-dark-300 truncate">{bodyPreview}</div>
      {message.deadLetterReason && <div className="text-xs text-red-400 mt-1">Reason: {message.deadLetterReason}</div>}
    </div>
  );
}

