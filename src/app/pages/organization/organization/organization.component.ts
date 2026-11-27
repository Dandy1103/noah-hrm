import { NoahButtonComponent, NoahIconButtonComponent, NoahPageHeadingComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { TableComponent } from '../../../shared/table/table.component';
import { DepartmentDialogComponent } from '../department-dialog/department-dialog.component';
import { DepartmentScreen } from '../department-screen';

@Component({
  selector: 'app-organization',
  standalone: true,
  imports: [NoahPageHeadingComponent, NoahButtonComponent, NoahIconButtonComponent, TableComponent, DepartmentDialogComponent],
  templateUrl: './organization.component.html',
  styleUrl: '../../../app.component.scss',
})
export class OrganizationComponent {
  readonly screen = inject(DepartmentScreen);
}
