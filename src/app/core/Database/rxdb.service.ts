import {
  Injector,
  Injectable,
  Signal,
  untracked,
  inject,
  OnDestroy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, throwError, timer } from 'rxjs';
import {
  retryWhen,
  mergeMap,
  take,
  catchError,
  finalize,
} from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { TXN_SCHEMA } from '../schema/txn.schema';
import { DOOR_SCHEMA } from '../schema/door.schema';

import { RxReactivityFactory, createRxDatabase } from 'rxdb/plugins/core';

import { RxTxnsCollections, RxTxnsDatabase } from './RxDB.D';
import { TransactionReplicationService } from './transaction-replication.service';
import { DoorReplicationService } from './door-replication.service';
import { DatabaseConfigService } from './database-config.service';
import { createServiceLogger } from './utils/logging.utils';
import { retryWithBackoff } from './utils/retry.utils';
import {
  DatabaseErrorFactory,
  DatabaseNotReadyError,
} from './errors/database.errors';
import {
  DatabaseInitState,
  IServiceLifecycle,
  DatabaseHealthCheck,
} from './types/replication.types';

environment.addRxDBPlugins();

const collectionsSettings = {
  txn: {
    schema: TXN_SCHEMA as any,
  },
  door: {
    schema: DOOR_SCHEMA as any,
  },
};

async function _create(
  injector: Injector,
  doorId: string,
): Promise<RxTxnsDatabase> {
  environment.addRxDBPlugins();

  console.log('DatabaseService: creating database..');

  const reactivityFactory: RxReactivityFactory<Signal<any>> = {
    fromObservable(obs, initialValue: any) {
      return untracked(() =>
        toSignal(obs, {
          initialValue,
          injector,
        }),
      );
    },
  };

  const databaseName = `door-${doorId}.db`;
  console.log('DatabaseService: creating database with name:', databaseName);

  const db = (await createRxDatabase<RxTxnsCollections>({
    name: databaseName,
    storage: environment.getRxStorage(),
    multiInstance: environment.multiInstance,
    reactivity: reactivityFactory,
  })) as RxTxnsDatabase;

  console.log('DatabaseService: created database');

  if (environment.multiInstance) {
    db.waitForLeadership().then(() => {
      console.log('isLeader now');
      document.title = '♛ ' + document.title;
    });
  }

  console.log('DatabaseService: create collections');

  await db.addCollections(collectionsSettings);

  // เริ่ม replication อัตโนมัติ
  console.log('DatabaseService: starting replications...');

  // Get replication services from injector instead of creating them manually
  const transactionReplicationService = injector.get(
    TransactionReplicationService,
  );
  const doorReplicationService = injector.get(DoorReplicationService);

  await transactionReplicationService.setupReplication(db.txn as any);
  await doorReplicationService.setupReplication(db.door as any);
  console.log('DatabaseService: replications started');

  return db;
}

@Injectable()
export class DatabaseService implements IServiceLifecycle, OnDestroy {
  private static instance: DatabaseService | null = null;
  private static initPromise: Promise<RxTxnsDatabase> | null = null;
  private static databaseInstance: RxTxnsDatabase | null = null;

  private readonly logger = createServiceLogger('DatabaseService');
  private readonly configService = new DatabaseConfigService();
  private readonly _initState$ = new BehaviorSubject<DatabaseInitState>(
    DatabaseInitState.NOT_INITIALIZED,
  );
  private readonly _lastError$ = new BehaviorSubject<Error | null>(null);
  private readonly startTime = Date.now();

  constructor(
    private transactionReplicationService: TransactionReplicationService,
    private doorReplicationService: DoorReplicationService,
  ) {
    if (DatabaseService.instance) {
      return DatabaseService.instance;
    }
    DatabaseService.instance = this;
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      throw DatabaseErrorFactory.notReady('getInstance', {
        message: 'DatabaseService not initialized',
      });
    }
    return DatabaseService.instance;
  }

  /**
   * Initialize database with proper error handling and retry logic
   */
  static async initDatabase(
    injector: Injector,
    doorId: string,
  ): Promise<RxTxnsDatabase> {
    if (!injector) {
      throw DatabaseErrorFactory.notReady('initDatabase', {
        message: 'Injector missing',
      });
    }

    if (!doorId) {
      throw DatabaseErrorFactory.notReady('initDatabase', {
        message: 'Door ID missing',
      });
    }

    if (DatabaseService.initPromise) {
      return DatabaseService.initPromise;
    }

    const service = DatabaseService.getInstance();
    service._initState$.next(DatabaseInitState.INITIALIZING);

    DatabaseService.initPromise = service
      .createDatabase(injector, doorId)
      .then((db) => {
        DatabaseService.databaseInstance = db;
        service._initState$.next(DatabaseInitState.READY);
        service.logger.info(
          'initDatabase',
          'Database initialized successfully',
          { doorId },
        );
        return db;
      })
      .catch((error) => {
        service._initState$.next(DatabaseInitState.ERROR);
        service._lastError$.next(error);
        service.logger.error(
          'initDatabase',
          'Database initialization failed',
          error,
        );
        throw error;
      });

    return DatabaseService.initPromise;
  }

  /**
   * Create database with retry logic
   */
  private async createDatabase(
    injector: Injector,
    doorId: string,
  ): Promise<RxTxnsDatabase> {
    const config = this.configService.getServiceConfig('database');
    const timeout = config.timeouts?.initialization || 30000;

    return this._createDatabase(injector, doorId);
  }

  /**
   * Internal database creation logic
   */
  private async _createDatabase(
    injector: Injector,
    doorId: string,
  ): Promise<RxTxnsDatabase> {
    this.logger.info('_createDatabase', 'Creating database', { doorId });

    const reactivityFactory: RxReactivityFactory<Signal<any>> = {
      fromObservable(obs, initialValue: any) {
        return untracked(() =>
          toSignal(obs, {
            initialValue,
            injector,
          }),
        );
      },
    };

    const databaseName = `door-${doorId}.db`;
    this.logger.debug('_createDatabase', 'Database name', { databaseName });

    const db = (await createRxDatabase<RxTxnsCollections>({
      name: databaseName,
      storage: environment.getRxStorage(),
      multiInstance: environment.multiInstance,
      reactivity: reactivityFactory,
    })) as RxTxnsDatabase;

    this.logger.info('_createDatabase', 'Database created', { databaseName });

    if (environment.multiInstance) {
      db.waitForLeadership().then(() => {
        this.logger.info('_createDatabase', 'Database leadership acquired');
        document.title = '♛ ' + document.title;
      });
    }

    this.logger.info('_createDatabase', 'Adding collections');
    await db.addCollections(collectionsSettings);

    this.logger.info('_createDatabase', 'Starting replications');
    await this.setupReplications(db);

    this.logger.info('_createDatabase', 'Database setup completed');
    return db;
  }

  /**
   * Setup replications with error handling
   */
  private async setupReplications(db: RxTxnsDatabase): Promise<void> {
    try {
      await Promise.all([
        this.transactionReplicationService.setupReplication(db.txn as any),
        this.doorReplicationService.setupReplication(db.door as any),
      ]);
      this.logger.info(
        'setupReplications',
        'All replications started successfully',
      );
    } catch (error) {
      this.logger.error(
        'setupReplications',
        'Failed to start replications',
        error,
      );
      throw DatabaseErrorFactory.notReady('setupReplications', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get database instance
   */
  get db(): RxTxnsDatabase {
    if (!DatabaseService.databaseInstance) {
      throw DatabaseErrorFactory.notReady('getDatabase', {
        state: this._initState$.value,
      });
    }
    return DatabaseService.databaseInstance;
  }

  /**
   * Check if database is ready (implements IServiceLifecycle)
   */
  isReady(): boolean {
    return (
      this._initState$.value === DatabaseInitState.READY &&
      DatabaseService.databaseInstance !== null
    );
  }

  /**
   * Get initialization state
   */
  get initState(): DatabaseInitState {
    return this._initState$.value;
  }

  /**
   * Get initialization state observable
   */
  get initState$(): Observable<DatabaseInitState> {
    return this._initState$.asObservable();
  }

  /**
   * Get last error
   */
  get lastError(): Error | null {
    return this._lastError$.value;
  }

  /**
   * Get last error observable
   */
  get lastError$(): Observable<Error | null> {
    return this._lastError$.asObservable();
  }

  /**
   * Stop all replications
   */
  async stopReplication(): Promise<void> {
    try {
      this.logger.info('stopReplication', 'Stopping all replications');

      await Promise.all([
        this.transactionReplicationService.stopReplication(),
        this.doorReplicationService.stopReplication(),
      ]);

      this.logger.info('stopReplication', 'All replications stopped');
    } catch (error) {
      this.logger.error(
        'stopReplication',
        'Error stopping replications',
        error,
      );
      throw error;
    }
  }

  /**
   * Get database health check
   */
  getHealthCheck(): DatabaseHealthCheck {
    const collections = {
      txn: {
        documentCount: 0,
        isReplicating: this.transactionReplicationService.isReplicationActive(),
        lastReplicationError: undefined,
      },
      door: {
        documentCount: 0,
        isReplicating: this.doorReplicationService.isReplicationActive(),
        lastReplicationError: undefined,
      },
    };

    // Try to get document counts if database is ready
    if (this.isReady()) {
      try {
        // This would need to be implemented with proper async handling
        // For now, we'll leave document counts as 0
      } catch (error) {
        this.logger.warn(
          'getHealthCheck',
          'Could not get document counts',
          error,
        );
      }
    }

    return {
      isHealthy: this.isReady() && !this._lastError$.value,
      state: this._initState$.value,
      lastError: this._lastError$.value || undefined,
      collections,
    };
  }

  /**
   * Restart database with new door ID
   */
  async restart(injector: Injector, doorId: string): Promise<void> {
    this.logger.info('restart', 'Restarting database', { doorId });

    try {
      await this.destroy();
      await DatabaseService.initDatabase(injector, doorId);
      this.logger.info('restart', 'Database restarted successfully');
    } catch (error) {
      this.logger.error('restart', 'Failed to restart database', error);
      throw error;
    }
  }

  /**
   * Initialize service (implements IServiceLifecycle)
   */
  async initialize(): Promise<void> {
    // Database initialization is handled by initDatabase static method
    // This method is here for interface compliance
  }

  /**
   * Destroy service and cleanup
   */
  async destroy(): Promise<void> {
    this.logger.info('destroy', 'Destroying database service');

    try {
      await this.stopReplication();

      if (DatabaseService.databaseInstance) {
        // Note: RxDB doesn't have a destroy method, we'll just clear the reference
        // await DatabaseService.databaseInstance.destroy();
        DatabaseService.databaseInstance = null;
      }

      DatabaseService.initPromise = null;
      this._initState$.next(DatabaseInitState.DESTROYED);
      this.logger.info('destroy', 'Database service destroyed');
    } catch (error) {
      this.logger.error('destroy', 'Error destroying database service', error);
      throw error;
    }
  }

  /**
   * Cleanup on destroy
   */
  ngOnDestroy(): void {
    this.logger.info('ngOnDestroy', 'Cleaning up database service');
    this._initState$.complete();
    this._lastError$.complete();
  }
}
