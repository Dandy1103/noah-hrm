import { NoahPageHeadingComponent, type NoahBreadcrumb } from '@dandy1103/ui';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HrmDirectory } from '../../../core/hrm-directory';
import { HRM_ROOT, type DutyKind } from '../../../core/hrm-location';
import { DutyBoardComponent } from '../duty-board/duty-board.component';

@Component({
  selector: 'app-duty-page',
  standalone: true,
  imports: [NoahPageHeadingComponent, DutyBoardComponent],
  templateUrl: './duty-page.component.html',
  styleUrl: '../../../app.component.scss',
})
export class DutyPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly directory = inject(HrmDirectory);
  private readonly url = this.route.snapshot.url.map((segment) => segment.path);

  readonly people = this.directory.people;
  readonly peopleError = this.directory.peopleError;
  readonly editing = signal(false);
  readonly count = signal<number | null>(null);
  readonly kind = dutyKind(this.url[0]);
  readonly routeView = dutyRouteView(this.url);
  readonly routeId = this.route.snapshot.paramMap.get('recordId');
  readonly title = this.kind === 'attendance' ? '出勤紀錄' : dutyLabel(this.kind);
  readonly breadcrumbs = computed<NoahBreadcrumb[]>(() => [
    { label: '首頁', href: '/portal' },
    { label: '人資管理', route: `${HRM_ROOT}/employees` },
    ...this.crumbs(),
  ]);

  private crumbs(): NoahBreadcrumb[] {
    const label = dutyLabel(this.kind);
    if (!this.editing()) return [{ label }];
    return [{ label, route: `/${this.kind}` }, { label: '登記' }];
  }
}

function dutyKind(value: string | undefined): DutyKind {
  if (value === 'leave' || value === 'overtime' || value === 'trip' || value === 'attendance') return value;
  return 'attendance';
}

function dutyRouteView(url: string[]): 'list' | 'new' | 'edit' {
  if (url[1] === 'new') return 'new';
  if (url[2] === 'edit') return 'edit';
  return 'list';
}

function dutyLabel(kind: DutyKind): string {
  if (kind === 'leave') return '請假';
  if (kind === 'overtime') return '加班';
  if (kind === 'trip') return '出差';
  return '出勤';
}
