import { Component, computed, input } from '@angular/core';
import { NoahHeaderComponent } from '@dandy1103/ui';

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
  readonly showLogout = computed(() => this.signedIn() && !this.mountedInPortal());
  readonly backLabel = computed(() => this.mountedInPortal() ? '回 Portal' : '');

  readonly portalHomeUrl = computed(() => {
    if (this.mountedInPortal()) return '/';
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return isLocal ? 'http://localhost:4200/' : 'https://noahportal.dandy-cheng.com/';
  });
}
