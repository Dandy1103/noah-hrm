import { NoahButtonComponent, NoahDatePickerComponent, NoahDialogComponent, NoahInputComponent, NoahSelectComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { EmployeeScreen } from '../employee-screen';

@Component({
  selector: 'app-employee-dialog',
  standalone: true,
  imports: [NoahButtonComponent, NoahDatePickerComponent, NoahDialogComponent, NoahInputComponent, NoahSelectComponent, ReactiveFormsModule],
  templateUrl: './employee-dialog.component.html',
  styleUrl: '../../../app.component.scss',
})
export class EmployeeDialogComponent {
  readonly screen = inject(EmployeeScreen);
}
