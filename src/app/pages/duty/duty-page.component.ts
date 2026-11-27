import { NoahPageHeadingComponent } from '@dandy1103/ui';
import { Component, inject } from '@angular/core';
import { DutyBoardComponent } from './duty-board.component';
import { HrmScreen } from '../hrm-screen';

@Component({
  selector: 'app-duty-page',
  standalone: true,
  imports: [NoahPageHeadingComponent, DutyBoardComponent],
  templateUrl: './duty-page.component.html',
  styleUrl: '../../app.component.scss',
})
export class DutyPageComponent {
  readonly screen = inject(HrmScreen);
}
