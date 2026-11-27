import { NoahButtonComponent, NoahDatePickerComponent, NoahFieldComponent, NoahInputDirective, NoahPageHeadingComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SelectFieldComponent } from '../../shared/select-field/select-field.component';
import { TableComponent } from '../../shared/table/table.component';
import { HrmScreen } from '../hrm-screen';
import { EmployeeCreateDialogComponent } from './employee-create-dialog.component';
import { EmployeeRestoreDialogComponent } from './employee-restore-dialog.component';

@Component({
  selector: 'app-employees',
  standalone: true,
  imports: [NoahInputDirective, NoahPageHeadingComponent, NoahButtonComponent, NoahDatePickerComponent, NoahFieldComponent, ReactiveFormsModule, RouterLink, SelectFieldComponent, TableComponent, EmployeeCreateDialogComponent, EmployeeRestoreDialogComponent],
  templateUrl: './employees.component.html',
  styleUrl: '../../app.component.scss',
})
export class EmployeesComponent {
  readonly screen = inject(HrmScreen);
}
