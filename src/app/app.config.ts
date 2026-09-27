import { ApplicationConfig, inject, InjectionToken, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { ARTIST_METADATA_GATEWAY, AUDIO_ANALYSIS_ENGINE, AudioAnalysisEngine, LIBRARY_GATEWAY, LYRICS_GATEWAY, PLAYBACK_ENGINE, PlaybackEngine, PLAYLIST_GATEWAY, SETTINGS_GATEWAY } from './core/contracts';
import { MockArtistMetadataGateway, MockLibraryGateway, MockLyricsGateway, MockPlaybackEngine, MockPlaylistGateway, MockSettingsGateway } from './core/mock';
import { ElectronLibraryGateway } from './core/desktop/electron-library.gateway';
import { ElectronPlaylistGateway } from './core/desktop/electron-playlist.gateway';
import { ElectronSettingsGateway } from './core/desktop/electron-settings.gateway';
import { ElectronArtistMetadataGateway } from './core/desktop/electron-artist-metadata.gateway';
import { ElectronLyricsGateway } from './core/desktop/electron-lyrics.gateway';
import { HtmlAudioPlaybackEngine } from './core/desktop/html-audio-playback.engine';
import { getDesktopApi } from './core/desktop/desktop-api';
import { ThemeService } from './core/theme/theme.service';
import { MediaSessionService } from './core/media/media-session.service';
import { Capacitor } from '@capacitor/core';
import { AndroidLibraryGateway } from './core/android/android-library.gateway';
import { AndroidPlaylistGateway } from './core/android/android-playlist.gateway';

const isDesktop = () => Boolean(getDesktopApi());
const isAndroid = () => Capacitor.getPlatform() === 'android';
const ACTIVE_AUDIO_ENGINE = new InjectionToken<PlaybackEngine & AudioAnalysisEngine>('ACTIVE_AUDIO_ENGINE');

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),

    { provide: LIBRARY_GATEWAY, useFactory: () => isDesktop() ? new ElectronLibraryGateway() : isAndroid() ? new AndroidLibraryGateway() : new MockLibraryGateway() },
    { provide: PLAYLIST_GATEWAY, useFactory: () => isDesktop() ? new ElectronPlaylistGateway() : isAndroid() ? new AndroidPlaylistGateway() : new MockPlaylistGateway() },
    { provide: SETTINGS_GATEWAY, useFactory: () => isDesktop() ? new ElectronSettingsGateway() : new MockSettingsGateway() },
    { provide: ARTIST_METADATA_GATEWAY, useFactory: () => isDesktop() ? new ElectronArtistMetadataGateway() : new MockArtistMetadataGateway() },
    { provide: LYRICS_GATEWAY, useFactory: () => isDesktop() ? new ElectronLyricsGateway() : new MockLyricsGateway() },
    { provide: ACTIVE_AUDIO_ENGINE, useFactory: () => isDesktop() ? new HtmlAudioPlaybackEngine() : new MockPlaybackEngine() },
    { provide: PLAYBACK_ENGINE, useExisting: ACTIVE_AUDIO_ENGINE },
    { provide: AUDIO_ANALYSIS_ENGINE, useExisting: ACTIVE_AUDIO_ENGINE },
    provideAppInitializer(() => inject(ThemeService).restore()),
    provideAppInitializer(() => void inject(MediaSessionService)),
  ],
};
