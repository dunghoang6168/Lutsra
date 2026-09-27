import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface NativePlaybackState {
  playing: boolean;
  playWhenReady: boolean;
  playbackState: number;
  positionMs: number;
  durationMs: number;
  index: number;
  count: number;
  title: string;
}

interface NativePlaybackPlugin {
  pickAndPlay(): Promise<NativePlaybackState>;
  playTestQueue(): Promise<NativePlaybackState>;
  getState(): Promise<NativePlaybackState>;
  play(): Promise<NativePlaybackState>;
  pause(): Promise<NativePlaybackState>;
  next(): Promise<NativePlaybackState>;
  previous(): Promise<NativePlaybackState>;
  seekTo(options: { positionMs: number }): Promise<NativePlaybackState>;
  addListener(eventName: 'state', listener: (state: NativePlaybackState) => void): Promise<PluginListenerHandle>;
}

const nativePlayback = registerPlugin<NativePlaybackPlugin>('SpikePlayback');

@Component({
  selector: 'app-android-spike',
  standalone: true,
  template: `
    <main>
      <h1>Audio Lutstra · Android spike</h1>
      <p>Thiết bị: {{ platform }}</p>
      @if (nativeAvailable) {
        <section>
          <h2>Media3 native</h2>
          <p>Chọn nhiều bài để thử next/previous từ màn hình khóa và tai nghe. Hàng chờ nằm trong dịch vụ Android.</p>
          <button type="button" (click)="chooseNativeFiles()">Chọn nhạc cho Media3</button>
          <button type="button" (click)="playNativeTestQueue()">Phát 2 âm mẫu</button>
          <p>Bài: {{ nativeState()?.title || 'Chưa chọn' }}
            @if (nativeState()?.count) { ({{ (nativeState()?.index || 0) + 1 }}/{{ nativeState()?.count }}) }
          </p>
          <p>Trạng thái: {{ nativeState()?.playing ? 'Đang phát' : 'Dừng/tạm dừng' }}
            · {{ nativeState()?.positionMs || 0 }} ms
            @if (nativeError()) { · Lỗi: {{ nativeError() }} }
          </p>
          <div class="controls">
            <button type="button" (click)="nativeAction('previous')">Trước</button>
            <button type="button" (click)="nativeAction('pause')">Tạm dừng</button>
            <button type="button" (click)="nativeAction('play')">Phát</button>
            <button type="button" (click)="nativeAction('next')">Tiếp</button>
          </div>
          <button type="button" (click)="nativeSeekForward()">Tua +10 giây</button>
        </section>
      }
      <h2>WebView baseline</h2>
      <p>Chọn lần lượt MP3, FLAC và WAV trên điện thoại. Ghi kết quả sau khi khóa màn hình và bấm nút tai nghe.</p>
      <label for="audio-file">Chọn file âm thanh</label>
      <input id="audio-file" type="file" accept="audio/*,.mp3,.flac,.wav" (change)="selectFile($event)">
      <p>Codec trình duyệt báo: {{ codecs }}</p>
      <p>File: {{ fileName() || 'Chưa chọn' }}</p>
      <p>Trạng thái: {{ status() }}</p>
      <audio #player controls (play)="onPlay()" (pause)="onPause()" (error)="onError(player)"></audio>
      <h2>Nhật ký điều khiển</h2>
      <ol>
        @for (entry of log(); track $index) { <li>{{ entry }}</li> }
      </ol>
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #141721; color: #f4f5fb; font: 16px system-ui, sans-serif; }
    main { max-width: 34rem; margin: auto; padding: max(2rem, env(safe-area-inset-top)) 1.25rem 2rem; }
    h1 { font-size: 1.5rem; }
    section { border: 1px solid #636a80; border-radius: .75rem; padding: 1rem; margin: 1.5rem 0; }
    button { background: #464f91; color: white; border: 0; border-radius: .5rem; padding: .7rem .85rem; margin: .25rem; font: inherit; }
    .controls { display: flex; flex-wrap: wrap; }
    p { line-height: 1.5; }
    label { display: block; margin: 1.5rem 0 .5rem; }
    input, audio { display: block; width: 100%; margin-bottom: 1rem; }
    li { margin: .4rem 0; overflow-wrap: anywhere; }
  `],
})
export class AndroidSpikeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('player') private player!: ElementRef<HTMLAudioElement>;
  readonly platform = Capacitor.getPlatform();
  readonly nativeAvailable = Capacitor.isNativePlatform();
  readonly nativeState = signal<NativePlaybackState | null>(null);
  readonly nativeError = signal('');
  readonly fileName = signal('');
  readonly status = signal('Sẵn sàng');
  readonly log = signal<string[]>([]);
  readonly codecs: string;

  private objectUrl: string | null = null;
  private nativeListener: PluginListenerHandle | null = null;

  constructor() {
    const probe = new Audio();
    this.codecs = [
      ['MP3', 'audio/mpeg'],
      ['FLAC', 'audio/flac'],
      ['WAV', 'audio/wav'],
    ].map(([name, mime]) => `${name}: ${probe.canPlayType(mime) || 'không'}`).join(' · ');

  }

  ngAfterViewInit(): void {
    if (this.nativeAvailable) {
      void nativePlayback.addListener('state', state => this.nativeState.set(state))
        .then(handle => { this.nativeListener = handle; })
        .catch(error => this.nativeError.set(String(error)));
      void nativePlayback.getState().then(state => this.nativeState.set(state))
        .catch(error => this.nativeError.set(String(error)));
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.mediaAction('play', () => this.player.nativeElement.play()));
      navigator.mediaSession.setActionHandler('pause', () => this.mediaAction('pause', () => this.player.nativeElement.pause()));
      navigator.mediaSession.setActionHandler('stop', () => this.mediaAction('stop', () => { this.player.nativeElement.pause(); this.player.nativeElement.currentTime = 0; }));
      navigator.mediaSession.setActionHandler('seekto', details => this.mediaAction('seekto', () => {
        if (details.seekTime != null) this.player.nativeElement.currentTime = details.seekTime;
      }));
    }
  }

  selectFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const audio = this.player.nativeElement;
    audio.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    audio.src = this.objectUrl;
    this.fileName.set(`${file.name} (${file.type || 'MIME không có'}, ${file.size} bytes)`);
    this.status.set('Đã nạp file');
    this.writeLog(`selected ${file.name}`);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: file.name, artist: 'Android spike' });
    }
  }

  onPlay(): void { this.status.set('Đang phát'); this.writeLog('play'); }
  onPause(): void { this.status.set('Tạm dừng'); this.writeLog('pause'); }
  onError(audio: HTMLAudioElement): void {
    this.status.set(`Lỗi phát: ${audio.error?.code ?? 'không rõ'}`);
    this.writeLog(this.status());
  }

  ngOnDestroy(): void {
    void this.nativeListener?.remove();
    this.player.nativeElement.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if ('mediaSession' in navigator) {
      for (const action of ['play', 'pause', 'stop', 'seekto'] as MediaSessionAction[]) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    }
  }

  async chooseNativeFiles(): Promise<void> {
    try {
      this.nativeError.set('');
      this.nativeState.set(await nativePlayback.pickAndPlay());
    } catch (error) {
      this.nativeError.set(String(error));
    }
  }

  async playNativeTestQueue(): Promise<void> {
    try {
      this.nativeError.set('');
      this.nativeState.set(await nativePlayback.playTestQueue());
    } catch (error) {
      this.nativeError.set(String(error));
    }
  }

  async nativeAction(action: 'play' | 'pause' | 'next' | 'previous'): Promise<void> {
    try {
      this.nativeError.set('');
      this.nativeState.set(await nativePlayback[action]());
    } catch (error) {
      this.nativeError.set(String(error));
    }
  }

  async nativeSeekForward(): Promise<void> {
    try {
      this.nativeError.set('');
      this.nativeState.set(await nativePlayback.seekTo({ positionMs: (this.nativeState()?.positionMs || 0) + 10000 }));
    } catch (error) {
      this.nativeError.set(String(error));
    }
  }

  private mediaAction(name: string, callback: () => void | Promise<void>): void {
    this.writeLog(`mediaSession: ${name}`);
    void Promise.resolve(callback()).catch(error => this.writeLog(`mediaSession error: ${String(error)}`));
  }

  private writeLog(message: string): void {
    this.log.update(entries => [`${new Date().toLocaleTimeString()}: ${message}`, ...entries].slice(0, 20));
  }
}
