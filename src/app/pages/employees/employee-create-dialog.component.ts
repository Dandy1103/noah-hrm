import { NoahButtonComponent, NoahDatePickerComponent, NoahDialogComponent, NoahFieldComponent, NoahInputDirective } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { SelectFieldComponent } from '../../shared/select-field/select-field.component';
import { HrmScreen } from '../hrm-screen';

@Component({
  selector: 'app-employee-create-dialog',
  standalone: true,
  imports: [NoahButtonComponent, NoahDatePickerComponent, NoahDialogComponent, NoahFieldComponent, NoahInputDirective, ReactiveFormsModule, SelectFieldComponent],
  templateUrl: './employee-create-dialog.component.html',
  styleUrl: '../../app.component.scss',
})
export class EmployeeCreateDialogComponent {
  readonly screen = inject(HrmScreen);
}
