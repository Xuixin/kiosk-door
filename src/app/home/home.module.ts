import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HomePage } from './home.page';

import { HomePageRoutingModule } from './home-routing.module';

// PrimeNG imports
import { ButtonModule } from 'primeng/button';
import { RippleModule } from 'primeng/ripple';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePageRoutingModule,
    ButtonModule,
    RippleModule,
  ],
  declarations: [HomePage],
})
export class HomePageModule {}
