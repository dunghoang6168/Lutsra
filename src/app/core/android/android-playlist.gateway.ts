import { Injectable } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { PlaylistGateway } from '../contracts/playlist.gateway';
import { Playlist } from '../models';

interface NativePlaylists {
  list(): Promise<{ playlists: Playlist[] }>;
  create(options: { name: string }): Promise<{ playlist: Playlist }>;
  rename(options: { id: string; name: string }): Promise<{ playlist: Playlist }>;
  delete(options: { id: string }): Promise<void>;
  addTracks(options: { id: string; trackIds: string[] }): Promise<{ playlist: Playlist }>;
  removeEntry(options: { id: string; entryId: string }): Promise<{ playlist: Playlist }>;
  reorder(options: { id: string; entryIds: string[] }): Promise<{ playlist: Playlist }>;
}

const nativePlaylists = registerPlugin<NativePlaylists>('AndroidPlaylists');

@Injectable({ providedIn: 'root' })
export class AndroidPlaylistGateway implements PlaylistGateway {
  async getPlaylists(): Promise<Playlist[]> { return (await nativePlaylists.list()).playlists; }
  async createPlaylist(name: string): Promise<Playlist> { return (await nativePlaylists.create({ name })).playlist; }
  async renamePlaylist(id: string, name: string): Promise<Playlist> { return (await nativePlaylists.rename({ id, name })).playlist; }
  async deletePlaylist(id: string): Promise<void> { await nativePlaylists.delete({ id }); }
  async addTracks(playlistId: string, trackIds: string[]): Promise<Playlist> {
    return (await nativePlaylists.addTracks({ id: playlistId, trackIds })).playlist;
  }
  async removeEntry(playlistId: string, entryId: string): Promise<Playlist> {
    return (await nativePlaylists.removeEntry({ id: playlistId, entryId })).playlist;
  }
  async reorderEntries(playlistId: string, entryIds: string[]): Promise<Playlist> {
    return (await nativePlaylists.reorder({ id: playlistId, entryIds })).playlist;
  }
}
