import { Injectable, inject } from '@angular/core';
import { RxTxnCollection } from './RxDB.D';
import { RxTxnDocumentType } from '../schema/txn.schema';
import {
  PUSH_TRANSACTION_MUTATION,
  PULL_TRANSACTION_QUERY,
  STREAM_TRANSACTION_SUBSCRIPTION,
} from './query-builder/txn-query-builder';
import { DoorPreferenceService } from '../../services/door-preference.service';
import { BaseReplicationService } from './base-replication.service';
import { BaseReplicationConfig } from './types/replication.types';
import {
  createPullQueryVariables,
  createPushMutationVariables,
  extractReplicationData,
  filterByDoorPermission,
  transformDocumentForPull,
} from './utils/replication.utils';
import { createServiceLogger } from './utils/logging.utils';

@Injectable({
  providedIn: 'root',
})
export class TransactionReplicationService extends BaseReplicationService<RxTxnDocumentType> {
  private doorPreferenceService = inject(DoorPreferenceService);
  private doorId: string | null = null;
  protected readonly logger = createServiceLogger(
    'TransactionReplicationService',
  );

  /**
   * Get replication configuration for transactions
   */
  protected getReplicationConfig(): BaseReplicationConfig {
    return {
      replicationIdentifier: 'txn-graphql-replication',
      url: this.configService.getReplicationConfig().url,
      batchSize: 5,
      retryTime: this.configService.getReplicationConfig().retryTime,
      live: true,
      autoStart: true,
      waitForLeadership: true,
      headers: this.configService.getReplicationConfig().headers,

      pull: {
        queryBuilder: (checkpoint, limit) => {
          this.logger.debug('pullQueryBuilder', 'Building pull query', {
            checkpoint,
            limit,
          });
          return {
            query: PULL_TRANSACTION_QUERY,
            variables: createPullQueryVariables(checkpoint, limit),
          };
        },

        streamQueryBuilder: (headers) => {
          this.logger.debug('streamQueryBuilder', 'Building stream query', {
            headers,
          });
          return {
            query: STREAM_TRANSACTION_SUBSCRIPTION,
            variables: {},
          };
        },

        responseModifier: (plainResponse, requestCheckpoint) => {
          const { documents, checkpoint } = extractReplicationData(
            plainResponse,
            'pullTransaction',
            {
              service: 'TransactionReplication',
              operation: 'responseModifier',
            },
          );

          // ✅ ส่งข้อมูลครบทุก doc (ไม่ filter) เพื่อ preserve pagination
          return {
            documents: documents,
            checkpoint: checkpoint,
          };
        },

        modifier: (doc) => {
          // ✅ ถ้า status = 'OUT' ให้ mark เป็น deleted
          if (doc.status === 'OUT') {
            return {
              ...doc,
              _deleted: true, // RxDB จะไม่เก็บ doc นี้ แต่จะนับเป็น 1 doc ใน batch
            };
          }

          // Check door permissions for IN status documents
          if (this.doorId) {
            const permissions = Array.isArray(doc.door_permission)
              ? doc.door_permission
              : doc.door_permission?.split(',').map((p: string) => p.trim()) ||
                [];

            const hasPermission = permissions.includes(this.doorId);

            if (!hasPermission) {
              return {
                ...doc,
                _deleted: true, // RxDB จะไม่เก็บ doc นี้ แต่จะนับเป็น 1 doc ใน batch
              };
            }
          }

          // ✅ ลบ deleted field ออกจาก document (backend ส่งมาแต่เราไม่ต้องการ)
          const { deleted, ...docWithoutDeleted } = doc;

          // Transform door permissions and return valid document
          return {
            ...docWithoutDeleted,
            door_permission:
              typeof doc.door_permission === 'string'
                ? doc.door_permission.split(',').map((s: any) => s.trim())
                : doc.door_permission,
          };
        },
      },

      push: {
        queryBuilder: (docs) => {
          return {
            query: PUSH_TRANSACTION_MUTATION,
            variables: createPushMutationVariables(docs),
          };
        },

        dataPath: 'data.pushTransaction',

        modifier: (doc) => {
          return doc;
        },
      },
    };
  }

  /**
   * Get collection name for logging
   */
  protected getCollectionName(): string {
    return 'transaction';
  }

  /**
   * Setup replication with door ID filtering
   */
  async setupReplication(collection: any): Promise<any> {
    // Get door ID for filtering
    this.doorId = await this.doorPreferenceService.getDoorId();
    this.logger.info(
      'setupReplication',
      'Setting up replication with door ID',
      { doorId: this.doorId },
    );

    return super.setupReplication(collection);
  }

  /**
   * Determine if a document should be kept based on door permissions
   */
  private shouldKeepDocument(doc: any): boolean {
    // ✅ Filter 1: Only keep IN status
    if (doc.status !== 'IN') {
      this.logger.debug('shouldKeepDocument', 'Rejecting: not IN status', {
        id: doc.id,
        status: doc.status,
      });
      return false;
    }

    // ✅ Filter 2: Must have door permission AND doorId must be set
    if (!this.doorId) {
      this.logger.debug('shouldKeepDocument', 'Rejecting: no door ID set', {
        id: doc.id,
      });
      return false;
    }

    // Check door permissions
    const permissions = Array.isArray(doc.door_permission)
      ? doc.door_permission
      : doc.door_permission?.split(',').map((p: string) => p.trim()) || [];

    const hasPermission = permissions.includes(this.doorId);

    if (!hasPermission) {
      this.logger.debug('shouldKeepDocument', 'Rejecting: no door permission', {
        id: doc.id,
        doorId: this.doorId,
        permissions,
      });
    }

    // ✅ Both conditions must be true: IN status AND has door permission
    return hasPermission;
  }
}
