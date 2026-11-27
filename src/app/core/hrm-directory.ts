import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { HrmAccess } from './hrm-access';

export interface Department {
  departmentId: number;
  name: string;
  parentDepartmentId: number | null;
  parentName: string | null;
  headEmployeeNumber: string | null;
  headName: string | null;
  employeeCount: number;
}

export interface PersonOption {
  employeeNumber: string;
  displayName: string;
  status: 'active' | 'inactive';
  departmentId: number | null;
}

@Injectable({ providedIn: 'root' })
export class HrmDirectory {
  private readonly http = inject(HttpClient);
  private readonly access = inject(HrmAccess);
  private readonly departmentLoaded: Array<() => void> = [];
  private accountReload: (() => void) | null = null;

  readonly departments = signal<Department[]>([]);
  readonly people = signal<PersonOption[]>([]);
  readonly departmentLoading = signal(false);
  readonly departmentListError = signal('');
  readonly peopleError = signal('');

  whenDepartmentsLoaded(listener: () => void): void {
    this.departmentLoaded.push(listener);
  }

  whenAccountsShouldReload(reload: () => void): void {
    this.accountReload = reload;
  }

  reloadAccounts(): void {
    this.accountReload?.();
  }

  loadDepartments(): void {
    this.departmentLoading.set(true);
    this.departmentListError.set('');
    this.http.get<Department[]>('/api/hrm/departments')
      .pipe(finalize(() => this.departmentLoading.set(false)))
      .subscribe({
        next: (departments) => {
          this.departments.set(departments);
          for (const listener of this.departmentLoaded) listener();
        },
        error: (error: HttpErrorResponse) => {
          if (error.status === 401) this.access.signIn();
          this.departmentListError.set('無法讀取部門，請稍後再試。');
        },
      });
  }

  loadPeople(): void {
    this.peopleError.set('');
    this.http.get<PersonOption[]>('/api/hrm/people').subscribe({
      next: (people) => this.people.set(people),
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) this.access.signIn();
        this.peopleError.set('無法讀取員工名單，主管選單可能不完整。');
      },
    });
  }
}
