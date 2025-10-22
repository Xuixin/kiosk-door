import { Observable } from 'rxjs';
import { RxCollection, RxDocument } from 'rxdb';

/**
 * Base replication configuration
 */
export interface ReplicationConfig {
  url: {
    http: string;
    ws: string;
  };
  batchSize: number;
  retryTime: number;
  live: boolean;
  autoStart: boolean;
  waitForLeadership: boolean;
  headers?: Record<string, string>;
}

/**
 * Replication state interface
 */
export interface ReplicationState<T = any> {
  received$: Observable<T>;
  sent$: Observable<T>;
  error$: Observable<Error>;
  active$: Observable<boolean>;
  cancel(): Promise<void>;
  awaitInitialReplication(): Promise<void>;
}

/**
 * Query builder function types
 */
export type PullQueryBuilder<T = any> = (
  checkpoint: any,
  limit: number,
) => {
  query: string;
  variables: any;
};

export type StreamQueryBuilder<T = any> = (headers: any) => {
  query: string;
  variables: any;
};

export type PushQueryBuilder<T = any> = (docs: any[]) => {
  query: string;
  variables: any;
};

/**
 * Response modifier function types
 */
export type ResponseModifier<T = any> = (
  response: any,
  requestCheckpoint: any,
) => {
  documents: T[];
  checkpoint: any;
};

export type DocumentModifier<T = any> = (doc: T) => T;

/**
 * Replication service interface
 */
export interface IReplicationService<T = any> {
  replicationState?: ReplicationState<T>;
  setupReplication(collection: RxCollection): Promise<ReplicationState<T>>;
  stopReplication(): Promise<void>;
}

/**
 * Base replication service configuration
 */
export interface BaseReplicationConfig extends ReplicationConfig {
  replicationIdentifier: string;
  deletedField?: string; // Custom deleted field name
  pull: {
    queryBuilder: PullQueryBuilder;
    streamQueryBuilder: StreamQueryBuilder;
    responseModifier: ResponseModifier;
    modifier: DocumentModifier;
  };
  push: {
    queryBuilder: PushQueryBuilder;
    dataPath: string;
    modifier: DocumentModifier;
  };
}

/**
 * Replication events
 */
export interface ReplicationReceivedEvent<T = any> {
  documents: T[];
  checkpoint: {
    id: string;
    server_updated_at: string;
  };
}

export interface ReplicationSentEvent<T = any> {
  documents: T[];
  checkpoint: {
    id: string;
    server_updated_at: string;
  };
}

/**
 * Database initialization state
 */
export enum DatabaseInitState {
  NOT_INITIALIZED = 'not_initialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error',
  DESTROYED = 'destroyed',
}

/**
 * Database health check result
 */
export interface DatabaseHealthCheck {
  isHealthy: boolean;
  state: DatabaseInitState;
  lastError?: Error;
  collections: {
    [key: string]: {
      documentCount: number;
      isReplicating: boolean;
      lastReplicationError?: Error;
    };
  };
}

/**
 * Service lifecycle interface
 */
export interface IServiceLifecycle {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  isReady(): boolean;
  getHealthCheck(): DatabaseHealthCheck;
}

/**
 * Checkpoint synchronization interface
 */
export interface ICheckpointSync {
  updateCheckpoint(checkpoint: string): Promise<void>;
  getCurrentCheckpoint(): Promise<string | null>;
  syncCheckpoint(): Promise<void>;
}

/**
 * Document with replication metadata
 */
export interface ReplicationDocument {
  id: string;
  client_created_at: string;
  client_updated_at: string;
  server_created_at?: string;
  server_updated_at?: string;
}

/**
 * Replication statistics
 */
export interface ReplicationStats {
  documentsReceived: number;
  documentsSent: number;
  lastReceivedAt?: Date;
  lastSentAt?: Date;
  errors: number;
  lastErrorAt?: Date;
  isActive: boolean;
  uptime: number; // in milliseconds
}

/**
 * Replication retry configuration
 */
export interface ReplicationRetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

/**
 * Service configuration
 */
export interface ServiceConfig {
  replication: ReplicationConfig;
  retry: ReplicationRetryConfig;
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableConsole: boolean;
  };
  timeouts: {
    initialization: number;
    replication: number;
    checkpoint: number;
  };
}
