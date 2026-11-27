import { NoahButtonComponent, NoahFieldComponent, NoahInputDirective, NoahPageHeadingComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { SelectFieldComponent } from '../../shared/select-field/select-field.component';
import { TableComponent } from '../../shared/table/table.component';
import { HrmScreen } from '../hrm-screen';

@Component({
  selector: 'app-organization',
  standalone: true,
  imports: [NoahInputDirective, NoahPageHeadingComponent, NoahButtonComponent, NoahFieldComponent, ReactiveFormsModule, SelectFieldComponent, TableComponent],
  templateUrl: './organization.component.html',
  styleUrl: '../../app.component.scss',
})
export class OrganizationComponent {
  readonly screen = inject(HrmScreen);
}
