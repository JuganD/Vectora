export interface Connection {
  id: number;
  name: string;
  connectionString: string;
  isEmulator: boolean;
  emulatorConfigId?: number;
}

export interface QueueInfo {
  name: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  isEmulator: boolean;
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
  timeToLive: string;
  deliveryCount: number;
  deadLetterReason?: string;
  deadLetterErrorDescription?: string;
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

