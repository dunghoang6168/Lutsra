import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../core/contracts';
import { Playlist, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-playlists',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent],
  templateUrl: './playlists.component.html',
  styleUrl: './playlists.component.scss'
})
export class PlaylistsComponent implements OnInit {
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly player = inject(PlayerService);

  readonly playlists = signal<Playlist[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);

  // Modals state
  readonly showCreateModal = signal<boolean>(false);
  newPlaylistName = '';

  readonly playlistToRename = signal<Playlist | null>(null);
  renameValue = '';

  readonly playlistToDelete = signal<Playlist | null>(null);

  async ngOnInit(): Promise<void> {
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadData());
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const [plist, lib] = await Promise.all([
        this.playlistGateway.getPlaylists(),
        this.libraryGateway.getLibrary(),
      ]);
      this.playlists.set(plist);
      this.allTracks.set(lib.tracks);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load playlists');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onConfirmCreate(): Promise<void> {
    const name = this.newPlaylistName.trim();
    if (!name) return;
    this.errorMessage.set(null);
    try {
      await this.playlistGateway.createPlaylist(name);
      this.newPlaylistName = '';
      this.showCreateModal.set(false);
      await this.loadData();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to create playlist');
    }
  }

  onOpenRename(event: MouseEvent, playlist: Playlist): void {
    event.stopPropagation();
    this.playlistToRename.set(playlist);
    this.renameValue = playlist.name;
  }

  async onConfirmRename(): Promise<void> {
    const pl = this.playlistToRename();
    if (!pl || !this.renameValue.trim()) return;
    this.errorMessage.set(null);
    try {
      await this.playlistGateway.renamePlaylist(pl.id, this.renameValue.trim());
      this.playlistToRename.set(null);
      await this.loadData();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to rename playlist');
    }
  }

  onOpenDelete(event: MouseEvent, playlist: Playlist): void {
    event.stopPropagation();
    this.playlistToDelete.set(playlist);
  }

  async onConfirmDelete(): Promise<void> {
    const pl = this.playlistToDelete();
    if (!pl) return;
    this.errorMessage.set(null);
    try {
      await this.playlistGateway.deletePlaylist(pl.id);
      this.playlistToDelete.set(null);
      await this.loadData();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to delete playlist');
    }
  }

  onPlayPlaylist(event: MouseEvent, playlist: Playlist): void {
    event.stopPropagation();
    const trackMap = new Map<string, Track>();
    this.allTracks().forEach((t) => trackMap.set(t.id, t));

    const tracks: Track[] = [];
    playlist.entries.forEach((entry) => {
      const t = trackMap.get(entry.trackId);
      if (t) tracks.push(t);
    });

    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }
}
