import type { NoahBreadcrumb, NoahSelectOption } from '@dandy1103/ui';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, finalize } from 'rxjs';
import { HrmAccess } from '../../core/hrm-access';
import { HrmDirectory } from '../../core/hrm-directory';
import type { Department } from '../../core/hrm-directory';
import { HRM_ROOT, hrmScreenFromLocation, type HrmView } from '../../core/hrm-location';

interface OrganizationRow {
  department: Department;
  depth: number;
}

@Injectable({ providedIn: 'root' })
export class DepartmentScreen {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  private readonly access = inject(HrmAccess);
  private readonly directory = inject(HrmDirectory);
  private toastTimer = 0;

  readonly peopleError = this.directory.peopleError;
  readonly departments = this.directory.departments;
  readonly departmentLoading = this.directory.departmentLoading;
  readonly departmentListError = this.directory.departmentListError;
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly departmentEditor = signal<'create' | Department | null>(null);
  readonly deleteDepartmentTarget = signal<Department | null>(null);
  readonly departmentForm = this.formBuilder.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    parentDepartmentId: [''],
    headEmployeeNumber: [''],
  });
  readonly organizationRows = computed(() => this.buildOrganizationRows());
  readonly breadcrumbs = computed<NoahBreadcrumb[]>(() => [
    { label: '首頁', href: '/portal' },
    { label: '人資管理', route: `${HRM_ROOT}/employees` },
    ...this.trail().map(({ label, go }) => ({
      label,
      route: go ? '/' + go : undefined,
    })),
  ]);

  private readonly trail = computed(() => {
    const editor = this.departmentEditor();
    if (editor === 'create') return [{ label: '組織', go: 'organization' }, { label: '新增部門', go: '' }];
    if (editor) return [{ label: '組織', go: 'organization' }, { label: '修改部門', go: '' }];
    return [{ label: '組織', go: '' }];
  });

  constructor() {
    this.directory.whenDepartmentsLoaded(() => this.openEditorFromRoute());
  }

  show(screen: HrmView): void {
    if (screen.view === 'list') {
      this.resetEditor();
      return;
    }
    if (screen.view === 'new') {
      if (this.departmentEditor() !== 'create') this.presentEditor();
      return;
    }
    const department = this.directory.departments().find((item) => String(item.departmentId) === screen.id);
    if (!department) {
      this.resetEditor();
      return;
    }
    const current = this.departmentEditor();
    if (current && current !== 'create' && current.departmentId === department.departmentId) return;
    this.presentEditor(department);
  }

  leave(): void {
    this.resetEditor();
    this.deleteDepartmentTarget.set(null);
  }

  parentDepartmentSelectOptions(): NoahSelectOption[] {
    return [
      { value: '', label: '無' },
      ...this.parentOptions().map((department) => ({ value: String(department.departmentId), label: department.name })),
    ];
  }

  departmentHeadSelectOptions(): NoahSelectOption[] {
    return [
      { value: '', label: '不指定' },
      ...this.directory.people().map((person) => ({
        value: person.employeeNumber,
        label: `${person.displayName}（${person.employeeNumber}）${person.status === 'inactive' ? '，已停用' : ''}`,
      })),
    ];
  }

  canDeleteDepartment(department: Department): boolean {
    const hasChild = this.directory.departments().some((item) => item.parentDepartmentId === department.departmentId);
    return department.employeeCount === 0 && !hasChild;
  }

  openDepartmentEditor(department?: Department): void {
    if (department) this.router.navigate([HRM_ROOT, 'organization', department.departmentId, 'edit']);
    else this.router.navigate([HRM_ROOT, 'organization', 'new']);
  }

  closeDepartmentEditor(): void {
    this.router.navigate([HRM_ROOT, 'organization']);
  }

  saveDepartment(): void {
    const editor = this.departmentEditor();
    if (!editor || this.departmentForm.invalid || this.saving()) return;
    const raw = this.departmentForm.getRawValue();
    const body = {
      name: raw.name,
      parentDepartmentId: raw.parentDepartmentId === '' ? null : Number(raw.parentDepartmentId),
      headEmployeeNumber: raw.headEmployeeNumber.trim() || null,
    };
    const request = editor === 'create'
      ? this.http.post('/api/hrm/departments', body)
      : this.http.patch('/api/hrm/departments/' + editor.departmentId, body);
    this.mutate(request, editor === 'create' ? '已新增部門。' : '已儲存部門。', {
      400: '部門無法儲存。請確認名稱，上層部門不要選到自己或下層，主管要選現有員工。',
      409: '已經有相同名稱的部門。',
    });
  }

  confirmDeleteDepartment(department: Department): void {
    this.closeDepartmentEditor();
    this.message.set('');
    this.deleteDepartmentTarget.set(department);
  }

  deleteDepartment(): void {
    const department = this.deleteDepartmentTarget();
    if (!department) return;
    this.mutate(this.http.delete('/api/hrm/departments/' + department.departmentId), '已刪除部門。', {
      409: '這個部門還有員工或下層部門，無法刪除。',
      404: '找不到這個部門，請重新整理。',
    });
  }

  private openEditorFromRoute() {
    const screen = hrmScreenFromLocation();
    if (screen.section !== 'organization' || screen.view !== 'edit' || this.departmentEditor()) return;
    const department = this.directory.departments().find((item) => String(item.departmentId) === screen.id);
    if (department) this.presentEditor(department);
  }

  private parentOptions(): Department[] {
    const editor = this.departmentEditor();
    if (editor === 'create' || editor === null) return this.directory.departments();
    return this.directory.departments().filter((item) => item.departmentId !== editor.departmentId);
  }

  private buildOrganizationRows(): OrganizationRow[] {
    const departments = this.directory.departments();
    const ids = new Set(departments.map((department) => department.departmentId));
    const byParent = new Map<number | null, Department[]>();
    for (const department of departments) {
      const parentId = department.parentDepartmentId != null && ids.has(department.parentDepartmentId)
        ? department.parentDepartmentId
        : null;
      const siblings = byParent.get(parentId) ?? [];
      siblings.push(department);
      byParent.set(parentId, siblings);
    }
    const rows: OrganizationRow[] = [];
    const seen = new Set<number>();
    const walk = (parentId: number | null, depth: number) => {
      for (const department of byParent.get(parentId) ?? []) {
        if (seen.has(department.departmentId)) continue;
        seen.add(department.departmentId);
        rows.push({ department, depth });
        walk(department.departmentId, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }

  private resetEditor() {
    this.departmentForm.reset();
    this.departmentEditor.set(null);
    this.error.set('');
  }

  private presentEditor(department?: Department) {
    this.error.set('');
    this.message.set('');
    this.deleteDepartmentTarget.set(null);
    this.departmentForm.reset(department ? {
      name: department.name,
      parentDepartmentId: department.parentDepartmentId == null ? '' : String(department.parentDepartmentId),
      headEmployeeNumber: department.headEmployeeNumber ?? '',
    } : {});
    this.departmentEditor.set(department ?? 'create');
  }

  private showToast(text: string) {
    window.clearTimeout(this.toastTimer);
    this.message.set(text);
    this.toastTimer = window.setTimeout(() => this.message.set(''), 3200);
  }

  private mutate(request: Observable<unknown>, success: string, failures: Record<number, string>) {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    const editing = hrmScreenFromLocation().view !== 'list';
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.departmentForm.reset();
        this.departmentEditor.set(null);
        this.deleteDepartmentTarget.set(null);
        this.showToast(success);
        if (editing) this.router.navigate([HRM_ROOT, 'organization']);
        this.access.loadDisplayName();
        this.directory.loadDepartments();
        this.directory.loadPeople();
        this.directory.reloadAccounts();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.access.signIn();
          return;
        }
        const messages: Record<number, string> = {
          400: '有欄位未填或格式不對。請檢查部門、職稱、到職日、生日、雇用型態和身分證字號。新增帳號時，密碼至少要 12 個字元。',
          403: '你沒有修改這個帳號的權限。',
          404: '找不到這個帳號，請重新整理清單。',
          409: '沒有存成。請確認員工編號、身分證字號或電子郵件沒有重複，而且還留著至少一位人資。',
          503: '目前無法排入帳號同步。請確認 Core 已設定 HRM_SYNC_ENCRYPTION_KEY 和 HRM Keycloak 管理憑證。',
          ...failures,
        };
        this.error.set(messages[error.status] ?? '更新失敗，請稍後再試。');
      },
    });
  }
}
