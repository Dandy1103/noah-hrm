import { Component, ElementRef, HostListener, ViewChild, computed, input } from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
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

  @ViewChild('account') account?: ElementRef<HTMLElement>;

  isMenuOpen = false;

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu(): void {
    this.isMenuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  closeMenuOnOutsideClick(event: MouseEvent): void {
    if (!this.isMenuOpen) return;
    const target = event.target;
    const account = this.account?.nativeElement;
    if (target instanceof Node && account?.contains(target)) return;
    this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  closeMenuOnEscape(): void {
    this.closeMenu();
  }
}
