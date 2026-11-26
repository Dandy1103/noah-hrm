import { Component, HostBinding, HostListener, forwardRef, input } from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { NoahSelectComponent, type NoahSelectOption } from '@dandy1103/ui';

@Component({
  selector: 'app-select-field',
  standalone: true,
  imports: [NoahSelectComponent],
  template: `<noah-select [value]="value" [options]="choices()" (valueChange)="choose($event)" />`,
  styles: [`:host{display:block}:host([aria-disabled="true"]){opacity:.55;pointer-events:none}`],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => SelectFieldComponent),
    multi: true,
  }],
})
export class SelectFieldComponent implements ControlValueAccessor {
  readonly options = input<readonly NoahSelectOption[]>([]);
  readonly emptyLabel = input('');

  value = '';
  disabled = false;

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  @HostBinding('attr.aria-disabled')
  get ariaDisabled(): string | null {
    return this.disabled ? 'true' : null;
  }

  @HostBinding('attr.inert')
  get inert(): '' | null {
    return this.disabled ? '' : null;
  }

  choices(): readonly NoahSelectOption[] {
    const emptyLabel = this.emptyLabel();
    if (!emptyLabel) return this.options();
    return [{ value: '', label: emptyLabel }, ...this.options().filter((option) => option.value !== '')];
  }

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }

  registerOnChange(onChange: (value: string) => void): void {
    this.onChange = onChange;
  }

  registerOnTouched(onTouched: () => void): void {
    this.onTouched = onTouched;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  choose(value: string): void {
    if (this.disabled) return;
    this.value = value;
    this.onChange(value);
    this.onTouched();
  }

  @HostListener('focusout')
  touch(): void {
    this.onTouched();
  }
}
