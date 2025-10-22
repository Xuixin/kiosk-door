import { Component, OnInit, OnDestroy, inject, Injector } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DatabaseService } from './core/Database/rxdb.service';
import { DoorPreferenceService } from './services/door-preference.service';
import { DoorCheckpointService } from './services/door-checkpoint.service';
import { ModalController } from '@ionic/angular';
import { DoorSelectionModalComponent } from './components/door-selection-modal/door-selection-modal.component';

import 'zone.js/plugins/zone-patch-rxjs';
@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  private doorPreferenceService = inject(DoorPreferenceService);
  private doorCheckpointService = inject(DoorCheckpointService);
  private modalController = inject(ModalController);
  private databaseService = inject(DatabaseService);
  private injector = inject(Injector);

  constructor() {}

  async ngOnInit() {
    await this.initializeDoorSystem();
  }

  ngOnDestroy() {
    this.databaseService.stopReplication();
  }

  /**
   * Initialize door system
   */
  private async initializeDoorSystem() {
    try {
      // Check if door-id exists in preferences
      const hasDoorId = await this.doorPreferenceService.hasDoorId();

      if (hasDoorId) {
        // Case 2: Existing door-id
        const doorId = await this.doorPreferenceService.getDoorId();
        if (doorId) {
          await this.initializeDatabase(doorId);
        }
      } else {
        // Case 1: No door-id - show selection modal
        console.log('❌ No door ID found, showing selection modal');
        await this.showDoorSelectionModal();
      }
    } catch (error) {
      console.error('❌ Error initializing door system:', error);
    }
  }

  /**
   * Show door selection modal
   */
  private async showDoorSelectionModal() {
    try {
      const modal = await this.modalController.create({
        component: DoorSelectionModalComponent,
        backdropDismiss: false, // Prevent dismissing without selection
        cssClass: 'door-selection-modal',
      });

      await modal.present();

      const { data } = await modal.onDidDismiss();

      if (data) {
        // User selected a door
        console.log('✅ Door selected:', data);
        await this.initializeDatabase(data);
      } else {
        // User cancelled - show modal again
        console.log('❌ Door selection cancelled, showing modal again');
        await this.showDoorSelectionModal();
      }
    } catch (error) {
      console.error('❌ Error showing door selection modal:', error);
    }
  }

  /**
   * Initialize database with door ID
   */
  private async initializeDatabase(doorId: string) {
    try {
      // Initialize database with door ID
      await DatabaseService.initDatabase(this.injector, doorId);

      // Initialize door checkpoint service after database is ready
      this.doorCheckpointService.initialize();
    } catch (error) {
      console.error('❌ Error initializing database:', error);
    }
  }
}
