import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { DatabaseService } from '../core/Database/rxdb.service';
import { TransactionReplicationService } from '../core/Database/transaction-replication.service';
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
  distinctUntilChanged,
} from 'rxjs/operators';
import { createServiceLogger } from '../core/Database/utils/logging.utils';
import { retryWithBackoff } from '../core/Database/utils/retry.utils';
import {
  isDocument,
  isDocumentArray,
} from '../core/Database/utils/types.utils';
import { DatabaseErrorFactory } from '../core/Database/errors/database.errors';
import { RxTxnDocumentType } from '../core/schema/txn.schema';

export interface TransactionStats {
  total: number;
  pending: number;
  in: number;
  out: number;
}

export interface TransactionServiceState {
  isInitialized: boolean;
  isLoading: boolean;
  lastError: Error | null;
  transactionCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class TransactionService implements OnDestroy {
  private readonly databaseService = inject(DatabaseService);
  private readonly replicationService = inject(TransactionReplicationService);
  private readonly logger = createServiceLogger('TransactionService');

  private subscription?: Subscription;
  private replicationSubscription?: Subscription;
  private readonly _state$ = new BehaviorSubject<TransactionServiceState>({
    isInitialized: false,
    isLoading: false,
    lastError: null,
    transactionCount: 0,
  });

  // Signals for reactive data
  private _transactions = signal<RxTxnDocumentType[]>([]);
  public readonly transactions = this._transactions.asReadonly();

  // Computed signals for statistics
  public readonly stats = computed<TransactionStats>(() => {
    const txns = this._transactions();
    return {
      total: txns.length,
      pending: txns.filter((t: any) => t.status === 'PENDING').length,
      in: txns.filter((t: any) => t.status === 'IN').length,
      out: txns.filter((t: any) => t.status === 'OUT').length,
    };
  });

  // Computed signal for recent transactions (last 5)
  public readonly recentTransactions = computed(() => {
    return this._transactions().slice(0, 5);
  });

  // State observables
  public readonly state$ = this._state$.asObservable();
  public readonly isInitialized = computed(
    () => this._state$.value.isInitialized,
  );
  public readonly isLoading = computed(() => this._state$.value.isLoading);
  public readonly lastError = computed(() => this._state$.value.lastError);

  constructor() {
    this.setupReplicationSubscription();
  }

  ngOnDestroy() {
    this.logger.info('ngOnDestroy', 'Cleaning up transaction service');

    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.replicationSubscription) {
      this.replicationSubscription.unsubscribe();
    }

    this._state$.complete();
  }

  private setupReplicationSubscription(): void {
    this.logger.info(
      'setupReplicationSubscription',
      'Setting up replication subscription',
    );

    // Wait for database to be ready, then setup subscriptions
    this.subscription = this.databaseService.initState$
      .pipe(
        filter((state) => state === 'ready'),
        switchMap(() => this.waitForReplicationReady()),
        switchMap(() => this.setupSubscriptions()),
        catchError((error) => {
          this.logger.error(
            'setupReplicationSubscription',
            'Failed to setup subscription',
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
        const isReady = this.replicationService.isReplicationInitialized();
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
   * Setup both replication and local database subscriptions
   */
  private setupSubscriptions(): Observable<void> {
    this.logger.info('setupSubscriptions', 'Setting up subscriptions');

    // Setup replication subscription
    const replicationState = this.replicationService.getReplicationState();
    if (replicationState) {
      this.replicationSubscription = replicationState.received$
        .pipe(
          tap((data: any) => {
            this.logger.debug(
              'replicationReceived',
              'Replication data received',
              {
                documentCount: Array.isArray(data) ? data.length : 1,
              },
            );
          }),
          switchMap((data) => this.handleReplicationData(data)),
          catchError((error) => {
            this.logger.error(
              'replicationSubscription',
              'Error in replication subscription',
              error,
            );
            this.updateState({ lastError: error });
            return EMPTY;
          }),
        )
        .subscribe();
    }

    // Setup local database subscription as backup
    this.subscription = this.databaseService.db.txn
      .find()
      .$.pipe(
        tap((txns) => {
          this.logger.debug('localDatabaseUpdate', 'Local database updated', {
            transactionCount: txns.length,
          });
        }),
        catchError((error) => {
          this.logger.error(
            'localDatabaseSubscription',
            'Error in local subscription',
            error,
          );
          this.updateState({ lastError: error });
          return EMPTY;
        }),
      )
      .subscribe((txns) => {
        this._transactions.set(txns);
        this.updateState({
          transactionCount: txns.length,
          isInitialized: true,
          isLoading: false,
        });
      });

    this.logger.info('setupSubscriptions', 'Subscriptions setup completed');
    return EMPTY;
  }

  private handleReplicationData(received: any): Observable<void> {
    this.updateState({ isLoading: true, lastError: null });

    return new Observable<void>((subscriber) => {
      try {
        this.logger.debug(
          'handleReplicationData',
          'Processing replication data',
          {
            dataType: Array.isArray(received) ? 'array' : 'object',
            dataLength: Array.isArray(received) ? received.length : 1,
          },
        );

        let updatedTransactions: RxTxnDocumentType[];

        if (isDocumentArray(received)) {
          // Array of documents - replace all
          updatedTransactions = received as RxTxnDocumentType[];
          this.logger.debug(
            'handleReplicationData',
            'Processing document array',
            {
              count: received.length,
            },
          );
        } else if (isDocument(received)) {
          // Single document - add or update
          const currentTxns = this._transactions();
          const receivedDoc = received as RxTxnDocumentType;
          const existingIndex = currentTxns.findIndex(
            (t: any) => t.id === (receivedDoc as any).id,
          );

          if (existingIndex >= 0) {
            // Update existing document
            updatedTransactions = [...currentTxns];
            updatedTransactions[existingIndex] = receivedDoc;
            this.logger.debug(
              'handleReplicationData',
              'Updated existing document',
              {
                id: (receivedDoc as any).id,
              },
            );
          } else {
            // Add new document
            updatedTransactions = [receivedDoc, ...currentTxns];
            this.logger.debug('handleReplicationData', 'Added new document', {
              id: (receivedDoc as any).id,
            });
          }
        } else {
          this.logger.warn('handleReplicationData', 'Invalid data format', {
            received,
          });
          subscriber.error(new Error('Invalid replication data format'));
          return;
        }

        this._transactions.set(updatedTransactions);
        this.updateState({
          transactionCount: updatedTransactions.length,
          isInitialized: true,
          isLoading: false,
        });

        this.logger.info(
          'handleReplicationData',
          'Transactions updated successfully',
          {
            count: updatedTransactions.length,
          },
        );

        subscriber.next();
        subscriber.complete();
      } catch (error) {
        this.logger.error(
          'handleReplicationData',
          'Error handling replication data',
          error,
        );
        this.updateState({ lastError: error as Error, isLoading: false });
        subscriber.error(error);
      }
    });
  }

  /**
   * Update state with partial updates
   */
  private updateState(updates: Partial<TransactionServiceState>): void {
    const currentState = this._state$.value;
    const newState = { ...currentState, ...updates };
    this._state$.next(newState);
  }

  /**
   * Manually refresh data if needed
   */
  async refreshTransactions(): Promise<void> {
    this.logger.info('refreshTransactions', 'Manually refreshing transactions');
    this.updateState({ isLoading: true, lastError: null });

    try {
      // Check if database is ready
      if (!this.databaseService.isReady) {
        throw DatabaseErrorFactory.notReady('refreshTransactions', {
          message: 'Database not ready for refresh',
        });
      }

      const txns = await this.databaseService.db.txn.find().exec();
      this._transactions.set(txns);
      this.updateState({
        transactionCount: txns.length,
        isLoading: false,
        isInitialized: true,
      });

      this.logger.info(
        'refreshTransactions',
        'Transactions refreshed successfully',
        {
          count: txns.length,
        },
      );
    } catch (error) {
      this.logger.error(
        'refreshTransactions',
        'Error refreshing transactions',
        error,
      );
      this.updateState({ lastError: error as Error, isLoading: false });
      throw error;
    }
  }

  /**
   * Get transactions by status
   */
  getTransactionsByStatus(status: string) {
    return computed(() =>
      this._transactions().filter((t: any) => t.status === status),
    );
  }

  /**
   * Get transactions by door permission
   */
  getTransactionsByDoor(doorId: string) {
    return computed(() =>
      this._transactions().filter((t: any) =>
        Array.isArray(t.door_permission)
          ? t.door_permission.includes(doorId)
          : t.door_permission?.split(',').includes(doorId),
      ),
    );
  }

  /**
   * Check if service is working
   */
  isServiceWorking(): boolean {
    return Boolean(
      (this.subscription && !this.subscription.closed) ||
        (this.replicationSubscription && !this.replicationSubscription.closed),
    );
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
      isHealthy: Boolean(
        this._state$.value.isInitialized && !this._state$.value.lastError,
      ),
      lastError: this._state$.value.lastError,
      isInitialized: this._state$.value.isInitialized,
    };
  }

  /**
   * Get transaction by ID
   */
  getTransactionById(id: string): RxTxnDocumentType | undefined {
    return this._transactions().find((t: any) => t.id === id);
  }

  /**
   * Get transactions count
   */
  getTransactionCount(): number {
    return this._transactions().length;
  }

  /**
   * Clear all transactions (for testing/reset)
   */
  clearTransactions(): void {
    this.logger.info('clearTransactions', 'Clearing all transactions');
    this._transactions.set([]);
    this.updateState({ transactionCount: 0 });
  }
}
