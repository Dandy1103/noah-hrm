import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, EventEmitter, Input, OnChanges, OnDestroy, Output, inject, signal } from '@angular/core';
import type { SimpleChanges } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { NoahButtonComponent, NoahDatePickerComponent, NoahFieldComponent, NoahInputDirective } from '@dandy1103/ui';
import type { NoahSelectOption } from '@dandy1103/ui';
import { SelectFieldComponent } from '../../shared/select-field/select-field.component';
import { TableComponent } from '../../shared/table/table.component';

const HRM_ROOT = '/hrm';

export type DutyKind = 'attendance' | 'leave' | 'overtime' | 'trip';

interface PersonOption {
  employeeNumber: string;
  displayName: string;
  status: 'active' | 'inactive';
}

interface DutyRecord {
  id: number;
  employeeNumber: string;
  displayName: string;
  workDate: string | null;
  clockIn: string | null;
  clockOut: string | null;
  note: string | null;
  leaveType: string | null;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
  place: string | null;
}

@Component({
  selector: 'app-duty-board',
  standalone: true,
  imports: [ReactiveFormsModule, NoahButtonComponent, NoahInputDirective, NoahDatePickerComponent, NoahFieldComponent, SelectFieldComponent, TableComponent],
  templateUrl: './duty-board.component.html',
  styleUrl: './duty-board.component.scss',
})
export class DutyBoardComponent implements OnChanges, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  private request: Subscription | null = null;
  private toastTimer = 0;
  private leaving = false;

  @Input({ required: true }) kind: DutyKind = 'attendance';
  @Input() people: PersonOption[] = [];
  @Input() listTick = 0;
  @Input() routeView: 'list' | 'new' | 'edit' = 'list';
  @Input() routeId: string | null = null;
  @Output() readonly editing = new EventEmitter<boolean>();
  @Output() readonly recordCount = new EventEmitter<number>();

  readonly leaveTypes = [
    { value: 'annual', label: '特休' },
    { value: 'sick', label: '病假' },
    { value: 'personal', label: '事假' },
    { value: 'menstrual', label: '生理假' },
    { value: 'bereavement', label: '喪假' },
    { value: 'marriage', label: '婚假' },
    { value: 'official', label: '公假' },
  ];
  readonly records = signal<DutyRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly listError = signal('');
  readonly message = signal('');
  readonly error = signal('');
  readonly editor = signal<'create' | DutyRecord | null>(null);
  readonly deleteTarget = signal<DutyRecord | null>(null);
  readonly form = this.formBuilder.group({
    employeeNumber: '',
    workDate: '',
    clockIn: '',
    clockOut: '',
    note: '',
    leaveType: 'annual',
    startsOn: '',
    endsOn: '',
    startsAt: '',
    endsAt: '',
    reason: '',
    place: '',
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['kind'] || changes['listTick']) this.reload();
    if (changes['routeView'] || changes['routeId'] || changes['kind']) this.syncRoute();
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.toastTimer);
    this.request?.unsubscribe();
  }

  private showToast(text: string) {
    window.clearTimeout(this.toastTimer);
    this.message.set(text);
    this.toastTimer = window.setTimeout(() => this.message.set(''), 3200);
  }

  title(): string {
    if (this.kind === 'leave') return '請假';
    if (this.kind === 'overtime') return '加班';
    if (this.kind === 'trip') return '出差';
    return '出勤';
  }

  staff(): PersonOption[] {
    const selected = this.form.controls.employeeNumber.value;
    return this.people.filter((person) => person.status === 'active' || person.employeeNumber === selected);
  }

  staffSelectOptions(): NoahSelectOption[] {
    return [
      { value: '', label: '請選擇' },
      ...this.staff().map((person) => ({
        value: person.employeeNumber,
        label: `${person.displayName}（${person.employeeNumber}）${person.status === 'inactive' ? '，已停用' : ''}`,
      })),
    ];
  }

  canSave(): boolean {
    const value = this.form.getRawValue();
    if (!value.employeeNumber) return false;
    if (this.kind === 'attendance') return !!value.workDate && (!!value.clockIn || !!value.clockOut);
    if (this.kind === 'leave') return !!value.leaveType && !!value.startsOn && !!value.endsOn;
    if (this.kind === 'overtime') return !!value.workDate && !!value.startsAt && !!value.endsAt && !!value.reason.trim();
    return !!value.place.trim() && !!value.startsOn && !!value.endsOn && !!value.reason.trim();
  }

  leaveLabel(value: string | null): string {
    return this.leaveTypes.find((item) => item.value === value)?.label ?? '—';
  }

  leaveLength(record: DutyRecord): string {
    if (!record.startsOn || !record.endsOn) return '—';
    const start = Date.parse(`${record.startsOn}T00:00:00`);
    const end = Date.parse(`${record.endsOn}T00:00:00`);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
    const days = Math.round((end - start) / 86400000) + 1;
    return `${days} 天`;
  }

  overtimeLength(record: DutyRecord): string {
    const minutes = this.minutesBetween(record.startsAt, record.endsAt);
    if (minutes === null || minutes <= 0) return '—';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest} 分`;
    if (rest === 0) return `${hours} 小時`;
    return `${hours} 小時 ${rest} 分`;
  }

  formatDate(value: string | null): string {
    if (!value) return '—';
    const [year, month, day] = value.split('-');
    if (!year || !month || !day) return value;
    return `${year}/${month}/${day}`;
  }

  shown(value: string | null): string {
    const text = value?.trim() ?? '';
    return text || '—';
  }

  private dismissEditor(): void {
    if (this.editor() === null) return;
    this.editor.set(null);
    this.editing.emit(false);
  }

  private beginCreate(): void {
    this.deleteTarget.set(null);
    this.error.set('');
    this.form.reset({ leaveType: 'annual' });
    this.editor.set('create');
    this.editing.emit(true);
  }

  private beginEdit(record: DutyRecord): void {
    this.deleteTarget.set(null);
    this.error.set('');
    this.form.reset({
      employeeNumber: record.employeeNumber,
      workDate: record.workDate ?? '',
      clockIn: record.clockIn ?? '',
      clockOut: record.clockOut ?? '',
      note: record.note ?? '',
      leaveType: record.leaveType ?? 'annual',
      startsOn: record.startsOn ?? '',
      endsOn: record.endsOn ?? '',
      startsAt: record.startsAt ?? '',
      endsAt: record.endsAt ?? '',
      reason: record.reason ?? '',
      place: record.place ?? '',
    });
    this.editor.set(record);
    this.editing.emit(true);
  }

  private syncRoute(): void {
    if (this.leaving && this.routeView !== 'list') return;
    this.leaving = false;
    if (this.routeView === 'new') {
      if (this.editor() !== 'create') this.beginCreate();
      return;
    }
    if (this.routeView === 'edit' && this.routeId) {
      const current = this.editor();
      if (current && current !== 'create' && String(current.id) === this.routeId) return;
      const record = this.records().find((item) => String(item.id) === this.routeId);
      if (record) this.beginEdit(record);
      return;
    }
    this.dismissEditor();
  }

  openCreate(): void {
    this.router.navigate([HRM_ROOT, this.kind, 'new']);
  }

  openEditor(record: DutyRecord): void {
    this.router.navigate([HRM_ROOT, this.kind, record.id, 'edit']);
  }

  closeEditor(): void {
    this.router.navigate([HRM_ROOT, this.kind]);
  }

  confirmDelete(record: DutyRecord): void {
    this.deleteTarget.set(record);
    this.router.navigate([HRM_ROOT, this.kind]);
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;
    const problem = this.formProblem();
    if (problem) {
      this.error.set(problem);
      return;
    }
    const editor = this.editor();
    if (editor === null) return;
    const url = editor === 'create' ? this.path() : `${this.path()}/${editor.id}`;
    const request = editor === 'create'
      ? this.http.post(url, this.payload())
      : this.http.patch(url, this.payload());
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.leaving = true;
        this.showToast(`${this.title()}已儲存。`);
        this.closeEditor();
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.failure(error, '目前無法儲存，請稍後再試。'));
      },
    });
  }

  remove(): void {
    const target = this.deleteTarget();
    if (!target || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.message.set('');
    this.http.delete(`${this.path()}/${target.id}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.deleteTarget.set(null);
        this.showToast(`已刪除這筆${this.title()}。`);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.failure(error, '目前無法刪除，請稍後再試。'));
      },
    });
  }

  private reload(): void {
    this.dismissEditor();
    this.deleteTarget.set(null);
    this.message.set('');
    this.error.set('');
    this.load();
  }

  private load(): void {
    const kind = this.kind;
    this.request?.unsubscribe();
    this.loading.set(true);
    this.listError.set('');
    this.request = this.http.get<DutyRecord[]>(this.path()).subscribe({
      next: (rows) => {
        if (kind !== this.kind) return;
        this.records.set(rows);
        this.loading.set(false);
        this.recordCount.emit(rows.length);
        this.syncRoute();
      },
      error: (error: HttpErrorResponse) => {
        if (kind !== this.kind) return;
        this.loading.set(false);
        this.records.set([]);
        this.recordCount.emit(0);
        this.listError.set(this.failure(error, `無法讀取${this.title()}，請稍後重新整理。`));
      },
    });
  }

  private path(): string {
    if (this.kind === 'leave') return '/api/hrm/leave';
    if (this.kind === 'overtime') return '/api/hrm/overtime';
    if (this.kind === 'trip') return '/api/hrm/trips';
    return '/api/hrm/attendance';
  }

  private payload(): Record<string, string> {
    const value = this.form.getRawValue();
    const employeeNumber = value.employeeNumber.trim().toUpperCase();
    if (this.kind === 'attendance') {
      return {
        employeeNumber,
        workDate: value.workDate,
        clockIn: value.clockIn,
        clockOut: value.clockOut,
        note: value.note.trim(),
      };
    }
    if (this.kind === 'leave') {
      return {
        employeeNumber,
        leaveType: value.leaveType,
        startsOn: value.startsOn,
        endsOn: value.endsOn,
        note: value.note.trim(),
      };
    }
    if (this.kind === 'overtime') {
      return {
        employeeNumber,
        workDate: value.workDate,
        startsAt: value.startsAt,
        endsAt: value.endsAt,
        reason: value.reason.trim(),
      };
    }
    return {
      employeeNumber,
      place: value.place.trim(),
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      reason: value.reason.trim(),
    };
  }

  private formProblem(): string {
    const value = this.form.getRawValue();
    if (value.note.trim().length > 200 || value.reason.trim().length > 200 || value.place.trim().length > 100) {
      return '備註和事由最多 200 字，地點最多 100 字。';
    }
    if (this.kind === 'attendance' && value.clockIn && value.clockOut && value.clockOut < value.clockIn) {
      return '下班時間不能早於上班時間。';
    }
    if (this.kind === 'overtime' && value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      return '結束時間要晚於開始時間。';
    }
    if ((this.kind === 'leave' || this.kind === 'trip') && value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
      return '結束日期不能早於開始日期。';
    }
    return '';
  }

  private minutesBetween(start: string | null, end: string | null): number | null {
    if (!start || !end) return null;
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    if ([startHour, startMinute, endHour, endMinute].some((part) => Number.isNaN(part))) return null;
    return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  }

  private failure(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 401) {
      location.replace('/auth/login?next=' + encodeURIComponent(location.pathname + location.search));
      return '登入後才能使用。';
    }
    if (error.status === 403) return '請用有人資權限的帳號操作。';
    if (error.status === 404) return '這筆資料已經不在，請重新整理。';
    if (error.status === 409) return '這天已經有這位員工的出勤紀錄。';
    if (error.status === 400) return '請確認員工、日期和時間都填對，結束不能早於開始。';
    return fallback;
  }
}
