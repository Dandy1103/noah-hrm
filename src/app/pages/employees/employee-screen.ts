import type { NoahBreadcrumb, NoahSelectOption } from '@dandy1103/ui';
import { PAGE_SIZE } from '@dandy1103/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, catchError, debounceTime, finalize, forkJoin, of } from 'rxjs';
import { HrmAccess } from '../../core/hrm-access';
import { HrmDirectory } from '../../core/hrm-directory';
import type { Department } from '../../core/hrm-directory';
import { HRM_ROOT, hrmPageOffset, hrmPageQuery, hrmScreenFromLocation, type HrmView } from '../../core/hrm-location';

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
  identitySyncStatus?: 'pending' | 'synced' | 'failed' | 'unlinked' | 'disabled';
  identitySyncError?: string | null;
  managed: boolean;
  editable: boolean;
  self: boolean;
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

@Injectable({ providedIn: 'root' })
export class EmployeeScreen {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  private readonly access = inject(HrmAccess);
  private readonly directory = inject(HrmDirectory);
  private readonly accountsUrl = '/api/hrm/accounts';
  private readonly openedAccount = signal<EmployeeAccount | null>(null);
  private readonly seenTitles = signal<string[]>([]);
  private listLoad = 0;
  private personLoad = 0;
  private toastTimer = 0;
  private appliedQuery = '';
  private filteredAccounts: EmployeeAccount[] | null = null;

  readonly canManage = this.access.canManage;
  readonly peopleError = this.directory.peopleError;
  readonly jobTitles = [
    '總經理',
    '管理員',
    '業務部主管',
    '業務專員',
    '後端技術長',
    '後端工程師',
    '測試工程師',
    '資安長',
    '維運工程師',
    '前端技術長',
    '前端工程師',
    '人資部主管',
    '專案部主管',
    '專案經理（PM）',
    '設計部主管',
    'UI/UX 工程師',
  ];
  readonly employmentTypes = [
    { value: 'regular', label: '正職' },
    { value: 'part_time', label: '部分工時' },
    { value: 'fixed_term', label: '定期契約' },
    { value: 'intern', label: '實習' },
  ];
  readonly roles = [
    { value: 'admin', label: '管理員' },
    { value: 'manager', label: '主管' },
    { value: 'employee', label: '員工' },
  ];
  readonly accounts = signal<EmployeeAccount[]>([]);
  readonly reports = signal<EmployeeAccount[]>([]);
  readonly recent = signal<RecentLine[]>([]);
  readonly personLoading = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly listError = signal('');
  readonly message = signal('');
  readonly error = signal('');
  readonly editor = signal<'create' | EmployeeAccount | null>(null);
  readonly disableTarget = signal<EmployeeAccount | null>(null);
  readonly restoreTarget = signal<EmployeeAccount | null>(null);
  readonly selectedNumber = signal<string | null>(null);
  readonly nextEmployeeNumber = signal('');
  readonly nextEmployeeNumberError = signal(false);
  readonly offset = signal(0);
  readonly pageSize = signal(PAGE_SIZE);
  readonly hasMore = signal(false);
  readonly query = this.formBuilder.control('', [Validators.maxLength(100)]);
  readonly departmentFilter = this.formBuilder.control('');
  readonly titleFilter = this.formBuilder.control('');
  readonly form = this.formBuilder.group({
    nationalId: ['', Validators.pattern(/^[a-z][12][0-9]{8}$/i)],
    employeeNumber: ['', [Validators.pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/i)]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    departmentId: ['', Validators.required],
    jobTitle: ['', [Validators.required, Validators.maxLength(100)]],
    hiredOn: ['', Validators.required],
    bornOn: ['', Validators.required],
    employmentType: ['', Validators.required],
    managerEmployeeNumber: ['', Validators.pattern(/^$|^[a-z0-9][a-z0-9_-]{0,31}$/i)],
    role: ['employee', Validators.required],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
  });
  readonly restoreForm = this.formBuilder.group({
    nationalId: ['', [Validators.required, Validators.pattern(/^[a-z][12][0-9]{8}$/i)]],
    initialPassword: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });
  readonly breadcrumbs = computed<NoahBreadcrumb[]>(() => [
    { label: '首頁', href: '/portal' },
    { label: '人資管理', route: `${HRM_ROOT}/employees` },
    ...this.trail().map(({ label, go }) => ({
      label,
      route: go ? '/' + go : undefined,
    })),
  ]);

  private readonly trail = computed(() => {
    const selectedNumber = this.selectedNumber();
    const opened = this.openedAccount();
    const account = selectedNumber
      ? this.accounts().find((item) => item.employeeNumber === selectedNumber)
        ?? (opened?.employeeNumber === selectedNumber ? opened : null)
      : null;
    if (account && selectedNumber) return [{ label: '員工', go: 'employees' as const }, { label: account.displayName, go: undefined }];
    if (selectedNumber) return [{ label: '員工', go: 'employees' as const }, { label: '員工資料', go: undefined }];
    return [{ label: '員工', go: undefined }];
  });

  constructor() {
    this.directory.whenAccountsShouldReload(() => {
      this.loadAccounts(this.offset());
      this.refreshOpenedAccount();
    });
    this.departmentFilter.valueChanges.subscribe(() => this.loadAccounts(0));
    this.titleFilter.valueChanges.subscribe(() => this.loadAccounts(0));
    this.query.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.appliedQuery = this.query.value.trim();
      this.loadAccounts(0);
    });
  }

  loadInitial(): void {
    this.loadAccounts(hrmPageOffset(this.pageSize()));
  }

  show(screen: HrmView, current: () => boolean): void {
    if (screen.view === 'list') {
      this.resetEditor();
      this.clearPerson();
      return;
    }
    if (screen.view === 'new') {
      this.clearPerson();
      if (this.editor() !== 'create') this.presentEditor();
      return;
    }
    const number = screen.id ?? '';
    const known = this.accounts().find((account) => account.employeeNumber === number)
      ?? (this.openedAccount()?.employeeNumber === number ? this.openedAccount() : null);
    const open = (account: EmployeeAccount | null) => {
      if (!current()) return;
      if (!account) {
        this.resetEditor();
        this.openedAccount.set(null);
        this.selectedNumber.set(number);
        return;
      }
      this.openedAccount.set(account);
      if (screen.view === 'person') {
        this.resetEditor();
        this.selectedNumber.set(number);
        this.loadPersonContext(number);
        return;
      }
      this.presentEditor(account);
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

  leave(): void {
    this.resetEditor();
    this.clearPerson();
    this.disableTarget.set(null);
  }

  departmentSelectOptions(): NoahSelectOption[] {
    return this.directory.departments().map((department) => ({ value: String(department.departmentId), label: department.name }));
  }

  jobTitleSelectOptions(): NoahSelectOption[] {
    return this.jobTitleChoices().map((title) => ({ value: title, label: title }));
  }

  filteredTitleSelectOptions(): NoahSelectOption[] {
    return this.titleFilterChoices().map((title) => ({ value: title, label: title }));
  }

  managerSelectOptions(): NoahSelectOption[] {
    return [
      { value: '', label: '無' },
      ...this.managerOptions().map((person) => ({
        value: person.employeeNumber,
        label: `${person.displayName}（${person.employeeNumber}）${person.status === 'inactive' ? '，已停用' : ''}`,
      })),
    ];
  }

  loadAccounts(offset = 0): void {
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

  search(): void {
    if (this.loading() || this.query.invalid) return;
    this.appliedQuery = this.query.value.trim();
    this.loadAccounts();
  }

  personRoute(account: EmployeeAccount): string[] {
    return [HRM_ROOT, 'employees', account.employeeNumber];
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
    return this.directory.departments().find((item) => item.departmentId === account.departmentId) ?? null;
  }

  editingEmployee(): EmployeeAccount | null {
    const editor = this.editor();
    return editor && editor !== 'create' ? editor : null;
  }

  openEditor(account?: EmployeeAccount): void {
    if (account) {
      this.presentEditor(account);
      return;
    }
    this.router.navigate([HRM_ROOT, 'employees', 'new']);
  }

  closeEditor(): void {
    if (this.saving()) return;
    this.resetEditor();
    const screen = hrmScreenFromLocation();
    if (screen.view === 'new' || screen.view === 'edit') {
      this.router.navigate([HRM_ROOT, 'employees'], { queryParamsHandling: 'merge', queryParams: { section: null } });
    }
  }

  save(): void {
    const editor = this.editor();
    if (!editor || this.form.invalid || this.saving()) return;
    const raw = this.form.getRawValue();
    const profile = {
      displayName: raw.name?.trim(),
      firstName: null,
      lastName: null,
      departmentId: Number(raw.departmentId),
      jobTitle: raw.jobTitle,
      hiredOn: raw.hiredOn,
      bornOn: raw.bornOn,
      employmentType: raw.employmentType,
      email: raw.email,
      managerEmployeeNumber: raw.managerEmployeeNumber.trim() || null,
    };
    const { nationalId } = raw;
    if (editor === 'create') {
      this.mutate(this.http.post(this.accountsUrl, { ...profile, employeeNumber: this.nextEmployeeNumber(), nationalId }), '員工資料已新增；登入帳號正在背景建立。', true, {
        409: '員工編號已更新，請關閉後重新開啟新增員工表單。',
      }, true);
    } else {
      this.mutate(this.http.patch(this.accountUrl(editor), { ...profile, role: raw.role, nationalId }), '員工資料已儲存；登入帳號正在背景同步。', false, {}, true);
    }
  }

  confirmDisable(account: EmployeeAccount): void {
    this.closeEditor();
    this.message.set('');
    this.disableTarget.set(account);
  }

  disable(): void {
    const account = this.disableTarget();
    if (!account) return;
    this.mutate(this.http.delete(this.accountUrl(account)), '員工已停用；登入帳號正在停用。');
  }

  restore(account: EmployeeAccount): void {
    this.error.set('');
    this.message.set('');
    this.restoreForm.reset();
    this.restoreTarget.set(account);
  }

  confirmRestore(): void {
    const account = this.restoreTarget();
    if (!account || this.restoreForm.invalid) return;
    const { nationalId, initialPassword } = this.restoreForm.getRawValue();
    this.mutate(this.http.post(this.accountUrl(account) + '/restore', { nationalId, initialPassword }),
      '已送出恢復申請；登入帳號正在背景恢復。');
  }

  closeRestore(): void {
    if (this.saving()) return;
    this.restoreTarget.set(null);
    this.restoreForm.reset();
    this.error.set('');
  }

  syncStatus(account: EmployeeAccount): string {
    switch (account.identitySyncStatus) {
      case 'pending': return '登入身分處理中';
      case 'failed': return '登入身分處理失敗，系統會自動重試';
      case 'disabled': return '登入帳號已停用';
      case 'unlinked': return account.status === 'inactive' ? '登入帳號已移除' : '尚未連結登入帳號';
      default: return '登入身分已連結';
    }
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

  personName(account: Pick<EmployeeAccount, 'firstName' | 'lastName' | 'displayName'>): string {
    const last = account.lastName?.trim() ?? '';
    const first = account.firstName?.trim() ?? '';
    const combined = `${last}${first}`;
    if (!combined) return account.displayName?.trim() || '—';
    return /[\u4e00-\u9fff]/.test(combined) ? combined : `${first} ${last}`.trim();
  }

  displayNote(account: Pick<EmployeeAccount, 'firstName' | 'lastName' | 'displayName'>): string {
    const display = account.displayName?.trim() ?? '';
    if (!display || display === this.personName(account)) return '';
    return display;
  }

  private jobTitleChoices(): string[] {
    const current = this.form.controls.jobTitle.value?.trim() ?? '';
    if (current && !this.jobTitles.includes(current)) return [current, ...this.jobTitles];
    return this.jobTitles;
  }

  private titleFilterChoices(): string[] {
    const titles = new Set<string>(this.jobTitles);
    for (const title of this.seenTitles()) titles.add(title);
    const selected = this.titleFilter.value.trim();
    if (selected) titles.add(selected);
    return [...titles];
  }

  private managerOptions() {
    const editor = this.editor();
    const number = editor && editor !== 'create' ? editor.employeeNumber : '';
    return this.directory.people().filter((person) => person.employeeNumber !== number);
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
    if (error.status === 401) this.access.signIn();
    const message = error.status === 404
      ? '找不到帳號管理服務，請確認 HRM 後端是否已啟動。'
      : '無法讀取帳號，請稍後再試。';
    this.listError.set(message);
  }

  private rememberPage(offset: number) {
    const page = Math.floor(offset / this.pageSize()) + 1;
    this.router.navigate([], {
      queryParams: { page: page < 2 ? null : page },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private resetEditor() {
    this.form.reset();
    this.editor.set(null);
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

  private presentEditor(account?: EmployeeAccount) {
    this.error.set('');
    this.message.set('');
    this.disableTarget.set(null);
    this.form.reset(account ? {
      employeeNumber: account.employeeNumber,
      name: this.personName(account),
      departmentId: account.departmentId == null ? '' : String(account.departmentId),
      jobTitle: account.jobTitle ?? '',
      hiredOn: account.hiredOn ?? '',
      bornOn: account.bornOn ?? '',
      employmentType: account.employmentType ?? '',
      managerEmployeeNumber: account.managerEmployeeNumber ?? '',
      role: account.role ?? 'employee',
      email: account.email ?? '',
    } : { role: 'employee' });
    if (account) this.form.controls.employeeNumber.disable();
    else this.form.controls.employeeNumber.enable();
    const nationalId = this.form.controls.nationalId;
    if (account) nationalId.removeValidators(Validators.required);
    else nationalId.addValidators(Validators.required);
    nationalId.updateValueAndValidity();
    if (!account) this.loadNextEmployeeNumber();
    this.editor.set(account ?? 'create');
  }

  private loadNextEmployeeNumber() {
    this.nextEmployeeNumber.set('');
    this.nextEmployeeNumberError.set(false);
    this.http.get<{ employeeNumber: string }>(this.accountsUrl + '/next-number').subscribe({
      next: ({ employeeNumber }) => this.nextEmployeeNumber.set(employeeNumber),
      error: () => this.nextEmployeeNumberError.set(true),
    });
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
    if (from === '—') return to;
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
        this.form.reset();
        this.editor.set(null);
        this.disableTarget.set(null);
        this.restoreTarget.set(null);
        this.restoreForm.reset();
        if (backToList) this.clearPerson();
        this.showToast(success);
        if (backToList) {
          this.router.navigate([HRM_ROOT, 'employees'], {
            queryParamsHandling: 'merge',
            queryParams: { section: null, page: resetSearch ? null : hrmPageQuery() },
          });
        }
        if (resetSearch) {
          this.query.reset('', { emitEvent: false });
          this.departmentFilter.setValue('', { emitEvent: false });
          this.titleFilter.setValue('', { emitEvent: false });
          this.appliedQuery = '';
        }
        this.access.loadDisplayName();
        this.loadAccounts(resetSearch ? 0 : this.offset());
        this.directory.loadDepartments();
        this.directory.loadPeople();
        this.refreshOpenedAccount();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.closeEditor();
          this.disableTarget.set(null);
          this.access.signIn();
          return;
        }
        const messages: Record<number, string> = {
          400: '有欄位未填或格式不對。請檢查部門、職稱、到職日、生日、雇用型態和身分證字號。新增帳號時，密碼至少要 12 個字元。',
          403: '你沒有修改這個帳號的權限。',
          404: '找不到這個帳號，請重新整理清單。',
          409: '沒有存成。請確認員工編號、身分證字號或電子郵件沒有重複，而且還留著至少一位管理員。',
          503: '目前無法排入帳號同步。請確認 Core 已設定 HRM_SYNC_ENCRYPTION_KEY 和 HRM Keycloak 管理憑證。',
          ...failures,
        };
        this.error.set(messages[error.status] ?? '更新失敗，請稍後再試。');
      },
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
