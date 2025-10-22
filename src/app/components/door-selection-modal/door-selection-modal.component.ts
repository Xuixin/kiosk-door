import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DoorPreferenceService } from '../../services/door-preference.service';
import { GraphQLService, Door } from '../../services/graphql.service';

// Door interface is now imported from GraphQLService

@Component({
  selector: 'app-door-selection-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, ButtonModule, CardModule],
  templateUrl: './door-selection-modal.component.html',
  styleUrls: ['./door-selection-modal.component.scss'],
})
export class DoorSelectionModalComponent implements OnInit {
  doors = signal<Door[]>([]);
  selectedDoorId = signal<string>('');
  isLoading = signal<boolean>(true);
  error = signal<string>('');

  constructor(
    private modalController: ModalController,
    private doorPreferenceService: DoorPreferenceService,
    private graphqlService: GraphQLService,
  ) {}

  ngOnInit() {
    this.loadDoors();
  }

  /**
   * Load doors from GraphQL
   */
  private async loadDoors() {
    try {
      this.isLoading.set(true);
      this.error.set('');

      console.log('🚪 Loading doors from GraphQL API...');

      // Try to get doors from GraphQL API
      let doors: Door[] = [];

      try {
        // First try the pullDoors query (for replication-style API)
        doors = await this.graphqlService.pullDoors();
        console.log('✅ Loaded doors via pullDoors:', doors.length);
      } catch (pullError) {
        console.warn('⚠️ pullDoors failed, trying getAllDoors:', pullError);

        try {
          // Fallback to getAllDoors query (simpler query)
          doors = await this.graphqlService.getAllDoors();
          console.log('✅ Loaded doors via getAllDoors:', doors.length);
        } catch (getAllError) {
          console.error('❌ Both GraphQL queries failed:', getAllError);
          throw getAllError;
        }
      }

      if (doors.length === 0) {
        console.warn('⚠️ No doors returned from API, using fallback data');
        // Fallback to mock data if API returns empty
        doors = this.getFallbackDoors();
      }

      // Transform API data to match component interface
      const transformedDoors = doors.map((door) => ({
        id: door.id,
        name: door.name,
        description: `ประตู ${door.id}`,
      }));

      this.doors.set(transformedDoors);
      this.isLoading.set(false);

      console.log('✅ Doors loaded successfully:', transformedDoors.length);
    } catch (error) {
      console.error('❌ Error loading doors:', error);

      // Use fallback data on error
      console.log('🔄 Using fallback door data');
      const fallbackDoors = this.getFallbackDoors();
      this.doors.set(fallbackDoors);
      this.error.set('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ ใช้ข้อมูลสำรอง');
      this.isLoading.set(false);
    }
  }

  /**
   * Get fallback door data
   */
  private getFallbackDoors(): Door[] {
    return [
      {
        id: 'door-1',
        name: 'ประตู 1 - ทางเข้าหลัก',
        description: 'ประตูทางเข้าหลักของอาคาร',
      },
      {
        id: 'door-2',
        name: 'ประตู 2 - ทางเข้าด้านข้าง',
        description: 'ประตูทางเข้าด้านข้างของอาคาร',
      },
      {
        id: 'door-3',
        name: 'ประตู 3 - ทางเข้าห้องประชุม',
        description: 'ประตูเข้าห้องประชุมใหญ่',
      },
      {
        id: 'door-4',
        name: 'ประตู 4 - ทางเข้าห้องสมุด',
        description: 'ประตูเข้าห้องสมุด',
      },
      {
        id: 'door-5',
        name: 'ประตู 5 - ทางเข้าห้องแล็บ',
        description: 'ประตูเข้าห้องปฏิบัติการ',
      },
    ];
  }

  /**
   * Select a door
   */
  selectDoor(doorId: string) {
    this.selectedDoorId.set(doorId);
  }

  /**
   * Check if a door is selected
   */
  isSelected(doorId: string): boolean {
    return this.selectedDoorId() === doorId;
  }

  /**
   * Confirm door selection
   */
  async confirmSelection() {
    const selectedId = this.selectedDoorId();
    if (!selectedId) {
      this.error.set('กรุณาเลือกประตู');
      return;
    }

    try {
      // Save door ID to preferences
      const success = await this.doorPreferenceService.setDoorId(selectedId);
      if (success) {
        // Close modal and return selected door ID
        await this.modalController.dismiss(selectedId);
      } else {
        this.error.set('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      }
    } catch (error) {
      console.error('Error confirming door selection:', error);
      this.error.set('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  }

  /**
   * Cancel selection
   */
  async cancel() {
    await this.modalController.dismiss(null);
  }

  /**
   * Retry loading doors
   */
  retry() {
    this.loadDoors();
  }

  /**
   * Get selected door name
   */
  getSelectedDoorName(): string {
    const selectedId = this.selectedDoorId();
    if (!selectedId) return '';

    const selectedDoor = this.doors().find((d) => d.id === selectedId);
    return selectedDoor ? selectedDoor.name : '';
  }
}
