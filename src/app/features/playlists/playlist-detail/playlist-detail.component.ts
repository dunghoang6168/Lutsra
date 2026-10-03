import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../../core/contracts';
import { Playlist, PlaylistEntry, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface PlaylistTrackRow {
  entry: PlaylistEntry;
  track: Track;
}

@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DurationPipe, IconComponent],
  templateUrl: './playlist-detail.component.html',
  styleUrl: './playlist-detail.component.scss'
})
export class PlaylistDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);

  readonly playlist = signal<Playlist | null>(null);
  readonly allLibraryTracks = signal<Track[]>([]);
  readonly entryTracks = signal<ReadonlyMap<string, Track>>(new Map());
  readonly isLoading = signal<boolean>(true);
  readonly showAddTracksModal = signal<boolean>(false);

  readonly trackRows = computed<PlaylistTrackRow[]>(() => {
    const pl = this.playlist();
    if (!pl) return [];

    const trackMap = this.entryTracks();

    const rows: PlaylistTrackRow[] = [];
    pl.entries.forEach((entry) => {
      const track = trackMap.get(entry.trackId);
      if (track) {
        rows.push({ entry, track });
      }
    });

    return rows;
  });

  readonly totalDuration = computed<string>(() => {
    const totalSecs = this.trackRows().reduce((acc, r) => acc + r.track.duration, 0);
    const mins = Math.floor(totalSecs / 60);
    return `${mins} min`;
  });

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadPlaylist();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadPlaylist());
    await this.loadPlaylist();
  }

  async loadPlaylist(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    try {
      const [playlists, lib] = await Promise.all([
        this.playlistGateway.getPlaylists(),
        this.libraryGateway.getLibrary(),
      ]);
      const found = playlists.find((p) => p.id === id) || null;
      const libraryTracks = new Map(lib.tracks.map((track) => [track.id, track]));
      const missingIds = [...new Set(found?.entries.map((entry) => entry.trackId) ?? [])]
        .filter((trackId) => !libraryTracks.has(trackId));
      const missingTracks = await Promise.all(missingIds.map((trackId) => this.libraryGateway.getTrackById(trackId)));
      missingTracks.forEach((track) => { if (track) libraryTracks.set(track.id, track); });
      this.playlist.set(found);
      this.allLibraryTracks.set(lib.tracks);
      this.entryTracks.set(libraryTracks);
    } finally {
      this.isLoading.set(false);
    }
  }

  async onMoveUp(index: number): Promise<void> {
    const pl = this.playlist();
    if (!pl || index <= 0) return;

    const entries = [...pl.entries];
    const temp = entries[index - 1];
    entries[index - 1] = entries[index];
    entries[index] = temp;

    const entryIds = entries.map((e) => e.id);
    const updated = await this.playlistGateway.reorderEntries(pl.id, entryIds);
    this.playlist.set(updated);
  }

  async onMoveDown(index: number): Promise<void> {
    const pl = this.playlist();
    if (!pl || index >= pl.entries.length - 1) return;

    const entries = [...pl.entries];
    const temp = entries[index + 1];
    entries[index + 1] = entries[index];
    entries[index] = temp;

    const entryIds = entries.map((e) => e.id);
    const updated = await this.playlistGateway.reorderEntries(pl.id, entryIds);
    this.playlist.set(updated);
  }

  async onRemoveEntry(entryId: string): Promise<void> {
    const pl = this.playlist();
    if (!pl) return;
    const updated = await this.playlistGateway.removeEntry(pl.id, entryId);
    this.playlist.set(updated);
  }

  async onAddSingleTrack(trackId: string): Promise<void> {
    const pl = this.playlist();
    if (!pl) return;
    const updated = await this.playlistGateway.addTracks(pl.id, [trackId]);
    this.playlist.set(updated);
  }

  onPlayAll(): void {
    const tracks = this.trackRows().map((r) => r.track).filter((track) => track.isAvailable);
    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }

  onShufflePlay(): void {
    const tracks = this.trackRows().map((r) => r.track).filter((track) => track.isAvailable);
    if (tracks.length > 0) {
      if (!this.player.isShuffle()) {
        this.player.toggleShuffle();
      }
      this.player.playCollection(tracks, 0);
    }
  }

  onPlayRow(index: number): void {
    const tracks = this.trackRows().map((r) => r.track);
    if (index >= 0 && index < tracks.length) {
      if (!tracks[index].isAvailable) return;
      this.player.playCollection(tracks, index);
    }
  }

  onAddAllToQueue(): void {
    this.queueActions.add(this.trackRows().map((row) => row.track));
  }

  onAddTrackToQueue(track: Track): void {
    this.queueActions.add([track]);
  }
}
