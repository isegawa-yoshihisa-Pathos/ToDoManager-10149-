import { Routes } from '@angular/router';
import { Login } from './login/login';
import { UserWindow } from './user-window/user-window';
import { SignUp } from './signup/signup';
import { UserWindowTaskList } from './user-window/user-window-task-list';
import { UserWindowProjectHub } from './user-window/user-window-project-hub';
import { TaskDetail } from './task-detail/task-detail';
import { TaskBulkEdit } from './task-bulk-edit/task-bulk-edit';
import { TaskReport } from './task-report/task-report';
import { ProjectSettings } from './project-settings/project-settings';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  { path: 'user-window', component: UserWindow, canActivate: [authGuard], children:[
    { path: 'private/:listId', component: UserWindowTaskList },
    { path: 'project/hub', component: UserWindowProjectHub },
    { path: 'project/:projectId', component: UserWindowTaskList },
    { path: '', redirectTo: 'private/default', pathMatch: 'full' },
  ] },
  { path: 'project/:projectId/settings', component: ProjectSettings, canActivate: [authGuard] },
  { path: 'task/:scope/:taskId', component: TaskDetail, canActivate: [authGuard] },
  { path: 'tasks/bulk-edit/:scope', component: TaskBulkEdit, canActivate: [authGuard] },
  { path: 'report/:scope', component: TaskReport, canActivate: [authGuard] },
  { path: 'signup', component: SignUp },
];