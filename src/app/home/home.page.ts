import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  signal,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { TransactionService } from '../services/transaction.service';
import { DatabaseService } from '../core/Database/rxdb.service';
import { DoorPreferenceService } from '../services/door-preference.service';

interface AccessResult {
  hasAccess: boolean;
  studentName?: string;
  message: string;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('studentInput') studentInput?: ElementRef<HTMLInputElement>;

  currentDate = new Date();
  currentTime = new Date();

  // Inject services
  private readonly transactionService = inject(TransactionService);
  private readonly databaseService = inject(DatabaseService);
  private readonly doorPreferenceService = inject(DoorPreferenceService);
  private readonly cdr = inject(ChangeDetectorRef);

  // Signals from service
  public readonly transactions = this.transactionService.transactions;
  public readonly stats = this.transactionService.stats;
  public readonly recentTransactions =
    this.transactionService.recentTransactions;

  // Door system properties
  public studentNumber = '';
  public isChecking = false;
  public accessResult = signal<AccessResult | null>(null);
  public currentDoorName = signal<string>('');

  private timeInterval?: any;
  private resultTimeout?: any;

  constructor() {
    // Update time every minute
    this.timeInterval = setInterval(() => {
      this.currentTime = new Date();
      this.currentDate = new Date();
      this.cdr.detectChanges();
    }, 60000);
  }

  ngOnInit() {
    // Wait for database to be ready before loading door name
    this.databaseService.initState$.subscribe((state) => {
      if (state === 'ready') {
        this.loadCurrentDoorName();
      }
    });
  }

  ngOnDestroy() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    if (this.resultTimeout) {
      clearTimeout(this.resultTimeout);
    }
  }

  /**
   * Load current door name
   */
  private async loadCurrentDoorName() {
    try {
      const doorId = await this.doorPreferenceService.getDoorId();
      if (doorId) {
        // Try to get door name from database
        const doorDoc = await this.databaseService.db.door
          .findOne({
            selector: { id: doorId } as any,
          })
          .exec();

        if (doorDoc) {
          this.currentDoorName.set((doorDoc as any).name);
        } else {
          this.currentDoorName.set(`ประตู ${doorId}`);
        }
      }
    } catch (error) {
      console.error('Error loading door name:', error);
      this.currentDoorName.set('ประตูไม่ระบุ');
    }
  }

  /**
   * Add number from numpad
   */
  addNumber(num: number) {
    this.studentNumber += num.toString();
    this.focusInput();
  }

  /**
   * Clear input
   */
  clearInput() {
    this.studentNumber = '';
    this.focusInput();
  }

  /**
   * Backspace
   */
  backspace() {
    if (this.studentNumber.length > 0) {
      this.studentNumber = this.studentNumber.slice(0, -1);
    }
    this.focusInput();
  }

  /**
   * Focus input field
   */
  private focusInput() {
    setTimeout(() => {
      this.studentInput?.nativeElement.focus();
    }, 0);
  }

  /**
   * Check student access
   */
  async checkAccess() {
    if (!this.studentNumber.trim()) {
      return;
    }

    // Clear any existing timeout
    if (this.resultTimeout) {
      clearTimeout(this.resultTimeout);
    }

    this.isChecking = true;
    this.accessResult.set(null);

    try {
      console.log('🔍 Checking access for student:', this.studentNumber);

      // Get current door ID
      const currentDoorId = await this.doorPreferenceService.getDoorId();
      if (!currentDoorId) {
        this.accessResult.set({
          hasAccess: false,
          message: 'ไม่พบข้อมูลประตู กรุณาติดต่อเจ้าหน้าที่',
        });
        this.autoResetAfterResult();
        return;
      }

      // Check if database is ready
      if (!this.databaseService.isReady) {
        this.accessResult.set({
          hasAccess: false,
          message: 'ระบบฐานข้อมูลยังไม่พร้อม กรุณารอสักครู่',
        });
        this.autoResetAfterResult();
        return;
      }

      // Query local database for student
      const studentDoc = await this.databaseService.db.txn
        .findOne({
          selector: { student_number: this.studentNumber.trim() } as any,
        })
        .exec();

      console.log('Student document:', studentDoc);

      if (!studentDoc) {
        this.accessResult.set({
          hasAccess: false,
          message: 'ไม่พบข้อมูลการลงทะเบียน',
        });
        this.autoResetAfterResult();
        return;
      }

      // Check if student has access to current door
      const student = studentDoc as any;
      const doorPermissions = Array.isArray(student.door_permission)
        ? student.door_permission
        : student.door_permission.split(',').map((s: string) => s.trim());

      const hasDoorPermission = doorPermissions.includes(currentDoorId);
      const isStatusIn = student.status === 'IN';

      if (isStatusIn && hasDoorPermission) {
        this.accessResult.set({
          hasAccess: true,
          studentName: student.name,
          message: 'คุณมีสิทธิ์เข้า',
        });
        console.log('✅ Access granted for:', student.name);
      } else {
        let message = 'ไม่มีสิทธิ์เข้า';
        if (!isStatusIn) {
          message = 'สถานะไม่ถูกต้อง (ไม่ได้ลงทะเบียนเข้า)';
        } else if (!hasDoorPermission) {
          message = 'ไม่มีสิทธิ์เข้าประตูนี้';
        }

        this.accessResult.set({
          hasAccess: false,
          studentName: student.name,
          message: message,
        });
        console.log('❌ Access denied for:', student.name, 'Reason:', message);
      }

      // Auto reset after showing result
      this.autoResetAfterResult();
    } catch (error) {
      console.error('❌ Error checking access:', error);
      this.accessResult.set({
        hasAccess: false,
        message: 'เกิดข้อผิดพลาดในการตรวจสอบ กรุณาลองใหม่อีกครั้ง',
      });
      this.autoResetAfterResult();
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Auto reset after showing result (3 seconds)
   */
  private autoResetAfterResult() {
    this.resultTimeout = setTimeout(() => {
      this.resetForm();
    }, 3000); // Show result for 3 seconds
  }

  /**
   * Reset form to initial state
   */
  private resetForm() {
    this.accessResult.set(null);
    this.studentNumber = '';
    this.focusInput();
    this.cdr.detectChanges();
  }

  /**
   * Clear access result (manual)
   */
  clearResult() {
    if (this.resultTimeout) {
      clearTimeout(this.resultTimeout);
    }
    this.resetForm();
  }
}
