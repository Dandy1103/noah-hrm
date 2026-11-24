import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { NoahHeaderAction, NoahHeaderComponent } from '@dandy1103/ui';
import { loadCatalog, loadedCatalog, NavCatalog, portalEntry } from '../navbar/nav-catalog';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NoahHeaderComponent],
  template: `
    <noah-header [homeHref]="homeHref" [actions]="actions" [userName]="accountName()"></noah-header>
  `,
})
export class HeaderComponent {
  private readonly catalog = signal<NavCatalog | null>(loadedCatalog() ?? null);
  readonly displayName = input.required<string>();
  readonly signedIn = input.required<boolean>();
  readonly accountName = computed(() => this.signedIn() ? this.displayName() : '');

  constructor() {
    const request = new AbortController();
    inject(DestroyRef).onDestroy(() => request.abort());
    void loadCatalog(request.signal).then((value) => this.catalog.set(value));
  }

  get homeHref(): string {
    return portalEntry(this.catalog());
  }

  get actions(): NoahHeaderAction[] {
    const home = this.homeHref;
    const origin = home ? new URL(home, location.origin).origin + '/' : '';
    return [
      { label: '個人資料', href: portalEntry(this.catalog(), 'profile') },
      { label: '我的權限', href: portalEntry(this.catalog(), 'permissions') },
      { label: '變更密碼', href: origin ? new URL('auth/change-password', origin).href : '' },
      { label: '登出', href: origin ? new URL('auth/logout', origin).href : '', method: 'post' },
    ];
  }
}
