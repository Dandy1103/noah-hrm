import { NoahButtonComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HrmScreen } from './pages/hrm-screen';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NoahButtonComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly screen = inject(HrmScreen);
}
