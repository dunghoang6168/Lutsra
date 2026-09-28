import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class NavigationHistoryService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly entries = signal<string[]>([]);
  private readonly currentIndex = signal(-1);
  private pendingIndex: number | null = null;

  readonly canGoBack = computed(() => this.currentIndex() > 0);
  readonly canGoForward = computed(() => {
    const index = this.currentIndex();
    return index >= 0 && index < this.entries().length - 1;
  });

  constructor() {
    this.recordNavigation(this.router.url);
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) this.recordNavigation(event.urlAfterRedirects, this.router.currentNavigation()?.extras.replaceUrl === true);
      else if (event instanceof NavigationCancel || event instanceof NavigationError) this.pendingIndex = null;
    });
  }

  back(): void { this.navigateToIndex(this.currentIndex() - 1); }
  forward(): void { this.navigateToIndex(this.currentIndex() + 1); }

  private navigateToIndex(index: number): void {
    const destination = this.entries()[index];
    if (!destination || index < 0 || index >= this.entries().length) return;
    this.pendingIndex = index;
    void this.router.navigateByUrl(destination);
  }

  private recordNavigation(url: string, replaceCurrent = false): void {
    if (!url || url === '/') return;
    if (this.pendingIndex !== null) {
      const targetIndex = this.pendingIndex;
      this.pendingIndex = null;
      this.entries.update((items) => items.map((item, index) => index === targetIndex ? url : item));
      this.currentIndex.set(targetIndex);
      return;
    }

    const currentIndex = this.currentIndex();
    const entries = this.entries();
    if (currentIndex >= 0 && entries[currentIndex] === url) return;
    if (replaceCurrent && currentIndex >= 0) {
      this.entries.update((items) => items.map((item, index) => index === currentIndex ? url : item));
      return;
    }
    const nextEntries = [...entries.slice(0, currentIndex + 1), url];
    this.entries.set(nextEntries);
    this.currentIndex.set(nextEntries.length - 1);
  }
}
