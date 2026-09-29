import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { LIBRARY_GATEWAY } from '../../../core/contracts';
import { Album, orderAlbumTracks, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface DiscGroup {
  discNumber: number;
  tracks: Track[];
}

@Component({
  selector: 'app-album-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, DurationPipe, IconComponent],
  templateUrl: './album-detail.component.html',
  styleUrl: './album-detail.component.scss'
})
export class AlbumDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly player = inject(PlayerService);

  readonly album = signal<Album | null>(null);
  readonly albumTracks = signal<Track[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly orderedAlbumTracks = computed<Track[]>(() => orderAlbumTracks(this.albumTracks()));

  readonly discGroups = computed<DiscGroup[]>(() => {
    const tracks = this.orderedAlbumTracks();
    const map = new Map<number, Track[]>();

    tracks.forEach((t) => {
      const disc = t.discNumber ?? 1;
      if (!map.has(disc)) map.set(disc, []);
      map.get(disc)!.push(t);
    });

    const groups: DiscGroup[] = [];
    map.forEach((discTracks, discNumber) => {
      groups.push({ discNumber, tracks: discTracks });
    });

    return groups;
  });

  readonly totalDuration = computed<string>(() => {
    const totalSecs = this.albumTracks().reduce((acc, t) => acc + t.duration, 0);
    const mins = Math.floor(totalSecs / 60);
    return `${mins} min`;
  });

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadAlbum();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadAlbum());
    await this.loadAlbum();
  }

  private async loadAlbum(): Promise<void> {
    const albumId = this.route.snapshot.paramMap.get('id');
    if (!albumId) {
      this.isLoading.set(false);
      return;
    }

    try {
      const lib = await this.libraryGateway.getLibrary();
      const foundAlbum = lib.albums.find((a) => a.id === albumId) || null;
      this.album.set(foundAlbum);
      if (!foundAlbum) this.albumTracks.set([]);

      if (foundAlbum) {
        const trackMap = new Map<string, Track>();
        lib.tracks.forEach((t) => trackMap.set(t.id, t));

        const tracks: Track[] = [];
        foundAlbum.trackIds.forEach((id) => {
          const t = trackMap.get(id);
          if (t) tracks.push(t);
        });

        this.albumTracks.set(tracks);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  onPlayAll(): void {
    const tracks = this.orderedAlbumTracks();
    if (tracks.length > 0) {
      this.player.setShuffle(false);
      this.player.playCollection(tracks, 0);
    }
  }

  onShufflePlay(): void {
    const tracks = this.orderedAlbumTracks();
    if (tracks.length > 0) {
      this.player.setShuffle(true);
      this.player.playCollection(tracks, 0);
    }
  }

  onPlayTrack(track: Track): void {
    if (!track.isAvailable) return;
    const tracks = this.orderedAlbumTracks();
    const idx = tracks.findIndex((t) => t.id === track.id);
    this.player.setShuffle(false);
    this.player.playCollection(tracks, Math.max(0, idx));
  }
}
