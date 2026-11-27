import { NoahButtonComponent, NoahInputComponent, NoahPageHeadingComponent, NoahSelectComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableComponent } from '../../../shared/table/table.component';
import { EmployeeDialogComponent } from '../employee-dialog/employee-dialog.component';
import { EmployeeScreen } from '../employee-screen';
import { EmployeeRestoreDialogComponent } from '../employee-restore-dialog/employee-restore-dialog.component';

@Component({
  selector: 'app-employees',
  standalone: true,
  imports: [NoahInputComponent, NoahPageHeadingComponent, NoahButtonComponent, NoahSelectComponent, ReactiveFormsModule, RouterLink, TableComponent, EmployeeDialogComponent, EmployeeRestoreDialogComponent],
  templateUrl: './employees.component.html',
  styleUrl: '../../../app.component.scss',
})
export class EmployeesComponent {
  readonly screen = inject(EmployeeScreen);
}
