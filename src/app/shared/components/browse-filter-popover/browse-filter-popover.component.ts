import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, input, signal } from '@angular/core';

let nextPopoverId = 0;

@Component({
  selector: 'app-browse-filter-popover',
  standalone: true,
  template: `
    <button #trigger type="button" class="filter-trigger" [class.active]="activeCount() > 0"
      [attr.popovertarget]="panelId" [attr.aria-controls]="panelId" [attr.aria-expanded]="isOpen()" (click)="onTriggerClick()">
      Filter
      @if (activeCount() > 0) { <span class="filter-count">{{ activeCount() }}</span> }
    </button>
    <div #panel popover="auto" class="filter-panel" [id]="panelId" role="group" aria-label="Sort and filter options" tabindex="-1" (toggle)="onToggle()">
      <ng-content />
    </div>
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .filter-trigger { height: 36px; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); cursor: pointer; white-space: nowrap; }
    .filter-trigger:hover, .filter-trigger.active, .filter-trigger[aria-expanded="true"] { border-color: var(--accent-primary); background: var(--bg-surface-hover); }
    .filter-trigger:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
    .filter-count { min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--accent-primary); color: #fff; font-size: 11px; }
    .filter-panel { position: fixed; inset: auto; margin: 0; width: min(320px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto; padding: 16px; border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 18px 45px rgba(0, 0, 0, .45); }
    :host-context(.layout-liquid-glass) .filter-trigger { border-color: var(--glass-border); background: var(--glass-regular); }
    :host-context(.layout-liquid-glass) .filter-panel { border-color: var(--glass-border); background: var(--glass-elevated); box-shadow: inset 0 1px 0 var(--glass-specular), var(--glass-shadow); backdrop-filter: blur(var(--glass-blur)) saturate(1.25); }
  `],
})
export class BrowseFilterPopoverComponent implements AfterViewInit, OnDestroy {
  readonly activeCount = input(0);
  readonly isOpen = signal(false);
  readonly panelId = `browse-filter-${++nextPopoverId}`;

  @ViewChild('trigger', { static: true }) private trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('panel', { static: true }) private panel!: ElementRef<HTMLElement>;
  private panelObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    if (typeof ResizeObserver !== 'function') return;
    this.panelObserver = new ResizeObserver(() => {
      if (this.panel.nativeElement.matches(':popover-open')) this.positionPanel();
    });
    this.panelObserver.observe(this.panel.nativeElement);
  }

  ngOnDestroy(): void { this.panelObserver?.disconnect(); }

  onTriggerClick(): void {
    queueMicrotask(() => {
      if (this.panel.nativeElement.matches(':popover-open')) this.positionPanel();
    });
  }

  onToggle(): void {
    const open = this.panel.nativeElement.matches(':popover-open');
    this.isOpen.set(open);
    if (open) {
      this.positionPanel();
      this.panel.nativeElement.focus();
    }
    else if (this.panel.nativeElement.contains(document.activeElement)) this.trigger.nativeElement.focus();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.isOpen()) this.positionPanel();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.panel.nativeElement.matches(':popover-open')) return;
    event.preventDefault();
    event.stopPropagation();
    this.panel.nativeElement.hidePopover();
    this.trigger.nativeElement.focus();
  }

  private positionPanel(): void {
    const trigger = this.trigger.nativeElement.getBoundingClientRect();
    const panel = this.panel.nativeElement;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const padding = 12;
    const left = Math.max(padding, Math.min(trigger.right - width, window.innerWidth - width - padding));
    const below = trigger.bottom + 8;
    const top = below + height <= window.innerHeight - padding ? below : Math.max(padding, trigger.top - height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
}
