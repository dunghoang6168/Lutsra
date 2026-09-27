import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { IconComponent } from '../icon/icon.component';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('isCollapsed', true);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('aligns the collapsed navigation controls with the sidebar toggle', () => {
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.sidebar-toggle-btn')!;
    const navItems = Array.from(element.querySelectorAll<HTMLElement>('.nav-item'));

    expect(getComputedStyle(toggle).width).toBe('36px');
    expect(getComputedStyle(toggle).height).toBe('36px');
    expect(navItems.length).toBeGreaterThan(0);
    expect(getComputedStyle(element.querySelector<HTMLElement>('.sidebar-toggle-row')!).justifyContent).toBe('center');
    const sectionTitle = element.querySelector<HTMLElement>('.sidebar-section-title')!;
    expect(sectionTitle).not.toBeNull();
    expect(getComputedStyle(sectionTitle).display).toBe('none');

    for (const item of navItems) {
      const style = getComputedStyle(item);
      expect(style.width).toBe('36px');
      expect(style.height).toBe('36px');
      expect(style.padding).toBe('0px');
    }
  });

  it('expands from the top toggle when collapsed', () => {
    const emit = spyOn(fixture.componentInstance.toggleCollapse, 'emit');
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.sidebar-toggle-btn')!;

    expect(toggle.title).toBe('Expand sidebar');
    expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar');
    expect(fixture.debugElement.query(By.directive(IconComponent)).componentInstance.name()).toBe('chevron-right');
    toggle.click();

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('shows Library and the collapse control in the compact expanded header', () => {
    fixture.componentRef.setInput('isCollapsed', false);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const row = element.querySelector<HTMLElement>('.sidebar-toggle-row')!;
    const toggle = element.querySelector<HTMLButtonElement>('.sidebar-toggle-btn')!;

    expect(getComputedStyle(row).height).toBe('64px');
    expect(getComputedStyle(row).justifyContent).toBe('space-between');
    expect(element.querySelector('.sidebar-section-title')?.textContent?.trim()).toBe('LIBRARY');
    expect(element.querySelector('.nav-menu .sidebar-section-title')).toBeNull();
    expect(toggle.title).toBe('Collapse sidebar');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(element.textContent).not.toContain('Lutsra');
    expect(element.textContent).not.toContain('Hi-Res Player');
    expect(fixture.debugElement.query(By.directive(IconComponent)).componentInstance.name()).toBe('chevron-left');
  });

  it('uses the shortened expanded sidebar width', () => {
    const width = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
    expect(width).toBeGreaterThanOrEqual(168);
    expect(width).toBeLessThanOrEqual(176);
  });

  it('fades labels before collapsing the width and centers content only after transition end', fakeAsync(() => {
    fixture.componentRef.setInput('isCollapsed', false);
    fixture.detectChanges();
    dispatchWidthTransitionEnd();
    fixture.detectChanges();

    fixture.componentRef.setInput('isCollapsed', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.phase()).toBe('collapsing');
    expect(fixture.componentInstance.labelsVisible()).toBeFalse();
    expect(fixture.componentInstance.widthCollapsed()).toBeFalse();
    expect(fixture.componentInstance.contentCollapsed()).toBeFalse();

    tick(50);
    expect(fixture.componentInstance.widthCollapsed()).toBeTrue();
    expect(fixture.componentInstance.contentCollapsed()).toBeFalse();

    dispatchWidthTransitionEnd();
    fixture.detectChanges();
    expect(fixture.componentInstance.phase()).toBe('collapsed');
    expect(fixture.componentInstance.contentCollapsed()).toBeTrue();
  }));

  it('expands the layout before revealing labels and supports the fallback timer', fakeAsync(() => {
    fixture.componentRef.setInput('isCollapsed', false);
    fixture.detectChanges();

    expect(fixture.componentInstance.phase()).toBe('expanding');
    expect(fixture.componentInstance.contentCollapsed()).toBeFalse();
    expect(fixture.componentInstance.labelsVisible()).toBeFalse();

    tick(70);
    expect(fixture.componentInstance.labelsVisible()).toBeTrue();

    tick(140);
    expect(fixture.componentInstance.phase()).toBe('expanded');
    expect(fixture.componentInstance.isAnimating()).toBeFalse();
  }));

  it('cancels the previous animation when direction changes', fakeAsync(() => {
    fixture.componentRef.setInput('isCollapsed', false);
    fixture.detectChanges();
    tick(40);

    fixture.componentRef.setInput('isCollapsed', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.phase()).toBe('collapsing');

    tick(50);
    dispatchWidthTransitionEnd();
    expect(fixture.componentInstance.phase()).toBe('collapsed');

    tick(300);
    expect(fixture.componentInstance.phase()).toBe('collapsed');
  }));

  it('applies reduced-motion state changes immediately', () => {
    const mediaQuery = (fixture.componentInstance as unknown as { reducedMotion: MediaQueryList }).reducedMotion;
    Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: true });

    fixture.componentRef.setInput('isCollapsed', false);
    fixture.detectChanges();

    expect(fixture.componentInstance.phase()).toBe('expanded');
    expect(fixture.componentInstance.widthCollapsed()).toBeFalse();
    expect(fixture.componentInstance.labelsVisible()).toBeTrue();
  });

  function dispatchWidthTransitionEnd(): void {
    const sidebar = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.sidebar')!;
    sidebar.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'width', bubbles: true }));
  }
});
