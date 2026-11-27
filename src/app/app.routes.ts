import { Routes } from '@angular/router';
import { DutyPageComponent } from './pages/duty/duty-page.component';
import { EmployeesComponent } from './pages/employees/employees.component';
import { OrganizationComponent } from './pages/organization/organization.component';
import { requireSession } from './require-session';

const dutyRoutes = ['attendance', 'leave', 'overtime', 'trip'].flatMap((kind) => [
  { path: `${kind}/new`, component: DutyPageComponent },
  { path: `${kind}/:recordId/edit`, component: DutyPageComponent },
  { path: kind, component: DutyPageComponent },
]);

export const routes: Routes = [
  { path: '', canActivate: [requireSession], children: [
    { path: '', pathMatch: 'full', redirectTo: 'employees' },
    { path: 'employees/new', component: EmployeesComponent },
    { path: 'employees/:employeeNumber/edit', component: EmployeesComponent },
    { path: 'employees/:employeeNumber', component: EmployeesComponent },
    { path: 'employees', component: EmployeesComponent },
    { path: 'organization/new', component: OrganizationComponent },
    { path: 'organization/:departmentId/edit', component: OrganizationComponent },
    { path: 'organization', component: OrganizationComponent },
    ...dutyRoutes,
    { path: '**', redirectTo: 'employees' },
  ]},
];
