import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy,
  computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { LIBRARY_GATEWAY } from '../../../core/contracts/library.gateway';
import { RightPanelService } from '../../../core/layout/right-panel.service';
import { TrackSelectionService } from '../../../core/layout/track-selection.service';
import type { TrackDetails } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { IconComponent } from '../icon/icon.component';
import { SignalPathComponent } from '../signal-path/signal-path.component';
import { formatTrackFormat } from '../../../features/home/library-quality';

interface PropertyRow { name: string; value: string; path?: boolean; }
interface PropertySection { title: string; rows: PropertyRow[]; }

const DEFAULT_WIDTH = 600;
const MIN_WIDTH = 360;
const MAX_WIDTH = 800;
const MIN_MAIN_WIDTH = 280;

@Component({
  selector: 'app-track-details-panel',
  standalone: true,
  imports: [IconComponent, SignalPathComponent],
  host: {
    '[class.open]': 'visible()',
    '[class.docked]': 'docked()',
    '[style.--track-details-width.px]': 'effectiveWidth()',
    '[attr.aria-hidden]': '!visible()',
    '[attr.inert]': 'visible() ? null : ""',
  },
  templateUrl: './track-details-panel.component.html',
  styleUrl: './track-details-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackDetailsPanelComponent implements AfterViewInit, OnDestroy {
  readonly open = input(false);
  /** Console docks the panel as a permanent inspector that follows the selected track. */
  readonly docked = input(false);
  private readonly selection = inject(TrackSelectionService);
  readonly visible = computed(() => this.open() || this.docked());
  readonly subject = computed(() => this.docked()
    ? this.selection.selected() ?? this.player.currentTrack()
    : this.player.currentTrack());
  readonly subjectSource = computed(() => this.docked() && this.selection.selected() ? 'Selected track' : 'Now playing');
  readonly subjectFormat = computed(() => { const track = this.subject(); return track ? formatTrackFormat(track) : null; });
  /** Mono is for measurements only; names and tags stay in the text face. */
  readonly measureRows = new Set(['Duration', 'Sample rate', 'Bits per sample', 'Bitrate', 'Audio MD5', 'Full path', 'File size', 'Track number', 'Total tracks', 'Disc number', 'Total discs']);
  readonly player = inject(PlayerService);
  readonly rightPanels = inject(RightPanelService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly details = signal<TrackDetails | null>(null);
  readonly effectiveWidth = signal(DEFAULT_WIDTH);
  readonly maxWidth = signal(MAX_WIDTH);
  readonly minWidth = MIN_WIDTH;
  readonly resizeHandle = viewChild.required<ElementRef<HTMLElement>>('resizeHandle');
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly pointerListeners = new AbortController();
  private requestVersion = 0;
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = DEFAULT_WIDTH;
  private gestureMaxWidth = MAX_WIDTH;
  private pendingWidth = DEFAULT_WIDTH;
  private resizeFrameId: number | null = null;
  private previousBodyCursor = '';
  private previousBodyUserSelect = '';

  readonly sections = computed<PropertySection[]>(() => {
    const details = this.details();
    if (!details) return [];
    const metadata = details.metadata;
    const audio = details.audio;
    const file = details.file;
    return [
      section('Metadata', [
        row('Artist name', join(metadata.artists)), row('Track title', metadata.title), row('Album title', metadata.album),
        row('Date', metadata.date ?? formatNumber(metadata.year)), row('Composer', join(metadata.composers)),
        row('Album artist', join(metadata.albumArtists)), row('Genre', join(metadata.genres)),
        row('Track number', formatNumber(metadata.trackNumber)), row('Total tracks', formatNumber(metadata.totalTracks)),
        row('Disc number', formatNumber(metadata.discNumber)), row('Total discs', formatNumber(metadata.totalDiscs)),
      ]),
      section('General', [
        row('Duration', formatDuration(audio.duration, audio.numberOfSamples)),
        row('Sample rate', audio.sampleRate === null ? null : `${formatInteger(audio.sampleRate)} Hz`),
        row('Channels', formatChannels(audio.channels)),
        row('Bits per sample', audio.bitsPerSample === null ? null : String(audio.bitsPerSample)),
        row('Bitrate', audio.bitrate === null ? null : `${formatInteger(Math.round(audio.bitrate / 1000))} kbps`),
        row('Codec', audio.codec), row('Codec profile', audio.codecProfile), row('Container', audio.container),
        row('Encoding', audio.lossless === null ? null : audio.lossless ? 'Lossless' : 'Lossy'),
        row('Encoder tool', audio.encoderTool), row('Tag types', join(audio.tagTypes)), row('Audio MD5', audio.audioMd5),
      ]),
      section('File', [
        row('File name', file.fileName), row('Full path', file.path, true),
        row('File size', formatFileSize(file.fileSize)), row('Last modified', formatDate(file.lastModified)),
      ]),
    ].filter((item) => item.rows.length > 0);
  });

  constructor() {
    effect(() => {
      const isOpen = this.visible();
      const track = this.subject();
      if (!isOpen || !track) {
        this.abortResize();
        this.requestVersion++;
        this.loading.set(false);
        this.details.set(null);
        this.error.set(null);
        return;
      }
      queueMicrotask(() => this.applyRequestedWidth(this.rightPanels.trackDetailsWidth()));
      void this.load(track.id);
    });
    effect(() => {
      const requested = this.rightPanels.trackDetailsWidth();
      if (this.open()) queueMicrotask(() => this.applyRequestedWidth(requested));
    });
  }

  ngAfterViewInit(): void {
    const handle = this.resizeHandle().nativeElement;
    this.zone.runOutsideAngular(() => {
      const options = { signal: this.pointerListeners.signal };
      handle.addEventListener('pointerdown', this.nativePointerDown, options);
      handle.addEventListener('pointermove', this.nativePointerMove, options);
      handle.addEventListener('pointerup', this.nativePointerEnd, options);
      handle.addEventListener('pointercancel', this.nativePointerEnd, options);
    });
  }

  ngOnDestroy(): void {
    this.requestVersion++;
    this.pointerListeners.abort();
    this.abortResize();
  }
  retry(): void { const track = this.subject(); if (track) void this.load(track.id); }

  onResizeStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.effectiveWidth();
    this.pendingWidth = this.resizeStartWidth;
    this.gestureMaxWidth = this.measureMaximumWidth();
    const handle = this.resizeHandle().nativeElement;
    const host = this.host.nativeElement;
    handle.classList.add('dragging');
    host.classList.add('resizing');
    host.style.setProperty('--drag-width', `${this.pendingWidth}px`);
    handle.setAttribute('aria-valuemax', String(this.gestureMaxWidth));
    handle.setAttribute('aria-valuenow', String(this.pendingWidth));
    this.previousBodyCursor = document.body.style.cursor;
    this.previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    try { handle.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer event. */ }
    event.preventDefault();
  }
  onResizeMove(event: PointerEvent): void {
    if (!this.resizing) return;
    this.pendingWidth = clamp(this.resizeStartWidth + this.resizeStartX - event.clientX, MIN_WIDTH, this.gestureMaxWidth);
    if (this.resizeFrameId === null) {
      this.resizeFrameId = requestAnimationFrame(() => this.applyDragWidth());
    }
  }
  onResizeEnd(event: PointerEvent): void {
    if (!this.resizing) return;
    if (event.type === 'pointerup') {
      this.pendingWidth = clamp(this.resizeStartWidth + this.resizeStartX - event.clientX, MIN_WIDTH, this.gestureMaxWidth);
    }
    this.resizing = false;
    const handle = this.resizeHandle().nativeElement;
    this.cancelResizeFrame();
    this.applyDragWidth();
    try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch { /* Capture already released. */ }
    const committedWidth = this.pendingWidth;
    this.host.nativeElement.style.setProperty('--track-details-width', `${committedWidth}px`);
    this.cleanupResizeAppearance();
    this.zone.run(() => {
      this.effectiveWidth.set(committedWidth);
      this.rightPanels.setTrackDetailsWidth(committedWidth);
    });
  }
  onResizeKeyDown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;
    let width: number | null = null;
    if (event.key === 'ArrowLeft') width = this.effectiveWidth() + step;
    else if (event.key === 'ArrowRight') width = this.effectiveWidth() - step;
    else if (event.key === 'Home') width = MIN_WIDTH;
    else if (event.key === 'End') width = this.maxWidth();
    if (width === null) return;
    event.preventDefault();
    this.setWidth(width);
  }
  resetWidth(): void { this.setWidth(DEFAULT_WIDTH); }

  @HostListener('window:resize')
  onWindowResize(): void { if (this.open()) this.applyRequestedWidth(this.rightPanels.trackDetailsWidth()); }

  private setWidth(width: number): void {
    const clamped = this.clampWidth(width);
    this.effectiveWidth.set(clamped);
    this.rightPanels.setTrackDetailsWidth(clamped);
  }
  private applyRequestedWidth(width: number): void { this.effectiveWidth.set(this.clampWidth(width)); }
  private clampWidth(width: number): number {
    const maximum = this.measureMaximumWidth();
    return clamp(width, MIN_WIDTH, maximum);
  }

  private measureMaximumWidth(): number {
    const host = this.host.nativeElement;
    const sibling = host.previousElementSibling as HTMLElement | null;
    const main = sibling?.classList.contains('main-content') ? sibling : null;
    const available = main ? main.getBoundingClientRect().width + host.getBoundingClientRect().width : 0;
    const maximum = Math.round(main && available > 0
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, available - MIN_MAIN_WIDTH))
      : MAX_WIDTH);
    this.maxWidth.set(maximum);
    return maximum;
  }

  private applyDragWidth(): void {
    this.resizeFrameId = null;
    const width = Math.round(this.pendingWidth);
    this.host.nativeElement.style.setProperty('--drag-width', `${width}px`);
    this.resizeHandle().nativeElement.setAttribute('aria-valuenow', String(width));
  }

  private cancelResizeFrame(): void {
    if (this.resizeFrameId === null) return;
    cancelAnimationFrame(this.resizeFrameId);
    this.resizeFrameId = null;
  }

  private cleanupResizeAppearance(): void {
    const host = this.host.nativeElement;
    host.classList.remove('resizing');
    host.style.removeProperty('--drag-width');
    this.resizeHandle().nativeElement.classList.remove('dragging');
    document.body.style.cursor = this.previousBodyCursor;
    document.body.style.userSelect = this.previousBodyUserSelect;
  }

  private abortResize(): void {
    if (!this.resizing) {
      this.cancelResizeFrame();
      return;
    }
    this.resizing = false;
    this.cancelResizeFrame();
    this.pendingWidth = this.effectiveWidth();
    this.cleanupResizeAppearance();
  }

  private readonly nativePointerDown = (event: PointerEvent): void => this.onResizeStart(event);
  private readonly nativePointerMove = (event: PointerEvent): void => this.onResizeMove(event);
  private readonly nativePointerEnd = (event: PointerEvent): void => this.onResizeEnd(event);
  private async load(trackId: string): Promise<void> {
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.error.set(null);
    this.details.set(null);
    try {
      const details = await this.libraryGateway.getTrackDetails(trackId);
      if (version !== this.requestVersion || trackId !== this.subject()?.id || !this.visible()) return;
      this.details.set(details);
    } catch {
      if (version !== this.requestVersion || trackId !== this.subject()?.id || !this.visible()) return;
      this.error.set('The source file may be missing, locked, corrupt, or outside the registered library.');
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }
}

function section(title: string, rows: Array<PropertyRow | null>): PropertySection {
  return { title, rows: rows.filter((item): item is PropertyRow => item !== null) };
}
function row(name: string, value: string | null, path = false): PropertyRow | null {
  return value === null || value === '' ? null : { name, value, path };
}
function join(values: string[]): string | null { return values.length ? values.join(', ') : null; }
function formatNumber(value: number | null): string | null { return value === null ? null : String(value); }
function formatInteger(value: number): string { return Math.round(value).toLocaleString('en-US'); }
function formatDuration(duration: number | null, samples: number | null): string | null {
  if (duration === null) return null;
  const totalMilliseconds = Math.max(0, Math.round(duration * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  return samples === null ? clock : `${clock} (${formatInteger(samples)} samples)`;
}
function formatChannels(channels: number | null): string | null {
  if (channels === null) return null;
  if (channels === 1) return 'Mono (1 ch)';
  if (channels === 2) return 'Stereo (2 ch)';
  return `${channels} ch`;
}
function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString('en-US', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}
function formatDate(timestamp: number | null): string | null {
  return timestamp === null ? null : new Date(timestamp).toLocaleString();
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.max(minimum, Math.min(maximum, value)));
}
