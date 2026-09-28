import { TestBed } from '@angular/core/testing';
import { SETTINGS_GATEWAY } from '../../core/contracts';
import { MockSettingsGateway } from '../../core/mock/mock-settings.gateway';
import { LayoutPreferenceService } from '../../core/layout/layout-preference.service';
import { LayoutSettingsComponent } from './layout-settings.component';

describe('LayoutSettingsComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem('lutsra.layout.mode');
    await TestBed.configureTestingModule({
      imports: [LayoutSettingsComponent],
      providers: [{ provide: SETTINGS_GATEWAY, useClass: MockSettingsGateway }],
    }).compileComponents();
  });

  afterEach(() => localStorage.removeItem('lutsra.layout.mode'));

  it('switches between Panel and Classic and marks the selected option', async () => {
    const fixture = TestBed.createComponent(LayoutSettingsComponent);
    fixture.detectChanges();
    const options = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.layout-option');
    expect(options.length).toBe(2);
    expect(options[0].getAttribute('aria-pressed')).toBe('true');
    options[1].click();
    fixture.detectChanges();
    expect(TestBed.inject(LayoutPreferenceService).mode()).toBe('classic');
    expect(options[1].getAttribute('aria-pressed')).toBe('true');
    await fixture.whenStable();
    expect(localStorage.getItem('lutsra.layout.mode')).toBe('classic');
    expect((await new MockSettingsGateway().getSettings()).layoutMode).toBe('classic');
  });
});
