import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent, IconName } from '../icon/icon.component';

@Component({
  selector: 'app-album-card',
  standalone: true,
  imports: [RouterModule, IconComponent],
  template: `
    <div class="album-card">
      <div class="cover-wrapper" [class.is-circle]="isCircle">
        @if (!imageUrl && imageUrls.length === 4) {
          <div class="cover-mosaic">
            @for (url of imageUrls; track url) {
              <span class="cover-cell"><img [src]="url" alt="" class="cover-img" /></span>
            }
          </div>
        } @else if (imageUrl || imageUrls[0]) {
          <img [src]="imageUrl || imageUrls[0]" alt="" class="cover-img" />
        } @else {
          <div class="cover-placeholder" aria-hidden="true">
            <app-icon [name]="fallbackIcon" [size]="isCircle ? 48 : 36" />
          </div>
        }
        
        <button
          type="button"
          class="quick-play-btn"
          (click)="play.emit()"
          [disabled]="disableActions"
          [title]="'Play ' + title"
          [attr.aria-label]="'Play ' + title">
          <app-icon name="play" [size]="18" />
        </button>
        <button
          type="button"
          class="quick-queue-btn"
          (click)="queue.emit()"
          [disabled]="disableActions"
          [title]="'Add ' + title + ' to Queue'"
          [attr.aria-label]="'Add ' + title + ' to Queue'">
          <app-icon name="plus" [size]="17" />
        </button>
      </div>
      
      <h3 class="album-title truncate" >
        <a [routerLink]="link">{{ title }}</a>
      </h3>
      @if (subtitle) {
        <p class="album-artist truncate">{{ subtitle }}</p>
      }
      
      @if (format) {
        <p class="album-format" [class.hires]="format.hires">{{ format.label }}</p>
      }
      @if (showDetails && subtext) {
        <div class="album-sub">
          <span>{{ subtext }}</span>
          <ng-content select="[card-actions]"></ng-content>
        </div>
      }

      <ng-content></ng-content>
    </div>
  `,
  styles: [`
    .cover-mosaic {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
    .cover-cell { min-width: 0; min-height: 0; overflow: hidden; }
    .album-sub { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  `],
  styleUrl: './album-card.component.scss'
})
export class AlbumCardComponent {
  @Input({ required: true }) item!: any;
  @Input({ required: true }) title!: string;
  @Input() subtitle: string = '';
  @Input() subtext: string = '';
  @Input() imageUrl: string | null = null;
  @Input() imageUrls: readonly string[] = [];
  @Input() fallbackIcon: IconName = 'disc';
  @Input() link!: any[] | string;
  @Input() showDetails = false;
  @Input() isCircle = false;
  @Input() disableActions = false;
  @Input() format: { label: string; hires: boolean } | null = null;
  
  @Output() play = new EventEmitter<any>();
  @Output() queue = new EventEmitter<any>();
}
