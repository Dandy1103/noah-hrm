import { NoahButtonComponent, NoahDialogComponent, NoahInputComponent, NoahSelectComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DepartmentScreen } from '../department-screen';

@Component({
  selector: 'app-department-dialog',
  standalone: true,
  imports: [NoahButtonComponent, NoahDialogComponent, NoahInputComponent, NoahSelectComponent, ReactiveFormsModule],
  templateUrl: './department-dialog.component.html',
  styleUrl: '../../../app.component.scss',
})
export class DepartmentDialogComponent {
  readonly screen = inject(DepartmentScreen);
}
