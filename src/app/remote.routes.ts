import { Routes } from '@angular/router';
import { AppComponent } from './app.component';
import { routes } from './app.routes';

export const remoteRoutes: Routes = [
  { path: '', component: AppComponent, children: routes },
];
