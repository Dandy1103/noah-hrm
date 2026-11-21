import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, finalize } from 'rxjs';

interface EmployeeAccount {
  employeeNumber: string;
  displayName: string;
  department: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: 'active' | 'inactive';
  managed: boolean;
  editable: boolean;
}

interface AccountPage {
  accounts: EmployeeAccount[];
  hasMore: boolean;
  pageSize: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  private readonly accountsUrl = '/api/hrm/accounts';

  readonly title = 'Noah HRM';
  readonly mountedInPortal = new URL(document.baseURI).pathname === '/hrm/';
  private readonly loginParams = new URLSearchParams(location.search);
  readonly signInError = this.loginParams.get('authError');
  readonly signedOut = this.loginParams.get('signedOut') === '1';
  readonly loginUrl = '/auth/login?' + new URLSearchParams({
    next: this.signInError || this.signedOut ? this.loginParams.get('next') ?? '/' : location.pathname + location.search,
  });
  readonly changePasswordUrl = '/auth/change-password?' + new URLSearchParams({ next: location.pathname + location.search });
  readonly access = signal<'loading' | 'allowed' | 'signed-out' | 'denied' | 'unavailable'>('loading');
  readonly accessError = signal('目前無法讀取權限，請稍後重新整理。');
  readonly accounts = signal<EmployeeAccount[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly listError = signal('');
  readonly message = signal('');
  readonly error = signal('');
  readonly editor = signal<'create' | EmployeeAccount | null>(null);
  readonly disableTarget = signal<EmployeeAccount | null>(null);
  readonly query = this.formBuilder.control('', [Validators.maxLength(100)]);
  readonly offset = signal(0);
  readonly pageSize = signal(30);
  readonly hasMore = signal(false);
  private appliedQuery = '';

  readonly form = this.formBuilder.group({
    nationalId: ['', Validators.pattern(/^[a-z][12][0-9]{8}$/i)],
    employeeNumber: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/i)]],
    lastName: ['', [Validators.required, Validators.maxLength(48)]],
    firstName: ['', [Validators.required, Validators.maxLength(48)]],
    department: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    initialPassword: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });

  constructor() {
    this.http.get('/api/hrm/access').subscribe({
      next: () => {
        this.access.set('allowed');
        this.loadAccounts();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.signIn();
          return;
        }
        if (error.status === 403) {
          this.access.set('denied');
          return;
        }
        this.access.set('unavailable');
      },
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
      department: account.department,
      email: account.email ?? '',
    } : {});
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

  save() {
    const editor = this.editor();
    if (!editor || this.form.invalid || this.saving()) return;
    const { employeeNumber, nationalId, firstName, lastName, department, email, initialPassword } = this.form.getRawValue();
    const profile = { firstName, lastName, department, email };
    if (editor === 'create') {
      this.mutate(this.http.post(this.accountsUrl, { ...profile, employeeNumber, nationalId, initialPassword }), '已新增帳號。', true);
    } else {
      this.mutate(this.http.patch(this.accountUrl(editor), { ...profile, nationalId }), '已儲存帳號。');
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
    this.mutate(this.http.delete(this.accountUrl(account)), '已停用帳號。');
  }

  restore(account: EmployeeAccount) {
    this.mutate(this.http.post(this.accountUrl(account) + '/restore', null), '已恢復帳號。');
  }

  private signIn() {
    if (this.signInError || this.signedOut) this.access.set('signed-out');
    else location.replace(this.loginUrl);
  }

  private accountUrl(account: EmployeeAccount) {
    return this.accountsUrl + '/' + encodeURIComponent(account.employeeNumber);
  }

  private mutate(request: Observable<unknown>, success: string, resetSearch = false) {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.closeEditor();
        this.disableTarget.set(null);
        this.message.set(success);
        if (resetSearch) {
          this.query.reset();
          this.appliedQuery = '';
        }
        this.loadAccounts(resetSearch ? 0 : this.offset());
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.closeEditor();
          this.disableTarget.set(null);
          this.signIn();
          return;
        }
        const messages: Record<number, string> = {
          400: '請確認身分證字號與欄位內容。新增帳號時也要確認初始密碼符合規則。',
          403: '你沒有修改這個帳號的權限。',
          404: '找不到這個帳號，請重新整理清單。',
          409: '員工編號、身分證字號或電子郵件可能已被使用，請確認後再試。',
          503: '目前無法寫入帳號，請確認 HRM 的資料庫與 Keycloak 管理設定。',
        };
        this.error.set(messages[error.status] ?? '帳號更新失敗，請稍後再試。');
      }
    });
  }
}
