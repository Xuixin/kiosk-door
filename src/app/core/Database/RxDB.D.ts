import type { RxDocument, RxCollection, RxDatabase } from 'rxdb';
import { RxTxnDocumentType } from '../schema/txn.schema';
import { RxDoorDocumentType } from '../schema/door.schema';
import { Signal } from '@angular/core';
import { Checkpoint, ReplicationEvent } from './utils/types.utils';

// Transaction ORM methods
type RxTxnMethods = {
  findAll: () => Promise<RxTxnDocument[]>;
  findById: (id: string) => Promise<RxTxnDocument | null>;
  create: (txn: RxTxnDocumentType) => Promise<RxTxnDocument>;
  update: (txn: RxTxnDocumentType) => Promise<RxTxnDocument>;
  findByStatus: (status: string) => Promise<RxTxnDocument[]>;
  findByDoor: (doorId: string) => Promise<RxTxnDocument[]>;
  getStats: () => Promise<{
    total: number;
    pending: number;
    in: number;
    out: number;
  }>;
};

export type RxTxnDocument = RxDocument<RxTxnDocumentType, RxTxnMethods>;
export type RxTxnCollection = RxCollection<
  RxTxnDocumentType,
  RxTxnMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

// Door ORM methods
type RxDoorMethods = {
  findAll: () => Promise<RxDoorDocument[]>;
  findById: (id: string) => Promise<RxDoorDocument | null>;
  create: (door: RxDoorDocumentType) => Promise<RxDoorDocument>;
  update: (door: RxDoorDocumentType) => Promise<RxDoorDocument>;
  findByCheckpoint: (checkpoint: string) => Promise<RxDoorDocument[]>;
  getCurrentCheckpoint: () => Promise<string | null>;
};

export type RxDoorDocument = RxDocument<RxDoorDocumentType, RxDoorMethods>;
export type RxDoorCollection = RxCollection<
  RxDoorDocumentType,
  RxDoorMethods,
  unknown,
  unknown,
  Signal<unknown>
>;

// Database collections
export type RxTxnsCollections = {
  txn: RxTxnCollection;
  door: RxDoorCollection;
};

// Main database type
export type RxTxnsDatabase = RxDatabase<
  RxTxnsCollections,
  unknown,
  unknown,
  Signal<unknown>
>;

// Replication event types
export type TxnReplicationEvent = ReplicationEvent<RxTxnDocumentType>;
export type DoorReplicationEvent = ReplicationEvent<RxDoorDocumentType>;

// Query builder parameter types
export interface PullQueryParams {
  checkpoint: Checkpoint | null;
  limit: number;
}

export interface StreamQueryParams {
  headers?: Record<string, any>;
}

export interface PushQueryParams<T = any> {
  documents: Array<{
    newDocumentState: T;
    assumedMasterState: T | null;
  }>;
}

// Replication state types
export interface ReplicationStateInfo {
  isActive: boolean;
  isInitialized: boolean;
  lastError: Error | null;
  uptime: number;
}

// Database health check types
export interface DatabaseHealthInfo {
  isHealthy: boolean;
  collections: {
    txn: {
      documentCount: number;
      isReplicating: boolean;
      lastReplicationError: Error | null;
    };
    door: {
      documentCount: number;
      isReplicating: boolean;
      lastReplicationError: Error | null;
    };
  };
  lastError: Error | null;
}

// Service state types
export interface ServiceState {
  isInitialized: boolean;
  isLoading: boolean;
  lastError: Error | null;
}

// Document with replication metadata
export interface ReplicationDocument {
  id: string;
  client_created_at: string;
  client_updated_at: string;
  server_created_at?: string;
  server_updated_at?: string;
}

// Extended document types with replication metadata
export type RxTxnDocumentWithReplication = RxTxnDocumentType &
  ReplicationDocument;
export type RxDoorDocumentWithReplication = RxDoorDocumentType &
  ReplicationDocument;

// Error types for better error handling
export interface DatabaseErrorInfo {
  operation: string;
  context?: Record<string, any>;
  retryable: boolean;
  timestamp: Date;
}

// Configuration types
export interface DatabaseConfig {
  name: string;
  multiInstance: boolean;
  replication: {
    batchSize: number;
    retryTime: number;
    live: boolean;
  };
}

// Event types for observables
export interface DatabaseEvent<T = any> {
  type: 'created' | 'updated' | 'deleted' | 'replicated';
  document: T;
  timestamp: Date;
}

export interface ReplicationEventInfo {
  type: 'received' | 'sent' | 'error';
  count: number;
  timestamp: Date;
  error?: Error;
}
