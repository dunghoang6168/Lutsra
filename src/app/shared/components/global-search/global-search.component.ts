import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { LIBRARY_GATEWAY, type LibrarySnapshot } from '../../../core/contracts/library.gateway';
import type { Album, Artist, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { IconComponent } from '../icon/icon.component';

type SearchKind = 'song' | 'album' | 'artist';

interface SearchResult {
  key: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  artwork: string | null;
  disabled: boolean;
  item: Track | Album | Artist;
}

interface SearchGroup {
  label: string;
  results: SearchResult[];
}

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './global-search.component.html',
  styleUrl: './global-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalSearchComponent {
  private readonly gateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly player = inject(PlayerService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly inputElement = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly snapshot = signal<LibrarySnapshot | null>(null);
  private requestVersion = 0;

  readonly query = signal('');
  readonly isOpen = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly activeKey = signal<string | null>(null);
  readonly hasQuery = computed(() => this.query().trim().length > 0);
  readonly groups = computed<SearchGroup[]>(() => buildGroups(this.snapshot(), this.query()));
  readonly flatResults = computed(() => this.groups().flatMap((group) => group.results));

  constructor() {
    let wasScanning = false;
    this.gateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) this.refreshIfOpen();
    });
    this.gateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshIfOpen());
  }

  focus(): void {
    this.inputElement().nativeElement.focus();
    if (!this.isOpen()) this.openSearch();
  }

  openSearch(): void {
    this.isOpen.set(true);
    void this.loadSnapshot();
  }

  close(): void {
    this.isOpen.set(false);
    this.activeKey.set(null);
    this.requestVersion++;
  }

  reload(): void { void this.loadSnapshot(); }
  refreshIfOpen(): void { if (this.isOpen()) void this.loadSnapshot(); }

  updateQuery(event: Event): void {
    this.query.set((event.currentTarget as HTMLInputElement).value);
    this.activeKey.set(firstSelectable(this.flatResults())?.key ?? null);
  }

  clear(): void {
    this.query.set('');
    this.activeKey.set(null);
    this.inputElement().nativeElement.focus();
  }

  setActive(result: SearchResult): void {
    if (!result.disabled) this.activeKey.set(result.key);
  }

  onSearchKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      this.inputElement().nativeElement.blur();
      return;
    }
    if (event.key === 'Tab') { this.close(); return; }
    const selectable = this.flatResults().filter((result) => !result.disabled);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!selectable.length) return;
      event.preventDefault();
      this.isOpen.set(true);
      const currentIndex = selectable.findIndex((result) => result.key === this.activeKey());
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (delta > 0 ? 0 : selectable.length - 1)
        : (currentIndex + delta + selectable.length) % selectable.length;
      this.activeKey.set(selectable[nextIndex].key);
      return;
    }
    if (event.key === 'Enter') {
      const selected = selectable.find((result) => result.key === this.activeKey()) ?? selectable[0];
      if (!selected) return;
      event.preventDefault();
      void this.activate(selected);
    }
  }

  async activate(result: SearchResult): Promise<void> {
    if (result.disabled) return;
    if (result.kind === 'song') await this.player.playTrack(result.item as Track);
    else await this.router.navigate([result.kind === 'album' ? '/albums' : '/artists', result.item.id]);
    this.close();
  }

  optionId(key: string): string { return `global-search-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`; }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  private async loadSnapshot(): Promise<void> {
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.error.set(null);
    try {
      const snapshot = await this.gateway.getLibrary();
      if (version !== this.requestVersion || !this.isOpen()) return;
      this.snapshot.set(snapshot);
      this.activeKey.set(firstSelectable(this.flatResults())?.key ?? null);
    } catch {
      if (version !== this.requestVersion || !this.isOpen()) return;
      this.error.set('Local library could not be searched.');
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }
}

function buildGroups(snapshot: LibrarySnapshot | null, rawQuery: string): SearchGroup[] {
  const query = normalize(rawQuery.trim());
  if (!snapshot || !query) return [
    { label: 'Songs', results: [] },
    { label: 'Albums', results: [] },
    { label: 'Artists', results: [] },
  ];
  return [
    {
      label: 'Songs',
      results: rank(snapshot.tracks, query, (track) => track.title, (track) => [track.artist, track.album, track.fileName])
        .slice(0, 5)
        .map((track) => ({
          key: `song-${track.id}`, kind: 'song', title: track.title,
          subtitle: [track.artist, track.album].filter(Boolean).join(' · ') || track.fileName,
          artwork: track.artwork, disabled: !track.isAvailable, item: track,
        })),
    },
    {
      label: 'Albums',
      results: rank(snapshot.albums, query, (album) => album.title, (album) => [album.artist])
        .slice(0, 5)
        .map((album) => ({
          key: `album-${album.id}`, kind: 'album', title: album.title,
          subtitle: album.artist || 'Unknown Artist', artwork: album.artwork, disabled: false, item: album,
        })),
    },
    {
      label: 'Artists',
      results: rank(snapshot.artists, query, (artist) => artist.name, () => [])
        .slice(0, 5)
        .map((artist) => ({
          key: `artist-${artist.id}`, kind: 'artist', title: artist.name,
          subtitle: `${artist.trackIds.length} tracks`, artwork: null, disabled: false, item: artist,
        })),
    },
  ];
}

function rank<T>(items: T[], query: string, primary: (item: T) => string, secondary: (item: T) => Array<string | null>): T[] {
  return items
    .map((item, index) => ({ item, index, score: matchScore(primary(item), secondary(item), query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

function matchScore(primary: string, secondary: Array<string | null>, query: string): number {
  const normalizedPrimary = normalize(primary);
  if (normalizedPrimary.startsWith(query)) return 0;
  if (normalizedPrimary.includes(query)) return 1;
  const normalizedSecondary = secondary.filter((value): value is string => Boolean(value)).map(normalize);
  if (normalizedSecondary.some((value) => value.startsWith(query))) return 2;
  if (normalizedSecondary.some((value) => value.includes(query))) return 3;
  return Number.POSITIVE_INFINITY;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('đ', 'd');
}

function firstSelectable(results: SearchResult[]): SearchResult | undefined {
  return results.find((result) => !result.disabled);
}
