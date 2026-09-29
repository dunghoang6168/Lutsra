import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { LIBRARY_GATEWAY, LYRICS_GATEWAY } from '../../core/contracts';
import { FolderNode, MusicFolder, ScanProgress, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-folders',
  standalone: true,
  imports: [CommonModule, FormsModule, DurationPipe, IconComponent],
  templateUrl: './folders.component.html',
  styleUrl: './folders.component.scss'
})
export class FoldersComponent implements OnInit, OnDestroy {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly lyricsGateway = inject(LYRICS_GATEWAY);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly player = inject(PlayerService);
  private readonly sub = new Subscription();
  private rootsLoaded = false;
  private loadVersion = 0;
  private selectionVersion = 0;
  private loadedRootId: string | null = null;
  private loadedTree: FolderNode | null = null;
  private lyricsRequestVersion = 0;

  readonly roots = signal<MusicFolder[]>([]);
  readonly selectedRootId = signal<string | null>(null);
  readonly nodeStack = signal<FolderNode[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly tracksById = computed(() => new Map(this.allTracks().map((track) => [track.id, track])));
  readonly lyricTrackIds = signal<ReadonlySet<string>>(new Set());
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);

  // Scan State
  readonly scanProgress = signal<ScanProgress>({
    isScanning: false,
    scannedFiles: 0,
    audioFiles: 0,
    currentPath: null,
  });

  // Modal Dialogs
  readonly showRemoveDialog = signal<boolean>(false);

  selectedRoot = () => this.roots().find((r) => r.id === this.selectedRootId()) || null;
  currentNode = () => {
    const stack = this.nodeStack();
    return stack.length > 0 ? stack[stack.length - 1] : null;
  };
  subfolders = () => {
    const curr = this.currentNode();
    return curr?.children?.filter((c) => c.isFolder) || [];
  };
  readonly filesInCurrentFolder = computed(() => {
    const curr = this.currentNode();
    return (curr?.children?.filter((child) => !child.isFolder) ?? [])
      .sort(compareFolderFiles);
  });

  constructor() {
    effect(() => {
      const trackIds = this.filesInCurrentFolder().flatMap((file) => file.trackId ? [file.trackId] : []);
      const version = ++this.lyricsRequestVersion;
      this.lyricTrackIds.set(new Set());
      if (!trackIds.length) return;
      void this.lyricsGateway.findTracksWithLyrics(trackIds).then((found) => {
        if (version === this.lyricsRequestVersion) this.lyricTrackIds.set(new Set(found));
      }).catch(() => {
        if (version === this.lyricsRequestVersion) this.lyricTrackIds.set(new Set());
      });
    });
  }

  async ngOnInit(): Promise<void> {
    this.sub.add(this.route.queryParamMap.subscribe(() => {
      if (this.rootsLoaded) void this.syncSelectionFromUrl();
    }));
    let wasScanning = false;
    this.sub.add(
      this.libraryGateway.scanProgress$.subscribe(async (prog) => {
        const justFinished = wasScanning && !prog.isScanning;
        wasScanning = prog.isScanning;
        this.scanProgress.set(prog);

        if (justFinished) {
          await this.loadRoots();
        }
      })
    );
    if (this.libraryGateway.libraryChanged$) {
      this.sub.add(this.libraryGateway.libraryChanged$.subscribe(() => void this.loadRoots()));
    }

    await this.loadRoots();
  }

  ngOnDestroy(): void {
    ++this.lyricsRequestVersion;
    this.sub.unsubscribe();
  }

  async loadRoots(): Promise<void> {
    const loadVersion = ++this.loadVersion;
    ++this.selectionVersion;
    this.rootsLoaded = false;
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const lib = await this.libraryGateway.getLibrary();
      if (loadVersion !== this.loadVersion) return;
      this.roots.set(lib.folders);
      this.allTracks.set(lib.tracks);
      this.loadedRootId = null;
      this.loadedTree = null;
      this.rootsLoaded = true;
      await this.syncSelectionFromUrl();
    } catch (err: any) {
      if (loadVersion !== this.loadVersion) return;
      this.errorMessage.set(err?.message || 'Failed to load music folders');
    } finally {
      if (loadVersion === this.loadVersion) this.isLoading.set(false);
    }
  }

  onSelectRoot(root: MusicFolder): void {
    if (root.id === this.selectedRootId() && this.nodeStack().length === 1) return;
    this.navigateToFolder(root.id, []);
  }

  onEnterFolder(node: FolderNode): void {
    if (!node.isFolder || !this.selectedRootId()) return;
    this.navigateToFolder(this.selectedRootId()!, [...this.nodeStack().slice(1).map((item) => item.id), node.id]);
  }

  onNavigateBreadcrumb(index: number): void {
    if (!this.selectedRootId() || index < 0 || index >= this.nodeStack().length - 1) return;
    this.navigateToFolder(this.selectedRootId()!, this.nodeStack().slice(1, index + 1).map((item) => item.id));
  }

  private navigateToFolder(rootId: string, folderIds: string[]): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { root: rootId, folder: folderIds.length ? folderIds : null },
    });
  }

  private async syncSelectionFromUrl(): Promise<void> {
    const version = ++this.selectionVersion;
    const params = this.route.snapshot.queryParamMap;
    const requestedRootId = params.get('root');
    const root = this.roots().find((item) => item.id === requestedRootId) ?? this.roots()[0];
    if (!root) {
      this.selectedRootId.set(null);
      this.nodeStack.set([]);
      if (requestedRootId || params.getAll('folder').length) this.replaceFolderUrl(null, []);
      return;
    }

    this.selectedRootId.set(root.id);
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      if (this.loadedRootId !== root.id) {
        const tree = await this.libraryGateway.getFolderTree(root.id);
        if (version !== this.selectionVersion) return;
        this.loadedRootId = root.id;
        this.loadedTree = tree;
      }
      const stack: FolderNode[] = this.loadedTree ? [this.loadedTree] : [];
      const requestedFolders = params.getAll('folder');
      for (const id of requestedFolders) {
        const child = stack.at(-1)?.children?.find((item) => item.isFolder && item.id === id);
        if (!child) break;
        stack.push(child);
      }
      if (version !== this.selectionVersion) return;
      this.nodeStack.set(stack);
      if ((requestedRootId && requestedRootId !== root.id) || stack.length - 1 !== requestedFolders.length) {
        this.replaceFolderUrl(root.id, stack.slice(1).map((item) => item.id));
      }
    } catch (err: any) {
      if (version === this.selectionVersion) this.errorMessage.set(err?.message || `Failed to load folder tree for ${root.name}`);
    } finally {
      if (version === this.selectionVersion) this.isLoading.set(false);
    }
  }

  private replaceFolderUrl(rootId: string | null, folderIds: string[]): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { root: rootId, folder: folderIds.length ? folderIds : null },
      replaceUrl: true,
    });
  }

  async onStartScan(): Promise<void> {
    const root = this.selectedRoot();
    this.errorMessage.set(null);
    try {
      await this.libraryGateway.requestScan(root ? [root.id] : undefined);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to request scan');
    }
  }

  async onAddFolder(): Promise<void> {
    this.errorMessage.set(null);
    try {
      const selected = await this.libraryGateway.selectAndAddMusicFolders();
      if (selected && selected.length > 0) {
        await this.loadRoots();
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to select or add folder');
    }
  }

  async onConfirmRemoveRoot(): Promise<void> {
    const rootId = this.selectedRootId();
    if (!rootId) return;

    try {
      await this.libraryGateway.removeMusicFolder(rootId);
      this.showRemoveDialog.set(false);
      this.selectedRootId.set(null);
      await this.loadRoots();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to remove folder');
    }
  }

  onPlayFile(fileNode: FolderNode): void {
    if (!fileNode.trackId) return;
    const track = this.allTracks().find((t) => t.id === fileNode.trackId);
    if (track && track.isAvailable) {
      this.player.playTrack(track);
    }
  }

  onPlayFolderFiles(): void {
    const files = this.filesInCurrentFolder();
    const trackMap = new Map<string, Track>();
    this.allTracks().forEach((t) => trackMap.set(t.id, t));

    const tracks: Track[] = [];
    files.forEach((f) => {
      if (f.trackId) {
        const t = trackMap.get(f.trackId);
        if (t) tracks.push(t);
      }
    });

    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }

  isHiRes(track: Track): boolean {
    return (track.sampleRate !== null && track.sampleRate > 48000) ||
      (track.bitDepth !== null && track.bitDepth > 16);
  }
}

const fileNameCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

function compareFolderFiles(a: FolderNode, b: FolderNode): number {
  return fileNameCollator.compare(a.name, b.name)
    || fileNameCollator.compare(a.path, b.path)
    || a.id.localeCompare(b.id);
}
