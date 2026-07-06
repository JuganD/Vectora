import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Edit2, Save, Database, Upload } from 'lucide-react';
import type { Connection, EmulatorConfig } from '../types';
import { getConnections, createConnection, updateConnection, deleteConnection, getEmulatorConfigs, uploadEmulatorConfig } from '../api/client';

interface ConnectionManagerProps {
  onClose: () => void;
}

export default function ConnectionManager({ onClose }: ConnectionManagerProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [emulatorConfigs, setEmulatorConfigs] = useState<EmulatorConfig[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: '', connectionString: '', isEmulator: false, emulatorConfigId: undefined as number | undefined });
  const [error, setError] = useState('');

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

  const loadData = async () => {
    try {
      const [conns, configs] = await Promise.all([getConnections(), getEmulatorConfigs()]);
      setConnections(conns);
      setEmulatorConfigs(configs);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    if (!formData.name || !formData.connectionString) {
      setError('Name and connection string are required');
      return;
    }
    setError('');
    try {
      if (editingId) {
        await updateConnection(editingId, formData);
      } else {
        await createConnection(formData);
      }
      await loadData();
      setIsAdding(false);
      setEditingId(null);
      setFormData({ name: '', connectionString: '', isEmulator: false, emulatorConfigId: undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleEdit = (conn: Connection) => {
    setEditingId(conn.id);
    setFormData({ name: conn.name, connectionString: conn.connectionString, isEmulator: conn.isEmulator, emulatorConfigId: conn.emulatorConfigId });
    setIsAdding(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this connection?')) return;
    try {
      await deleteConnection(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({ name: '', connectionString: '', isEmulator: false, emulatorConfigId: undefined });
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', connectionString: '', isEmulator: false, emulatorConfigId: undefined });
    setError('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={handleBackdropMouseDown}>
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-primary-400" />
            Manage Connections
          </h2>
          <button onClick={onClose} className="text-dark-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
          )}

          {/* Connection List */}
          <div className="space-y-2 mb-4">
            {connections.map(conn => (
              <div key={conn.id} className={`p-3 rounded-lg border ${editingId === conn.id ? 'border-primary-500 bg-primary-500/10' : 'border-dark-600 bg-dark-700/50'}`}>
                {editingId === conn.id ? (
                  <ConnectionForm formData={formData} setFormData={setFormData} emulatorConfigs={emulatorConfigs} onSave={handleSave} onCancel={handleCancel} onConfigUploaded={loadData} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-white">{conn.name}</div>
                      <div className="text-sm text-dark-400 truncate max-w-md">{conn.connectionString.substring(0, 50)}...</div>
                      {conn.isEmulator && <span className="text-xs text-purple-400">Emulator</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleEdit(conn)} className="p-1.5 text-dark-400 hover:text-primary-400 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(conn.id)} className="p-1.5 text-dark-400 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add New Connection */}
          {isAdding ? (
            <div className="p-3 rounded-lg border border-primary-500 bg-primary-500/10">
              <ConnectionForm formData={formData} setFormData={setFormData} emulatorConfigs={emulatorConfigs} onSave={handleSave} onCancel={handleCancel} onConfigUploaded={loadData} />
            </div>
          ) : (
            <button onClick={handleAdd} className="w-full p-3 border border-dashed border-dark-500 rounded-lg text-dark-400 hover:text-white hover:border-primary-500 transition-colors flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> Add Connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ConnectionFormProps {
  formData: { name: string; connectionString: string; isEmulator: boolean; emulatorConfigId: number | undefined };
  setFormData: React.Dispatch<React.SetStateAction<{ name: string; connectionString: string; isEmulator: boolean; emulatorConfigId: number | undefined }>>;
  emulatorConfigs: EmulatorConfig[];
  onSave: () => void;
  onCancel: () => void;
  onConfigUploaded: () => void;
}

function ConnectionForm({ formData, setFormData, emulatorConfigs, onSave, onCancel, onConfigUploaded }: ConnectionFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const content = await file.text();
      const config = await uploadEmulatorConfig(file.name, content);
      setFormData(d => ({ ...d, emulatorConfigId: config.id }));
      onConfigUploaded();
    } catch (err) {
      console.error('Failed to upload config:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <input type="text" placeholder="Connection Name" value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
      <input type="text" placeholder="Connection String" value={formData.connectionString} onChange={e => setFormData(d => ({ ...d, connectionString: e.target.value }))} className="w-full px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
      <label className="flex items-center gap-2 text-sm text-dark-300">
        <input type="checkbox" checked={formData.isEmulator} onChange={e => setFormData(d => ({ ...d, isEmulator: e.target.checked }))} className="rounded border-dark-500" />
        This is an emulator connection
      </label>
      {formData.isEmulator && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={formData.emulatorConfigId ?? ''}
              onChange={e => setFormData(d => ({ ...d, emulatorConfigId: e.target.value ? Number(e.target.value) : undefined }))}
              className="flex-1 px-3 py-2 bg-dark-900 border border-dark-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select emulator config...</option>
              {emulatorConfigs.map(c => <option key={c.id} value={c.id}>{c.fileName}</option>)}
            </select>
            <input type="file" ref={fileInputRef} accept=".json" onChange={handleFileUpload} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 bg-dark-600 hover:bg-dark-500 text-white text-sm rounded-lg flex items-center gap-1 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
          <p className="text-xs text-dark-400">Upload a new config file or select an existing one</p>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onSave} className="px-3 py-1.5 bg-primary-500 hover:bg-primary-400 text-white text-sm rounded-lg flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save</button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 text-white text-sm rounded-lg">Cancel</button>
      </div>
    </div>
  );
}
