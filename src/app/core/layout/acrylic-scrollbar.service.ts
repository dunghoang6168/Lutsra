import { Injectable } from '@angular/core';

const SCROLL_AREAS = [
  '.table-scroll-container', '.home-page', '.albums-page', '.album-detail-page',
  '.artists-page', '.artist-detail-page', '.playlists-page', '.playlist-detail-page',
  '.folders-page', '.settings-page', '.now-playing-page', '.drawer-content',
  '.panel-content', '.nav-menu', '.search-results', '.tracks-picker-list',
  '.metadata-modal-card',
].map((selector) => `.app-layout ${selector}`).join(', ');

class OverlayScrollArea {
  private readonly anchor = document.createElement('span');
  private readonly hitArea = document.createElement('span');
  private readonly thumb = document.createElement('span');
  private readonly resizeObserver = new ResizeObserver(() => this.sync());
  private readonly generatedId: boolean;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private thumbTravel = 0;
  private maxScroll = 0;

  constructor(private readonly host: HTMLElement, id: number) {
    this.generatedId = !host.id;
    if (this.generatedId) host.id = `acrylic-scroll-${id}`;

    this.anchor.className = 'acrylic-scroll-anchor';
    this.hitArea.className = 'acrylic-scroll-hit-area';
    this.thumb.className = 'acrylic-scroll-thumb';
    this.thumb.setAttribute('role', 'scrollbar');
    this.thumb.setAttribute('aria-label', 'Scroll content');
    this.thumb.setAttribute('aria-orientation', 'vertical');
    this.thumb.setAttribute('aria-controls', host.id);
    this.thumb.setAttribute('aria-valuemin', '0');
    this.thumb.tabIndex = 0;
    this.hitArea.append(this.thumb);
    this.anchor.append(this.hitArea);
    host.prepend(this.anchor);
    host.classList.add('acrylic-scroll-host');

    host.addEventListener('scroll', this.onScroll, { passive: true });
    this.thumb.addEventListener('pointerdown', this.onPointerDown);
    this.thumb.addEventListener('pointermove', this.onPointerMove);
    this.thumb.addEventListener('pointerup', this.onPointerEnd);
    this.thumb.addEventListener('pointercancel', this.onPointerEnd);
    this.thumb.addEventListener('keydown', this.onKeyDown);
    this.resizeObserver.observe(host);
    this.sync();
  }

  sync(): void {
    const height = this.host.clientHeight;
    this.maxScroll = Math.max(0, this.host.scrollHeight - height);
    const style = getComputedStyle(this.host);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const trackHeight = Math.max(0, height - paddingTop - paddingBottom);
    const visible = this.maxScroll > 1 && trackHeight > 0;
    this.anchor.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    const thumbHeight = Math.min(trackHeight, Math.max(24, trackHeight * height / this.host.scrollHeight));
    this.thumbTravel = trackHeight - thumbHeight;
    this.anchor.style.top = `${paddingTop}px`;
    this.hitArea.style.height = `${trackHeight}px`;
    this.thumb.style.height = `${thumbHeight}px`;
    this.thumb.style.transform = `translateY(${this.maxScroll ? this.host.scrollTop / this.maxScroll * this.thumbTravel : 0}px)`;
    this.thumb.setAttribute('aria-valuemax', String(Math.round(this.maxScroll)));
    this.thumb.setAttribute('aria-valuenow', String(Math.round(this.host.scrollTop)));
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.host.removeEventListener('scroll', this.onScroll);
    this.thumb.removeEventListener('pointerdown', this.onPointerDown);
    this.thumb.removeEventListener('pointermove', this.onPointerMove);
    this.thumb.removeEventListener('pointerup', this.onPointerEnd);
    this.thumb.removeEventListener('pointercancel', this.onPointerEnd);
    this.thumb.removeEventListener('keydown', this.onKeyDown);
    this.anchor.remove();
    this.host.classList.remove('acrylic-scroll-host');
    if (this.generatedId) this.host.removeAttribute('id');
  }

  private readonly onScroll = (): void => this.sync();

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.dragStartY = event.clientY;
    this.dragStartScroll = this.host.scrollTop;
    this.hitArea.classList.add('is-dragging');
    this.thumb.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.thumb.hasPointerCapture(event.pointerId) || this.thumbTravel <= 0) return;
    this.host.scrollTop = this.dragStartScroll +
      (event.clientY - this.dragStartY) * this.maxScroll / this.thumbTravel;
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.hitArea.classList.remove('is-dragging');
    if (this.thumb.hasPointerCapture(event.pointerId)) this.thumb.releasePointerCapture(event.pointerId);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const step = 40;
    const page = this.host.clientHeight * 0.9;
    const delta: Record<string, number> = {
      ArrowUp: -step, ArrowDown: step, PageUp: -page, PageDown: page,
      Home: -this.host.scrollTop, End: this.maxScroll - this.host.scrollTop,
    };
    if (!(event.key in delta)) return;
    event.preventDefault();
    this.host.scrollTop += delta[event.key];
  };
}

@Injectable({ providedIn: 'root' })
export class AcrylicScrollbarService {
  private readonly areas = new Map<HTMLElement, OverlayScrollArea>();
  private observer?: MutationObserver;
  private frame = 0;
  private nextId = 0;

  start(): void {
    if (this.observer || typeof document === 'undefined') return;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-layout', 'data-runtime'],
    });
    const layout = document.querySelector('.app-layout');
    if (layout) this.observer.observe(layout, { childList: true, subtree: true });
    window.addEventListener('resize', this.schedule);
    this.schedule();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    window.removeEventListener('resize', this.schedule);
    cancelAnimationFrame(this.frame);
    for (const area of this.areas.values()) area.destroy();
    this.areas.clear();
  }

  private readonly schedule = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  };

  private refresh(): void {
    const enabled = document.documentElement.matches(
      "[data-layout='liquid-glass'][data-runtime='desktop']");
    const found = enabled
      ? new Set(document.querySelectorAll<HTMLElement>(SCROLL_AREAS))
      : new Set<HTMLElement>();

    for (const [host, area] of this.areas) {
      if (found.has(host)) area.sync();
      else {
        area.destroy();
        this.areas.delete(host);
      }
    }
    for (const host of found) {
      if (!this.areas.has(host)) this.areas.set(host, new OverlayScrollArea(host, ++this.nextId));
    }
  }
}
