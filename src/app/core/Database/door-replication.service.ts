import { Injectable, inject } from '@angular/core';
import { RxDoorCollection } from './RxDB.D';
import { RxDoorDocumentType } from '../schema/door.schema';
import {
  PULL_DOOR_QUERY,
  PUSH_DOOR_MUTATION,
  STREAM_DOOR_SUBSCRIPTION,
} from './query-builder/door-query-builder';
import { DoorPreferenceService } from '../../services/door-preference.service';
import { NetworkMonitorService } from '../../services/network-monitor.service';
import { BaseReplicationService } from './base-replication.service';
import { BaseReplicationConfig } from './types/replication.types';
import {
  createPullQueryVariables,
  createPushMutationVariables,
  extractReplicationData,
  transformDocumentForPush,
} from './utils/replication.utils';
import { createServiceLogger } from './utils/logging.utils';
import { Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DoorReplicationService extends BaseReplicationService<RxDoorDocumentType> {
  private doorPreferenceService = inject(DoorPreferenceService);
  private networkMonitorService = inject(NetworkMonitorService);
  private networkSubscription?: Subscription;
  protected readonly logger = createServiceLogger('DoorReplicationService');

  constructor() {
    super();
    this.setupNetworkMonitoring();
  }

  /**
   * Get replication configuration for doors
   */
  protected getReplicationConfig(): BaseReplicationConfig {
    return {
      replicationIdentifier: 'door-graphql-replication',
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
            query: PULL_DOOR_QUERY,
            variables: createPullQueryVariables(checkpoint, limit),
          };
          return queryConfig;
        },

        streamQueryBuilder: (headers) => {
          return {
            query: STREAM_DOOR_SUBSCRIPTION,
            variables: {},
          };
        },

        responseModifier: (plainResponse, requestCheckpoint) => {
          const { documents, checkpoint } = extractReplicationData(
            plainResponse,
            'pullDoors',
            { service: 'DoorReplication', operation: 'responseModifier' },
          );

          return { documents, checkpoint };
        },

        modifier: (doc) => {
          // Transform backend's deleted field to RxDB's _deleted flag
          const { deleted, ...rest } = doc as any;
          return {
            ...rest,
            _deleted: deleted || false,
          };
        },
      },

      push: {
        queryBuilder: (docs) => {
          return {
            query: PUSH_DOOR_MUTATION,
            variables: createPushMutationVariables(docs),
          };
        },

        dataPath: 'data.pushDoors',

        modifier: (doc) => {
          // ✅ ลบ _deleted field ออกและแปลงเป็น deleted field สำหรับ backend
          const { _deleted, ...docWithoutDeleted } = doc as any;

          return {
            ...docWithoutDeleted,
            deleted: _deleted || false,
          };
        },
      },
    };
  }

  /**
   * Get collection name for logging
   */
  protected getCollectionName(): string {
    return 'door';
  }

  /**
   * Override setupReplication to add observables monitoring
   */
  async setupReplication(collection: any): Promise<any> {
    this.logger.info('setupReplication', 'Setting up door replication');

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
      console.log('[door] replicationReceived', doc);
    });

    // emits each document that was send to the remote
    replicationState.sent$.subscribe((doc: any) => {
      console.log('[door] replicationSent', doc);
    });

    // emits all errors that happen when running the push- & pull-handlers.
    replicationState.error$.subscribe((error: any) => {
      console.log('[door] replicationError', error);
    });

    // emits true when the replication was canceled, false when not.
    replicationState.canceled$.subscribe((bool: boolean) => {
      console.log('[door] replicationCanceled', bool);
    });

    // emits true when a replication cycle is running, false when not.
    replicationState.active$.subscribe((bool: boolean) => {
      console.log('[door] replicationActive', bool);
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
        console.log('[door] Network status', { isOnline, wasOffline });

        if (!isOnline) {
          console.log('[door] Network offline, stopping replication');
          this.stopReplication().catch((error) => {
            this.logger.error(
              'networkMonitoring',
              'Failed to stop replication',
              error,
            );
          });
        } else if (wasOffline && isOnline) {
          console.log('[door] Back online, triggering replication rerun in 1s');

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
}
