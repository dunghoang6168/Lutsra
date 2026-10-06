import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PlayerService } from '../../../core/player/player.service';
import { formatKhz, formatTrackFormat } from '../../../features/home/library-quality';

type PathState = 'bit-perfect' | 'converted' | 'shared' | 'disconnected';

const STATE_HELP: Record<PathState, string> = {
  'bit-perfect': 'Bit-perfect: samples reach the device unchanged.',
  converted: 'Converted: the sample rate or channel layout is changed before output.',
  shared: 'Shared mixer: Windows mixes all app sound at the device format.',
  disconnected: 'The output device is disconnected.',
};

/** Source format plus what the output path does to it, stated only as far as the engine reports. */
@Component({
  selector: 'app-signal-path',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (source(); as source) {
      <span class="signal-path" [attr.data-state]="state()" [title]="description()">
        <span class="source" [class.hires]="source.hires">{{ source.label }}</span>
        @if (pathLabel(); as label) {
          <span class="arrow" aria-hidden="true">→</span>
          <span class="path">{{ label }}</span>
        }
      </span>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .signal-path {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      max-width: 100%;
      overflow: hidden;
      color: var(--text-secondary);
      font-family: var(--font-family-mono);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      line-height: 1.3;
      white-space: nowrap;
    }
    .source { color: var(--text-primary); }
    .source.hires { color: var(--text-accent); }
    .arrow { color: var(--text-muted); }
    .path { overflow: hidden; text-overflow: ellipsis; }
    [data-state='bit-perfect'] .path { color: var(--text-accent); }
    [data-state='disconnected'] .path { color: var(--status-warning-text); }
  `,
})
export class SignalPathComponent {
  private readonly player = inject(PlayerService);
  readonly source = computed(() => {
    const track = this.player.currentTrack();
    return track ? formatTrackFormat(track) : null;
  });

  readonly state = computed<PathState>(() => {
    const path = this.player.audioPathStatus();
    if (!path) return 'shared';
    if (!path.isConnected) return 'disconnected';
    if (path.mode === 'exclusive-bitperfect' && path.bitPerfectEligible && !path.resamplingActive && !path.channelConversionActive) {
      return 'bit-perfect';
    }
    return path.resamplingActive || path.channelConversionActive ? 'converted' : 'shared';
  });

  readonly pathLabel = computed(() => {
    const path = this.player.audioPathStatus();
    if (!path) return '';
    const rate = path.outputFormat?.sampleRate;
    switch (this.state()) {
      case 'disconnected': return 'output disconnected';
      case 'bit-perfect': return 'bit-perfect';
      case 'converted':
        if (path.resamplingActive && rate) return `resampled ${formatKhz(rate)} kHz`;
        return 'channel conversion';
      default:
        if (path.backend === 'chromium') return 'shared mixer';
        return rate ? `shared ${formatKhz(rate)} kHz${path.outputSampleType === 'float' ? ' float' : ''}` : 'shared mixer';
    }
  });

  readonly description = computed(() => {
    const path = this.player.audioPathStatus();
    const source = this.source()?.label ?? '';
    if (!path) return `Source ${source}`;
    const reasons = path.processingReasons.join(', ');
    return `Source ${source} · ${path.deviceName}${reasons ? ` · ${reasons}` : ''}\n${STATE_HELP[this.state()]}`;
  });
}
