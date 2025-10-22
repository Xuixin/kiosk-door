import {
  Injector,
  NgModule,
  APP_INITIALIZER,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import { IonicModule } from '@ionic/angular';
import {
  IonicRouteStrategy,
  provideIonicAngular,
} from '@ionic/angular/standalone';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { DatabaseService } from './core/Database/rxdb.service';
import { WorkflowPreloadService } from './flow-services/workflow-preload.service';
import { DoorSelectionModalComponent } from './components/door-selection-modal/door-selection-modal.component';
import { DoorPreferenceService } from './services/door-preference.service';
import { TransactionService } from './services/transaction.service';
import { TransactionReplicationService } from './core/Database/transaction-replication.service';
import { DoorReplicationService } from './core/Database/door-replication.service';
import { DoorCheckpointService } from './services/door-checkpoint.service';
import { GraphQLService } from './services/graphql.service';
import Aura from '@primeng/themes/aura';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    HttpClientModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    CommonModule,
    FormsModule,
    DoorSelectionModalComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [
    {
      provide: RouteReuseStrategy,
      useClass: IonicRouteStrategy,
    },
    provideIonicAngular(),
    // * workflow preload
    {
      provide: APP_INITIALIZER,
      useFactory: (preloadService: WorkflowPreloadService) => () => {
        return preloadService.preloadWorkflowComponents();
      },
      multi: true,
      deps: [WorkflowPreloadService],
    },
    DatabaseService,
    WorkflowPreloadService,
    DoorPreferenceService,
    TransactionService,
    TransactionReplicationService,
    DoorReplicationService,
    DoorCheckpointService,
    GraphQLService,
    // * animations
    provideAnimationsAsync(),
    MessageService,
    ConfirmationService,

    // * primeng
    providePrimeNG({
      theme: {
        preset: Aura,
        options: { darkModeSelector: false },
      },
      ripple: true,
      zIndex: {
        modal: 9000, // dialog, sidebar
        overlay: 9500, // dropdown, overlaypanel
        menu: 10000, // overlay menus
        tooltip: 11000, // tooltip
      },
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
