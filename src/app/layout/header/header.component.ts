import { Component, computed, input } from '@angular/core';
import { NoahHeaderComponent } from '@dandy1103/header';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NoahHeaderComponent],
  templateUrl: './header.component.html',
})
export class HeaderComponent {
  readonly displayName = input.required<string>();
  readonly signedIn = input.required<boolean>();
  readonly mountedInPortal = input.required<boolean>();
  readonly changePasswordUrl = input.required<string>();

  readonly accountName = computed(() => this.signedIn() ? this.displayName() : '');
  readonly showLogout = computed(() => this.signedIn());
  readonly portalHomeUrl = computed(() => {
    if (this.mountedInPortal()) return '/';
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return isLocal ? 'http://localhost:4200/' : 'https://noahportal.dandy-cheng.com/';
  });
  readonly profileHref = computed(() => this.accountPage('profile'));
  readonly permissionsHref = computed(() => this.accountPage('permissions'));

  private accountPage(page: 'profile' | 'permissions'): string {
    if (this.mountedInPortal()) return `/${page}`;
    return `${this.portalHomeUrl().replace(/\/?$/, '/')}${page}`;
  }
}
