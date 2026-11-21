import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import {
  NoahButtonComponent,
  NoahFieldComponent,
  NoahTableComponent,
} from '@dandy1103/ui';
import { HeaderComponent } from './layout/header/header.component';

interface EmployeeAccount {
  employeeNumber: string;
  displayName: string;
  department: string;
  departmentId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  hiredOn: string | null;
  bornOn: string | null;
  employmentType: string | null;
  managerEmployeeNumber: string | null;
  managerName: string | null;
  role: 'admin' | 'manager' | 'employee';
  status: 'active' | 'inactive';
  managed: boolean;
  editable: boolean;
  self: boolean;
}

interface Department {
  departmentId: number;
  name: string;
  parentDepartmentId: number | null;
  parentName: string | null;
  headEmployeeNumber: string | null;
  headName: string | null;
  employeeCount: number;
}

interface PersonOption {
  employeeNumber: string;
  displayName: string;
  status: 'active' | 'inactive';
}

interface OrganizationRow {
  department: Department;
  depth: number;
}

interface AccountPage {
  accounts: EmployeeAccount[];
  hasMore: boolean;
  pageSize: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, HeaderComponent, NoahButtonComponent, NoahFieldComponent, NoahTableComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  private readonly accountsUrl = '/api/hrm/accounts';
  private readonly departmentsUrl = '/api/hrm/departments';
  readonly employmentTypes = [
    { value: 'regular', label: '正職' },
    { value: 'part_time', label: '部分工時' },
    { value: 'fixed_term', label: '定期契約' },
    { value: 'intern', label: '實習' },
  ];
  readonly roles = [
    { value: 'admin', label: '人資' },
    { value: 'manager', label: '主管' },
    { value: 'employee', label: '員工' },
  ];

  readonly mountedInPortal = new URL(document.baseURI).pathname === '/hrm/';
  private readonly loginParams = new URLSearchParams(location.search);
  readonly signInError = this.loginParams.get('authError');
  readonly signedOut = this.loginParams.get('signedOut') === '1';
  readonly loginUrl = '/auth/login?' + new URLSearchParams({
    next: this.signInError || this.signedOut ? this.loginParams.get('next') ?? '/' : location.pathname + location.search,
  });
  readonly changePasswordUrl = '/auth/change-password?' + new URLSearchParams({ next: location.pathname + location.search });
  readonly access = signal<'loading' | 'allowed' | 'signed-out' | 'denied' | 'unavailable'>('loading');
  readonly displayName = signal('');
  readonly accessError = signal('目前無法讀取權限，請稍後重新整理。');
  readonly section = signal<'employees' | 'organization' | 'attendance' | 'leave'>('employees');
  readonly selectedNumber = signal<string | null>(null);
  readonly accounts = signal<EmployeeAccount[]>([]);
  readonly departments = signal<Department[]>([]);
  readonly people = signal<PersonOption[]>([]);
  readonly departmentLoading = signal(false);
  readonly departmentListError = signal('');
  readonly peopleError = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly listError = signal('');
  readonly message = signal('');
  readonly error = signal('');
  readonly editor = signal<'create' | EmployeeAccount | null>(null);
  readonly disableTarget = signal<EmployeeAccount | null>(null);
  readonly departmentEditor = signal<'create' | Department | null>(null);
  readonly deleteDepartmentTarget = signal<Department | null>(null);
  readonly query = this.formBuilder.control('', [Validators.maxLength(100)]);
  readonly offset = signal(0);
  readonly pageSize = signal(30);
  readonly hasMore = signal(false);
  private appliedQuery = '';
  readonly rosterSummary = computed(() => {
    const people = this.people();
    if (people.length === 0) return '';
    const inactive = people.filter((person) => person.status === 'inactive').length;
    if (inactive === 0) return `${people.length} 人`;
    return `${people.length} 人，${inactive} 人已停用`;
  });
  readonly organizationRows = computed(() => this.buildOrganizationRows());

  readonly form = this.formBuilder.group({
    nationalId: ['', Validators.pattern(/^[a-z][12][0-9]{8}$/i)],
    employeeNumber: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/i)]],
    lastName: ['', [Validators.required, Validators.maxLength(48)]],
    firstName: ['', [Validators.required, Validators.maxLength(48)]],
    departmentId: ['', Validators.required],
    jobTitle: ['', [Validators.required, Validators.maxLength(100)]],
    hiredOn: ['', Validators.required],
    bornOn: ['', Validators.required],
    employmentType: ['', Validators.required],
    managerEmployeeNumber: ['', Validators.pattern(/^$|^[a-z0-9][a-z0-9_-]{0,31}$/i)],
    role: ['employee', Validators.required],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    initialPassword: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });
  readonly departmentForm = this.formBuilder.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    parentDepartmentId: [''],
    headEmployeeNumber: [''],
  });

  constructor() {
    this.http.get('/api/hrm/access').subscribe({
      next: () => {
        this.access.set('allowed');
        this.loadDisplayName();
        this.loadAccounts();
        this.loadDepartments();
        this.loadPeople();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.signIn();
          return;
        }
        if (error.status === 403) {
          this.access.set('denied');
          this.loadDisplayName();
          return;
        }
        this.access.set('unavailable');
      },
    });
  }

  private loadDisplayName() {
    this.http.get<{ displayName: string }>('/api/session').subscribe({
      next: (user) => this.displayName.set(user.displayName),
      error: () => this.displayName.set(''),
    });
  }

  loadAccounts(offset = 0) {
    this.loading.set(true);
    this.listError.set('');
    this.http.get<AccountPage>(this.accountsUrl, { params: { q: this.appliedQuery, offset } })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.accounts.set(page.accounts);
          this.pageSize.set(page.pageSize);
          this.hasMore.set(page.hasMore);
          this.offset.set(offset);
        },
        error: (error: HttpErrorResponse) => {
          if (error.status === 401) this.signIn();
          const message = error.status === 404
            ? '找不到帳號管理服務，請確認 HRM 後端是否已啟動。'
            : '無法讀取帳號，請稍後再試。';
          this.listError.set(message);
        }
      });
  }

  loadDepartments() {
    this.departmentLoading.set(true);
    this.departmentListError.set('');
    this.http.get<Department[]>(this.departmentsUrl)
      .pipe(finalize(() => this.departmentLoading.set(false)))
      .subscribe({
        next: (departments) => this.departments.set(departments),
        error: (error: HttpErrorResponse) => {
          if (error.status === 401) this.signIn();
          this.departmentListError.set('無法讀取部門，請稍後再試。');
        },
      });
  }

  loadPeople() {
    this.peopleError.set('');
    this.http.get<PersonOption[]>('/api/hrm/people').subscribe({
      next: (people) => this.people.set(people),
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) this.signIn();
        this.peopleError.set('無法讀取員工名單，主管選單可能不完整。');
      },
    });
  }

  showEmployees() {
    this.selectedNumber.set(null);
    this.closeEditor();
    this.disableTarget.set(null);
    this.closeDepartmentEditor();
    this.section.set('employees');
  }

  showOrganization() {
    this.selectedNumber.set(null);
    this.closeEditor();
    this.disableTarget.set(null);
    this.section.set('organization');
  }

  showLater(section: 'attendance' | 'leave') {
    this.selectedNumber.set(null);
    this.closeEditor();
    this.disableTarget.set(null);
    this.closeDepartmentEditor();
    this.section.set(section);
  }

  openPerson(account: EmployeeAccount) {
    this.closeEditor();
    this.disableTarget.set(null);
    this.message.set('');
    this.error.set('');
    this.selectedNumber.set(account.employeeNumber);
  }

  closePerson() {
    this.closeEditor();
    this.disableTarget.set(null);
    this.selectedNumber.set(null);
  }

  selectedAccount(): EmployeeAccount | null {
    const number = this.selectedNumber();
    if (!number) return null;
    return this.accounts().find((account) => account.employeeNumber === number) ?? null;
  }

  employmentLabel(value: string | null): string {
    return this.employmentTypes.find((item) => item.value === value)?.label ?? '—';
  }

  roleLabel(value: string | null): string {
    return this.roles.find((item) => item.value === value)?.label ?? '—';
  }

  formatDate(value: string | null): string {
    if (!value) return '—';
    const [year, month, day] = value.split('-');
    return year && month && day ? `${year}/${month}/${day}` : value;
  }

  tenureLabel(value: string | null): string {
    return serviceLength(value);
  }

  parentOptions(): Department[] {
    const editor = this.departmentEditor();
    if (editor === 'create' || editor === null) return this.departments();
    return this.departments().filter((item) => item.departmentId !== editor.departmentId);
  }

  managerOptions(): PersonOption[] {
    const editor = this.editor();
    const number = editor && editor !== 'create' ? editor.employeeNumber : '';
    return this.people().filter((person) => person.employeeNumber !== number);
  }

  canDeleteDepartment(department: Department): boolean {
    const hasChild = this.departments().some((item) => item.parentDepartmentId === department.departmentId);
    return department.employeeCount === 0 && !hasChild;
  }

  search() {
    if (this.loading() || this.query.invalid) return;
    this.appliedQuery = this.query.value.trim();
    this.loadAccounts();
  }

  openEditor(account?: EmployeeAccount) {
    this.error.set('');
    this.message.set('');
    this.disableTarget.set(null);
    this.form.reset(account ? {
      employeeNumber: account.employeeNumber,
      firstName: account.firstName ?? '',
      lastName: account.lastName ?? '',
      departmentId: account.departmentId == null ? '' : String(account.departmentId),
      jobTitle: account.jobTitle ?? '',
      hiredOn: account.hiredOn ?? '',
      bornOn: account.bornOn ?? '',
      employmentType: account.employmentType ?? '',
      managerEmployeeNumber: account.managerEmployeeNumber ?? '',
      role: account.role ?? 'employee',
      email: account.email ?? '',
    } : { role: 'employee' });
    for (const control of [this.form.controls.employeeNumber, this.form.controls.initialPassword]) {
      if (account) control.disable();
      else control.enable();
    }
    const nationalId = this.form.controls.nationalId;
    if (account) nationalId.removeValidators(Validators.required);
    else nationalId.addValidators(Validators.required);
    nationalId.updateValueAndValidity();
    this.editor.set(account ?? 'create');
  }

  closeEditor() {
    this.form.reset();
    this.editor.set(null);
    this.error.set('');
  }

  openDepartmentEditor(department?: Department) {
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

  closeDepartmentEditor() {
    this.departmentForm.reset();
    this.departmentEditor.set(null);
    this.deleteDepartmentTarget.set(null);
    this.error.set('');
  }

  saveDepartment() {
    const editor = this.departmentEditor();
    if (!editor || this.departmentForm.invalid || this.saving()) return;
    const raw = this.departmentForm.getRawValue();
    const body = {
      name: raw.name,
      parentDepartmentId: raw.parentDepartmentId === '' ? null : Number(raw.parentDepartmentId),
      headEmployeeNumber: raw.headEmployeeNumber.trim() || null,
    };
    const request = editor === 'create'
      ? this.http.post(this.departmentsUrl, body)
      : this.http.patch(this.departmentsUrl + '/' + editor.departmentId, body);
    this.mutate(request, editor === 'create' ? '已新增部門。' : '已儲存部門。', false, {
      400: '部門無法儲存。請確認名稱，上層部門不要選到自己或下層，主管要選現有員工。',
      409: '已經有相同名稱的部門。',
    });
  }

  confirmDeleteDepartment(department: Department) {
    this.closeDepartmentEditor();
    this.message.set('');
    this.deleteDepartmentTarget.set(department);
  }

  deleteDepartment() {
    const department = this.deleteDepartmentTarget();
    if (!department) return;
    this.mutate(this.http.delete(this.departmentsUrl + '/' + department.departmentId), '已刪除部門。', false, {
      409: '這個部門還有員工或下層部門，無法刪除。',
      404: '找不到這個部門，請重新整理。',
    });
  }

  save() {
    const editor = this.editor();
    if (!editor || this.form.invalid || this.saving()) return;
    const raw = this.form.getRawValue();
    const profile = {
      firstName: raw.firstName,
      lastName: raw.lastName,
      departmentId: Number(raw.departmentId),
      jobTitle: raw.jobTitle,
      hiredOn: raw.hiredOn,
      bornOn: raw.bornOn,
      employmentType: raw.employmentType,
      email: raw.email,
      managerEmployeeNumber: raw.managerEmployeeNumber.trim() || null,
      role: raw.role,
    };
    const { employeeNumber, nationalId, initialPassword } = raw;
    if (editor === 'create') {
      this.mutate(this.http.post(this.accountsUrl, { ...profile, employeeNumber, nationalId, initialPassword }), '已新增員工。', true);
    } else {
      this.mutate(this.http.patch(this.accountUrl(editor), { ...profile, nationalId }), '已儲存員工資料。');
    }
  }

  confirmDisable(account: EmployeeAccount) {
    this.closeEditor();
    this.message.set('');
    this.disableTarget.set(account);
  }

  disable() {
    const account = this.disableTarget();
    if (!account) return;
    this.mutate(this.http.delete(this.accountUrl(account)), '已停用。');
  }

  restore(account: EmployeeAccount) {
    this.mutate(this.http.post(this.accountUrl(account) + '/restore', null), '已恢復。');
  }

  private buildOrganizationRows(): OrganizationRow[] {
    const departments = this.departments();
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

  private signIn() {
    if (this.signInError || this.signedOut) this.access.set('signed-out');
    else location.replace(this.loginUrl);
  }

  private accountUrl(account: EmployeeAccount) {
    return this.accountsUrl + '/' + encodeURIComponent(account.employeeNumber);
  }

  private mutate(request: Observable<unknown>, success: string, resetSearch = false, failures: Record<number, string> = {}) {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.closeEditor();
        this.closeDepartmentEditor();
        this.disableTarget.set(null);
        this.message.set(success);
        if (resetSearch) {
          this.query.reset();
          this.appliedQuery = '';
        }
        this.loadAccounts(resetSearch ? 0 : this.offset());
        this.loadDepartments();
        this.loadPeople();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.closeEditor();
          this.disableTarget.set(null);
          this.signIn();
          return;
        }
        const messages: Record<number, string> = {
          400: '有欄位未填或格式不對。請檢查部門、職稱、到職日、生日、雇用型態和身分證字號。新增帳號時，密碼至少要 12 個字元。',
          403: '你沒有修改這個帳號的權限。',
          404: '找不到這個帳號，請重新整理清單。',
          409: '沒有存成。請確認員工編號、身分證字號或電子郵件沒有重複，而且還留著至少一位人資。',
          503: '目前無法寫入，請確認 HRM 的資料庫與 Keycloak 管理設定。',
          ...failures,
        };
        this.error.set(messages[error.status] ?? '更新失敗，請稍後再試。');
      }
    });
  }
}

function serviceLength(value: string | null): string {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return '';
  const today = new Date();
  let years = today.getFullYear() - year;
  let months = today.getMonth() + 1 - month;
  if (today.getDate() < day) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return '';
  if (years === 0 && months === 0) return '未滿 1 個月';
  if (years === 0) return `${months} 個月`;
  if (months === 0) return `${years} 年`;
  return `${years} 年 ${months} 個月`;
}
