import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Task } from '../../models/task';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { deleteDoc, doc, Firestore, updateDoc } from '@angular/fire/firestore';
import { AuthService } from '../auth.service';
import { TaskScope, taskDetailScopeParam } from '../task-scope';
import { priorityShortLabel } from '../task-priority';

@Component({
  selector: 'app-task-list-item',
  imports: [
    CommonModule,
    FormsModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    DragDropModule,
  ],
  templateUrl: './task-list-item.html',
  styleUrl: './task-list-item.css',
})
export class TaskListItem implements OnInit {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit() {}

  @Input() task: Task = {
    title: '',
    label: '',
    done: false,
    priority: 3,
    deadline: new Date(),
  };
  @Input() taskScope: TaskScope = { kind: 'private', privateListId: 'default' };
  @Input() showDragHandle = false;

  priorityLabel(): string {
    return priorityShortLabel(this.task.priority);
  }

  /** 左の色帯・行の背景トーンに使用 */
  labelStripColor(): string {
    const c = this.task.label?.trim();
    return c || '#e0e0e0';
  }

  onDoneChange(done: boolean): void {
    this.task.done = done;
    const id = this.task.id;
    const username = this.auth.username();
    if (!id || !username) {
      return;
    }
    const ref = this.taskDocRef(id);
    if (!ref) {
      return;
    }
    updateDoc(ref, { done }).catch((err) => console.error('updateDoc failed:', err));
  }

  onTaskRowClick(ev: MouseEvent): void {
    const el = ev.target as HTMLElement | null;
    if (!el) {
      return;
    }
    if (el.closest('button, mat-checkbox, a, input, textarea, .drag-handle')) {
      return;
    }
    this.onDoneChange(!this.task.done);
  }

  onTaskMainKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter' && ev.key !== ' ') {
      return;
    }
    ev.preventDefault();
    this.onDoneChange(!this.task.done);
  }

  isOverdue(task: Task) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return (
      !task.done &&
      task.deadline &&
      task.deadline.getTime() < start.getTime()
    );
  }

  openDetail(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    const id = this.task.id;
    if (!id) {
      return;
    }
    const scope = taskDetailScopeParam(this.taskScope);
    void this.router.navigate(['/task', scope, id]);
  }

  deleteTask(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    const id = this.task.id;
    const username = this.auth.username();
    if (!id || !username) {
      return;
    }
    if (!confirm('このタスクを削除しますか？')) {
      return;
    }
    const ref = this.taskDocRef(id);
    if (!ref) {
      return;
    }
    deleteDoc(ref).catch((err) => console.error('deleteDoc failed:', err));
  }

  private taskDocRef(taskId: string) {
    const username = this.auth.username();
    if (!username) {
      return null;
    }
    if (this.taskScope.kind === 'project') {
      return doc(this.firestore, 'projects', this.taskScope.projectId, 'tasks', taskId);
    }
    const pid = this.taskScope.privateListId;
    return pid === 'default'
      ? doc(this.firestore, 'accounts', username, 'tasks', taskId)
      : doc(
          this.firestore,
          'accounts',
          username,
          'privateTaskLists',
          pid,
          'tasks',
          taskId,
        );
  }
}
