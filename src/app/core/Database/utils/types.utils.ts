/**
 * Type guards and validators for RxDB operations
 */

export interface Checkpoint {
  id: string;
  server_updated_at: string;
}

export interface ReplicationEvent<T = any> {
  documents: T[];
  checkpoint: Checkpoint;
}

export interface DocumentWithTimestamps {
  client_created_at?: string;
  client_updated_at?: string;
  server_created_at?: string;
  server_updated_at?: string;
}

export interface DoorPermissionData {
  door_permission: string[] | string;
}

/**
 * Type guard to check if value is a valid checkpoint
 */
export function isCheckpoint(value: any): value is Checkpoint {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.server_updated_at === 'string'
  );
}

/**
 * Type guard to check if value is a replication event
 */
export function isReplicationEvent<T = any>(
  value: any,
): value is ReplicationEvent<T> {
  return (
    value &&
    typeof value === 'object' &&
    Array.isArray(value.documents) &&
    isCheckpoint(value.checkpoint)
  );
}

/**
 * Type guard to check if value is a single document
 */
export function isDocument(value: any): value is Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard to check if value is an array of documents
 */
export function isDocumentArray(value: any): value is Record<string, any>[] {
  return Array.isArray(value) && value.every(isDocument);
}

/**
 * Check if a value has timestamp properties
 */
export function hasTimestamps(value: any): value is DocumentWithTimestamps {
  return (
    value &&
    typeof value === 'object' &&
    (typeof value.client_created_at === 'string' ||
      typeof value.client_updated_at === 'string' ||
      typeof value.server_created_at === 'string' ||
      typeof value.server_updated_at === 'string')
  );
}

/**
 * Check if a value has door permission data
 */
export function hasDoorPermission(value: any): value is DoorPermissionData {
  return (
    value &&
    typeof value === 'object' &&
    (Array.isArray(value.door_permission) ||
      typeof value.door_permission === 'string')
  );
}

/**
 * Safe property access with type checking
 */
export function safeGet<T>(obj: any, path: string, defaultValue: T): T {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current == null || typeof current !== 'object') {
      return defaultValue;
    }
    current = current[key];
  }

  return current !== undefined ? current : defaultValue;
}

/**
 * Create a type-safe object with required properties
 */
export function createTypedObject<T extends Record<string, any>>(
  data: Partial<T>,
  defaults: T,
): T {
  return { ...defaults, ...data } as T;
}

/**
 * Validate that all required properties exist
 */
export function validateRequired<T extends Record<string, any>>(
  obj: any,
  requiredKeys: (keyof T)[],
): obj is T {
  if (!obj || typeof obj !== 'object') return false;

  return requiredKeys.every((key) => key in obj && obj[key] !== undefined);
}

/**
 * Extract checkpoint from various data structures
 */
export function extractCheckpoint(data: any): Checkpoint | null {
  if (!data || typeof data !== 'object') return null;

  // Direct checkpoint object
  if (isCheckpoint(data)) return data;

  // From server_updated_at field
  if (data.server_updated_at) {
    return {
      id: data.id || '',
      server_updated_at: data.server_updated_at,
    };
  }

  // From server_created_at field as fallback
  if (data.server_created_at) {
    return {
      id: data.id || '',
      server_updated_at: data.server_created_at,
    };
  }

  return null;
}
