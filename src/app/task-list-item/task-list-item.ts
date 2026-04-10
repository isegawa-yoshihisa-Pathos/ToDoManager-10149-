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
import {
  displayEllipsis,
  isDisplayTruncated,
  TASK_TITLE_DISPLAY_MAX_CHARS,
} from '../display-ellipsis';

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
  /** プロジェクト時、担当表示名の解決用 */
  @Input() projectMembers: { userId: string; displayName: string }[] = [];
  @Input() showDragHandle = false;

  priorityLabel(): string {
    return priorityShortLabel(this.task.priority);
  }

  taskTitleDisplay(): string {
    return displayEllipsis(this.task.title, TASK_TITLE_DISPLAY_MAX_CHARS);
  }

  /** 省略時のみホバーで全文 */
  taskTitleTooltip(): string | null {
    const t = this.task.title ?? '';
    return isDisplayTruncated(t, TASK_TITLE_DISPLAY_MAX_CHARS) ? t : null;
  }

  /** タスクの assignee はユーザーID。一覧ではユーザー名を表示 */
  assigneeDisplay(): string {
    const a = this.task.assignee?.trim();
    if (!a) {
      return '';
    }
    const m = this.projectMembers.find((x) => x.userId === a);
    return m?.displayName ?? a;
  }

  /** 左の色帯・行の背景トーンに使用 */
  labelStripColor(): string {
    const c = this.task.label?.trim();
    return c || '#e0e0e0';
  }

  onDoneChange(done: boolean): void {
    this.task.done = done;
    const id = this.task.id;
    const userId = this.auth.userId();
    if (!id || !userId) {
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
    const userId = this.auth.userId();
    if (!id || !userId) {
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
    const userId = this.auth.userId();
    if (!userId) {
      return null;
    }
    if (this.taskScope.kind === 'project') {
      return doc(this.firestore, 'projects', this.taskScope.projectId, 'tasks', taskId);
    }
    const pid = this.taskScope.privateListId;
    return pid === 'default'
      ? doc(this.firestore, 'accounts', userId, 'tasks', taskId)
      : doc(
          this.firestore,
          'accounts',
          userId,
          'privateTaskLists',
          pid,
          'tasks',
          taskId,
        );
  }
}
