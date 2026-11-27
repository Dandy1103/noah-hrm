import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { HrmAccess } from './core/hrm-access';
import { HrmDirectory } from './core/hrm-directory';
import { HRM_ROOT, hrmPageQuery, hrmPathSection, hrmScreenFromLocation, hrmSectionFromLocation, isDutySection } from './core/hrm-location';
import { EmployeeScreen } from './pages/employees/employee-screen';
import { DepartmentScreen } from './pages/organization/department-screen';

@Injectable({ providedIn: 'root' })
export class HrmRoute {
  private readonly router = inject(Router);
  private readonly access = inject(HrmAccess);
  private readonly directory = inject(HrmDirectory);
  private readonly employees = inject(EmployeeScreen);
  private readonly departments = inject(DepartmentScreen);
  private stamp = '';
  private section = hrmSectionFromLocation();

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.follow());
    this.openCanonicalUrl();
    if (hrmPathSection() && !new URLSearchParams(location.search).has('section')) this.follow();
    this.access.start(() => {
      this.stamp = '';
      this.follow();
      this.employees.loadInitial();
      if (this.access.canManage()) {
        this.directory.loadDepartments();
        this.directory.loadPeople();
      }
    });
  }

  private openCanonicalUrl() {
    const legacy = new URLSearchParams(location.search).has('section');
    if (hrmPathSection() && !legacy) return;
    const section = hrmSectionFromLocation();
    this.router.navigate([HRM_ROOT, section], {
      queryParams: { page: section === 'employees' ? hrmPageQuery() : null, section: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private follow() {
    const screen = hrmScreenFromLocation();
    const stamp = `${screen.section}/${screen.view}/${screen.id ?? ''}`;
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    if (screen.section !== this.section) {
      this.employees.leave();
      this.departments.leave();
      this.section = screen.section;
    }
    if (this.access.access() === 'allowed' && !this.access.canManage() && (screen.section !== 'employees' || screen.view !== 'list')) {
      this.router.navigate([HRM_ROOT, 'employees']);
      return;
    }
    if (isDutySection(screen.section)) return;
    if (screen.section === 'employees') {
      this.departments.leave();
      this.employees.show(screen, () => this.stamp === stamp);
      return;
    }
    this.employees.leave();
    this.departments.show(screen);
  }
}
