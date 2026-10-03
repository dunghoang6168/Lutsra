import { ApplicationConfig, inject, InjectionToken, NgZone, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
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
import { NativeAudioPlaybackEngine } from './core/desktop/native-audio-playback.engine';
import { SwitchingPlaybackEngine } from './core/desktop/switching-playback.engine';
import { getDesktopApi } from './core/desktop/desktop-api';
import { ThemeService } from './core/theme/theme.service';
import { MediaSessionService } from './core/media/media-session.service';
import { LayoutPreferenceService } from './core/layout/layout-preference.service';
import { AudioVisualizationPreferenceService } from './core/layout/audio-visualization-preference.service';

const isDesktop = () => Boolean(getDesktopApi());
const ACTIVE_AUDIO_ENGINE = new InjectionToken<PlaybackEngine & AudioAnalysisEngine>('ACTIVE_AUDIO_ENGINE');

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),

    { provide: LIBRARY_GATEWAY, useFactory: () => isDesktop() ? new ElectronLibraryGateway() : new MockLibraryGateway() },
    { provide: PLAYLIST_GATEWAY, useFactory: () => isDesktop() ? new ElectronPlaylistGateway() : new MockPlaylistGateway() },
    { provide: SETTINGS_GATEWAY, useFactory: () => isDesktop() ? new ElectronSettingsGateway() : new MockSettingsGateway() },
    { provide: ARTIST_METADATA_GATEWAY, useFactory: () => isDesktop() ? new ElectronArtistMetadataGateway() : new MockArtistMetadataGateway() },
    { provide: LYRICS_GATEWAY, useFactory: () => isDesktop() ? new ElectronLyricsGateway() : new MockLyricsGateway() },
    { provide: ACTIVE_AUDIO_ENGINE, useFactory: () => isDesktop()
      ? new SwitchingPlaybackEngine(new HtmlAudioPlaybackEngine(), new NativeAudioPlaybackEngine(inject(NgZone)))
      : new MockPlaybackEngine() },
    { provide: PLAYBACK_ENGINE, useExisting: ACTIVE_AUDIO_ENGINE },
    { provide: AUDIO_ANALYSIS_ENGINE, useExisting: ACTIVE_AUDIO_ENGINE },
    provideAppInitializer(() => inject(ThemeService).restore()),
    provideAppInitializer(() => inject(LayoutPreferenceService).restore()),
    provideAppInitializer(() => inject(AudioVisualizationPreferenceService).restore()),
    provideAppInitializer(() => void inject(MediaSessionService)),
  ],
};
