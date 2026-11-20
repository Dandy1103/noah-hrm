import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

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

  readonly title = 'Noah HRM';
  readonly localDevelopment = location.origin === 'http://localhost:4201'
    && new URL(document.baseURI).pathname === '/';
  readonly signInError = new URLSearchParams(location.search).get('authError');
  readonly access = signal<'loading' | 'allowed' | 'signed-out' | 'denied' | 'unavailable'>('loading');
  readonly accessError = signal('目前無法讀取權限，請稍後重新整理。');
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly form = this.formBuilder.group({
    employeeNumber: ['', [Validators.required, Validators.pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/i)]],
    displayName: ['', [Validators.required, Validators.maxLength(100)]],
    department: ['', [Validators.required, Validators.maxLength(100)]],
    keycloakUserId: ['', [Validators.required, Validators.maxLength(255)]],
  });

  constructor() {
    this.http.get('/api/hrm/access').subscribe({
      next: () => this.access.set('allowed'),
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.access.set('signed-out');
          return;
        }
        if (error.status === 403) {
          this.access.set('denied');
          return;
        }
        if (this.localDevelopment) {
          const messages: Record<number, string> = {
            200: '請在啟動 HRM 的終端機設定 HRM_DEV_PORTAL_ORIGIN，再重啟 HRM。',
            404: 'develop Portal 找不到 HRM API，請確認部署版本與網址。',
            502: '無法連線到 develop Portal，請確認 HRM_DEV_PORTAL_ORIGIN 和部署狀態。',
          };
          this.accessError.set(messages[error.status] ?? 'develop Portal 目前無法確認 HRM 權限，請稍後再試。');
        }
        this.access.set('unavailable');
      },
    });
  }

  save() {
    if (this.form.invalid || this.saving()) return;

    this.message.set('');
    this.error.set('');
    this.saving.set(true);
    this.http.post<{ employeeNumber: string }>('/api/hrm/employees', this.form.getRawValue())
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: ({ employeeNumber }) => {
          this.form.reset();
          this.message.set(`已新增員工 ${employeeNumber}。`);
        },
        error: (error: HttpErrorResponse) => {
          if (error.status === 401) {
            this.access.set('signed-out');
            return;
          }
          const messages: Record<number, string> = {
            400: '請檢查員工編號、姓名、部門和 Keycloak 使用者 ID。',
            403: '你的帳號沒有新增員工的權限。',
            409: '這個員工編號或 Keycloak 使用者已綁定。',
          };
          this.error.set(messages[error.status] ?? '目前無法新增員工，請稍後再試。');
        },
      });
  }
}
