import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { getDesktopApi } from './app/core/desktop/desktop-api';

document.documentElement.setAttribute('data-runtime', getDesktopApi() ? 'desktop' : 'web');

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
