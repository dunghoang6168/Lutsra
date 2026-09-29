import { Component, inject } from '@angular/core';
import { LayoutPreferenceService } from '../../core/layout/layout-preference.service';
import { AudioVisualizationPreferenceService } from '../../core/layout/audio-visualization-preference.service';

@Component({
  selector: 'app-layout-settings',
  standalone: true,
  templateUrl: './layout-settings.component.html',
  styleUrl: './layout-settings.component.scss',
})
export class LayoutSettingsComponent {
  readonly layoutPreference = inject(LayoutPreferenceService);
  readonly audioVisualization = inject(AudioVisualizationPreferenceService);
}
