import { Injectable, OnDestroy } from '@angular/core';
import {
  Observable,
  BehaviorSubject,
  Subscription,
  throwError,
  timer,
} from 'rxjs';
import {
  catchError,
  retryWhen,
  mergeMap,
  take,
  tap,
  finalize,
} from 'rxjs/operators';
import {
  replicateGraphQL,
  RxGraphQLReplicationState,
} from 'rxdb/plugins/replication-graphql';
import { RxCollection } from 'rxdb';

import { DatabaseConfigService } from './database-config.service';
import {
  IReplicationService,
  ReplicationConfig,
  ReplicationState,
  BaseReplicationConfig,
  DatabaseInitState,
} from './types/replication.types';
import { createServiceLogger } from './utils/logging.utils';
import { retryWithBackoff, RetryConfig } from './utils/retry.utils';
import {
  DatabaseErrorFactory,
  isRetryableError,
} from './errors/database.errors';

@Injectable()
export abstract class BaseReplicationService<T = any>
  implements IReplicationService<T>, OnDestroy
{
  protected readonly logger = createServiceLogger(this.constructor.name);
  protected readonly configService = new DatabaseConfigService();

  public replicationState?: RxGraphQLReplicationState<T, any>;
  protected readonly isInitialized$ = new BehaviorSubject<boolean>(false);
  protected readonly isActive$ = new BehaviorSubject<boolean>(false);
  protected readonly error$ = new BehaviorSubject<Error | null>(null);

  private subscriptions: Subscription[] = [];
  private retryConfig: RetryConfig;

  constructor() {
    const retryConfig = this.configService.getRetryConfig();
    this.retryConfig = {
      maxAttempts: retryConfig.maxRetries,
      baseDelay: retryConfig.baseDelay,
      maxDelay: retryConfig.maxDelay,
      backoffMultiplier: retryConfig.backoffMultiplier,
      jitter: retryConfig.jitter,
    };
  }

  /**
   * Abstract method to get replication configuration
   */
  protected abstract getReplicationConfig(): BaseReplicationConfig;

  /**
   * Abstract method to get collection name for logging
   */
  protected abstract getCollectionName(): string;

  /**
   * Setup replication for the given collection
   */
  async setupReplication(
    collection: RxCollection,
  ): Promise<ReplicationState<T>> {
    try {
      this.logger.info('setupReplication', 'Starting replication setup');

      const config = this.getReplicationConfig();
      this.validateConfig(config);

      this.replicationState = replicateGraphQL<T, any>({
        collection,
        replicationIdentifier: config.replicationIdentifier,
        url: config.url,
        pull: config.pull,
        push: config.push,
        live: config.live,
        retryTime: config.retryTime,
        autoStart: config.autoStart,
        waitForLeadership: config.waitForLeadership,
        headers: config.headers,
      });

      this.setupReplicationSubscriptions();
      await this.replicationState.awaitInitialReplication();

      this.isInitialized$.next(true);
      this.isActive$.next(true);
      this.logger.info(
        'setupReplication',
        'Replication setup completed successfully',
      );

      return this.replicationState;
    } catch (error) {
      const dbError = DatabaseErrorFactory.replication(
        `Failed to setup replication: ${error}`,
        'setupReplication',
        this.getCollectionName(),
        isRetryableError(error as Error),
        { collection: this.getCollectionName() },
      );

      this.error$.next(dbError);
      this.logger.error(
        'setupReplication',
        'Replication setup failed',
        dbError,
      );
      throw dbError;
    }
  }

  /**
   * Stop replication
   */
  async stopReplication(): Promise<void> {
    try {
      this.logger.info('stopReplication', 'Stopping replication');

      if (this.replicationState) {
        await this.replicationState.cancel();
        this.replicationState = undefined;
      }

      this.isActive$.next(false);
      this.isInitialized$.next(false);
      this.cleanupSubscriptions();

      this.logger.info('stopReplication', 'Replication stopped successfully');
    } catch (error) {
      this.logger.error('stopReplication', 'Error stopping replication', error);
      throw DatabaseErrorFactory.replication(
        `Failed to stop replication: ${error}`,
        'stopReplication',
        this.getCollectionName(),
        false,
      );
    }
  }

  /**
   * Get replication state
   */
  getReplicationState(): ReplicationState<T> | undefined {
    return this.replicationState;
  }

  /**
   * Check if replication is active
   */
  isReplicationActive(): boolean {
    return this.isActive$.value;
  }

  /**
   * Check if replication is initialized
   */
  isReplicationInitialized(): boolean {
    return this.isInitialized$.value;
  }

  /**
   * Get replication status observable
   */
  getStatusObservable(): Observable<{
    isActive: boolean;
    isInitialized: boolean;
  }> {
    return new Observable((subscriber) => {
      const subscription = this.isActive$.subscribe((isActive) => {
        subscriber.next({
          isActive,
          isInitialized: this.isInitialized$.value,
        });
      });

      return () => subscription.unsubscribe();
    });
  }

  /**
   * Get error observable
   */
  getErrorObservable(): Observable<Error | null> {
    return this.error$.asObservable();
  }

  /**
   * Setup replication subscriptions with error handling
   */
  private setupReplicationSubscriptions(): void {
    if (!this.replicationState) {
      throw DatabaseErrorFactory.replication(
        'Replication state not available',
        'setupReplicationSubscriptions',
        this.getCollectionName(),
        false,
      );
    }

    // Error subscription with retry logic
    const errorSubscription = this.replicationState.error$
      .pipe(
        tap((error) => {
          this.logger.error('replication', 'Replication error occurred', error);
          this.error$.next(error);
        }),
        retryWhen((errors) =>
          errors.pipe(
            mergeMap((error, index) => {
              const attempt = index + 1;
              if (attempt > this.retryConfig.maxAttempts) {
                return throwError(() => error);
              }
              const delayTime =
                this.retryConfig.baseDelay *
                Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
              return timer(delayTime);
            }),
            take(this.retryConfig.maxAttempts),
          ),
        ),
        catchError((error) => {
          this.logger.error(
            'replication',
            'Replication failed after retries',
            error,
          );
          this.isActive$.next(false);
          return throwError(() => error);
        }),
      )
      .subscribe();

    // Received data subscription
    const receivedSubscription = this.replicationState.received$
      .pipe(
        tap((data) => {
          this.logger.debug(
            'replication',
            `Received ${Array.isArray(data) ? data.length : 1} documents`,
          );
        }),
        catchError((error) => {
          this.logger.error(
            'replication',
            'Error processing received data',
            error,
          );
          return throwError(() => error);
        }),
      )
      .subscribe();

    // Sent data subscription
    const sentSubscription = this.replicationState.sent$
      .pipe(
        tap((data) => {
          this.logger.debug(
            'replication',
            `Sent ${Array.isArray(data) ? data.length : 1} documents`,
          );
        }),
        catchError((error) => {
          this.logger.error('replication', 'Error processing sent data', error);
          return throwError(() => error);
        }),
      )
      .subscribe();

    this.subscriptions.push(
      errorSubscription,
      receivedSubscription,
      sentSubscription,
    );
  }

  /**
   * Validate replication configuration
   */
  private validateConfig(config: BaseReplicationConfig): void {
    if (!config.url?.http || !config.url?.ws) {
      throw DatabaseErrorFactory.replication(
        'Missing required URL configuration',
        'validateConfig',
        this.getCollectionName(),
        false,
      );
    }

    if (!config.replicationIdentifier) {
      throw DatabaseErrorFactory.replication(
        'Missing replication identifier',
        'validateConfig',
        this.getCollectionName(),
        false,
      );
    }

    if (config.batchSize < 1 || config.batchSize > 100) {
      this.logger.warn(
        'validateConfig',
        'Batch size should be between 1 and 100',
      );
    }
  }

  /**
   * Cleanup subscriptions
   */
  private cleanupSubscriptions(): void {
    this.subscriptions.forEach((sub) => {
      if (!sub.closed) {
        sub.unsubscribe();
      }
    });
    this.subscriptions = [];
  }

  /**
   * Restart replication with exponential backoff
   */
  async restartReplication(collection: RxCollection): Promise<void> {
    this.logger.info('restartReplication', 'Restarting replication');

    try {
      await this.stopReplication();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief pause
      await this.setupReplication(collection);
    } catch (error) {
      this.logger.error(
        'restartReplication',
        'Failed to restart replication',
        error,
      );
      throw error;
    }
  }

  /**
   * Get replication health status
   */
  getHealthStatus(): {
    isHealthy: boolean;
    lastError: Error | null;
    uptime: number;
  } {
    return {
      isHealthy: this.isActive$.value && !this.error$.value,
      lastError: this.error$.value,
      uptime: this.isInitialized$.value
        ? Date.now() - (this as any).startTime
        : 0,
    };
  }

  /**
   * Cleanup on destroy
   */
  ngOnDestroy(): void {
    this.logger.info('ngOnDestroy', 'Cleaning up replication service');
    this.cleanupSubscriptions();
    this.isInitialized$.complete();
    this.isActive$.complete();
    this.error$.complete();
  }
}
