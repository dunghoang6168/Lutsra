import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PlayerBarComponent } from './player-bar.component';
import { PlayerService } from '../../../core/player/player.service';
import { PLAYBACK_ENGINE, SETTINGS_GATEWAY } from '../../../core/contracts';
import { MockPlaybackEngine } from '../../../core/mock/mock-playback.engine';
import { MockSettingsGateway } from '../../../core/mock/mock-settings.gateway';
import { Track } from '../../../core/models';

const testTrack: Track = {
  id: 'track-test', path: 'D:/Music/test.flac', fileName: 'test.flac', title: 'Test', artist: null,
  albumArtist: null, album: null, genre: null, year: null, trackNumber: null, discNumber: null,
  duration: 100, codec: 'FLAC', bitrate: null, sampleRate: 44100, bitDepth: 16, channels: 2,
  artwork: null, fileSize: null, lastModified: null, isAvailable: true,
};

describe('PlayerBarComponent (Keyboard & Controls)', () => {
  let component: PlayerBarComponent;
  let fixture: ComponentFixture<PlayerBarComponent>;
  let playerService: PlayerService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerBarComponent],
      providers: [
        provideRouter([]),
        { provide: PLAYBACK_ENGINE, useClass: MockPlaybackEngine },
        { provide: SETTINGS_GATEWAY, useClass: MockSettingsGateway },
        PlayerService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerBarComponent);
    component = fixture.componentInstance;
    playerService = TestBed.inject(PlayerService);
    fixture.detectChanges();
  });

  it('should create the player bar component', () => {
    expect(component).toBeTruthy();
  });

  it('renders as an inset rounded panel', () => {
    const host = fixture.nativeElement as HTMLElement;
    const panel = host.querySelector<HTMLElement>('.player-bar')!;
    const hostStyle = getComputedStyle(host);
    const panelStyle = getComputedStyle(panel);

    expect(hostStyle.paddingTop).toBe('8px');
    expect(hostStyle.paddingRight).toBe('8px');
    expect(hostStyle.paddingBottom).toBe('8px');
    expect(hostStyle.paddingLeft).toBe('8px');
    expect(panelStyle.borderTopWidth).toBe('1px');
    expect(panelStyle.borderRightWidth).toBe('1px');
    expect(panelStyle.borderBottomWidth).toBe('1px');
    expect(panelStyle.borderLeftWidth).toBe('1px');
    expect(panelStyle.borderTopLeftRadius).toBe('12px');
  });

  it('should omit source quality while keeping volume and queue controls for an active track', () => {
    playerService.currentTrack.set(testTrack);
    fixture.detectChanges();

    const playerBar = fixture.nativeElement as HTMLElement;
    const muteButton = playerBar.querySelector('[aria-label="Mute or Unmute"]') as HTMLButtonElement;
    const queueButton = playerBar.querySelector('.queue-btn') as HTMLButtonElement;
    const toggleQueueSpy = spyOn(component.toggleQueue, 'emit');

    expect(playerBar.querySelector('.quality-tag')).toBeNull();
    expect(playerBar.textContent).not.toContain('SOURCE QUALITY');
    expect(playerBar.querySelector('.volume-slider')).not.toBeNull();
    expect(muteButton).not.toBeNull();
    expect(queueButton).not.toBeNull();

    muteButton.click();
    queueButton.click();
    expect(playerService.isMuted()).toBeTrue();
    expect(toggleQueueSpy).toHaveBeenCalledTimes(1);
  });

  it('should keep the play button aligned to the same size as transport buttons', () => {
    const controlButton = fixture.nativeElement.querySelector('.ctrl-btn') as HTMLButtonElement;
    const playButton = fixture.nativeElement.querySelector('.play-pause-btn') as HTMLButtonElement;

    expect(getComputedStyle(controlButton).width).toBe('32px');
    expect(getComputedStyle(controlButton).height).toBe('32px');
    expect(getComputedStyle(playButton).width).toBe('32px');
    expect(getComputedStyle(playButton).height).toBe('32px');
  });

  it('should seek on pointer press and drag', () => {
    playerService.currentTrack.set(testTrack);
    playerService.duration.set(100);
    fixture.detectChanges();
    const timeline = fixture.nativeElement.querySelector('.progress-bar-wrap') as HTMLElement;
    spyOn(timeline, 'getBoundingClientRect').and.returnValue({ left: 10, width: 200 } as DOMRect);
    const seekSpy = spyOn(playerService, 'seek');

    component.onTimelinePointerDown(pointerEvent(timeline, 110));
    component.onTimelinePointerMove(pointerEvent(timeline, 170));
    component.onTimelinePointerUp(pointerEvent(timeline, 210));

    expect(seekSpy.calls.allArgs()).toEqual([[50], [80], [100]]);
  });

  it('should seek with keyboard and clamp at track boundaries', () => {
    playerService.currentTrack.set(testTrack);
    playerService.duration.set(100);
    playerService.currentTime.set(98);
    const seekSpy = spyOn(playerService, 'seek');
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });

    component.onTimelineKeyDown(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(seekSpy).toHaveBeenCalledWith(100);
  });

  it('should expose a native volume slider and update volume continuously from input events', () => {
    const slider = fixture.nativeElement.querySelector('.volume-slider') as HTMLInputElement;
    const setVolumeSpy = spyOn(playerService, 'setVolume');

    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('80');
    expect(slider.getAttribute('aria-valuetext')).toBe('80 percent');

    slider.value = '37';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setVolumeSpy).toHaveBeenCalledWith(0.37);
  });

  it('should show adjustment state and keep the tooltip synchronized with volume', () => {
    const shell = fixture.nativeElement.querySelector('.volume-slider-shell') as HTMLElement;
    const slider = fixture.nativeElement.querySelector('.volume-slider') as HTMLInputElement;

    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(shell.classList).toContain('adjusting');
    expect(shell.querySelector('.volume-tooltip')?.textContent?.trim()).toBe('80%');

    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    fixture.detectChanges();
    expect(shell.classList).not.toContain('adjusting');
  });

  it('should preserve the stored level while muted and unmute when adjusted above zero', () => {
    playerService.setVolume(0.64);
    playerService.toggleMute();
    fixture.detectChanges();
    const slider = fixture.nativeElement.querySelector('.volume-slider') as HTMLInputElement;
    const tooltip = fixture.nativeElement.querySelector('.volume-tooltip') as HTMLElement;

    expect(playerService.isMuted()).toBeTrue();
    expect(slider.value).toBe('64');
    expect(slider.getAttribute('aria-valuetext')).toBe('Muted, volume 64 percent');
    expect(tooltip.textContent?.trim()).toBe('Muted · 64%');

    slider.value = '45';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(playerService.volume()).toBe(0.45);
    expect(playerService.isMuted()).toBeFalse();
  });

  it('should render a normal pause icon while playback is loading', async () => {
    const pendingPlay = playerService.playTrack(testTrack);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.play-pause-btn') as HTMLButtonElement;

    expect(button.querySelector('.btn-spinner')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Pause');

    await playerService.togglePlayPause();
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toBe('Play');
    await pendingPlay;
  });
});

function pointerEvent(target: HTMLElement, clientX: number): PointerEvent {
  return {
    currentTarget: target,
    clientX,
    pointerId: 1,
    preventDefault: () => undefined,
  } as unknown as PointerEvent;
}
