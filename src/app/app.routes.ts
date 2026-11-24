import { Routes } from '@angular/router';
import { requireSession } from './require-session';
import { HrmSectionComponent } from './hrm-section.component';

const screen = { component: HrmSectionComponent };
const dutyRoutes = ['attendance', 'leave', 'overtime', 'trip'].flatMap((kind) => [
  { path: `${kind}/new`, ...screen },
  { path: `${kind}/:recordId/edit`, ...screen },
  { path: kind, ...screen },
]);

export const routes: Routes = [
  { path: '', canActivate: [requireSession], children: [
  { path: '', pathMatch: 'full', redirectTo: 'employees' },
  { path: 'employees/new', ...screen },
  { path: 'employees/:employeeNumber/edit', ...screen },
  { path: 'employees/:employeeNumber', ...screen },
  { path: 'employees', ...screen },
  { path: 'organization/new', ...screen },
  { path: 'organization/:departmentId/edit', ...screen },
  { path: 'organization', ...screen },
  ...dutyRoutes,
  { path: '**', redirectTo: 'employees' },
  ]},
];
