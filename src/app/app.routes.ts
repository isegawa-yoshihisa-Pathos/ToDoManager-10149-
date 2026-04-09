import { Routes, RouterModule} from '@angular/router';
import { Login } from './login/login';
import { UserWindow } from './user-window/user-window';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: Login },
    { path: 'user-window', component: UserWindow },
];