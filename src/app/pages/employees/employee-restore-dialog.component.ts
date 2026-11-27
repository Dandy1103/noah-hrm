import { NoahButtonComponent, NoahDialogComponent, NoahFieldComponent, NoahInputDirective } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { HrmScreen } from '../hrm-screen';

@Component({
  selector: 'app-employee-restore-dialog',
  standalone: true,
  imports: [NoahButtonComponent, NoahDialogComponent, NoahFieldComponent, NoahInputDirective, ReactiveFormsModule],
  templateUrl: './employee-restore-dialog.component.html',
  styleUrl: '../../app.component.scss',
})
export class EmployeeRestoreDialogComponent {
  readonly screen = inject(HrmScreen);
}
