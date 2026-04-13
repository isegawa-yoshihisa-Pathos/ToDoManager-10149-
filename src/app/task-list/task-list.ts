import {
  Component,
  DestroyRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskListItem } from '../task-list-item/task-list-item';
import { Task } from '../../models/task';
import { clampTaskPriority } from '../task-priority';
import { sortTasks, TaskSortField } from '../task-sort';
import {
  colorFilterOptions,
  defaultTaskFilterState,
  DueDateFilter,
  filterTasks,
  isFilterDefaultForReorder,
  TaskFilterState,
} from '../task-filter';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { TaskFormDialog } from '../task-form-dialog/task-form-dialog';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  Timestamp,
  collectionData,
  writeBatch,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth.service';
import { TaskScope } from '../task-scope';
import { TaskCalendar } from '../task-calendar/task-calendar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TASK_RETURN_QUERY } from '../task-return-query';

@Component({
  selector: 'app-task-list',
  imports: [
    CommonModule,
    FormsModule,
    TaskListItem,
    TaskCalendar,
    DragDropModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatSelectModule,
    MatRadioModule,
    MatDialogModule,
  ],
  templateUrl: './task-list.html',
  styleUrl: './task-list.css',
})
export class TaskList implements OnInit, OnDestroy, OnChanges {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private sub?: Subscription;

  @Input() taskScope: TaskScope = { kind: 'private', privateListId: 'default' };

  /** プロジェクトハブ画面がアクティブなとき（タスクリスト追加ボタンの見た目用） */
  @Input() projectHubNavActive = false;

  @Output() openProjectHub = new EventEmitter<void>();

  /** リスト表示 / カレンダー表示 */
  viewMode: 'list' | 'calendar' = 'list';
  /** カレンダー時の月／週 */
  calendarGranularity: 'month' | 'week' = 'month';

  tasks: Task[] = [];

  /** プロジェクトのメンバー（担当者選択・フィルタ用） */
  projectMembers: { userId: string; displayName: string }[] = [];
  private membersSub?: Subscription;

  /** 未選択は null（ソート条件から除外） */
  sortKey1: TaskSortField | null = null;
  sortKey2: TaskSortField | null = null;
  sortKey3: TaskSortField | null = null;
  sortAscending = true;

  filterState: TaskFilterState = defaultTaskFilterState();

  readonly sortFieldOptions: { value: TaskSortField; label: string }[] = [
    { value: 'color', label: '色' },
    { value: 'deadline', label: '期日' },
    { value: 'priority', label: '優先度' },
  ];

  readonly dueDateFilterOptions: { value: DueDateFilter; label: string }[] = [
    { value: 'all', label: '期日: すべて' },
    { value: 'overdue', label: '期限切れ（未完了）' },
    { value: 'today', label: '今日が期限' },
    { value: 'within_7', label: '7日以内' },
    { value: 'within_30', label: '30日以内' },
    { value: 'beyond_30', label: '31日以降' },
    { value: 'no_deadline', label: '期日なし' },
  ];

  readonly priorityFilterValues = [5, 4, 3, 2, 1] as const;

  /** フィルタのスウォッチ用。チャート外の #RRGGBB もその色で表示 */
  labelCssForFilter(hex: string): string {
    const t = hex?.trim() ?? '';
    if (/^#[0-9A-Fa-f]{6}$/.test(t)) {
      return t;
    }
    return '#bdbdbd';
  }

  resetFilters(): void {
    this.filterState = defaultTaskFilterState();
  }

  get isProjectScope(): boolean {
    return this.taskScope.kind === 'project';
  }

  /** 色フィルタの候補（チャート＋タスクに含まれるその他の色） */
  get colorOptionsForFilter(): string[] {
    return colorFilterOptions(this.tasks);
  }

  get displayTasks(): Task[] {
    const keys = [this.sortKey1, this.sortKey2, this.sortKey3].filter(
      (k): k is TaskSortField => k !== null,
    );
    const now = new Date();
    const filtered = filterTasks(
      this.tasks,
      this.filterState,
      now,
      this.isProjectScope,
    );
    if (keys.length === 0) {
      return [...filtered].sort((a, b) => {
        const oa = a.orderIndex ?? Number.MAX_SAFE_INTEGER;
        const ob = b.orderIndex ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) {
          return oa - ob;
        }
        return (a.title ?? '').localeCompare(b.title ?? '');
      });
    }
    return sortTasks(filtered, keys, this.sortAscending);
  }

  /** フィルタ初期・並び替え条件なしのときだけ手動ドラッグを有効にする */
  get canReorder(): boolean {
    return (
      this.viewMode === 'list' &&
      isFilterDefaultForReorder(this.filterState, this.isProjectScope) &&
      this.sortKey1 === null &&
      this.sortKey2 === null &&
      this.sortKey3 === null
    );
  }

  trackByTaskId(_index: number, task: Task): string {
    return task.id ?? `idx-${_index}`;
  }

  ngOnInit() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((qp) => {
        const tv = qp.get(TASK_RETURN_QUERY.taskView);
        if (tv === 'calendar') {
          this.viewMode = 'calendar';
          this.calendarGranularity =
            qp.get(TASK_RETURN_QUERY.cal) === 'week' ? 'week' : 'month';
        } else if (tv === 'list') {
          this.viewMode = 'list';
        }
      });
    this.subscribeTasks();
    this.subscribeProjectMembers();
  }

  /** ユーザーがリスト/カレンダーを切り替えたとき URL を同期（詳細からの戻りと一致させる） */
  onTaskListViewUiChange(): void {
    const queryParams: Record<string, string | null> = {
      [TASK_RETURN_QUERY.taskView]: this.viewMode,
      [TASK_RETURN_QUERY.cal]:
        this.viewMode === 'calendar' ? this.calendarGranularity : null,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['taskScope'] && !changes['taskScope'].firstChange) {
      this.subscribeTasks();
      this.subscribeProjectMembers();
      if (!this.isProjectScope) {
        this.filterState = { ...this.filterState, assignee: 'all' };
      }
    }
  }

  private subscribeProjectMembers(): void {
    this.membersSub?.unsubscribe();
    this.membersSub = undefined;
    this.projectMembers = [];
    if (this.taskScope.kind !== 'project') {
      return;
    }
    const pid = this.taskScope.projectId;
    const ref = collection(this.firestore, 'projects', pid, 'members');
    this.membersSub = collectionData(ref, { idField: 'id' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => {
            const id = String(data['id'] ?? '');
            const displayName =
              typeof data['displayName'] === 'string' && data['displayName'].trim() !== ''
                ? data['displayName'].trim()
                : typeof data['username'] === 'string' && data['username'].trim() !== ''
                  ? data['username'].trim()
                  : id;
            return { userId: id, displayName };
          }),
        ),
      )
      .subscribe((members) => {
        this.projectMembers = members.filter((m) => m.userId);
      });
  }

  private subscribeTasks() {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.tasks = [];

    const userId = this.auth.userId();
    if (!userId) {
      return;
    }

    const ref = this.tasksCollectionRef(userId);

    this.sub = collectionData(ref, { idField: 'id' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => {
            const raw = data['deadline'];
            const done = Boolean(data['done']);
            const label =
              typeof data['label'] === 'string' && data['label'].trim() !== ''
                ? data['label']
                : '';
            const deadline =
              raw instanceof Timestamp
                ? raw.toDate()
                : raw instanceof Date
                  ? raw
                  : raw
                    ? new Date(raw as string | number)
                    : null;
            const description =
              typeof data['description'] === 'string' ? data['description'] : '';
            const priority = clampTaskPriority(data['priority']);
            const rawAssignee = data['assignee'];
            const assignee =
              typeof rawAssignee === 'string' && rawAssignee.trim() !== ''
                ? rawAssignee.trim()
                : null;
            const rawOi = data['orderIndex'];
            const orderIndex =
              typeof rawOi === 'number' && !Number.isNaN(rawOi) ? rawOi : undefined;
            return {
              ...data,
              done,
              label,
              deadline,
              description,
              priority,
              assignee,
              orderIndex,
            } as Task;
          }),
        ),
      )
      .subscribe((tasks) => {
        this.tasks = tasks;
      });
  }

  addTask(task: Task) {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const col = this.tasksCollectionRef(userId);
    const payload: Record<string, unknown> = {
      title: task.title,
      label: task.label,
      done: task.done,
      priority: task.priority,
      deadline: task.deadline ? Timestamp.fromDate(new Date(task.deadline)) : null,
      description: task.description ?? '',
    };
    if (this.taskScope.kind === 'project') {
      const a = typeof task.assignee === 'string' ? task.assignee.trim() : '';
      payload['assignee'] = a || null;
    }
    const maxOrder = this.tasks.reduce(
      (m, t) => Math.max(m, t.orderIndex ?? -1),
      -1,
    );
    payload['orderIndex'] = maxOrder < 0 ? 0 : maxOrder + 1000;
    addDoc(col, payload);
  }

  onTaskDrop(event: CdkDragDrop<Task[]>): void {
    if (!this.canReorder || event.previousIndex === event.currentIndex) {
      return;
    }
    const ordered = [...this.displayTasks];
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);
    void this.persistTaskOrder(ordered);
  }

  private tasksCollectionRef(userId: string) {
    if (this.taskScope.kind === 'project') {
      return collection(this.firestore, 'projects', this.taskScope.projectId, 'tasks');
    }
    const pid = this.taskScope.privateListId;
    return pid === 'default'
      ? collection(this.firestore, 'accounts', userId, 'tasks')
      : collection(
          this.firestore,
          'accounts',
          userId,
          'privateTaskLists',
          pid,
          'tasks',
        );
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

  openAddTaskDialog(): void {
    const ref = this.dialog.open(TaskFormDialog, {
      width: 'min(96vw, 560px)',
      autoFocus: 'first-tabbable',
      data: {
        taskScope: this.taskScope,
        projectMembers: this.projectMembers,
      },
    });
    ref.afterClosed().subscribe((task: Task | undefined) => {
      if (task) {
        this.addTask(task);
      }
    });
  }

  private async persistTaskOrder(ordered: Task[]): Promise<void> {
    const batch = writeBatch(this.firestore);
    ordered.forEach((task, index) => {
      const id = task.id;
      if (!id) {
        return;
      }
      const r = this.taskDocRef(id);
      if (!r) {
        return;
      }
      batch.update(r, { orderIndex: index * 1000 });
    });
    try {
      await batch.commit();
    } catch (e) {
      console.error('persistTaskOrder failed:', e);
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.membersSub?.unsubscribe();
  }
}
