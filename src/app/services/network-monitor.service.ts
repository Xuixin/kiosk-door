import { Injectable, OnDestroy, inject } from '@angular/core';
import { Network } from '@capacitor/network';
import { BehaviorSubject, Observable } from 'rxjs';
import { createServiceLogger } from '../core/Database/utils/logging.utils';
import { DoorReplicationService } from '../core/Database/door-replication.service';
import { TransactionReplicationService } from '../core/Database/transaction-replication.service';

@Injectable({
  providedIn: 'root',
})
export class NetworkMonitorService implements OnDestroy {
  private readonly logger = createServiceLogger('NetworkMonitorService');
  private readonly networkStatus$ = new BehaviorSubject<boolean>(true);
  private previousStatus: boolean = true;
  private listener?: any;

  // Inject replication services
  private doorReplicationService = inject(DoorReplicationService);
  private transactionReplicationService = inject(TransactionReplicationService);

  constructor() {
    this.initializeNetworkListener();
  }

  private async initializeNetworkListener(): Promise<void> {
    try {
      // Get initial status
      const status = await Network.getStatus();
      this.networkStatus$.next(status.connected);
      this.previousStatus = status.connected;

      console.log('[network] Initial status', {
        connected: status.connected,
        connectionType: status.connectionType,
      });

      // Listen for changes
      this.listener = await Network.addListener(
        'networkStatusChange',
        (status) => {
          const wasOffline = !this.previousStatus;
          const isNowOnline = status.connected;

          console.log('[network] Status changed', {
            wasOffline,
            isNowOnline,
            connectionType: status.connectionType,
          });

          this.networkStatus$.next(status.connected);
          this.previousStatus = status.connected;

          // Handle network status changes
          if (!status.connected) {
            console.log('[network] Device offline, stopping replication');
            this.stopReplications();
          } else if (wasOffline && isNowOnline) {
            console.log('[network] Device back online, triggering replication');
          }
        },
      );

      this.logger.info(
        'initializeNetworkListener',
        'Network listener initialized',
      );
    } catch (error) {
      this.logger.error(
        'initializeNetworkListener',
        'Failed to initialize',
        error,
      );
    }
  }

  getNetworkStatus$(): Observable<boolean> {
    return this.networkStatus$.asObservable();
  }

  isOnline(): boolean {
    return this.networkStatus$.value;
  }

  /**
   * Stop all replications when offline
   */
  private async stopReplications(): Promise<void> {
    try {
      await Promise.all([
        this.doorReplicationService.stopReplication(),
        this.transactionReplicationService.stopReplication(),
      ]);
      this.logger.info(
        'stopReplications',
        'All replications stopped due to offline status',
      );
    } catch (error) {
      this.logger.error(
        'stopReplications',
        'Error stopping replications',
        error,
      );
    }
  }

  ngOnDestroy(): void {
    this.listener?.remove();
    this.logger.info('ngOnDestroy', 'Network listener removed');
  }
}
