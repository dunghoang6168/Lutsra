import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type IconName =
  | 'headphones'
  | 'home'
  | 'music'
  | 'disc'
  | 'user'
  | 'folder'
  | 'list-music'
  | 'settings'
  | 'chevron-left'
  | 'chevron-right'
  | 'menu'
  | 'grip-vertical'
  | 'panel-left'
  | 'more-horizontal'
  | 'play'
  | 'pause'
  | 'skip-back'
  | 'skip-forward'
  | 'shuffle'
  | 'repeat'
  | 'repeat-one'
  | 'volume-2'
  | 'volume-x'
  | 'queue'
  | 'search'
  | 'x'
  | 'plus'
  | 'trash'
  | 'edit'
  | 'refresh-cw'
  | 'arrow-up'
  | 'arrow-down'
  | 'clock'
  | 'alert-triangle'
  | 'info'
  | 'check'
  | 'sparkles'
  | 'file-audio'
  | 'play-fill';

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(18);
  readonly strokeWidth = input<number>(2);
  readonly filled = input<boolean | undefined>(undefined);

  readonly isFilled = computed<boolean>(() => {
    const explicit = this.filled();
    if (explicit !== undefined) return explicit;
    return this.name() === 'play' || this.name() === 'play-fill' || this.name() === 'pause';
  });

  readonly viewBox = computed<string>(() => '0 0 24 24');
}
