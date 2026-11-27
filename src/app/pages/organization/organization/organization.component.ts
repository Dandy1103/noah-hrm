import { NoahButtonComponent, NoahInputComponent, NoahPageHeadingComponent, NoahSelectComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { TableComponent } from '../../../shared/table/table.component';
import { DepartmentScreen } from '../department-screen';

@Component({
  selector: 'app-organization',
  standalone: true,
  imports: [NoahInputComponent, NoahPageHeadingComponent, NoahButtonComponent, NoahSelectComponent, ReactiveFormsModule, TableComponent],
  templateUrl: './organization.component.html',
  styleUrl: '../../../app.component.scss',
})
export class OrganizationComponent {
  readonly screen = inject(DepartmentScreen);
}
