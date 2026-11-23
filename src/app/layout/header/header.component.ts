import { Component, computed, input } from '@angular/core';
import { NoahHeaderAction, NoahHeaderComponent } from '@dandy1103/ui';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NoahHeaderComponent],
  template: `
    <noah-header [homeHref]="homeHref" [actions]="actions" [userName]="accountName()"></noah-header>
  `,
})
export class HeaderComponent {
  readonly homeHref = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ? 'http://localhost:4200/'
    : 'https://noahportal.dandy-cheng.com/';
  readonly actions: NoahHeaderAction[] = [
    { label: '個人資料', href: new URL('profile', this.homeHref).href },
    { label: '我的權限', href: new URL('permissions', this.homeHref).href },
    { label: '變更密碼', href: new URL('auth/change-password', this.homeHref).href },
    { label: '登出', href: new URL('auth/logout', this.homeHref).href, method: 'post' },
  ];
  readonly displayName = input.required<string>();
  readonly signedIn = input.required<boolean>();

  readonly accountName = computed(() => this.signedIn() ? this.displayName() : '');
}
