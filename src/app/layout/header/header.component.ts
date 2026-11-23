import { Component, computed, input } from '@angular/core';
import { NoahHeaderComponent } from '@dandy1103/ui';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NoahHeaderComponent],
  template: `
    <noah-header [userName]="accountName()"></noah-header>
  `,
})
export class HeaderComponent {
  readonly displayName = input.required<string>();
  readonly signedIn = input.required<boolean>();

  readonly accountName = computed(() => this.signedIn() ? this.displayName() : '');
}
