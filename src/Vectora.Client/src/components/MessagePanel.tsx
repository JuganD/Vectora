import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Send, RefreshCw, Trash2, RotateCcw, Inbox, MessageSquare, Users, Skull, X, ChevronLeft, Menu } from 'lucide-react';
import type { Connection, QueueInfo, TopicInfo, SelectedEntity, ServiceBusMessage } from '../types';
import { peekQueueMessages, peekSubscriptionMessages, receiveQueueMessages, receiveSubscriptionMessages, returnQueueDeadLetter, returnSubscriptionDeadLetter, returnQueueDeadLetterBatch, returnSubscriptionDeadLetterBatch, receiveQueueDeadLetterBatch, receiveSubscriptionDeadLetterBatch } from '../api/client';
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

  const PAGE_SIZE = 50;

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

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadMoreMessages();
    }
  }, [loadingMore, hasMore, messages]);

  useEffect(() => {
    if (connection && selectedEntity) {
      loadMessages();
    } else {
      setMessages([]);
      setSelectedMessage(null);
      setSelectedMessages(new Set());
    }
  }, [connection, selectedEntity, showDeadLetter]);

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
      <div className="px-3 md:px-4 py-2 md:py-0 md:h-[73px] border-b border-dark-700 flex flex-col md:flex-row md:items-center md:justify-between relative z-10 gap-2 md:gap-0">
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
          <button onClick={refreshAfterAction} disabled={loading} className="flex items-center gap-1.5 ml-auto md:ml-3 px-2 md:px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-dark-300 hover:text-white text-sm rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Refresh</span>
          </button>
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
          {showDeadLetter && selectedMessages.size > 0 && (
            <button onClick={handleReturnSelectedToQueue} disabled={loading} className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm rounded-lg disabled:opacity-50 whitespace-nowrap flex-shrink-0">
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">Return</span> ({selectedMessages.size})
            </button>
          )}
          {showDeadLetter && selectedMessages.size > 0 ? (
            <button
              onClick={handleConsumeSelected}
              disabled={loading}
              className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-lg disabled:opacity-50 whitespace-nowrap flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Consume</span> ({selectedMessages.size})
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
          )}

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
          {messages.length > 0 && (
            <div className="px-3 h-[46px] border-b border-dark-700 flex items-center justify-between">
              <span className="text-sm text-dark-400">
                {selectMode && selectedMessages.size > 0 ? `${selectedMessages.size} selected` : `${messages.length} messages`}
              </span>
              {showDeadLetter && (
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
              )}
            </div>
          )}
          <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-dark-400"><div className="animate-pulse">Loading messages...</div></div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-dark-500"><p>No messages found</p></div>
            ) : (
              <div className="divide-y divide-dark-700">
                {messages.map(msg => (
                  <MessageListItem
                    key={msg.sequenceNumber}
                    message={msg}
                    isSelected={selectedMessage?.sequenceNumber === msg.sequenceNumber}
                    isChecked={selectedMessages.has(msg.sequenceNumber)}
                    selectMode={showDeadLetter && selectMode}
                    onClick={() => {
                      if (showDeadLetter && selectMode) {
                        toggleMessageSelection(msg.sequenceNumber);
                      } else {
                        setSelectedMessage(msg);
                        if (isMobile) setMobileView('detail');
                      }
                    }}
                    showDeadLetter={showDeadLetter}
                    onReturn={() => handleReturnToQueue(msg)}
                  />
                ))}
                {loadingMore && (
                  <div className="flex items-center justify-center py-4 text-dark-400">
                    <div className="animate-pulse">Loading more...</div>
                  </div>
                )}
                {!hasMore && messages.length > 0 && (
                  <div className="flex items-center justify-center py-4 text-dark-500 text-sm">
                    No more messages
                  </div>
                )}
              </div>
            )}
          </div>
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

  const handleReturnClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onReturn();
  };

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
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-dark-400">#{message.sequenceNumber}</span>
            <span className="text-xs text-dark-500">{new Date(message.enqueuedTime).toLocaleString()}</span>
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
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-dark-400">#{message.sequenceNumber}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-500">{new Date(message.enqueuedTime).toLocaleString()}</span>
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

