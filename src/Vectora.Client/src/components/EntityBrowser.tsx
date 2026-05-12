import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, Inbox, MessageSquare, Users, Search, Plus, X, Trash2, Pencil } from 'lucide-react';
import type { Connection, QueueInfo, TopicInfo, SelectedEntity } from '../types';
import { createQueue, createTopic, createSubscription, deleteQueue, deleteTopic, deleteSubscription } from '../api/client';
import EditEntityDialog from './EditEntityDialog';

interface EntityBrowserProps {
  connection: Connection | null;
  queues: QueueInfo[];
  topics: TopicInfo[];
  selectedEntity: SelectedEntity | null;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onRefresh: () => void;
  loading: boolean;
}

type CreateMode = null | 'queue' | 'topic' | 'subscription';
type EntityType = 'queue' | 'topic' | 'subscription';

interface DeleteTarget {
  type: EntityType;
  name: string;
  topicName?: string;
}

interface EditTarget {
  type: EntityType;
  name: string;
  topicName?: string;
}

export default function EntityBrowser({ connection, queues, topics, selectedEntity, onSelectEntity, onRefresh, loading }: EntityBrowserProps) {
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createName, setCreateName] = useState('');
  const [createTopicName, setCreateTopicName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit state
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const openEditDialog = (type: EntityType, name: string, topicName?: string) => {
    setEditTarget({ type, name, topicName });
  };

  const closeEditDialog = () => {
    setEditTarget(null);
  };

  const toggleTopic = (topicName: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topicName)) next.delete(topicName);
      else next.add(topicName);
      return next;
    });
  };

  const filteredQueues = queues.filter(q => q.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredTopics = topics.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.subscriptions.some(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleCreate = async () => {
    if (!connection || !createName.trim()) return;
    if (createMode === 'subscription' && !createTopicName) {
      setCreateError('Please select a topic');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      if (createMode === 'queue') {
        await createQueue(connection.id, { name: createName.trim() });
      } else if (createMode === 'topic') {
        await createTopic(connection.id, { name: createName.trim() });
      } else if (createMode === 'subscription') {
        await createSubscription(connection.id, createTopicName, { name: createName.trim() });
      }
      setCreateMode(null);
      setCreateName('');
      setCreateTopicName('');
      onRefresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const closeCreateDialog = () => {
    setCreateMode(null);
    setCreateName('');
    setCreateTopicName('');
    setCreateError('');
  };

  // Delete handlers
  const openDeleteDialog = (type: EntityType, name: string, topicName?: string) => {
    setDeleteTarget({ type, name, topicName });
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!connection || !deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'queue') {
        await deleteQueue(connection.id, deleteTarget.name);
        if (selectedEntity?.type === 'queue' && selectedEntity.name === deleteTarget.name) {
          onSelectEntity(null);
        }
      } else if (deleteTarget.type === 'topic') {
        await deleteTopic(connection.id, deleteTarget.name);
        if (selectedEntity?.type === 'topic' && selectedEntity.name === deleteTarget.name) {
          onSelectEntity(null);
        }
      } else if (deleteTarget.type === 'subscription' && deleteTarget.topicName) {
        await deleteSubscription(connection.id, deleteTarget.topicName, deleteTarget.name);
        if (selectedEntity?.type === 'subscription' && selectedEntity.name === deleteTarget.name) {
          onSelectEntity(null);
        }
      }
      closeDeleteDialog();
      onRefresh();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Close dialogs on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (createMode) closeCreateDialog();
      if (deleteTarget) closeDeleteDialog();
    }
  }, [createMode, deleteTarget]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      closeCreateDialog();
    }
  };

  const handleDeleteBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      closeDeleteDialog();
    }
  };

  if (!connection) {
    return (
      <div className="flex-1 flex items-center justify-center text-dark-500 p-4 text-center">
        <div>
          <Inbox className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>Select a connection to browse entities</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search - fixed height matches MessagePanel header */}
      <div className={`px-4 h-[73px] ${loading ? '' : 'border-b border-dark-700'} flex items-center relative`}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        {/* Loading wave replaces the border line */}
        {loading && (
          <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden bg-dark-700">
            <div className="loading-wave-line h-full w-full">
              <div className="wave-sweep h-full w-full bg-gradient-to-r from-transparent via-primary-400 to-transparent" />
            </div>
          </div>
        )}
      </div>

      {/* Entity List */}
      <div className="flex-1 overflow-auto p-2 relative">
        {loading && queues.length === 0 && topics.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-dark-500">
            <p>Loading...</p>
          </div>
        ) : (
          <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
            {/* Queues Section */}
            <div className="mb-4">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Queues</span>
                {!connection?.isEmulator && (
                  <button onClick={() => setCreateMode('queue')} className="p-1 text-dark-400 hover:text-primary-400 transition-colors" title="Create Queue">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {filteredQueues.map(queue => (
                <EntityItem
                  key={queue.name}
                  icon={<Inbox className="w-4 h-4" />}
                  name={queue.name}
                  activeCount={queue.activeMessageCount}
                  deadLetterCount={queue.deadLetterMessageCount}
                  isSelected={selectedEntity?.type === 'queue' && selectedEntity.name === queue.name}
                  onClick={() => onSelectEntity({ type: 'queue', name: queue.name })}
                  onDelete={() => openDeleteDialog('queue', queue.name)}
                  onEdit={queue.isEmulator ? undefined : () => openEditDialog('queue', queue.name)}
                  isEmulator={queue.isEmulator}
                />
              ))}
              {filteredQueues.length === 0 && !searchTerm && (
                <div className="text-xs text-dark-500 px-2 py-1 italic">No queues</div>
              )}
            </div>

            {/* Topics Section */}
            <div>
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Topics</span>
                {!connection?.isEmulator && (
                  <button onClick={() => setCreateMode('topic')} className="p-1 text-dark-400 hover:text-primary-400 transition-colors" title="Create Topic">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {filteredTopics.map(topic => (
                <div key={topic.name}>
                  <TopicItem
                    name={topic.name}
                    subscriptionCount={topic.subscriptions.length}
                    isExpanded={expandedTopics.has(topic.name)}
                    isSelected={selectedEntity?.type === 'topic' && selectedEntity.name === topic.name}
                    onClick={() => {
                      onSelectEntity({ type: 'topic', name: topic.name });
                      toggleTopic(topic.name);
                    }}
                    onDelete={() => openDeleteDialog('topic', topic.name)}
                    onEdit={topic.isEmulator ? undefined : () => openEditDialog('topic', topic.name)}
                    onAddSubscription={() => { setCreateMode('subscription'); setCreateTopicName(topic.name); }}
                    isEmulator={topic.isEmulator}
                  />
                  {expandedTopics.has(topic.name) && (
                    <div className="ml-6 border-l border-dark-700 pl-2">
                      {topic.subscriptions.map(sub => (
                        <EntityItem
                          key={sub.name}
                          icon={<Users className="w-4 h-4" />}
                          name={sub.name}
                          activeCount={sub.activeMessageCount}
                          deadLetterCount={sub.deadLetterMessageCount}
                          isSelected={selectedEntity?.type === 'subscription' && selectedEntity.name === sub.name && selectedEntity.topicName === topic.name}
                          onClick={() => onSelectEntity({ type: 'subscription', name: sub.name, topicName: topic.name })}
                          onDelete={() => openDeleteDialog('subscription', sub.name, topic.name)}
                          onEdit={topic.isEmulator ? undefined : () => openEditDialog('subscription', sub.name, topic.name)}
                          isEmulator={topic.isEmulator}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredTopics.length === 0 && !searchTerm && (
                <div className="text-xs text-dark-500 px-2 py-1 italic">No topics</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Entity Dialog */}
      {createMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleBackdropClick}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                Create {createMode === 'queue' ? 'Queue' : createMode === 'topic' ? 'Topic' : 'Subscription'}
              </h3>
              <button onClick={closeCreateDialog} className="text-dark-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {createError && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">{createError}</div>
            )}
            {createMode === 'subscription' && (
              <div className="mb-3">
                <label className="block text-sm text-dark-400 mb-1">Topic</label>
                <select
                  value={createTopicName}
                  onChange={e => setCreateTopicName(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select topic...</option>
                  {topics.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm text-dark-400 mb-1">Name</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder={`Enter ${createMode} name`}
                className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={closeCreateDialog} className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-white text-sm rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !createName.trim()}
                className="px-3 py-1.5 bg-primary-500 hover:bg-primary-400 text-white text-sm rounded-lg disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleDeleteBackdropClick}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                Delete {deleteTarget.type === 'queue' ? 'Queue' : deleteTarget.type === 'topic' ? 'Topic' : 'Subscription'}
              </h3>
              <button onClick={closeDeleteDialog} className="text-dark-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-dark-300 mb-4">
              Are you sure you want to delete <span className="text-white font-medium">{deleteTarget.name}</span>? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={closeDeleteDialog} className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-white text-sm rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white text-sm rounded-lg disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Entity Dialog */}
      {editTarget && connection && (
        <EditEntityDialog
          connection={connection}
          entityType={editTarget.type}
          entityName={editTarget.name}
          topicName={editTarget.topicName}
          queues={queues}
          topics={topics}
          onClose={closeEditDialog}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
}

interface EntityItemProps {
  icon: React.ReactNode;
  name: string;
  activeCount: number;
  deadLetterCount: number;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  isEmulator?: boolean;
}

function EntityItem({ icon, name, activeCount, deadLetterCount, isSelected, onClick, onDelete, onEdit, isEmulator }: EntityItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [, forceUpdate] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const dragXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);

  const ACTION_WIDTH = 72; // Edit + Delete buttons
  const canSwipe = !isEmulator; // No swipe actions for emulator

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen || !canSwipe) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (contentRef.current) {
          contentRef.current.style.transform = 'translateX(0px)';
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, canSwipe]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!canSwipe) return;
    e.preventDefault();
    const currentX = isOpen ? -ACTION_WIDTH : 0;
    dragXRef.current = currentX;
    startXRef.current = e.clientX - currentX;
    isDraggingRef.current = true;
    didDragRef.current = false;
    // Don't force update here - wait for actual movement to show buttons
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!canSwipe || !isDraggingRef.current) return;
    const newX = e.clientX - startXRef.current;
    const clampedX = Math.max(-ACTION_WIDTH, Math.min(0, newX));

    // Mark as dragged if moved more than 5px
    if (Math.abs(clampedX - dragXRef.current) > 5 || Math.abs(newX - (isOpen ? -ACTION_WIDTH : 0)) > 5) {
      if (!didDragRef.current) {
        didDragRef.current = true;
        forceUpdate(n => n + 1); // Only show buttons when actual drag starts
      }
    }

    dragXRef.current = clampedX;
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${dragXRef.current}px)`;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!canSwipe || !isDraggingRef.current) return;

    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    isDraggingRef.current = false;

    // Snap based on current position
    const shouldOpen = dragXRef.current < -ACTION_WIDTH / 2;
    const targetX = shouldOpen ? -ACTION_WIDTH : 0;

    if (contentRef.current) {
      contentRef.current.style.transition = 'transform 200ms ease-out';
      contentRef.current.style.transform = `translateX(${targetX}px)`;
      setTimeout(() => {
        if (contentRef.current) {
          contentRef.current.style.transition = '';
        }
        // Hide buttons after animation if drawer closed
        if (!shouldOpen) {
          didDragRef.current = false;
          forceUpdate(n => n + 1);
        }
      }, 200);
    }

    dragXRef.current = targetX;
    setIsOpen(shouldOpen);
  };

  const handleClick = () => {
    // Ignore clicks that were part of a drag
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    if (isOpen) {
      setIsOpen(false);
      if (contentRef.current) {
        contentRef.current.style.transition = 'transform 200ms ease-out';
        contentRef.current.style.transform = 'translateX(0px)';
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.style.transition = '';
          }
        }, 200);
      }
    } else {
      onClick();
    }
  };

  const showActions = canSwipe && (isOpen || didDragRef.current);

  // For emulator, render simple non-swipeable item
  if (!canSwipe) {
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-dark-700 text-dark-300'
        }`}
        onClick={onClick}
      >
        {icon}
        <span className="flex-1 truncate text-sm">{name}</span>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg" ref={containerRef}>
      {/* Action buttons behind - Edit (orange) + Delete (red) */}
      {showActions && (
        <div className="absolute right-0 top-0 bottom-0 flex">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (contentRef.current) contentRef.current.style.transform = 'translateX(0px)'; onEdit(); }}
              className="w-9 h-full bg-orange-500 hover:bg-orange-400 flex items-center justify-center text-white transition-colors"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (contentRef.current) contentRef.current.style.transform = 'translateX(0px)'; onDelete(); }}
            className="w-9 h-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-white transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main content - draggable */}
      <div
        ref={contentRef}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? 'bg-[#21314e] text-primary-400'
            : (showActions ? 'bg-dark-800 text-dark-300' : 'hover:bg-dark-700 text-dark-300')
        }`}
        style={{ transform: isOpen ? `translateX(-${ACTION_WIDTH}px)` : 'translateX(0px)', touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        {icon}
        <span className="flex-1 truncate text-sm">{name}</span>
        <span className="text-xs bg-dark-600 px-1.5 py-0.5 rounded">{activeCount}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${deadLetterCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-red-500/10 text-red-300'}`}>
          {deadLetterCount}
        </span>
      </div>
    </div>
  );
}

interface TopicItemProps {
  name: string;
  subscriptionCount: number;
  isExpanded: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  onAddSubscription: () => void;
  isEmulator?: boolean;
}

function TopicItem({ name, subscriptionCount, isExpanded, isSelected, onClick, onDelete, onEdit, onAddSubscription, isEmulator }: TopicItemProps) {
  const canSwipe = !isEmulator; // No swipe actions for emulator

  // For emulator, render simple non-swipeable item
  if (!canSwipe) {
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-dark-700 text-dark-300'
        }`}
        onClick={onClick}
      >
        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <MessageSquare className="w-4 h-4" />
        <span className="flex-1 truncate text-sm">{name}</span>
        <span className="text-xs text-dark-500">{subscriptionCount}</span>
      </div>
    );
  }

  // Use swipeable version for non-emulator
  return <SwipeableTopicItem
    name={name}
    subscriptionCount={subscriptionCount}
    isExpanded={isExpanded}
    isSelected={isSelected}
    onClick={onClick}
    onDelete={onDelete}
    onEdit={onEdit}
    onAddSubscription={onAddSubscription}
  />;
}

// Swipeable version of TopicItem (for non-emulator connections)
function SwipeableTopicItem({ name, subscriptionCount, isExpanded, isSelected, onClick, onDelete, onEdit, onAddSubscription }: Omit<TopicItemProps, 'isEmulator'>) {
  const [isOpen, setIsOpen] = useState(false);
  const [, forceUpdate] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const dragXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);

  const ACTION_WIDTH = 72; // Edit + Delete buttons

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (contentRef.current) {
          contentRef.current.style.transform = 'translateX(0px)';
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const currentX = isOpen ? -ACTION_WIDTH : 0;
    dragXRef.current = currentX;
    startXRef.current = e.clientX - currentX;
    isDraggingRef.current = true;
    didDragRef.current = false;
    // Don't force update here - wait for actual movement to show buttons
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const newX = e.clientX - startXRef.current;
    const clampedX = Math.max(-ACTION_WIDTH, Math.min(0, newX));

    if (Math.abs(clampedX - dragXRef.current) > 5 || Math.abs(newX - (isOpen ? -ACTION_WIDTH : 0)) > 5) {
      if (!didDragRef.current) {
        didDragRef.current = true;
        forceUpdate(n => n + 1); // Only show buttons when actual drag starts
      }
    }

    dragXRef.current = clampedX;
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${dragXRef.current}px)`;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;

    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    isDraggingRef.current = false;

    const shouldOpen = dragXRef.current < -ACTION_WIDTH / 2;
    const targetX = shouldOpen ? -ACTION_WIDTH : 0;

    if (contentRef.current) {
      contentRef.current.style.transition = 'transform 200ms ease-out';
      contentRef.current.style.transform = `translateX(${targetX}px)`;
      setTimeout(() => {
        if (contentRef.current) {
          contentRef.current.style.transition = '';
        }
        // Hide buttons after animation if drawer closed
        if (!shouldOpen) {
          didDragRef.current = false;
          forceUpdate(n => n + 1);
        }
      }, 200);
    }

    dragXRef.current = targetX;
    setIsOpen(shouldOpen);
  };

  const handleClick = () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    if (isOpen) {
      setIsOpen(false);
      if (contentRef.current) {
        contentRef.current.style.transition = 'transform 200ms ease-out';
        contentRef.current.style.transform = 'translateX(0px)';
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.style.transition = '';
          }
        }, 200);
      }
    } else {
      onClick();
    }
  };

  const showActions = isOpen || didDragRef.current;

  return (
    <div className="relative overflow-hidden rounded-lg" ref={containerRef}>
      {/* Action buttons behind - Edit (orange) + Delete (red) */}
      {showActions && (
        <div className="absolute right-0 top-0 bottom-0 flex">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (contentRef.current) contentRef.current.style.transform = 'translateX(0px)'; onEdit(); }}
              className="w-9 h-full bg-orange-500 hover:bg-orange-400 flex items-center justify-center text-white transition-colors"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); if (contentRef.current) contentRef.current.style.transform = 'translateX(0px)'; onDelete(); }}
            className="w-9 h-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-white transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main content - draggable */}
      <div
        ref={contentRef}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? 'bg-[#21314e] text-primary-400'
            : (showActions ? 'bg-dark-800 text-dark-300' : 'hover:bg-dark-700 text-dark-300')
        }`}
        style={{ transform: isOpen ? `translateX(-${ACTION_WIDTH}px)` : 'translateX(0px)', touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <MessageSquare className="w-4 h-4" />
        <span className="flex-1 truncate text-sm">{name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onAddSubscription(); }}
          className="p-0.5 text-dark-500 hover:text-primary-400 transition-colors"
          title="Add Subscription"
        >
          <Plus className="w-3 h-3" />
        </button>
        <span className="text-xs text-dark-500">{subscriptionCount}</span>
      </div>
    </div>
  );
}

