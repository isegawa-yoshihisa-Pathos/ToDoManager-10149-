import { Component, inject } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TaskList } from '../task-list/task-list';
import type { TaskScope } from '../task-scope';

function taskScopeFromParams(params: ParamMap): TaskScope {
  const listId = params.get('listId');
  const projectId = params.get('projectId');
  if (listId != null) {
    return { kind: 'private', privateListId: listId };
  }
  if (projectId != null) {
    return { kind: 'project', projectId };
  }
  return { kind: 'private', privateListId: 'default' };
}

@Component({
  selector: 'app-user-window-task-list',
  standalone: true,
  imports: [TaskList],
  template: `<app-task-list [taskScope]="taskScope()"></app-task-list>`,
})
export class UserWindowTaskList {
  private readonly route = inject(ActivatedRoute);

  readonly taskScope = toSignal(
    this.route.paramMap.pipe(map((params) => taskScopeFromParams(params))),
    { initialValue: taskScopeFromParams(this.route.snapshot.paramMap) },
  );
}
