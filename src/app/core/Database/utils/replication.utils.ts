import { hasDoorPermission, DoorPermissionData } from './types.utils';
import { logger } from './logging.utils';

/**
 * Parse door permission from string to array or vice versa
 */
export function parseDoorPermission(permission: string | string[]): string[] {
  if (Array.isArray(permission)) {
    return permission;
  }

  if (typeof permission === 'string') {
    return permission
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  return [];
}

/**
 * Serialize door permission from array to string
 */
export function serializeDoorPermission(permission: string[]): string {
  if (!Array.isArray(permission)) {
    return '';
  }

  return permission.filter((p) => p && p.trim().length > 0).join(',');
}

/**
 * Check if a door ID is in the permission list
 */
export function hasDoorAccess(
  permission: string | string[],
  doorId: string,
): boolean {
  const permissions = parseDoorPermission(permission);
  return permissions.includes(doorId);
}

/**
 * Filter documents by door permission
 */
export function filterByDoorPermission<T extends DoorPermissionData>(
  documents: T[],
  doorId: string,
  context: { service: string; operation: string },
): T[] {
  if (!doorId) {
    logger.warn(context, 'No door ID provided for filtering');
    return documents;
  }

  return documents.filter((doc) => {
    if (!hasDoorPermission(doc)) {
      logger.debug(
        context,
        `Document ${(doc as any).id} has no door permission data`,
      );
      return false;
    }

    const hasAccess = hasDoorAccess(doc.door_permission, doorId);
    logger.debug(
      context,
      `Document ${(doc as any).id} door access: ${hasAccess}`,
    );
    return hasAccess;
  });
}

/**
 * Transform document for replication push
 */
export function transformDocumentForPush<T extends Record<string, any>>(
  doc: T,
  isDeleted: boolean = false,
): T {
  const now = Date.now().toString();

  return {
    ...doc,
    client_created_at: doc.client_created_at || now,
    client_updated_at: doc.client_updated_at || now,
    deleted: isDeleted,
  };
}

/**
 * Transform document for replication pull
 */
export function transformDocumentForPull<T extends Record<string, any>>(
  doc: T,
  doorId?: string,
): T {
  // Parse door permission if it's a string
  if (hasDoorPermission(doc) && typeof doc.door_permission === 'string') {
    return {
      ...doc,
      door_permission: parseDoorPermission(doc.door_permission),
    };
  }

  return doc;
}

/**
 * Create replication query variables
 */
export function createPullQueryVariables(checkpoint: any, limit: number = 5) {
  return {
    input: {
      checkpoint: {
        id: checkpoint?.id || '',
        server_updated_at: checkpoint?.server_updated_at || '0',
      },
      limit,
    },
  };
}

/**
 * Create push mutation variables
 */
export function createPushMutationVariables<T extends Record<string, any>>(
  docs: Array<{ newDocumentState: T; assumedMasterState: T | null }>,
) {
  return {
    writeRows: docs.map((docRow) => ({
      newDocumentState: transformDocumentForPush(
        docRow.newDocumentState,
        docRow.assumedMasterState === null,
      ),
    })),
  };
}

/**
 * Extract documents and checkpoint from replication response
 */
export function extractReplicationData<T = any>(
  response: any,
  dataPath: string,
  context: { service: string; operation: string },
): { documents: T[]; checkpoint: any } {
  const data = response[dataPath] || response;

  if (!data || typeof data !== 'object') {
    logger.warn(context, 'Invalid replication response structure', response);
    return { documents: [], checkpoint: null };
  }

  const documents = data.documents || [];
  const checkpoint = data.checkpoint;

  logger.debug(context, `Extracted ${documents.length} documents`, {
    checkpoint,
  });

  return { documents, checkpoint };
}

/**
 * Validate replication configuration
 */
export function validateReplicationConfig(config: {
  url?: { http: string; ws: string };
  batchSize?: number;
  retryTime?: number;
}): boolean {
  if (!config.url?.http || !config.url?.ws) {
    logger.error(
      { service: 'ReplicationUtils', operation: 'validateConfig' },
      'Missing required URL configuration',
    );
    return false;
  }

  if (config.batchSize && (config.batchSize < 1 || config.batchSize > 100)) {
    logger.warn(
      { service: 'ReplicationUtils', operation: 'validateConfig' },
      'Batch size should be between 1 and 100',
    );
  }

  return true;
}
