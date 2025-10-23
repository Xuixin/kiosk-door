import { Injectable, OnDestroy } from '@angular/core';
import { Network } from '@capacitor/network';
import { BehaviorSubject, Observable } from 'rxjs';
import { createServiceLogger } from '../core/Database/utils/logging.utils';

@Injectable({
  providedIn: 'root',
})
export class NetworkMonitorService implements OnDestroy {
  private readonly logger = createServiceLogger('NetworkMonitorService');
  private readonly networkStatus$ = new BehaviorSubject<boolean>(true);
  private previousStatus: boolean = true;
  private listener?: any;

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
            console.log('[network] Device offline');
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

  ngOnDestroy(): void {
    this.listener?.remove();
    this.logger.info('ngOnDestroy', 'Network listener removed');
  }
}
