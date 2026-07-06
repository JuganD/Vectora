import { useState, useEffect, useMemo } from "react";
import { X, Search, Inbox, MessageSquare, Loader2 } from "lucide-react";
import type {
  Connection,
  QueueInfo,
  TopicInfo,
  EntityStatus,
  QueueProperties,
  TopicProperties,
  SubscriptionProperties,
  UpdateQueueRequest,
  UpdateTopicRequest,
  UpdateSubscriptionRequest,
} from "../types";
import {
  getQueueProperties,
  getTopicProperties,
  getSubscriptionProperties,
  updateQueue,
  updateTopic,
  updateSubscription,
} from "../api/client";

const STATUS_OPTIONS: EntityStatus[] = [
  "Active",
  "Disabled",
  "SendDisabled",
  "ReceiveDisabled",
];
const TOPIC_STATUS_OPTIONS: EntityStatus[] = [
  "Active",
  "Disabled",
  "SendDisabled",
]; // Topics cannot have ReceiveDisabled

interface EditEntityDialogProps {
  connection: Connection;
  entityType: "queue" | "topic" | "subscription";
  entityName: string;
  topicName?: string; // Required for subscriptions
  queues: QueueInfo[];
  topics: TopicInfo[];
  onClose: () => void;
  onSaved: () => void;
}

// TimeSpan.MaxValue in days (approximately 10675199 days)
const MAX_TIMESPAN_DAYS = 10675199;

// Parse ISO 8601 duration to human-readable format
function parseDuration(iso: string): string {
  const match = iso.match(/^(\d+)\.(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (match) {
    const [, days, hours, minutes, seconds] = match;
    const daysNum = parseInt(days);
    // Detect TimeSpan.MaxValue (never expires)
    if (daysNum >= MAX_TIMESPAN_DAYS) {
      return "Never";
    }
    const parts: string[] = [];
    if (daysNum > 0) parts.push(`${daysNum}d`);
    if (hours !== "00") parts.push(`${parseInt(hours)}h`);
    if (minutes !== "00") parts.push(`${parseInt(minutes)}m`);
    if (seconds !== "00") parts.push(`${parseInt(seconds)}s`);
    return parts.length > 0 ? parts.join(" ") : "0s";
  }
  return iso;
}

// Format duration for API (TimeSpan format: d.hh:mm:ss)
function formatDuration(input: string): string {
  // Handle "Never" - return TimeSpan.MaxValue
  if (input.toLowerCase() === "never") {
    return `${MAX_TIMESPAN_DAYS}.00:00:00`;
  }
  // Try to parse human format like "14d" or "5m" or "1d 2h 30m"
  let totalSeconds = 0;
  const pattern = /(\d+)\s*(d|h|m|s)/gi;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "d") totalSeconds += value * 86400;
    else if (unit === "h") totalSeconds += value * 3600;
    else if (unit === "m") totalSeconds += value * 60;
    else if (unit === "s") totalSeconds += value;
  }
  if (totalSeconds > 0) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days}.${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  // Already in correct format or not parseable
  return input;
}

interface ForwardToSelectorProps {
  value: string;
  onChange: (value: string) => void;
  queues: QueueInfo[];
  topics: TopicInfo[];
  label: string;
}

function ForwardToSelector({
  value,
  onChange,
  queues,
  topics,
  label,
}: ForwardToSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allEntities = useMemo(() => {
    const entities: { type: "queue" | "topic"; name: string }[] = [];
    queues.forEach((q) => entities.push({ type: "queue", name: q.name }));
    topics.forEach((t) => entities.push({ type: "topic", name: t.name }));
    return entities;
  }, [queues, topics]);

  const filtered = useMemo(() => {
    if (!search) return allEntities;
    const lower = search.toLowerCase();
    return allEntities.filter((e) => e.name.toLowerCase().includes(lower));
  }, [allEntities, search]);

  return (
    <div className="relative">
      <label className="block text-sm text-dark-400 mb-1">{label}</label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm text-left flex items-center gap-2"
        >
          {value ? (
            <>
              {allEntities.find((e) => e.name === value)?.type === "queue" ? (
                <Inbox className="w-4 h-4 text-primary-400" />
              ) : (
                <MessageSquare className="w-4 h-4 text-primary-400" />
              )}
              <span className="truncate">{value}</span>
            </>
          ) : (
            <span className="text-dark-500">None</span>
          )}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="px-2 py-2 bg-dark-700 border border-dark-600 rounded text-dark-400 hover:text-white"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-dark-800 border border-dark-600 rounded-lg shadow-xl max-h-64 overflow-hidden">
          <div className="p-2 border-b border-dark-600">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-8 pr-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-white placeholder-dark-500"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-dark-500 text-sm">
                No entities found
              </div>
            ) : (
              filtered.map((entity) => (
                <button
                  key={`${entity.type}-${entity.name}`}
                  type="button"
                  onClick={() => {
                    onChange(entity.name);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-white hover:bg-dark-700 flex items-center gap-2"
                >
                  {entity.type === "queue" ? (
                    <Inbox className="w-4 h-4 text-primary-400" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-primary-400" />
                  )}
                  <span className="truncate">{entity.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface QueueFormProps {
  properties: QueueProperties;
  queues: QueueInfo[];
  topics: TopicInfo[];
  onSave: (data: UpdateQueueRequest) => Promise<void>;
  saving: boolean;
}

function QueueForm({
  properties,
  queues,
  topics,
  onSave,
  saving,
}: QueueFormProps) {
  const [status, setStatus] = useState<EntityStatus>(properties.status);
  const [ttl, setTtl] = useState(
    parseDuration(properties.defaultMessageTimeToLive),
  );
  const [lockDuration, setLockDuration] = useState(
    parseDuration(properties.lockDuration),
  );
  const [maxDeliveryCount, setMaxDeliveryCount] = useState(
    properties.maxDeliveryCount,
  );
  const [deadLetterOnExpiration, setDeadLetterOnExpiration] = useState(
    properties.deadLetteringOnMessageExpiration,
  );
  const [forwardTo, setForwardTo] = useState(properties.forwardTo || "");
  const [forwardDlq, setForwardDlq] = useState(
    properties.forwardDeadLetteredMessagesTo || "",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      status,
      defaultMessageTimeToLive: formatDuration(ttl),
      lockDuration: formatDuration(lockDuration),
      maxDeliveryCount,
      deadLetteringOnMessageExpiration: deadLetterOnExpiration,
      forwardTo: forwardTo || null,
      forwardDeadLetteredMessagesTo: forwardDlq || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-dark-400 mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EntityStatus)}
          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-dark-400 mb-1">
            Message TTL
          </label>
          <input
            type="text"
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
            placeholder="e.g. 14d or 1h 30m"
          />
        </div>
        <div>
          <label className="block text-sm text-dark-400 mb-1">
            Lock Duration
          </label>
          <input
            type="text"
            value={lockDuration}
            onChange={(e) => setLockDuration(e.target.value)}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
            placeholder="e.g. 30s or 5m"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-dark-400 mb-1">
            Max Delivery Count
          </label>
          <input
            type="number"
            value={maxDeliveryCount}
            onChange={(e) => setMaxDeliveryCount(parseInt(e.target.value) || 1)}
            min={1}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={deadLetterOnExpiration}
              onChange={(e) => setDeadLetterOnExpiration(e.target.checked)}
              className="w-4 h-4 rounded bg-dark-700 border-dark-600"
            />
            <span className="text-sm text-dark-300">
              Dead-letter on expiration
            </span>
          </label>
        </div>
      </div>
      <ForwardToSelector
        value={forwardTo}
        onChange={setForwardTo}
        queues={queues}
        topics={topics}
        label="Forward To"
      />
      <ForwardToSelector
        value={forwardDlq}
        onChange={setForwardDlq}
        queues={queues}
        topics={topics}
        label="Forward Dead-lettered Messages To"
      />
      <div className="flex justify-end pt-8 mt-4">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>
    </form>
  );
}

interface TopicFormProps {
  properties: TopicProperties;
  onSave: (data: UpdateTopicRequest) => Promise<void>;
  saving: boolean;
}

function TopicForm({ properties, onSave, saving }: TopicFormProps) {
  const [status, setStatus] = useState<EntityStatus>(properties.status);
  const [ttl, setTtl] = useState(
    parseDuration(properties.defaultMessageTimeToLive),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      status,
      defaultMessageTimeToLive: formatDuration(ttl),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-dark-400 mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EntityStatus)}
          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
        >
          {TOPIC_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-dark-400 mb-1">
          Default Message TTL
        </label>
        <input
          type="text"
          value={ttl}
          onChange={(e) => setTtl(e.target.value)}
          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
          placeholder="e.g. 14d or 1h 30m"
        />
      </div>
      <p className="text-xs text-dark-500">
        Topics have fewer editable properties. Other settings are fixed at
        creation time.
      </p>
      <div className="flex justify-end pt-8 mt-4">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>
    </form>
  );
}

interface SubscriptionFormProps {
  properties: SubscriptionProperties;
  queues: QueueInfo[];
  topics: TopicInfo[];
  onSave: (data: UpdateSubscriptionRequest) => Promise<void>;
  saving: boolean;
}

function SubscriptionForm({
  properties,
  queues,
  topics,
  onSave,
  saving,
}: SubscriptionFormProps) {
  const [status, setStatus] = useState<EntityStatus>(properties.status);
  const [ttl, setTtl] = useState(
    parseDuration(properties.defaultMessageTimeToLive),
  );
  const [lockDuration, setLockDuration] = useState(
    parseDuration(properties.lockDuration),
  );
  const [maxDeliveryCount, setMaxDeliveryCount] = useState(
    properties.maxDeliveryCount,
  );
  const [deadLetterOnExpiration, setDeadLetterOnExpiration] = useState(
    properties.deadLetteringOnMessageExpiration,
  );
  const [forwardTo, setForwardTo] = useState(properties.forwardTo || "");
  const [forwardDlq, setForwardDlq] = useState(
    properties.forwardDeadLetteredMessagesTo || "",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      status,
      defaultMessageTimeToLive: formatDuration(ttl),
      lockDuration: formatDuration(lockDuration),
      maxDeliveryCount,
      deadLetteringOnMessageExpiration: deadLetterOnExpiration,
      forwardTo: forwardTo || null,
      forwardDeadLetteredMessagesTo: forwardDlq || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-dark-400 mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EntityStatus)}
          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-dark-400 mb-1">
            Message TTL
          </label>
          <input
            type="text"
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
            placeholder="e.g. 14d or 1h 30m"
          />
        </div>
        <div>
          <label className="block text-sm text-dark-400 mb-1">
            Lock Duration
          </label>
          <input
            type="text"
            value={lockDuration}
            onChange={(e) => setLockDuration(e.target.value)}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
            placeholder="e.g. 30s or 5m"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-dark-400 mb-1">
            Max Delivery Count
          </label>
          <input
            type="number"
            value={maxDeliveryCount}
            onChange={(e) => setMaxDeliveryCount(parseInt(e.target.value) || 1)}
            min={1}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded text-white text-sm"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={deadLetterOnExpiration}
              onChange={(e) => setDeadLetterOnExpiration(e.target.checked)}
              className="w-4 h-4 rounded bg-dark-700 border-dark-600"
            />
            <span className="text-sm text-dark-300">
              Dead-letter on expiration
            </span>
          </label>
        </div>
      </div>
      <ForwardToSelector
        value={forwardTo}
        onChange={setForwardTo}
        queues={queues}
        topics={topics}
        label="Forward To"
      />
      <ForwardToSelector
        value={forwardDlq}
        onChange={setForwardDlq}
        queues={queues}
        topics={topics}
        label="Forward Dead-lettered Messages To"
      />
      <div className="flex justify-end pt-8 mt-4">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>
    </form>
  );
}

export default function EditEntityDialog({
  connection,
  entityType,
  entityName,
  topicName,
  queues,
  topics,
  onClose,
  onSaved,
}: EditEntityDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [queueProps, setQueueProps] = useState<QueueProperties | null>(null);
  const [topicProps, setTopicProps] = useState<TopicProperties | null>(null);
  const [subscriptionProps, setSubscriptionProps] =
    useState<SubscriptionProperties | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        if (entityType === "queue") {
          const props = await getQueueProperties(connection.id, entityName);
          setQueueProps(props);
        } else if (entityType === "topic") {
          const props = await getTopicProperties(connection.id, entityName);
          setTopicProps(props);
        } else if (entityType === "subscription" && topicName) {
          const props = await getSubscriptionProperties(
            connection.id,
            topicName,
            entityName,
          );
          setSubscriptionProps(props);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load properties",
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [connection.id, entityType, entityName, topicName]);

  const handleSaveQueue = async (data: UpdateQueueRequest) => {
    setSaving(true);
    setError("");
    try {
      await updateQueue(connection.id, entityName, data);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTopic = async (data: UpdateTopicRequest) => {
    setSaving(true);
    setError("");
    try {
      await updateTopic(connection.id, entityName, data);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSubscription = async (data: UpdateSubscriptionRequest) => {
    if (!topicName) return;
    setSaving(true);
    setError("");
    try {
      await updateSubscription(connection.id, topicName, entityName, data);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Close when a click starts on the backdrop (mousedown, so a drag that
  // starts inside the dialog and ends outside doesn't close it)
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && e.button === 0) onClose();
  };

  const title =
    entityType === "queue"
      ? `Edit Queue: ${entityName}`
      : entityType === "topic"
        ? `Edit Topic: ${entityName}`
        : `Edit Subscription: ${entityName}`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <h3 className="text-lg font-semibold text-white truncate">{title}</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 pb-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
            </div>
          ) : (
            <>
              {entityType === "queue" && queueProps && (
                <QueueForm
                  properties={queueProps}
                  queues={queues}
                  topics={topics}
                  onSave={handleSaveQueue}
                  saving={saving}
                />
              )}
              {entityType === "topic" && topicProps && (
                <TopicForm
                  properties={topicProps}
                  onSave={handleSaveTopic}
                  saving={saving}
                />
              )}
              {entityType === "subscription" && subscriptionProps && (
                <SubscriptionForm
                  properties={subscriptionProps}
                  queues={queues}
                  topics={topics}
                  onSave={handleSaveSubscription}
                  saving={saving}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
