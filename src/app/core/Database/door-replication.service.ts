import { Injectable, inject } from '@angular/core';
import { RxDoorCollection } from './RxDB.D';
import { RxDoorDocumentType } from '../schema/door.schema';
import {
  PULL_DOOR_QUERY,
  PUSH_DOOR_MUTATION,
  STREAM_DOOR_SUBSCRIPTION,
} from './query-builder/door-query-builder';
import { DoorPreferenceService } from '../../services/door-preference.service';
import { BaseReplicationService } from './base-replication.service';
import { BaseReplicationConfig } from './types/replication.types';
import {
  createPullQueryVariables,
  createPushMutationVariables,
  extractReplicationData,
  transformDocumentForPush,
} from './utils/replication.utils';
import { createServiceLogger } from './utils/logging.utils';

@Injectable({
  providedIn: 'root',
})
export class DoorReplicationService extends BaseReplicationService<RxDoorDocumentType> {
  private doorPreferenceService = inject(DoorPreferenceService);
  protected readonly logger = createServiceLogger('DoorReplicationService');

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
          this.logger.debug('pullQueryBuilder', 'Building door pull query', {
            checkpoint,
            limit,
          });
          return {
            query: PULL_DOOR_QUERY,
            variables: createPullQueryVariables(checkpoint, limit),
          };
        },

        streamQueryBuilder: (headers) => {
          this.logger.debug(
            'streamQueryBuilder',
            'Building door stream query',
            { headers },
          );
          return {
            query: STREAM_DOOR_SUBSCRIPTION,
            variables: {},
          };
        },

        responseModifier: (plainResponse, requestCheckpoint) => {
          this.logger.debug('responseModifier', 'Processing door response', {
            requestCheckpoint,
            responseKeys: Object.keys(plainResponse),
          });

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
}
