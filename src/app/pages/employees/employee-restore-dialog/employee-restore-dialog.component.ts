import { NoahButtonComponent, NoahDialogComponent, NoahInputComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { EmployeeScreen } from '../employee-screen';

@Component({
  selector: 'app-employee-restore-dialog',
  standalone: true,
  imports: [NoahButtonComponent, NoahDialogComponent, NoahInputComponent, ReactiveFormsModule],
  templateUrl: './employee-restore-dialog.component.html',
  styleUrl: '../../../app.component.scss',
})
export class EmployeeRestoreDialogComponent {
  readonly screen = inject(EmployeeScreen);
}
