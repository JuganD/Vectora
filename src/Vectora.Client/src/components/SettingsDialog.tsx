import { useState, useEffect } from "react";
import { X, Settings } from "lucide-react";
import { getSettings, updateSettings } from "../api/client";

interface SettingsDialogProps {
  onClose: () => void;
}

export default function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [batchTimeout, setBatchTimeout] = useState("60");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await getSettings();
      setBatchTimeout(data.batchOperationTimeoutSeconds.toString());
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const timeout = parseInt(batchTimeout) || 60;
      const updated = await updateSettings({
        batchOperationTimeoutSeconds: timeout,
      });
      setBatchTimeout(updated.batchOperationTimeoutSeconds.toString());
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-md p-4"
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
          <div className="space-y-4">
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

            <div className="flex gap-2 justify-end mt-6">
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
        )}
      </div>
    </div>
  );
}
