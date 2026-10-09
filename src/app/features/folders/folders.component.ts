import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { LIBRARY_GATEWAY, LYRICS_GATEWAY } from '../../core/contracts';
import { FolderNode, MusicFolder, ScanProgress, Track } from '../../core/models';
import { trackQuality } from '../home/library-quality';
import { PlayerService } from '../../core/player/player.service';
import { QueueActionsService } from '../../core/player/queue-actions.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { TrackActionsMenuComponent } from '../../shared/components/track-actions-menu/track-actions-menu.component';
import { ConfirmRemoveFolderDialogComponent } from '../../shared/components/confirm-remove-folder-dialog/confirm-remove-folder-dialog.component';

interface FolderSummary {
  trackCount: number;
  duration: number;
  artwork: string | null;
}

const EMPTY_FOLDER_SUMMARY: FolderSummary = { trackCount: 0, duration: 0, artwork: null };

@Component({
  selector: 'app-folders',
  standalone: true,
  imports: [CommonModule, FormsModule, DurationPipe, IconComponent, ConfirmRemoveFolderDialogComponent, TrackActionsMenuComponent],
  templateUrl: './folders.component.html',
  styleUrl: './folders.component.scss'
})
export class FoldersComponent implements OnInit, OnDestroy {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly lyricsGateway = inject(LYRICS_GATEWAY);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);
  private readonly sub = new Subscription();
  private rootsLoaded = false;
  private loadVersion = 0;
  private selectionVersion = 0;
  private lyricsRequestVersion = 0;

  readonly roots = signal<MusicFolder[]>([]);
  readonly folderTrees = signal<ReadonlyMap<string, FolderNode>>(new Map());
  readonly unavailableRootIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedRootId = signal<string | null>(null);
  readonly nodeStack = signal<FolderNode[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly tracksById = computed(() => new Map(this.allTracks().map((track) => [track.id, track])));
  readonly folderSummaries = computed(() => {
    const summaries = new Map<string, FolderSummary>();
    const tracks = this.tracksById();
    const summarize = (node: FolderNode): FolderSummary => {
      let trackCount = 0;
      let duration = 0;
      let artwork: string | null = null;
      for (const child of [...(node.children ?? [])].sort(compareFolderNodes)) {
        if (child.isFolder) {
          const childSummary = summarize(child);
          trackCount += childSummary.trackCount;
          duration += childSummary.duration;
          artwork ??= childSummary.artwork;
        } else {
          const track = child.trackId ? tracks.get(child.trackId) : undefined;
          if (!track) continue;
          trackCount++;
          duration += Number.isFinite(track.duration) ? Math.max(0, track.duration) : 0;
          artwork ??= track.artwork;
        }
      }
      const summary = { trackCount, duration, artwork };
      summaries.set(node.id, summary);
      return summary;
    };
    for (const tree of this.folderTrees().values()) summarize(tree);
    return summaries;
  });
  readonly failedArtworks = signal<ReadonlySet<string>>(new Set());
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
  readonly removingFolder = signal(false);

  selectedRoot = () => this.roots().find((r) => r.id === this.selectedRootId()) || null;
  sortedRoots = () => [...this.roots()].sort((a, b) => compareFolderNames(a.name, b.name) || a.id.localeCompare(b.id));
  rootParentName = (root: MusicFolder): string => {
    const parent = root.path.split(/[\\/]+/).filter(Boolean).at(-2);
    return parent && !/^[a-z]:$/i.test(parent) ? parent : 'Music root';
  };
  currentNode = () => {
    const stack = this.nodeStack();
    return stack.length > 0 ? stack[stack.length - 1] : null;
  };
  subfolders = () => {
    const curr = this.currentNode();
    return curr?.children?.filter((c) => c.isFolder).sort(compareFolderNodes) || [];
  };
  folderSummary = (node: FolderNode | null | undefined): FolderSummary =>
    node ? this.folderSummaries().get(node.id) ?? EMPTY_FOLDER_SUMMARY : EMPTY_FOLDER_SUMMARY;
  artworkFor = (node: FolderNode | null | undefined): string | null => {
    const artwork = this.folderSummary(node).artwork;
    return artwork && !this.failedArtworks().has(artwork) ? artwork : null;
  };

  onArtworkError(artwork: string): void {
    this.failedArtworks.update((failed) => new Set([...failed, artwork]));
  }

  readonly overviewArtworks = computed(() => {
    const artworks = new Set<string>();
    const trees = this.folderTrees();
    for (const root of this.roots()) {
      const tree = trees.get(root.id);
      const artwork = this.artworkFor(tree);
      if (artwork) artworks.add(artwork);
      if (artworks.size === 4) break;
    }
    return [...artworks];
  });
  readonly filesInCurrentFolder = computed(() => {
    const curr = this.currentNode();
    return (curr?.children?.filter((child) => !child.isFolder) ?? [])
      .sort(compareFolderFiles);
  });
  readonly currentFolderTracks = computed(() => this.filesInCurrentFolder()
    .flatMap((file) => {
      const track = file.trackId ? this.tracksById().get(file.trackId) : undefined;
      return track ? [track] : [];
    }));
  readonly hasAvailableFolderTracks = computed(() => this.currentFolderTracks().some((track) => track.isAvailable));

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
      this.folderTrees.set(new Map());
      this.unavailableRootIds.set(new Set());
      this.failedArtworks.set(new Set());
      const treeResults = await Promise.allSettled(lib.folders.map((folder) => this.libraryGateway.getFolderTree(folder.id)));
      if (loadVersion !== this.loadVersion) return;
      const trees = new Map<string, FolderNode>();
      const unavailable = new Set<string>();
      treeResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) trees.set(lib.folders[index].id, result.value);
        else unavailable.add(lib.folders[index].id);
      });
      this.folderTrees.set(trees);
      this.unavailableRootIds.set(unavailable);
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

  onNavigateOverview(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { root: null, folder: null },
    });
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
    const root = requestedRootId ? this.roots().find((item) => item.id === requestedRootId) : undefined;
    if (!root) {
      this.selectedRootId.set(null);
      this.nodeStack.set([]);
      this.errorMessage.set(null);
      this.isLoading.set(false);
      if (requestedRootId || params.getAll('folder').length) this.replaceFolderUrl(null, []);
      return;
    }

    this.selectedRootId.set(root.id);
    this.nodeStack.set([]);
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      let tree = this.folderTrees().get(root.id);
      if (!tree) {
        const fetchedTree = await this.libraryGateway.getFolderTree(root.id);
        if (version !== this.selectionVersion) return;
        if (fetchedTree) {
          tree = fetchedTree;
          this.folderTrees.update((current) => new Map(current).set(root.id, fetchedTree));
          this.unavailableRootIds.update((current) => {
            const next = new Set(current);
            next.delete(root.id);
            return next;
          });
        }
      }
      if (!tree) throw new Error(`Folder tree is unavailable for ${root.name}`);
      const stack: FolderNode[] = [tree];
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

  async onScanCurrentFolder(): Promise<void> {
    const rootId = this.selectedRootId();
    const node = this.currentNode();
    if (!rootId || !node || this.nodeStack().length < 2) return;
    this.errorMessage.set(null);
    try {
      await this.libraryGateway.requestFolderScan(rootId, node.path);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to request folder scan');
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
    if (!rootId || !this.showRemoveDialog() || this.removingFolder()) return;

    this.removingFolder.set(true);
    try {
      await this.libraryGateway.removeMusicFolder(rootId);
      this.showRemoveDialog.set(false);
      this.selectedRootId.set(null);
      await this.loadRoots();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to remove folder');
    } finally {
      this.removingFolder.set(false);
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
    const tracks = this.currentFolderTracks();
    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }

  onAddFolderFilesToQueue(): void {
    this.queueActions.add(this.currentFolderTracks());
  }


  isHiRes(track: Track): boolean {
    return trackQuality(track) === 'hires';
  }
}

const fileNameCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

function compareFolderNames(a: string, b: string): number {
  return fileNameCollator.compare(a, b);
}

function compareFolderNodes(a: FolderNode, b: FolderNode): number {
  return compareFolderNames(a.name, b.name)
    || compareFolderNames(a.path, b.path)
    || a.id.localeCompare(b.id);
}

function compareFolderFiles(a: FolderNode, b: FolderNode): number {
  return compareFolderNodes(a, b);
}
