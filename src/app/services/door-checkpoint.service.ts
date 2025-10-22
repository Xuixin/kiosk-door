import { Injectable, inject, OnDestroy, signal, computed } from '@angular/core';
import { DatabaseService } from '../core/Database/rxdb.service';
import { TransactionReplicationService } from '../core/Database/transaction-replication.service';
import { DoorPreferenceService } from './door-preference.service';
import { Observable, BehaviorSubject, Subscription, EMPTY, timer } from 'rxjs';
import {
  switchMap,
  filter,
  takeUntil,
  catchError,
  retryWhen,
  mergeMap,
  take,
  tap,
  finalize,
} from 'rxjs/operators';
import { createServiceLogger } from '../core/Database/utils/logging.utils';
import { retryWithBackoff } from '../core/Database/utils/retry.utils';
import {
  extractCheckpoint,
  Checkpoint,
} from '../core/Database/utils/types.utils';
import {
  DatabaseErrorFactory,
  CheckpointError,
} from '../core/Database/errors/database.errors';
import { ICheckpointSync } from '../core/Database/types/replication.types';

export interface CheckpointState {
  isInitialized: boolean;
  isUpdating: boolean;
  lastError: Error | null;
  currentCheckpoint: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class DoorCheckpointService implements OnDestroy, ICheckpointSync {
  private databaseService = inject(DatabaseService);
  private transactionReplicationService = inject(TransactionReplicationService);
  private doorPreferenceService = inject(DoorPreferenceService);
  private readonly logger = createServiceLogger('DoorCheckpointService');

  private subscription?: Subscription;
  private readonly _state$ = new BehaviorSubject<CheckpointState>({
    isInitialized: false,
    isUpdating: false,
    lastError: null,
    currentCheckpoint: null,
  });

  // Signals for reactive state
  private readonly _isInitialized = signal(false);
  private readonly _isUpdating = signal(false);
  private readonly _lastError = signal<Error | null>(null);
  private readonly _currentCheckpoint = signal<string | null>(null);

  // Computed signals
  public readonly isInitialized = this._isInitialized.asReadonly();
  public readonly isUpdating = this._isUpdating.asReadonly();
  public readonly lastError = this._lastError.asReadonly();
  public readonly currentCheckpoint = this._currentCheckpoint.asReadonly();

  // State observable
  public readonly state$ = this._state$.asObservable();

  constructor() {
    this.setupCheckpointHandshake();
  }

  /**
   * Setup checkpoint handshake mechanism using Observable patterns
   */
  private setupCheckpointHandshake(): void {
    this.logger.info(
      'setupCheckpointHandshake',
      'Setting up checkpoint handshake',
    );

    // Wait for database to be ready, then setup replication subscription
    this.subscription = this.databaseService.initState$
      .pipe(
        filter((state) => state === 'ready'),
        switchMap(() => this.waitForReplicationReady()),
        switchMap(() => this.setupReplicationSubscription()),
        catchError((error) => {
          this.logger.error(
            'setupCheckpointHandshake',
            'Failed to setup handshake',
            error,
          );
          this.updateState({ lastError: error });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  /**
   * Wait for replication to be ready with retry logic
   */
  private waitForReplicationReady(): Observable<boolean> {
    return timer(0, 1000).pipe(
      take(30), // Max 30 seconds
      switchMap(() => {
        const isReady =
          this.transactionReplicationService.isReplicationInitialized();
        if (isReady) {
          this.logger.info('waitForReplicationReady', 'Replication is ready');
          return [true];
        }
        this.logger.debug(
          'waitForReplicationReady',
          'Waiting for replication...',
        );
        return EMPTY;
      }),
      take(1),
    );
  }

  /**
   * Setup replication subscription with proper error handling
   */
  private setupReplicationSubscription(): Observable<void> {
    const replicationState =
      this.transactionReplicationService.getReplicationState();

    if (!replicationState) {
      throw DatabaseErrorFactory.notReady('setupReplicationSubscription', {
        message: 'Transaction replication state not available',
      });
    }

    this.logger.info(
      'setupReplicationSubscription',
      'Setting up replication subscription',
    );

    return replicationState.received$.pipe(
      tap((data: any) => {
        this.logger.debug(
          'replicationReceived',
          'Transaction received, updating checkpoint',
          {
            documentCount: Array.isArray(data) ? data.length : 1,
          },
        );
      }),
      switchMap((data) => this.updateDoorCheckpoint(data)),
      catchError((error) => {
        this.logger.error(
          'replicationSubscription',
          'Error in replication subscription',
          error,
        );
        this.updateState({ lastError: error });
        return EMPTY;
      }),
    );
  }

  /**
   * Update door checkpoint with transaction checkpoint
   */
  private updateDoorCheckpoint(transactionData: any): Observable<void> {
    this.updateState({ isUpdating: true, lastError: null });

    return new Observable<void>((subscriber) => {
      this.performCheckpointUpdate(transactionData)
        .then(() => {
          this.logger.info(
            'updateDoorCheckpoint',
            'Checkpoint updated successfully',
          );
          subscriber.next();
          subscriber.complete();
        })
        .catch((error) => {
          this.logger.error(
            'updateDoorCheckpoint',
            'Failed to update checkpoint',
            error,
          );
          this.updateState({ lastError: error });
          subscriber.error(error);
        })
        .finally(() => {
          this.updateState({ isUpdating: false });
        });
    });
  }

  /**
   * Perform the actual checkpoint update operation
   */
  private async performCheckpointUpdate(transactionData: any): Promise<void> {
    this.logger.debug('performCheckpointUpdate', 'Starting checkpoint update', {
      dataType: Array.isArray(transactionData) ? 'array' : 'object',
    });

    const doorId = await this.doorPreferenceService.getDoorId();
    if (!doorId) {
      throw DatabaseErrorFactory.checkpoint(
        'No door ID found, cannot update checkpoint',
        'performCheckpointUpdate',
      );
    }

    this.logger.debug('performCheckpointUpdate', 'Using door ID', { doorId });

    // Extract checkpoint from transaction data
    const checkpoint = this.extractCheckpointFromData(transactionData);
    if (!checkpoint) {
      throw DatabaseErrorFactory.checkpoint(
        'No valid checkpoint found in transaction data',
        'performCheckpointUpdate',
        transactionData,
      );
    }

    this.logger.debug('performCheckpointUpdate', 'Extracted checkpoint', {
      checkpoint,
    });

    // Update door document with new checkpoint
    await this.updateDoorDocument(doorId, checkpoint);
    this.updateState({ currentCheckpoint: checkpoint });
  }

  /**
   * Update door document in database
   */
  private async updateDoorDocument(
    doorId: string,
    checkpoint: string,
  ): Promise<void> {
    try {
      const doorDoc = await this.databaseService.db.door
        .findOne({
          selector: { id: doorId } as any,
        })
        .exec();

      const now = Date.now().toString();

      if (doorDoc) {
        await (doorDoc as any).incrementalModify((docData: any) => {
          docData.checkpoint = checkpoint;
          docData.client_updated_at = now;
          return docData;
        });

        this.logger.debug('updateDoorDocument', 'Door document updated', {
          doorId,
          checkpoint,
        });
      } else {
        this.logger.warn('updateDoorDocument', 'Door document not found', {
          doorId,
        });
      }
    } catch (error) {
      this.logger.error(
        'updateDoorDocument',
        'Failed to update door document',
        error,
      );
      throw DatabaseErrorFactory.checkpoint(
        `Failed to update door document: ${error}`,
        'updateDoorDocument',
        { doorId, checkpoint },
      );
    }
  }

  /**
   * Extract checkpoint from transaction replication data
   */
  private extractCheckpointFromData(transactionData: any): string | null {
    if (!transactionData || typeof transactionData !== 'object') {
      this.logger.warn(
        'extractCheckpointFromData',
        'Invalid transaction data',
        { transactionData },
      );
      return null;
    }

    this.logger.debug('extractCheckpointFromData', 'Extracting checkpoint', {
      keys: Object.keys(transactionData),
    });

    // Use utility function for consistent extraction
    const checkpoint = extractCheckpoint(transactionData);

    if (checkpoint) {
      this.logger.debug('extractCheckpointFromData', 'Checkpoint extracted', {
        checkpoint: checkpoint.server_updated_at,
      });
      return checkpoint.server_updated_at;
    }

    this.logger.warn('extractCheckpointFromData', 'No valid checkpoint found', {
      transactionData,
    });
    return null;
  }

  /**
   * Update state with partial updates
   */
  private updateState(updates: Partial<CheckpointState>): void {
    const currentState = this._state$.value;
    const newState = { ...currentState, ...updates };

    this._state$.next(newState);

    // Update signals
    if (updates.isInitialized !== undefined) {
      this._isInitialized.set(updates.isInitialized);
    }
    if (updates.isUpdating !== undefined) {
      this._isUpdating.set(updates.isUpdating);
    }
    if (updates.lastError !== undefined) {
      this._lastError.set(updates.lastError);
    }
    if (updates.currentCheckpoint !== undefined) {
      this._currentCheckpoint.set(updates.currentCheckpoint);
    }
  }

  /**
   * Manually trigger checkpoint update (implements ICheckpointSync)
   */
  async updateCheckpoint(checkpoint: string): Promise<void> {
    this.logger.info('updateCheckpoint', 'Manually updating checkpoint', {
      checkpoint,
    });

    try {
      await this.performCheckpointUpdate({ checkpoint });
      this.logger.info('updateCheckpoint', 'Checkpoint updated successfully');
    } catch (error) {
      this.logger.error(
        'updateCheckpoint',
        'Failed to update checkpoint',
        error,
      );
      throw error;
    }
  }

  /**
   * Get current door checkpoint (implements ICheckpointSync)
   */
  async getCurrentCheckpoint(): Promise<string | null> {
    try {
      const doorId = await this.doorPreferenceService.getDoorId();
      if (!doorId) {
        this.logger.warn('getCurrentCheckpoint', 'No door ID found');
        return null;
      }

      const doorDoc = await this.databaseService.db.door
        .findOne({
          selector: { id: doorId } as any,
        })
        .exec();

      const checkpoint = doorDoc ? (doorDoc as any).checkpoint : null;
      this.logger.debug('getCurrentCheckpoint', 'Retrieved checkpoint', {
        checkpoint,
      });

      return checkpoint;
    } catch (error) {
      this.logger.error(
        'getCurrentCheckpoint',
        'Error getting current checkpoint',
        error,
      );
      this.updateState({ lastError: error as Error });
      return null;
    }
  }

  /**
   * Sync checkpoint (implements ICheckpointSync)
   */
  async syncCheckpoint(): Promise<void> {
    this.logger.info('syncCheckpoint', 'Syncing checkpoint');

    try {
      const currentCheckpoint = await this.getCurrentCheckpoint();
      if (currentCheckpoint) {
        this.updateState({ currentCheckpoint });
        this.logger.info('syncCheckpoint', 'Checkpoint synced', {
          checkpoint: currentCheckpoint,
        });
      } else {
        this.logger.warn('syncCheckpoint', 'No checkpoint found to sync');
      }
    } catch (error) {
      this.logger.error('syncCheckpoint', 'Failed to sync checkpoint', error);
      throw error;
    }
  }

  /**
   * Manually trigger checkpoint update (legacy method)
   */
  async triggerCheckpointUpdate(checkpoint: string): Promise<void> {
    return this.updateCheckpoint(checkpoint);
  }

  /**
   * Manually initialize handshake (useful if replication starts later)
   */
  initialize(): void {
    if (!this._isInitialized()) {
      this.logger.info('initialize', 'Manually initializing handshake');
      this.setupCheckpointHandshake();
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus(): {
    isHealthy: boolean;
    lastError: Error | null;
    isInitialized: boolean;
  } {
    return {
      isHealthy: this._isInitialized() && !this._lastError(),
      lastError: this._lastError(),
      isInitialized: this._isInitialized(),
    };
  }

  /**
   * Cleanup subscription
   */
  ngOnDestroy(): void {
    this.logger.info('ngOnDestroy', 'Cleaning up door checkpoint service');

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }

    this.updateState({
      isInitialized: false,
      isUpdating: false,
      lastError: null,
      currentCheckpoint: null,
    });

    this._state$.complete();
  }
}
