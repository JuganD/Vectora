import { useState, useEffect } from "react";
import { X, Settings, Bot, Copy, Check, Eye, EyeOff, BookOpen } from "lucide-react";
import {
  getSettings,
  updateSettings,
  getConnections,
  updateConnectionMcpFlags,
} from "../api/client";
import {
  DATE_FORMATS,
  formatDateTime,
  getDateFormat,
  setDateFormat as applyDateFormat,
} from "../utils/dateFormat";
import type { Connection } from "../types";

interface SettingsDialogProps {
  onClose: () => void;
  onStartTour?: () => void;
}

export default function SettingsDialog({ onClose, onStartTour }: SettingsDialogProps) {
  const [batchTimeout, setBatchTimeout] = useState("60");
  const [dateFormat, setDateFormat] = useState(getDateFormat());
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpApiKey, setMcpApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const mcpUrl = `${window.location.origin}/mcp`;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [settings, conns] = await Promise.all([
        getSettings(),
        getConnections(),
      ]);
      setBatchTimeout(settings.batchOperationTimeoutSeconds.toString());
      setMcpEnabled(settings.mcpEnabled);
      setMcpApiKey(settings.mcpApiKey);
      setConnections(conns);
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  // Per-connection MCP flags persist immediately via their own endpoint.
  const setConnectionFlags = async (
    conn: Connection,
    mcpExposed: boolean,
    mcpAllowSend: boolean
  ) => {
    const allowSend = mcpExposed && mcpAllowSend; // sending requires exposure
    const previous = connections;
    setConnections((prev) =>
      prev.map((c) =>
        c.id === conn.id ? { ...c, mcpExposed, mcpAllowSend: allowSend } : c
      )
    );
    try {
      await updateConnectionMcpFlags(conn.id, mcpExposed, allowSend);
    } catch (error) {
      console.error("Failed to update connection MCP flags:", error);
      setConnections(previous); // revert on failure
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      applyDateFormat(dateFormat); // local display preference, not a backend setting
      const timeout = parseInt(batchTimeout) || 60;
      const updated = await updateSettings({
        batchOperationTimeoutSeconds: timeout,
        mcpEnabled,
        mcpApiKey: mcpApiKey.trim(),
      });
      setBatchTimeout(updated.batchOperationTimeoutSeconds.toString());
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && e.button === 0 && onClose()}
    >
      <div
        className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Settings</h3>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="text-dark-400 text-center py-8">
            Loading settings...
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">
                Batch Operation Timeout (seconds)
              </label>
              <p className="text-xs text-dark-400 mb-2">
                Timeout of batched Service Bus operations, such as sending, receiving and consuming specific messages.
              </p>
              <input
                type="number"
                min="10"
                max="600"
                value={batchTimeout}
                onChange={(e) => setBatchTimeout(e.target.value)}
                className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="60"
              />
              <p className="text-xs text-dark-500 mt-1">
                Range: 10-600 seconds (default: 60)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">
                Date Format
              </label>
              <p className="text-xs text-dark-400 mb-2">
                How dates and times are displayed across the app.
              </p>
              <select
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-dark-500 mt-1">
                Example: {formatDateTime(new Date(), dateFormat)}
              </p>
            </div>

            {/* MCP server */}
            <div className="border-t border-dark-600 pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Bot className="w-4 h-4 text-primary-400" />
                <h4 className="text-sm font-semibold text-white">MCP Server</h4>
              </div>
              <p className="text-xs text-dark-400 mb-3">
                Expose selected connections to AI agents over the Model Context Protocol for
                investigation and testing. Reads are peek-only (non-destructive); sending is
                opt-in per connection.
              </p>

              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input
                  type="checkbox"
                  checked={mcpEnabled}
                  onChange={(e) => setMcpEnabled(e.target.checked)}
                  className="w-4 h-4 accent-primary-500"
                />
                <span className="text-sm text-dark-200">Enable MCP server</span>
              </label>

              {mcpEnabled && (
                <div className="space-y-4 pl-1">
                  <div>
                    <label className="block text-xs font-medium text-dark-300 mb-1">
                      Endpoint URL
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2 py-1.5 bg-dark-900 border border-dark-600 rounded text-xs text-primary-300 truncate">
                        {mcpUrl}
                      </code>
                      <button
                        onClick={copyUrl}
                        className="p-1.5 bg-dark-700 hover:bg-dark-600 rounded text-dark-300"
                        title="Copy URL"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-300 mb-1">
                      API Key (optional)
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={mcpApiKey}
                        onChange={(e) => setMcpApiKey(e.target.value)}
                        className="w-full px-3 py-2 pr-10 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        placeholder="No key — authorization not required"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-dark-400 hover:text-white"
                        title={showApiKey ? "Hide key" : "Show key"}
                      >
                        {showApiKey ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-dark-500 mt-1">
                      Agents authorize with{" "}
                      <code className="text-dark-400">Authorization: Bearer &lt;key&gt;</code>.
                      Leave empty for no authorization.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-dark-300 mb-2">
                      Exposed connections
                    </label>
                    {connections.length === 0 ? (
                      <p className="text-xs text-dark-500">No connections yet.</p>
                    ) : (
                      <div className="border border-dark-600 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-dark-900 text-dark-400 text-xs">
                              <th className="text-left font-medium px-3 py-2">
                                Connection
                              </th>
                              <th className="font-medium px-3 py-2 w-20">Read</th>
                              <th className="font-medium px-3 py-2 w-24">Write</th>
                            </tr>
                          </thead>
                          <tbody>
                            {connections.map((conn) => (
                              <tr
                                key={conn.id}
                                className="border-t border-dark-700"
                              >
                                <td className="px-3 py-2 text-dark-200 truncate max-w-[12rem]">
                                  {conn.name}
                                  {conn.isEmulator && (
                                    <span className="ml-2 text-[10px] uppercase text-dark-500">
                                      emulator
                                    </span>
                                  )}
                                </td>
                                <td className="text-center px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={conn.mcpExposed}
                                    onChange={(e) =>
                                      setConnectionFlags(
                                        conn,
                                        e.target.checked,
                                        conn.mcpAllowSend
                                      )
                                    }
                                    className="w-4 h-4 accent-primary-500"
                                  />
                                </td>
                                <td className="text-center px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={conn.mcpAllowSend}
                                    disabled={!conn.mcpExposed}
                                    onChange={(e) =>
                                      setConnectionFlags(
                                        conn,
                                        conn.mcpExposed,
                                        e.target.checked
                                      )
                                    }
                                    className="w-4 h-4 accent-primary-500 disabled:opacity-30"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-between items-center">
              {onStartTour && (
                <button
                  onClick={onStartTour}
                  className="flex items-center gap-1.5 px-3 py-2 text-dark-300 hover:text-white bg-dark-700 hover:bg-dark-600 text-sm rounded-lg transition-colors"
                  title="Replay the feature tour"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Start Tour</span>
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-white text-sm rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white text-sm rounded-lg disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
