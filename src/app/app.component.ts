import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Observable, catchError, debounceTime, filter, finalize, forkJoin, of } from 'rxjs';
import { DutyBoardComponent } from './features/duty/duty-board.component';
import type { DutyKind } from './features/duty/duty-board.component';
import { HeaderComponent } from './layout/header/header.component';
import { NavbarComponent } from './layout/navbar/navbar.component';
import { ButtonComponent } from './shared/button/button.component';
import { DateFieldComponent } from './shared/date-field/date-field.component';
import { FieldComponent } from './shared/field/field.component';
import { TableComponent } from './shared/table/table.component';

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

interface CrumbStep {
  label: string;
  go?: 'employees' | 'organization' | 'person' | DutyKind;
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

interface DutySnippet {
  employeeNumber: string;
  workDate: string | null;
  clockIn: string | null;
  clockOut: string | null;
  note: string | null;
  leaveType: string | null;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
  place: string | null;
}

interface RecentLine {
  kind: string;
  when: string;
  detail: string;
}

type HrmSection = 'employees' | 'organization' | DutyKind;

interface HrmScreen {
  section: HrmSection;
  view: 'list' | 'new' | 'edit' | 'person';
  id: string | null;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgTemplateOutlet, ReactiveFormsModule, HeaderComponent, NavbarComponent, DutyBoardComponent, ButtonComponent, DateFieldComponent, FieldComponent, TableComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  private readonly accountsUrl = '/api/hrm/accounts';
  private readonly departmentsUrl = '/api/hrm/departments';
  readonly jobTitles = ['總經理', '特助', '人資主管', '人資專員', '人資', '工程師', '產品經理', '業務', '行銷', '財務', '會計', '客服', '行政'];
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
  readonly portalHomeUrl = this.mountedInPortal
    ? '/'
    : ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
      ? 'http://localhost:4200/'
      : 'https://noahportal.dandy-cheng.com/';
  private readonly loginParams = new URLSearchParams(location.search);
  readonly signInError = this.loginParams.get('authError');
  readonly signedOut = this.loginParams.get('signedOut') === '1';
  readonly loginUrl = '/auth/login?' + new URLSearchParams({
    next: this.signInError || this.signedOut ? this.loginParams.get('next') ?? '/' : location.pathname + location.search,
  });
  readonly access = signal<'loading' | 'allowed' | 'signed-out' | 'denied' | 'unavailable'>('loading');
  readonly displayName = signal('');
  readonly accessError = signal('請稍後重新整理。');
  readonly section = signal(this.sectionFromLocation());
  readonly dutyEditing = signal(false);
  readonly dutyView = signal<'list' | 'new' | 'edit'>('list');
  readonly dutyRecordId = signal<string | null>(null);
  readonly dutyCount = signal<number | null>(null);
  private readonly openedAccount = signal<EmployeeAccount | null>(null);
  private routeStamp = '';
  readonly dutyListTick = signal(0);
  readonly dutyKind = computed((): DutyKind | null => {
    const section = this.section();
    if (section === 'attendance' || section === 'leave' || section === 'overtime' || section === 'trip') return section;
    return null;
  });
  readonly selectedNumber = signal<string | null>(null);
  readonly reports = signal<EmployeeAccount[]>([]);
  readonly recent = signal<RecentLine[]>([]);
  readonly personLoading = signal(false);
  private personLoad = 0;
  private toastTimer = 0;
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
  readonly departmentFilter = this.formBuilder.control('');
  readonly titleFilter = this.formBuilder.control('');
  private readonly seenTitles = signal<string[]>([]);
  private listLoad = 0;
  readonly offset = signal(0);
  readonly pageSize = signal(10);
  readonly hasMore = signal(false);
  private appliedQuery = '';
  private filteredAccounts: EmployeeAccount[] | null = null;
  readonly rosterSummary = computed(() => {
    const people = this.people();
    if (people.length === 0) return '';
    const inactive = people.filter((person) => person.status === 'inactive').length;
    if (inactive === 0) return `${people.length} 人`;
    return `${people.length} 人，${inactive} 人已停用`;
  });
  readonly organizationRows = computed(() => this.buildOrganizationRows());
  readonly trail = computed((): CrumbStep[] => {
    const section = this.section();
    const editor = this.editor();
    const departmentEditor = this.departmentEditor();
    const selectedNumber = this.selectedNumber();
    const account = selectedNumber
      ? this.accounts().find((item) => item.employeeNumber === selectedNumber) ?? null
      : null;
    if (section === 'attendance' || section === 'leave' || section === 'overtime' || section === 'trip') {
      const label = this.dutyLabel(section);
      if (this.dutyEditing()) return [{ label, go: section }, { label: '登記' }];
      return [{ label }];
    }
    if (section === 'organization') {
      if (departmentEditor === 'create') return [{ label: '組織', go: 'organization' }, { label: '新增部門' }];
      if (departmentEditor) return [{ label: '組織', go: 'organization' }, { label: '修改部門' }];
      return [{ label: '組織' }];
    }
    if (editor === 'create') return [{ label: '員工', go: 'employees' }, { label: '新增員工' }];
    if (editor) return [{ label: '員工', go: 'employees' }, { label: editor.displayName, go: 'person' }, { label: '修改' }];
    if (account) return [{ label: '員工', go: 'employees' }, { label: account.displayName }];
    if (selectedNumber) return [{ label: '員工', go: 'employees' }, { label: '員工資料' }];
    return [{ label: '員工' }];
  });

  readonly form = this.formBuilder.group({
    nationalId: ['', Validators.pattern(/^[a-z][12][0-9]{8}$/i)],
    employeeNumber: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/i)]],
    displayName: ['', [Validators.required, Validators.maxLength(100)]],
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
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.followRoute());
    this.openCanonicalUrl();
    if (this.pathSection() && !new URLSearchParams(location.search).has('section')) this.followRoute();
    this.departmentFilter.valueChanges.subscribe(() => this.loadAccounts(0));
    this.titleFilter.valueChanges.subscribe(() => this.loadAccounts(0));
    this.query.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.appliedQuery = this.query.value.trim();
      this.loadAccounts(0);
    });
    this.http.get('/api/hrm/access').subscribe({
      next: () => {
        this.access.set('allowed');
        this.loadDisplayName();
        this.loadAccounts(this.pageOffset());
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
    this.http.get<{ displayName: string }>('/api/me/employee').subscribe({
      next: (employee) => this.displayName.set(employee.displayName),
      error: () => {
        this.http.get<{ displayName: string }>('/api/session').subscribe({
          next: (user) => this.displayName.set(user.displayName),
          error: () => this.displayName.set(''),
        });
      },
    });
  }

  titleFilterChoices(): string[] {
    const titles = new Set<string>(this.jobTitles);
    for (const title of this.seenTitles()) titles.add(title);
    const selected = this.titleFilter.value.trim();
    if (selected) titles.add(selected);
    return [...titles];
  }

  loadAccounts(offset = 0) {
    if (this.departmentFilter.value || this.titleFilter.value) {
      if (offset > 0 && this.filteredAccounts) {
        this.showAccountPage(this.filteredAccounts, offset);
        return;
      }
      this.loadFilteredAccounts();
      return;
    }
    this.filteredAccounts = null;
    this.fetchAccountPage(offset, (page) => {
      const size = this.pageSize();
      this.accounts.set(page.accounts.slice(0, size));
      this.hasMore.set(page.accounts.length > size || page.hasMore);
      this.offset.set(offset);
      this.rememberPage(offset);
      this.rememberTitles(page.accounts);
    });
  }

  private loadFilteredAccounts() {
    const load = ++this.listLoad;
    this.loading.set(true);
    this.listError.set('');
    const found: EmployeeAccount[] = [];
    const pull = (offset: number) => {
      this.http.get<AccountPage>(this.accountsUrl, { params: { q: this.appliedQuery, offset } }).subscribe({
        next: (page) => {
          if (load !== this.listLoad) return;
          found.push(...page.accounts);
          this.rememberTitles(page.accounts);
          if (page.hasMore && offset < page.pageSize * 4) {
            pull(offset + page.pageSize);
            return;
          }
          this.filteredAccounts = this.matchFilters(found);
          this.showAccountPage(this.filteredAccounts, 0);
          this.loading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          if (load !== this.listLoad) return;
          this.loading.set(false);
          this.failAccounts(error);
        },
      });
    };
    pull(0);
  }

  private fetchAccountPage(offset: number, apply: (page: AccountPage) => void) {
    const load = ++this.listLoad;
    this.loading.set(true);
    this.listError.set('');
    this.http.get<AccountPage>(this.accountsUrl, { params: { q: this.appliedQuery, offset } })
      .pipe(finalize(() => {
        if (load === this.listLoad) this.loading.set(false);
      }))
      .subscribe({
        next: (page) => {
          if (load !== this.listLoad) return;
          apply(page);
        },
        error: (error: HttpErrorResponse) => {
          if (load !== this.listLoad) return;
          this.failAccounts(error);
        },
      });
  }

  private showAccountPage(rows: EmployeeAccount[], offset: number) {
    const size = this.pageSize();
    this.accounts.set(rows.slice(offset, offset + size));
    this.hasMore.set(offset + size < rows.length);
    this.offset.set(offset);
    this.rememberPage(offset);
  }

  private matchFilters(accounts: EmployeeAccount[]): EmployeeAccount[] {
    const departmentId = this.departmentFilter.value;
    const title = this.titleFilter.value;
    return accounts.filter((account) => {
      if (departmentId && String(account.departmentId ?? '') !== departmentId) return false;
      if (title && (account.jobTitle ?? '') !== title) return false;
      return true;
    });
  }

  private rememberTitles(accounts: EmployeeAccount[]) {
    const titles = new Set(this.seenTitles());
    for (const account of accounts) {
      const title = account.jobTitle?.trim();
      if (title) titles.add(title);
    }
    this.seenTitles.set([...titles]);
  }

  private failAccounts(error: HttpErrorResponse) {
    if (error.status === 401) this.signIn();
    const message = error.status === 404
      ? '找不到帳號管理服務，請確認 HRM 後端是否已啟動。'
      : '無法讀取帳號，請稍後再試。';
    this.listError.set(message);
  }

  loadDepartments() {
    this.departmentLoading.set(true);
    this.departmentListError.set('');
    this.http.get<Department[]>(this.departmentsUrl)
      .pipe(finalize(() => this.departmentLoading.set(false)))
      .subscribe({
        next: (departments) => {
          this.departments.set(departments);
          const screen = this.screenFromLocation();
          if (screen.section === 'organization' && screen.view === 'edit' && !this.departmentEditor()) {
            this.routeStamp = '';
            this.followRoute();
          }
        },
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

  private isSection(value: string | null): value is HrmSection {
    return value === 'employees' || value === 'organization' || value === 'attendance' || value === 'leave' || value === 'overtime' || value === 'trip';
  }

  private sectionFromLocation(): HrmSection {
    const fromPath = this.pathSection();
    if (fromPath) return fromPath;
    const legacy = new URLSearchParams(location.search).get('section');
    if (this.isSection(legacy)) return legacy;
    return 'employees';
  }

  private pathSection(): HrmSection | null {
    const base = new URL(document.baseURI).pathname.replace(/\/+$/, '');
    const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
    const name = path.split('/').filter(Boolean)[0] ?? '';
    return this.isSection(name) ? name : null;
  }

  private openCanonicalUrl() {
    const legacy = new URLSearchParams(location.search).has('section');
    if (this.pathSection() && !legacy) return;
    this.rememberSection(this.section());
  }

  private screenFromLocation(): HrmScreen {
    const [head, second, third] = this.pathParts();
    if (!this.isSection(head)) return { section: 'employees', view: 'list', id: null };
    if (!second) return { section: head, view: 'list', id: null };
    if (second === 'new') return { section: head, view: 'new', id: null };
    if (third === 'edit') return { section: head, view: 'edit', id: second };
    if (head === 'employees') return { section: head, view: 'person', id: second };
    return { section: head, view: 'list', id: null };
  }

  private pathParts(): string[] {
    const base = new URL(document.baseURI).pathname.replace(/\/+$/, '');
    const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
    return path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  }

  private followRoute() {
    const screen = this.screenFromLocation();
    const stamp = `${screen.section}/${screen.view}/${screen.id ?? ''}`;
    if (stamp === this.routeStamp) return;
    this.routeStamp = stamp;
    if (screen.section !== this.section()) {
      this.dutyCount.set(null);
      this.applySection(screen.section);
    }
    this.showScreen(screen);
  }

  private showScreen(screen: HrmScreen) {
    const duty = screen.section === 'attendance' || screen.section === 'leave' || screen.section === 'overtime' || screen.section === 'trip';
    this.dutyView.set(duty && (screen.view === 'new' || screen.view === 'edit') ? screen.view : 'list');
    this.dutyRecordId.set(duty && screen.view === 'edit' ? screen.id : null);
    if (!duty) this.dutyCount.set(null);
    if (screen.section === 'employees') {
      this.resetDepartmentEditor();
      this.showEmployeeScreen(screen);
      return;
    }
    if (screen.section === 'organization') {
      this.resetEmployeeEditor();
      this.clearPerson();
      this.showOrganizationScreen(screen);
      return;
    }
    this.resetEmployeeEditor();
    this.clearPerson();
    this.resetDepartmentEditor();
  }

  private showEmployeeScreen(screen: HrmScreen) {
    if (screen.view === 'list') {
      this.resetEmployeeEditor();
      this.clearPerson();
      return;
    }
    if (screen.view === 'new') {
      this.clearPerson();
      if (this.editor() !== 'create') this.presentEmployeeEditor();
      return;
    }
    const number = screen.id ?? '';
    const known = this.accounts().find((account) => account.employeeNumber === number)
      ?? (this.openedAccount()?.employeeNumber === number ? this.openedAccount() : null);
    const open = (account: EmployeeAccount | null) => {
      if (this.routeStamp !== `${screen.section}/${screen.view}/${screen.id ?? ''}`) return;
      if (!account) {
        this.resetEmployeeEditor();
        this.openedAccount.set(null);
        this.selectedNumber.set(number);
        return;
      }
      this.openedAccount.set(account);
      if (screen.view === 'person') {
        this.resetEmployeeEditor();
        this.selectedNumber.set(number);
        this.loadPersonContext(number);
        return;
      }
      this.presentEmployeeEditor(account);
    };
    if (known) {
      open(known);
      return;
    }
    this.http.get<AccountPage>(this.accountsUrl, { params: { q: number, offset: 0 } }).subscribe({
      next: (page) => open(page.accounts.find((account) => account.employeeNumber === number) ?? null),
      error: () => open(null),
    });
  }

  private showOrganizationScreen(screen: HrmScreen) {
    if (screen.view === 'list') {
      this.resetDepartmentEditor();
      return;
    }
    if (screen.view === 'new') {
      if (this.departmentEditor() !== 'create') this.presentDepartmentEditor();
      return;
    }
    const department = this.departments().find((item) => String(item.departmentId) === screen.id);
    if (!department) {
      this.resetDepartmentEditor();
      return;
    }
    const current = this.departmentEditor();
    if (current && current !== 'create' && current.departmentId === department.departmentId) return;
    this.presentDepartmentEditor(department);
  }

  private resetEmployeeEditor() {
    this.form.reset();
    this.editor.set(null);
    this.error.set('');
  }

  private resetDepartmentEditor() {
    this.departmentForm.reset();
    this.departmentEditor.set(null);
    this.deleteDepartmentTarget.set(null);
    this.error.set('');
  }

  private clearPerson() {
    this.personLoad += 1;
    this.selectedNumber.set(null);
    this.openedAccount.set(null);
    this.reports.set([]);
    this.recent.set([]);
    this.personLoading.set(false);
  }

  private applySection(section: HrmSection) {
    this.selectedNumber.set(null);
    this.openedAccount.set(null);
    this.resetEmployeeEditor();
    this.disableTarget.set(null);
    this.resetDepartmentEditor();
    if (section === 'attendance' || section === 'leave' || section === 'overtime' || section === 'trip') {
      this.dutyListTick.update((value) => value + 1);
    }
    this.section.set(section);
  }

  showEmployees() {
    this.applySection('employees');
    this.rememberSection('employees');
  }

  showOrganization() {
    this.applySection('organization');
    this.rememberSection('organization');
  }

  openedDuty(): DutyKind {
    return this.dutyKind() ?? 'attendance';
  }

  dutyLabel(section: DutyKind): string {
    if (section === 'leave') return '請假';
    if (section === 'overtime') return '加班';
    if (section === 'trip') return '出差';
    return '出勤';
  }

  dutyPageTitle(section: DutyKind): string {
    if (section === 'attendance') return '出勤紀錄';
    return this.dutyLabel(section);
  }

  showDuty(section: DutyKind) {
    this.applySection(section);
    this.rememberSection(section);
  }

  followCrumb(step: CrumbStep['go']): void {
    if (step === 'employees') this.showEmployees();
    else if (step === 'organization') this.showOrganization();
    else if (step === 'person') this.closeEditor();
    else if (step === 'attendance' || step === 'leave' || step === 'overtime' || step === 'trip') this.showDuty(step);
  }

  private pageOffset(): number {
    const page = Number(new URLSearchParams(location.search).get('page'));
    if (!Number.isInteger(page) || page < 2) return 0;
    return (page - 1) * this.pageSize();
  }

  private pageParams(): { page: number | null } {
    const page = Number(new URLSearchParams(location.search).get('page'));
    if (!Number.isInteger(page) || page < 2) return { page: null };
    return { page };
  }

  private rememberPage(offset: number) {
    const page = Math.floor(offset / this.pageSize()) + 1;
    this.router.navigate([], {
      queryParams: { page: page < 2 ? null : page },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private rememberSection(section: HrmSection) {
    const page = section === 'employees' ? this.pageParams().page : null;
    this.router.navigate(['/', section], {
      queryParams: { page, section: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  openPerson(account: EmployeeAccount) {
    this.router.navigate(['/employees', account.employeeNumber]);
  }

  closePerson() {
    this.router.navigate(['/employees'], { queryParamsHandling: 'merge', queryParams: { section: null } });
  }

  private loadPersonContext(number: string) {
    const load = ++this.personLoad;
    this.reports.set([]);
    this.recent.set([]);
    this.personLoading.set(true);
    let pending = 2;
    const finish = () => {
      pending -= 1;
      if (pending === 0 && load === this.personLoad) this.personLoading.set(false);
    };
    this.collectReports(number, load, 0, [], finish);
    forkJoin({
      attendance: this.dutyRows('/api/hrm/attendance'),
      leave: this.dutyRows('/api/hrm/leave'),
      overtime: this.dutyRows('/api/hrm/overtime'),
      trips: this.dutyRows('/api/hrm/trips'),
    }).subscribe((groups) => {
      if (load === this.personLoad) this.recent.set(this.buildRecent(number, groups));
      finish();
    });
  }

  private collectReports(number: string, load: number, offset: number, found: EmployeeAccount[], finish: () => void) {
    this.http.get<AccountPage>(this.accountsUrl, { params: { q: '', offset } }).subscribe({
      next: (page) => {
        if (load !== this.personLoad) return;
        const next = found.concat(page.accounts.filter((account) => account.managerEmployeeNumber === number));
        if (page.hasMore && offset < page.pageSize * 4) {
          this.collectReports(number, load, offset + page.pageSize, next, finish);
          return;
        }
        this.reports.set(next);
        finish();
      },
      error: () => {
        if (load !== this.personLoad) return;
        this.reports.set(found);
        finish();
      },
    });
  }

  private dutyRows(path: string) {
    return this.http.get<DutySnippet[]>(path).pipe(catchError(() => of([] as DutySnippet[])));
  }

  private buildRecent(number: string, groups: { attendance: DutySnippet[]; leave: DutySnippet[]; overtime: DutySnippet[]; trips: DutySnippet[] }): RecentLine[] {
    const lines: { sort: string; kind: string; when: string; detail: string }[] = [];
    for (const row of groups.attendance) {
      if (row.employeeNumber !== number) continue;
      lines.push({ sort: row.workDate ?? '', kind: '出勤', when: this.formatDate(row.workDate), detail: this.clockDetail(row) });
    }
    for (const row of groups.leave) {
      if (row.employeeNumber !== number) continue;
      lines.push({
        sort: row.startsOn ?? '',
        kind: '請假',
        when: this.rangeLabel(row.startsOn, row.endsOn),
        detail: this.joinDetail(this.leaveName(row.leaveType), row.note),
      });
    }
    for (const row of groups.overtime) {
      if (row.employeeNumber !== number) continue;
      const span = row.startsAt && row.endsAt ? `${row.startsAt}–${row.endsAt}` : '';
      lines.push({ sort: row.workDate ?? '', kind: '加班', when: this.formatDate(row.workDate), detail: this.joinDetail(span, row.reason) });
    }
    for (const row of groups.trips) {
      if (row.employeeNumber !== number) continue;
      lines.push({ sort: row.startsOn ?? '', kind: '出差', when: this.rangeLabel(row.startsOn, row.endsOn), detail: this.joinDetail(row.place, row.reason) });
    }
    lines.sort((left, right) => right.sort.localeCompare(left.sort));
    return lines.slice(0, 8).map((line) => ({ kind: line.kind, when: line.when, detail: line.detail }));
  }

  private clockDetail(row: DutySnippet): string {
    const parts: string[] = [];
    if (row.clockIn) parts.push(`上班 ${row.clockIn}`);
    if (row.clockOut) parts.push(`下班 ${row.clockOut}`);
    if (row.note) parts.push(row.note);
    return parts.join('，') || '—';
  }

  private rangeLabel(start: string | null, end: string | null): string {
    const from = this.formatDate(start);
    const to = this.formatDate(end);
    if (from === '—' ) return to;
    if (to === '—' || from === to) return from;
    return `${from}–${to}`;
  }

  private joinDetail(leading: string | null, trailing: string | null): string {
    const parts = [leading?.trim() ?? '', trailing?.trim() ?? ''].filter((part) => part.length > 0);
    return parts.join('，') || '—';
  }

  private leaveName(value: string | null): string {
    const names: Record<string, string> = {
      annual: '特休',
      sick: '病假',
      personal: '事假',
      menstrual: '生理假',
      bereavement: '喪假',
      marriage: '婚假',
      official: '公假',
    };
    if (!value) return '';
    return names[value] ?? value;
  }

  private refreshOpenedAccount() {
    const number = this.selectedNumber();
    if (!number) return;
    this.http.get<AccountPage>(this.accountsUrl, { params: { q: number, offset: 0 } }).subscribe({
      next: (page) => {
        const account = page.accounts.find((item) => item.employeeNumber === number);
        if (account && this.selectedNumber() === number) this.openedAccount.set(account);
      },
    });
  }

  selectedAccount(): EmployeeAccount | null {
    const number = this.selectedNumber();
    if (!number) return null;
    const listed = this.accounts().find((account) => account.employeeNumber === number);
    if (listed) return listed;
    const opened = this.openedAccount();
    return opened?.employeeNumber === number ? opened : null;
  }

  personDepartment(account: EmployeeAccount): Department | null {
    if (account.departmentId == null) return null;
    return this.departments().find((item) => item.departmentId === account.departmentId) ?? null;
  }

  ageLabel(value: string | null): string {
    if (!value) return '';
    const born = new Date(`${value}T00:00:00`);
    if (Number.isNaN(born.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - born.getFullYear();
    const month = today.getMonth() - born.getMonth();
    if (month < 0 || (month === 0 && today.getDate() < born.getDate())) age -= 1;
    if (age < 0) return '';
    return `${age} 歲`;
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
    if (account) this.router.navigate(['/employees', account.employeeNumber, 'edit']);
    else this.router.navigate(['/employees', 'new']);
  }

  private presentEmployeeEditor(account?: EmployeeAccount) {
    this.error.set('');
    this.message.set('');
    this.disableTarget.set(null);
    this.form.reset(account ? {
      employeeNumber: account.employeeNumber,
      displayName: account.displayName,
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
    if (account) this.selectedNumber.set(account.employeeNumber);
    this.editor.set(account ?? 'create');
  }

  closeEditor() {
    const editing = this.editor();
    if (editing && editing !== 'create') {
      this.router.navigate(['/employees', editing.employeeNumber]);
      return;
    }
    this.router.navigate(['/employees'], { queryParamsHandling: 'merge', queryParams: { section: null } });
  }

  openDepartmentEditor(department?: Department) {
    if (department) this.router.navigate(['/organization', department.departmentId, 'edit']);
    else this.router.navigate(['/organization', 'new']);
  }

  private presentDepartmentEditor(department?: Department) {
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
    this.router.navigate(['/organization']);
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
      displayName: raw.displayName,
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
      this.mutate(this.http.post(this.accountsUrl, { ...profile, employeeNumber, nationalId, initialPassword }), '已新增員工。', true, {}, true);
    } else {
      this.mutate(this.http.patch(this.accountUrl(editor), { ...profile, nationalId }), '已儲存員工資料。', false, {}, true);
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

  reloadPage(): void {
    location.reload();
  }

  private signIn() {
    if (this.signInError || this.signedOut) this.access.set('signed-out');
    else location.replace(this.loginUrl);
  }

  jobTitleChoices(): string[] {
    const current = this.form.controls.jobTitle.value?.trim() ?? '';
    if (current && !this.jobTitles.includes(current)) return [current, ...this.jobTitles];
    return this.jobTitles;
  }

  personName(account: Pick<EmployeeAccount, 'firstName' | 'lastName'>): string {
    const last = account.lastName?.trim() ?? '';
    const first = account.firstName?.trim() ?? '';
    const combined = `${last}${first}`;
    if (!combined) return '—';
    return /[\u4e00-\u9fff]/.test(combined) ? combined : `${first} ${last}`.trim();
  }

  displayNote(account: Pick<EmployeeAccount, 'firstName' | 'lastName' | 'displayName'>): string {
    const display = account.displayName?.trim() ?? '';
    if (!display || display === this.personName(account)) return '';
    return display;
  }

  private accountUrl(account: EmployeeAccount) {
    return this.accountsUrl + '/' + encodeURIComponent(account.employeeNumber);
  }

  private showToast(text: string) {
    window.clearTimeout(this.toastTimer);
    this.message.set(text);
    this.toastTimer = window.setTimeout(() => this.message.set(''), 3200);
  }

  private mutate(request: Observable<unknown>, success: string, resetSearch = false, failures: Record<number, string> = {}, backToList = false) {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        const place = this.screenFromLocation();
        this.form.reset();
        this.editor.set(null);
        this.departmentForm.reset();
        this.departmentEditor.set(null);
        this.disableTarget.set(null);
        if (backToList) {
          this.personLoad += 1;
          this.selectedNumber.set(null);
          this.openedAccount.set(null);
          this.reports.set([]);
          this.recent.set([]);
        }
        this.showToast(success);
        if (backToList) {
          this.router.navigate(['/employees'], {
            queryParamsHandling: 'merge',
            queryParams: { section: null, page: resetSearch ? null : this.pageParams().page },
          });
        } else if (place.section === 'organization' && place.view !== 'list') {
          this.router.navigate(['/organization']);
        }
        if (resetSearch) {
          this.query.reset('', { emitEvent: false });
          this.departmentFilter.setValue('', { emitEvent: false });
          this.titleFilter.setValue('', { emitEvent: false });
          this.appliedQuery = '';
        }
        this.loadDisplayName();
        this.loadAccounts(resetSearch ? 0 : this.offset());
        this.loadDepartments();
        this.loadPeople();
        this.refreshOpenedAccount();
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
