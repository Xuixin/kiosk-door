import { Injectable, inject } from '@angular/core';
import { RxTxnCollection } from './RxDB.D';
import { RxTxnDocumentType } from '../schema/txn.schema';
import {
  PUSH_TRANSACTION_MUTATION,
  PULL_TRANSACTION_QUERY,
  STREAM_TRANSACTION_SUBSCRIPTION,
} from './query-builder/txn-query-builder';
import { DoorPreferenceService } from '../../services/door-preference.service';
import { NetworkMonitorService } from '../../services/network-monitor.service';
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
import { Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TransactionReplicationService extends BaseReplicationService<RxTxnDocumentType> {
  private doorPreferenceService = inject(DoorPreferenceService);
  private networkMonitorService = inject(NetworkMonitorService);
  private networkSubscription?: Subscription;
  private doorId: string | null = null;
  protected readonly logger = createServiceLogger(
    'TransactionReplicationService',
  );

  constructor() {
    super();
    this.setupNetworkMonitoring();
  }

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
          const queryConfig = {
            query: PULL_TRANSACTION_QUERY,
            variables: createPullQueryVariables(checkpoint, limit),
          };

          return queryConfig;
        },

        streamQueryBuilder: (headers) => {
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
    this.doorId = await this.doorPreferenceService.getDoorId();
    this.logger.info(
      'setupReplication',
      'Setting up replication with door ID',
      { doorId: this.doorId },
    );

    const replicationState = await super.setupReplication(collection);

    // Setup replication observables for debugging
    this.setupReplicationObservables(replicationState);

    return replicationState;
  }

  /**
   * Setup replication observables for debugging and monitoring
   */
  private setupReplicationObservables(replicationState: any): void {
    if (!replicationState) {
      this.logger.warn(
        'setupReplicationObservables',
        'No replication state available',
      );
      return;
    }

    // emits each document that was received from the remote
    replicationState.received$.subscribe((doc: any) => {
      console.log('[txn] replicationReceived', doc);
    });

    // emits each document that was send to the remote
    replicationState.sent$.subscribe((doc: any) => {
      console.log('[txn] replicationSent', doc);
    });

    // emits all errors that happen when running the push- & pull-handlers.
    replicationState.error$.subscribe((error: any) => {
      console.log('[txn] replicationError', error);
    });

    // emits true when the replication was canceled, false when not.
    replicationState.canceled$.subscribe((bool: boolean) => {
      console.log('[txn] replicationCanceled', bool);
    });

    // emits true when a replication cycle is running, false when not.
    replicationState.active$.subscribe((bool: boolean) => {
      console.log('[txn] replicationActive', bool);
    });
  }

  /**
   * Setup network monitoring to trigger replication when back online
   */
  private setupNetworkMonitoring(): void {
    let wasOffline = false;

    this.networkSubscription = this.networkMonitorService
      .getNetworkStatus$()
      .subscribe((isOnline) => {
        console.log('[txn] Network status', { isOnline, wasOffline });

        if (wasOffline && isOnline) {
          console.log('[txn] Back online, triggering replication rerun in 1s');

          // Delay 1s to allow network to stabilize (Android WebView timing)
          setTimeout(() => {
            this.rerunReplication().catch((error) => {
              this.logger.error(
                'networkMonitoring',
                'Failed to rerun replication',
                error,
              );
            });
          }, 1000);
        }

        wasOffline = !isOnline;
      });
  }

  override ngOnDestroy(): void {
    this.networkSubscription?.unsubscribe();
    super.ngOnDestroy();
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
