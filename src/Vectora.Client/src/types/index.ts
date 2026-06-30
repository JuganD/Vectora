export interface Connection {
  id: number;
  name: string;
  connectionString: string;
  isEmulator: boolean;
  emulatorConfigId?: number;
  mcpExposed: boolean;
  mcpAllowSend: boolean;
}

export interface QueueInfo {
  name: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  isEmulator: boolean;
  requiresSession: boolean;
}

export interface TopicInfo {
  name: string;
  subscriptions: SubscriptionInfo[];
  isEmulator: boolean;
}

export interface SubscriptionInfo {
  name: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  requiresSession: boolean;
}

export interface SessionInfo {
  sessionId: string;
  messageCount: number;
  lastEnqueuedTime?: string;
}

// Result of peeking one page of messages and grouping by session id.
// `lastSequenceNumber + 1` is the cursor to pass as the next fromSequenceNumber.
export interface SessionScanResult {
  sessions: SessionInfo[];
  scannedCount: number;
  lastSequenceNumber: number | null;
  reachedEnd: boolean;
}

// Result of peeking one page of messages and filtering to a single session.
export interface SessionMessageScanResult {
  messages: ServiceBusMessage[];
  scannedCount: number;
  lastSequenceNumber: number | null;
  reachedEnd: boolean;
}

export interface ServiceBusMessage {
  messageId: string;
  body: string;
  contentType?: string;
  subject?: string;
  correlationId?: string;
  replyTo?: string;
  replyToSessionId?: string;
  sessionId?: string;
  to?: string;
  sequenceNumber: number;
  enqueuedTime: string;
  scheduledEnqueueTime?: string;
  state: string; // 'Active' | 'Scheduled' | 'Deferred'
  timeToLive: string;
  expiresAt: string;
  deliveryCount: number;
  deadLetterReason?: string;
  deadLetterErrorDescription?: string;
  deadLetterSource?: string;
  applicationProperties?: Record<string, unknown>;
}

export interface SendMessageRequest {
  body: string;
  contentType?: string;
  subject?: string;
  messageId?: string;
  correlationId?: string;
  replyTo?: string;
  replyToSessionId?: string;
  sessionId?: string;
  to?: string;
  scheduledEnqueueTime?: string;
  timeToLive?: string;
  applicationProperties?: Record<string, string>;
}

export type EntityStatus = 'Active' | 'Disabled' | 'SendDisabled' | 'ReceiveDisabled';

export interface QueueProperties {
  name: string;
  status: EntityStatus;
  defaultMessageTimeToLive: string;
  lockDuration: string;
  maxDeliveryCount: number;
  requiresDuplicateDetection: boolean;
  requiresSession: boolean;
  deadLetteringOnMessageExpiration: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
  maxSizeInMegabytes: number;
}

export interface TopicProperties {
  name: string;
  status: EntityStatus;
  defaultMessageTimeToLive: string;
  requiresDuplicateDetection: boolean;
  maxSizeInMegabytes: number;
}

export interface SubscriptionProperties {
  name: string;
  topicName: string;
  status: EntityStatus;
  defaultMessageTimeToLive: string;
  lockDuration: string;
  maxDeliveryCount: number;
  requiresSession: boolean;
  deadLetteringOnMessageExpiration: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
}

export interface EmulatorConfig {
  id: number;
  fileName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionRequest {
  name: string;
  connectionString: string;
  isEmulator: boolean;
  emulatorConfigId?: number;
}

export interface CreateQueueRequest {
  name: string;
  defaultMessageTimeToLive?: string;
  lockDuration?: string;
  maxDeliveryCount?: number;
  requiresDuplicateDetection?: boolean;
  requiresSession?: boolean;
  deadLetteringOnMessageExpiration?: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
}

export interface CreateTopicRequest {
  name: string;
  defaultMessageTimeToLive?: string;
  requiresDuplicateDetection?: boolean;
}

export interface CreateSubscriptionRequest {
  name: string;
  defaultMessageTimeToLive?: string;
  lockDuration?: string;
  maxDeliveryCount?: number;
  requiresSession?: boolean;
  deadLetteringOnMessageExpiration?: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
}

export type EntityType = 'queue' | 'topic' | 'subscription';

export interface SelectedEntity {
  type: EntityType;
  name: string;
  topicName?: string; // For subscriptions
}

// Update request types
export interface UpdateQueueRequest {
  status?: EntityStatus;
  defaultMessageTimeToLive?: string;
  lockDuration?: string;
  maxDeliveryCount?: number;
  deadLetteringOnMessageExpiration?: boolean;
  forwardTo?: string | null;
  forwardDeadLetteredMessagesTo?: string | null;
}

export interface UpdateTopicRequest {
  status?: EntityStatus;
  defaultMessageTimeToLive?: string;
}

export interface UpdateSubscriptionRequest {
  status?: EntityStatus;
  defaultMessageTimeToLive?: string;
  lockDuration?: string;
  maxDeliveryCount?: number;
  deadLetteringOnMessageExpiration?: boolean;
  forwardTo?: string | null;
  forwardDeadLetteredMessagesTo?: string | null;
}

export interface MessageTemplate {
  id: number;
  name: string;
  body: string;
  contentType?: string;
  subject?: string;
  messageId?: string;
  correlationId?: string;
  sessionId?: string;
  applicationProperties?: string;
  sendMultiple: boolean;
  sendCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveMessageTemplateRequest {
  name: string;
  body: string;
  contentType?: string;
  subject?: string;
  messageId?: string;
  correlationId?: string;
  sessionId?: string;
  applicationProperties?: string;
  sendMultiple: boolean;
  sendCount: number;
}

