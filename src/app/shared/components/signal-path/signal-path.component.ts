import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PlayerService } from '../../../core/player/player.service';
import { formatKhz, formatTrackFormat } from '../../../features/home/library-quality';

type PathState = 'bit-perfect' | 'converted' | 'exclusive' | 'shared' | 'disconnected';

const STATE_HELP: Record<PathState, string> = {
  'bit-perfect': 'Bit-perfect: samples reach the device unchanged.',
  exclusive: 'Exclusive DSP: Lutstra has sole use of the output device; software volume and crossfade remain available.',
  converted: 'Converted: the sample rate or channel layout is changed before output.',
  shared: 'Shared mixer: Windows mixes all app sound at the device format.',
  disconnected: 'The output device is disconnected.',
};

/** Source format plus what the output path does to it, stated only as far as the engine reports. */
@Component({
  selector: 'app-signal-path',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './signal-path.component.html',
  styleUrl: './signal-path.component.scss',
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
    return path.resamplingActive || path.channelConversionActive ? 'converted' : path.mode === 'exclusive-dsp' ? 'exclusive' : 'shared';
  });

  readonly pathLabel = computed(() => {
    const path = this.player.audioPathStatus();
    if (!path) return '';
    const rate = path.outputFormat?.sampleRate;
    switch (this.state()) {
      case 'disconnected': return 'output disconnected';
      case 'bit-perfect': return 'bit-perfect';
      case 'exclusive': return rate ? `exclusive ${formatKhz(rate)} kHz` : 'exclusive';
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
