import { useState, useEffect, useRef, useCallback } from 'react';
import { LogOut, RefreshCw, ChevronDown, Check, Menu, X, Settings } from 'lucide-react';
import type { Connection, QueueInfo, TopicInfo, SelectedEntity } from '../types';
import { getConnections, getEntities, getQueueRuntimeInfo, getSubscriptionRuntimeInfo } from '../api/client';
import ConnectionManager from './ConnectionManager';
import EntityBrowser from './EntityBrowser';
import MessagePanel from './MessagePanel';
import SettingsDialog from './SettingsDialog';

const LAST_CONNECTION_KEY = 'vectora_last_connection';

// After a successful entity fetch, switching back to that connection within this window shows
// the cached data without re-fetching. Kept in memory only — a full app reload always refetches.
const REFRESH_THROTTLE_MS = 5 * 60 * 1000;

interface CachedEntities {
  queues: QueueInfo[];
  topics: TopicInfo[];
  supportsManagement: boolean;
}

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

interface MainLayoutProps {
  onLogout: () => void;
  showLogout?: boolean;
}

export default function MainLayout({ onLogout, showLogout = true }: MainLayoutProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  // Whether the selected connection exposes the management API (always true for real Service
  // Bus; for emulators, true only when the admin port is reachable). Gates create/edit/delete
  // and runtime-count refreshes in the UI.
  const [supportsManagement, setSupportsManagement] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConnectionManager, setShowConnectionManager] = useState(false);
  const [showConnectionDropdown, setShowConnectionDropdown] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Close mobile sidebar when entity is selected
  const handleSelectEntity = (entity: SelectedEntity | null) => {
    setSelectedEntity(entity);
    if (isMobile && entity) {
      setShowMobileSidebar(false);
    }
    // Auto-fetch runtime counts whenever the management API is available
    // (real Service Bus, or an emulator with a reachable admin port).
    if (entity && selectedConnection && supportsManagement) {
      updateEntityCount(entity);
    }
  };

  const loadConnections = async () => {
    try {
      const data = await getConnections();
      setConnections(data);

      // Restore last connection
      const lastConnectionId = localStorage.getItem(LAST_CONNECTION_KEY);
      if (lastConnectionId && !selectedConnection) {
        const conn = data.find(c => c.id === Number(lastConnectionId));
        if (conn) setSelectedConnection(conn);
      }
    } catch (error) {
      console.error('Failed to load connections:', error);
    }
  };

  // Per-connection in-memory cache of the last fetched entities, the last successful fetch time
  // (for throttling), and the set of connections with a fetch currently in flight. All refs:
  // they survive re-renders/switches without causing renders, and are intentionally lost on a
  // full app reload (we always re-fetch fresh then).
  const entityCacheRef = useRef<Map<number, CachedEntities>>(new Map());
  const lastRefreshRef = useRef<Map<number, number>>(new Map());
  const inFlightRef = useRef<Set<number>>(new Set());

  // Always-current view of the selected connection, read by async fetch callbacks after their
  // await so a late response only touches the screen when its connection is still active.
  const selectedConnectionRef = useRef(selectedConnection);
  selectedConnectionRef.current = selectedConnection;

  // Fetch fresh entities for a connection. The result is always cached + timestamped, but the
  // visible state and loading flag are only updated when that connection is still selected — so
  // switching away mid-fetch saves the data to its cache without hijacking the current screen.
  const loadEntities = useCallback(async (connectionId: number) => {
    if (inFlightRef.current.has(connectionId)) return; // a fetch for this connection is already running
    inFlightRef.current.add(connectionId);
    if (selectedConnectionRef.current?.id === connectionId) setLoading(true);
    try {
      const data = await getEntities(connectionId, true);
      const cached: CachedEntities = { queues: data.queues, topics: data.topics, supportsManagement: data.supportsManagement };
      entityCacheRef.current.set(connectionId, cached);
      lastRefreshRef.current.set(connectionId, Date.now());
      if (selectedConnectionRef.current?.id === connectionId) {
        setQueues(cached.queues);
        setTopics(cached.topics);
        setSupportsManagement(cached.supportsManagement);
      }
    } catch (error) {
      console.error('Failed to load entities:', error);
    } finally {
      inFlightRef.current.delete(connectionId);
      if (selectedConnectionRef.current?.id === connectionId) setLoading(false);
    }
  }, []);

  // Manual refresh / post-mutation refresh: fetch now, bypassing the throttle window.
  const refreshEntities = useCallback(() => {
    if (selectedConnectionRef.current) loadEntities(selectedConnectionRef.current.id);
  }, [loadEntities]);

  const handleSelectConnection = (conn: Connection | null) => {
    setSelectedConnection(conn);
    setShowConnectionDropdown(false);
    if (conn) {
      localStorage.setItem(LAST_CONNECTION_KEY, String(conn.id));
    } else {
      localStorage.removeItem(LAST_CONNECTION_KEY);
    }
  };

  const updateEntityCount = useCallback(async (entity: SelectedEntity) => {
    const connectionId = selectedConnectionRef.current?.id;
    if (connectionId == null) return;
    try {
      if (entity.type === 'queue') {
        const info = await getQueueRuntimeInfo(connectionId, entity.name);
        if (selectedConnectionRef.current?.id !== connectionId) return;
        const patch = (q: QueueInfo) => q.name === entity.name ? { ...q, activeMessageCount: info.activeMessageCount, deadLetterMessageCount: info.deadLetterMessageCount } : q;
        setQueues(prev => prev.map(patch));
        const cached = entityCacheRef.current.get(connectionId);
        if (cached) entityCacheRef.current.set(connectionId, { ...cached, queues: cached.queues.map(patch) });
      } else if (entity.type === 'subscription' && entity.topicName) {
        const info = await getSubscriptionRuntimeInfo(connectionId, entity.topicName, entity.name);
        if (selectedConnectionRef.current?.id !== connectionId) return;
        const patch = (t: TopicInfo) => t.name === entity.topicName ? {
          ...t,
          subscriptions: t.subscriptions.map(s => s.name === entity.name ? { ...s, activeMessageCount: info.activeMessageCount, deadLetterMessageCount: info.deadLetterMessageCount } : s)
        } : t;
        setTopics(prev => prev.map(patch));
        const cached = entityCacheRef.current.get(connectionId);
        if (cached) entityCacheRef.current.set(connectionId, { ...cached, topics: cached.topics.map(patch) });
      }
    } catch (error) {
      console.error('Failed to update entity count:', error);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    setSelectedEntity(null);
    const conn = selectedConnection;
    if (!conn) {
      setQueues([]);
      setTopics([]);
      setSupportsManagement(false);
      setLoading(false);
      return;
    }
    // Show this connection's cached entities instantly (if any) so the user can keep working
    // while a background refresh runs; otherwise start empty with a loading indicator.
    const cached = entityCacheRef.current.get(conn.id);
    if (cached) {
      setQueues(cached.queues);
      setTopics(cached.topics);
      setSupportsManagement(cached.supportsManagement);
    } else {
      setQueues([]);
      setTopics([]);
      setSupportsManagement(false);
    }
    // The loading indicator reflects only an in-flight fetch for THIS connection.
    setLoading(inFlightRef.current.has(conn.id));
    // Background refresh, throttled per connection: skip when we just showed cache that was
    // refreshed within the throttle window. A late response is guarded by connection id in
    // loadEntities, so switching away mid-fetch never refreshes the wrong screen.
    const lastRefresh = lastRefreshRef.current.get(conn.id) ?? 0;
    const stale = Date.now() - lastRefresh >= REFRESH_THROTTLE_MS;
    if (!cached || stale) {
      loadEntities(conn.id);
    }
  }, [selectedConnection, loadEntities]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowConnectionDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('vectora_token');
    onLogout();
  };

  return (
    <div className="h-full bg-dark-950 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-dark-900 border-b border-dark-700 px-3 md:px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 md:gap-6">
          {/* Mobile menu button */}
          {isMobile && (
            <button
              onClick={() => setShowMobileSidebar(!showMobileSidebar)}
              className="p-2 -ml-1 text-dark-400 hover:text-white transition-colors"
            >
              {showMobileSidebar ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {/* Logo */}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-7 h-7 md:w-8 md:h-8 bg-dark-800 border border-dark-600 rounded-lg flex items-center justify-center">
              <img src="/vectora-logo.svg" alt="Vectora" className="w-5 h-5 md:w-6 md:h-6 drop-shadow-[0_0_6px_rgba(14,165,233,0.5)]" />
            </div>
            <h1 className="text-lg md:text-xl font-bold bg-gradient-to-r from-primary-400 to-purple-400 bg-clip-text text-transparent">
              Vectora
            </h1>
          </div>

          {/* Connection Selector - hidden on mobile (moved to sidebar) */}
          <div className="relative hidden md:block" ref={dropdownRef}>
            <button
              onClick={() => setShowConnectionDropdown(!showConnectionDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg hover:border-dark-500 transition-colors min-w-[240px]"
            >
              <div className="flex-1 text-left">
                {selectedConnection ? (
                  <div>
                    <div className="text-sm font-medium text-white">{selectedConnection.name}</div>
                    <div className="text-xs text-dark-400">{selectedConnection.isEmulator ? 'Emulator' : 'Azure Service Bus'}</div>
                  </div>
                ) : (
                  <span className="text-sm text-dark-400">Select connection...</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-dark-400 transition-transform ${showConnectionDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showConnectionDropdown && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-dark-800 border border-dark-600 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="max-h-80 overflow-auto">
                  {connections.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-dark-400">No connections configured</div>
                  ) : (
                    connections.map(conn => (
                      <button
                        key={conn.id}
                        onClick={() => handleSelectConnection(conn)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          selectedConnection?.id === conn.id
                            ? 'bg-primary-500/20 border-l-2 border-primary-500'
                            : 'hover:bg-dark-700 border-l-2 border-transparent'
                        }`}
                      >
                        <div className="flex-1">
                          <div className={`font-medium ${selectedConnection?.id === conn.id ? 'text-primary-400' : 'text-white'}`}>
                            {conn.name}
                          </div>
                          <div className="text-xs text-dark-400 mt-0.5">
                            {conn.isEmulator ? 'Emulator' : 'Azure Service Bus'}
                          </div>
                        </div>
                        {selectedConnection?.id === conn.id && (
                          <Check className="w-4 h-4 text-primary-400" />
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-dark-600 p-2">
                  <button
                    onClick={() => { setShowConnectionDropdown(false); setShowConnectionManager(true); }}
                    className="w-full px-3 py-2 text-sm text-primary-400 hover:bg-dark-700 rounded-lg transition-colors"
                  >
                    Manage Connections...
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedConnection && !isMobile && (
            <button
              onClick={refreshEntities}
              disabled={loading}
              className="p-2 text-dark-400 hover:text-white transition-colors"
              title="Refresh entities"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 text-dark-400 hover:text-white transition-colors text-sm p-2 md:p-0"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden md:inline">Settings</span>
          </button>
          {showLogout && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-dark-400 hover:text-white transition-colors text-sm p-2 md:p-0"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden md:inline">Logout</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Mobile Sidebar Overlay */}
        {isMobile && showMobileSidebar && (
          <div
            className="absolute inset-0 bg-black/50 z-40"
            onClick={() => setShowMobileSidebar(false)}
          />
        )}

        {/* Entity Browser - Left Panel / Mobile Drawer */}
        <div className={`
          ${isMobile
            ? `absolute inset-y-0 left-0 z-50 w-[85%] max-w-sm transform transition-transform duration-300 ease-in-out ${showMobileSidebar ? 'translate-x-0' : '-translate-x-full'}`
            : 'w-80 relative'
          }
          border-r border-dark-700 overflow-hidden flex flex-col bg-dark-950
        `}>
          {/* Mobile connection selector */}
          {isMobile && (
            <div className="p-3 border-b border-dark-700 bg-dark-900">
              <button
                onClick={() => setShowConnectionDropdown(!showConnectionDropdown)}
                className="flex items-center gap-2 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg hover:border-dark-500 transition-colors w-full"
              >
                <div className="flex-1 text-left min-w-0">
                  {selectedConnection ? (
                    <div>
                      <div className="text-sm font-medium text-white truncate">{selectedConnection.name}</div>
                      <div className="text-xs text-dark-400">{selectedConnection.isEmulator ? 'Emulator' : 'Azure Service Bus'}</div>
                    </div>
                  ) : (
                    <span className="text-sm text-dark-400">Select connection...</span>
                  )}
                </div>
                <ChevronDown className={`w-4 h-4 text-dark-400 flex-shrink-0 transition-transform ${showConnectionDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showConnectionDropdown && (
                <div className="mt-2 bg-dark-800 border border-dark-600 rounded-xl shadow-xl overflow-hidden">
                  <div className="max-h-60 overflow-auto">
                    {connections.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-dark-400">No connections configured</div>
                    ) : (
                      connections.map(conn => (
                        <button
                          key={conn.id}
                          onClick={() => { handleSelectConnection(conn); setShowConnectionDropdown(false); }}
                          className="w-full px-4 py-3 text-left hover:bg-dark-700 transition-colors flex items-center justify-between"
                        >
                          <div>
                            <div className="text-sm font-medium text-white">{conn.name}</div>
                            <div className="text-xs text-dark-400">{conn.isEmulator ? 'Emulator' : 'Azure Service Bus'}</div>
                          </div>
                          {selectedConnection?.id === conn.id && (
                            <Check className="w-4 h-4 text-primary-400" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="border-t border-dark-600 p-2">
                    <button
                      onClick={() => { setShowConnectionDropdown(false); setShowMobileSidebar(false); setShowConnectionManager(true); }}
                      className="w-full px-3 py-2 text-sm text-primary-400 hover:bg-dark-700 rounded-lg transition-colors"
                    >
                      Manage Connections...
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <EntityBrowser
            connection={selectedConnection}
            queues={queues}
            topics={topics}
            selectedEntity={selectedEntity}
            onSelectEntity={handleSelectEntity}
            onRefresh={refreshEntities}
            loading={loading}
            canManage={supportsManagement}
          />
        </div>

        {/* Message Panel - Right Panel / Full width on mobile */}
        <div className="flex-1 overflow-hidden h-full">
          <MessagePanel
            connection={selectedConnection}
            selectedEntity={selectedEntity}
            queues={queues}
            topics={topics}
            onUpdateEntityCount={updateEntityCount}
            isMobile={isMobile}
            onOpenSidebar={() => setShowMobileSidebar(true)}
          />
        </div>
      </div>

      {/* Connection Manager Modal */}
      {showConnectionManager && (
        <ConnectionManager
          onClose={() => {
            setShowConnectionManager(false);
            loadConnections();
          }}
        />
      )}

      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

