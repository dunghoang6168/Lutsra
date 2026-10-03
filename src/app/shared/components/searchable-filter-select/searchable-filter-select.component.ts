import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, output, signal, viewChild } from '@angular/core';

export interface FilterChoice<T extends string = string> {
  value: T;
  label: string;
}

let nextListId = 0;

@Component({
  selector: 'app-searchable-filter-select',
  standalone: true,
  template: `
    <div class="searchable-select" (keydown)="onKeydown($event)">
      <button #trigger type="button" class="select-trigger" role="combobox" aria-haspopup="listbox"
        [attr.aria-label]="label() + ': ' + selectedLabel()" aria-autocomplete="none"
        [attr.aria-expanded]="isOpen()" [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="isOpen() && !showSearch() ? activeOptionId() : null" (click)="toggle()">
        <span class="selected-label">{{ selectedLabel() }}</span>
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <div #dropdown popover="manual" class="select-dropdown">
        @if (isOpen()) {
          @if (showSearch()) {
            <input #searchInput type="search" class="option-search" autocomplete="off" spellcheck="false"
              role="combobox" aria-autocomplete="list" [attr.aria-label]="'Search ' + label()" [placeholder]="'Search ' + label().toLowerCase() + '...'"
              [attr.aria-controls]="listId" [attr.aria-expanded]="true"
              [attr.aria-activedescendant]="activeOptionId()"
              [value]="query()" (input)="updateQuery($event)" />
          }
          <div #optionList class="option-list" [id]="listId" role="listbox" [attr.aria-label]="label()">
            @for (choice of visibleChoices(); track choice.value; let index = $index) {
              <button type="button" role="option" tabindex="-1" class="option-item" [id]="optionId(index)"
                [class.active]="activeIndex() === index" [class.selected]="value() === choice.value"
                [attr.aria-selected]="value() === choice.value" (mouseenter)="activeIndex.set(index)"
                (mousedown)="$event.preventDefault()" (click)="choose(choice.value)">{{ choice.label }}</button>
            } @empty {
              <div class="no-options">No matches</div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .searchable-select { min-width: 0; }
    .select-trigger, .option-search { width: 100%; height: 36px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font: inherit; }
    .select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; text-align: left; cursor: pointer; }
    .select-trigger:hover, .select-trigger[aria-expanded="true"] { border-color: var(--accent-primary); }
    .selected-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chevron { flex: none; width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); }
    .select-dropdown { position: fixed; inset: auto; margin: 0; box-sizing: border-box; padding: 6px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font: inherit; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, .2); }
    .select-dropdown:popover-open { display: flex; flex-direction: column; }
    .option-search { flex: none; padding: 0 10px; background: var(--bg-surface); }
    .option-list { min-height: 0; max-height: 200px; overflow-y: auto; overscroll-behavior: contain; }
    .option-search + .option-list { margin-top: 6px; }
    .option-item { display: block; width: 100%; min-height: 32px; padding: 6px 9px; border-radius: var(--radius-sm); color: var(--text-primary); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .option-item:hover, .option-item.active { background: var(--bg-surface-hover); }
    .option-item.selected { color: var(--accent-primary); font-weight: 600; }
    .option-item.selected::after { content: '\\2713'; float: right; margin-left: 8px; }
    .no-options { padding: 9px; color: var(--text-muted); font-size: var(--font-size-sm); }
    .select-trigger:focus-visible, .option-search:focus-visible, .option-item:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
  `],
})
export class SearchableFilterSelectComponent<T extends string = string> implements AfterViewInit, OnDestroy {
  readonly label = input.required<string>();
  readonly options = input<readonly (T | number | FilterChoice<T>)[]>([]);
  readonly value = input<T>('' as T);
  readonly allLabel = input<string | null>('All');
  readonly includeUnknown = input(false);
  readonly unknownValue = input('unknown');
  readonly unknownLabel = input('Unknown');
  readonly valueChange = output<T>();
  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly activeIndex = signal(0);
  readonly listId = `searchable-filter-${++nextListId}`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly dropdown = viewChild.required<ElementRef<HTMLElement>>('dropdown');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly optionList = viewChild<ElementRef<HTMLElement>>('optionList');
  private parentPopover: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onParentToggle = (event: Event) => {
    if ((event as ToggleEvent).newState === 'closed') this.close();
  };
  private readonly onScroll = (event: Event) => {
    if (this.isOpen() && !(event.target instanceof Node && this.dropdown().nativeElement.contains(event.target))) this.positionDropdown();
  };

  readonly choices = computed<FilterChoice<T>[]>(() => [
    ...(this.allLabel() !== null ? [{ value: '' as T, label: this.allLabel()! }] : []),
    ...this.options().map((option) => typeof option === 'object' ? option : { value: String(option) as T, label: String(option) }),
    ...(this.includeUnknown() ? [{ value: this.unknownValue() as T, label: this.unknownLabel() }] : []),
  ]);
  readonly showSearch = computed(() => this.choices().length > 8);
  readonly selectedLabel = computed(() => this.choices().find((choice) => choice.value === this.value())?.label ?? this.value());
  readonly visibleChoices = computed(() => {
    const term = normalize(this.query().trim());
    return term ? this.choices().filter((choice) => normalize(choice.label).includes(term)) : this.choices();
  });
  readonly activeOptionId = computed(() => this.visibleChoices()[this.activeIndex()] ? this.optionId(this.activeIndex()) : null);

  ngAfterViewInit(): void {
    this.parentPopover = this.host.nativeElement.closest<HTMLElement>('[popover]');
    this.parentPopover?.addEventListener('beforetoggle', this.onParentToggle);
    window.addEventListener('scroll', this.onScroll, true);
    this.observer = new ResizeObserver(() => { if (this.isOpen()) this.positionDropdown(); });
    this.observer.observe(this.trigger().nativeElement);
    this.observer.observe(this.dropdown().nativeElement);
  }

  ngOnDestroy(): void {
    clearTimeout(this.openTimer);
    this.observer?.disconnect();
    this.parentPopover?.removeEventListener('beforetoggle', this.onParentToggle);
    window.removeEventListener('scroll', this.onScroll, true);
  }

  optionId(index: number): string { return `${this.listId}-option-${index}`; }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    this.query.set('');
    this.isOpen.set(true);
    this.activeIndex.set(Math.max(0, this.visibleChoices().findIndex((choice) => choice.value === this.value())));
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => {
      if (!this.isOpen()) return;
      this.dropdown().nativeElement.showPopover();
      this.positionDropdown();
      (this.searchInput()?.nativeElement ?? this.trigger().nativeElement).focus({ preventScroll: true });
      this.scrollActiveIntoView();
    }, 0);
  }

  close(): void {
    clearTimeout(this.openTimer);
    const dropdown = this.dropdown().nativeElement;
    if (dropdown.matches(':popover-open')) dropdown.hidePopover();
    this.isOpen.set(false);
    this.query.set('');
  }

  choose(value: T): void {
    this.valueChange.emit(value);
    this.close();
    this.trigger().nativeElement.focus({ preventScroll: true });
  }

  updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
    if (this.optionList()) this.optionList()!.nativeElement.scrollTop = 0;
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.open(); }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.trigger().nativeElement.focus({ preventScroll: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (!this.showSearch() && (event.key === 'Home' || event.key === 'End'))) {
      event.preventDefault();
      const count = this.visibleChoices().length;
      if (!count) return;
      if (event.key === 'Home') this.activeIndex.set(0);
      else if (event.key === 'End') this.activeIndex.set(count - 1);
      else this.activeIndex.update((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
      this.scrollActiveIntoView();
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target !== this.searchInput()?.nativeElement)) {
      event.preventDefault();
      const choice = this.visibleChoices()[this.activeIndex()];
      if (choice) this.choose(choice.value);
    } else if (event.key === 'Tab') {
      this.trigger().nativeElement.focus({ preventScroll: true });
      this.close();
    }
  }

  private scrollActiveIntoView(): void {
    const list = this.optionList()?.nativeElement;
    const option = list?.querySelector<HTMLElement>(`#${this.optionId(this.activeIndex())}`);
    if (!list || !option) return;
    const item = option.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }

  @HostListener('window:resize')
  positionDropdown(): void {
    const panel = this.dropdown().nativeElement;
    if (!this.isOpen() || !panel.matches(':popover-open')) return;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const padding = 12;
    const gap = 4;
    const width = Math.min(rect.width, window.innerWidth - padding * 2);
    panel.style.width = `${width}px`;
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - padding);
    const above = Math.max(0, rect.top - gap - padding);
    const desiredHeight = 14 + (this.showSearch() ? 42 : 0) + Math.min(200, this.optionList()?.nativeElement.scrollHeight ?? 200);
    const openBelow = below >= desiredHeight || below >= above;
    const available = openBelow ? below : above;
    panel.style.maxHeight = `${available}px`;
    panel.style.left = `${Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding))}px`;
    panel.style.top = `${openBelow ? rect.bottom + gap : Math.max(padding, rect.top - gap - Math.min(desiredHeight, available))}px`;
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutsidePointer(event: Event): void {
    if (this.isOpen() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('\u0111', 'd');
}
