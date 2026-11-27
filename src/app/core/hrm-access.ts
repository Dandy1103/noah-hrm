import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { signedIn } from '../require-session';

@Injectable({ providedIn: 'root' })
export class HrmAccess {
  private readonly http = inject(HttpClient);
  private readonly loginParams = new URLSearchParams(location.search);
  private started = false;

  readonly signInError = this.loginParams.get('authError');
  readonly signedOut = this.loginParams.get('signedOut') === '1';
  readonly loginUrl = '/auth/login?' + new URLSearchParams({
    next: this.signInError || this.signedOut ? this.loginParams.get('next') ?? '/' : location.pathname + location.search,
  });
  readonly access = signal<'loading' | 'allowed' | 'signed-out' | 'denied' | 'unavailable'>('loading');
  readonly canManage = signal(false);
  readonly displayName = signal('');
  readonly accessError = signal('請稍後重新整理。');

  constructor() {
    void signedIn();
  }

  start(onAllowed: () => void): void {
    if (this.started) return;
    this.started = true;
    this.http.get<{ canManage: boolean }>('/api/hrm/access').subscribe({
      next: (capabilities) => {
        this.canManage.set(capabilities.canManage);
        this.access.set('allowed');
        this.loadDisplayName();
        onAllowed();
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

  loadDisplayName(): void {
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

  signIn(): void {
    if (this.signInError === 'unavailable' || this.signInError === 'signin') this.access.set('signed-out');
    else location.replace(this.loginUrl);
  }

  reloadPage(): void {
    location.reload();
  }
}
