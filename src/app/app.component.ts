import { NoahDialogComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HrmAccess } from './core/hrm-access';
import { HrmRoute } from './hrm-route';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NoahDialogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly screen = inject(HrmAccess);
  private readonly route = inject(HrmRoute);
}
