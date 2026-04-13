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
import {
  firestoreStatusFields,
  nextTaskStatus,
  normalizeTaskStatusFromDoc,
  type TaskStatus,
} from '../../models/task-status';
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
  updateDoc,
  getDoc,
  setDoc,
  docData,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth.service';
import { TaskScope, taskDetailScopeParam } from '../task-scope';
import { saveTaskShellScrollPosition } from '../task-shell-scroll';
import type { ProjectMemberRow } from '../../models/project-member';
import { TaskCalendar } from '../task-calendar/task-calendar';
import { UserAvatar } from '../user-avatar/user-avatar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { TASK_RETURN_QUERY } from '../task-return-query';
import {
  DEFAULT_KANBAN_COLUMNS,
  type KanbanColumn,
} from '../../models/kanban-column';

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
    MatMenuModule,
    UserAvatar,
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
  private kanbanBoardSub?: Subscription;

  @Input() taskScope: TaskScope = { kind: 'private', privateListId: 'default' };

  /** プロジェクトハブ画面がアクティブなとき（タスクリスト追加ボタンの見た目用） */
  @Input() projectHubNavActive = false;

  @Output() openProjectHub = new EventEmitter<void>();

  /** リスト表示 / カレンダー / カンバン */
  viewMode: 'list' | 'calendar' | 'kanban' = 'list';
  /** カレンダー時の月／週 */
  calendarGranularity: 'month' | 'week' = 'month';

  tasks: Task[] = [];

  /** プロジェクトのメンバー（担当者選択・フィルタ用） */
  projectMembers: ProjectMemberRow[] = [];
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

  /** Firestore と同期するカンバン列（進捗とは独立） */
  kanbanColumnList: KanbanColumn[] = [...DEFAULT_KANBAN_COLUMNS];

  /** 単一 mat-menu 用（編集ボタンでセット） */
  kanbanEditColumn: KanbanColumn | null = null;

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

  /** 担当者フィルタの選択行（トリガー表示用） */
  filterSelectedMember(): ProjectMemberRow | null {
    const id = this.filterState.assignee;
    if (id === 'all' || id === 'unassigned') {
      return null;
    }
    return this.projectMembers.find((m) => m.userId === id) ?? null;
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
        } else if (tv === 'kanban') {
          this.viewMode = 'kanban';
        } else if (tv === 'list') {
          this.viewMode = 'list';
        }
      });
    this.subscribeTasks();
    this.subscribeProjectMembers();
    void this.subscribeKanbanBoard();
  }

  /** ユーザーがリスト/カレンダー/カンバンを切り替えたとき URL を同期（詳細からの戻りと一致させる） */
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
      void this.subscribeKanbanBoard();
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
            const avatarUrl =
              typeof data['avatarUrl'] === 'string' && data['avatarUrl'].trim() !== ''
                ? data['avatarUrl'].trim()
                : null;
            return { userId: id, displayName, avatarUrl };
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
            const status = normalizeTaskStatusFromDoc(data as Record<string, unknown>);
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
            const rawKb = data['kanbanColumnId'];
            const kanbanColumnId =
              typeof rawKb === 'string' && rawKb.trim() !== '' ? rawKb.trim() : null;
            return {
              ...data,
              status,
              label,
              deadline,
              description,
              priority,
              assignee,
              orderIndex,
              kanbanColumnId,
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
      ...firestoreStatusFields(task.status),
      priority: task.priority,
      deadline: task.deadline ? Timestamp.fromDate(new Date(task.deadline)) : null,
      description: task.description ?? '',
    };
    if (this.taskScope.kind === 'project') {
      const a = typeof task.assignee === 'string' ? task.assignee.trim() : '';
      payload['assignee'] = a || null;
    }
    const firstCol = this.kanbanColumnList[0]?.id;
    if (firstCol) {
      payload['kanbanColumnId'] = firstCol;
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

  private kanbanBoardDocRef(): ReturnType<typeof doc> | null {
    const uid = this.auth.userId();
    if (!uid) {
      return null;
    }
    if (this.taskScope.kind === 'project') {
      return doc(this.firestore, 'projects', this.taskScope.projectId, 'config', 'kanban');
    }
    const scopeKey =
      this.taskScope.privateListId === 'default'
        ? 'private'
        : `pl_${this.taskScope.privateListId}`;
    return doc(this.firestore, 'accounts', uid, 'config', `kanban_${scopeKey}`);
  }

  private async subscribeKanbanBoard(): Promise<void> {
    this.kanbanBoardSub?.unsubscribe();
    this.kanbanBoardSub = undefined;
    const ref = this.kanbanBoardDocRef();
    if (!ref) {
      this.kanbanColumnList = [...DEFAULT_KANBAN_COLUMNS];
      return;
    }
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { columns: [...DEFAULT_KANBAN_COLUMNS] }, { merge: true });
      } else {
        const raw = (snap.data() as { columns?: unknown })?.['columns'];
        if (!Array.isArray(raw) || raw.length === 0) {
          await setDoc(ref, { columns: [...DEFAULT_KANBAN_COLUMNS] }, { merge: true });
        }
      }
    } catch (e) {
      console.error('subscribeKanbanBoard seed failed:', e);
    }
    this.kanbanBoardSub = docData(ref).subscribe((data) => {
      const raw = data?.['columns'];
      this.kanbanColumnList = this.normalizeKanbanColumnsFromDoc(raw);
    });
  }

  private normalizeKanbanColumnsFromDoc(raw: unknown): KanbanColumn[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      return [...DEFAULT_KANBAN_COLUMNS];
    }
    const out: KanbanColumn[] = [];
    for (const x of raw) {
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const id = typeof o['id'] === 'string' ? o['id'].trim() : '';
        const title = typeof o['title'] === 'string' ? o['title'].trim() : '';
        if (id) {
          out.push({ id, title: title || '（無題）' });
        }
      }
    }
    return out.length > 0 ? out : [...DEFAULT_KANBAN_COLUMNS];
  }

  kanbanListId(columnId: string): string {
    return `kanban-${columnId}`;
  }

  /** 列同士をつなぎ、列間ドラッグで移動できるようにする */
  kanbanConnectedIds(): string[] {
    return this.kanbanColumnList.map((c) => this.kanbanListId(c.id));
  }

  private parseKanbanColumnId(containerId: string): string {
    return containerId.startsWith('kanban-') ? containerId.slice('kanban-'.length) : '';
  }

  /** タスクが属するカンバン列 ID（未設定は先頭列） */
  columnIdForTask(task: Task): string {
    const first = this.kanbanColumnList[0]?.id ?? '';
    const k = typeof task.kanbanColumnId === 'string' ? task.kanbanColumnId.trim() : '';
    if (k && this.kanbanColumnList.some((c) => c.id === k)) {
      return k;
    }
    return first;
  }

  tasksForKanbanColumnId(colId: string): Task[] {
    const sortFn = (a: Task, b: Task) =>
      (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) ||
      (a.title ?? '').localeCompare(b.title ?? '');
    return this.displayTasks
      .filter((t) => this.columnIdForTask(t) === colId)
      .sort(sortFn);
  }

  private buildKanbanColumnState(): Record<string, Task[]> {
    const state: Record<string, Task[]> = {};
    for (const c of this.kanbanColumnList) {
      state[c.id] = this.tasksForKanbanColumnId(c.id);
    }
    return state;
  }

  /** リスト行（task-list-item）のラベル帯色と同じ */
  kanbanLabelColor(task: Task): string {
    const c = task.label?.trim();
    return c || '#e0e0e0';
  }

  /** ドラッグで列間移動（kanbanColumnId のみ更新）。進捗は変えない */
  onKanbanDrop(ev: CdkDragDrop<Task>): void {
    const task = ev.item.data as Task | undefined;
    if (!task?.id) {
      return;
    }
    const fromId = this.parseKanbanColumnId(ev.previousContainer.id);
    const toId = this.parseKanbanColumnId(ev.container.id);
    if (!fromId || !toId || !this.kanbanColumnList.some((c) => c.id === fromId)) {
      return;
    }
    const state = this.buildKanbanColumnState();

    if (fromId === toId) {
      const arr = [...(state[fromId] ?? [])];
      if (ev.previousIndex === ev.currentIndex) {
        return;
      }
      moveItemInArray(arr, ev.previousIndex, ev.currentIndex);
      state[fromId] = arr;
    } else {
      if (!this.kanbanColumnList.some((c) => c.id === toId)) {
        return;
      }
      const fromArr = [...(state[fromId] ?? [])];
      const toArr = [...(state[toId] ?? [])];
      const [moved] = fromArr.splice(ev.previousIndex, 1);
      if (!moved) {
        return;
      }
      const updated: Task = { ...moved, kanbanColumnId: toId };
      toArr.splice(Math.min(ev.currentIndex, toArr.length), 0, updated);
      state[fromId] = fromArr;
      state[toId] = toArr;
    }
    void this.persistKanbanBoardOrder(state);
  }

  private async persistKanbanBoardOrder(state: Record<string, Task[]>): Promise<void> {
    const flat: Task[] = [];
    for (const col of this.kanbanColumnList) {
      flat.push(...(state[col.id] ?? []));
    }
    const batch = writeBatch(this.firestore);
    const firstCol = this.kanbanColumnList[0]?.id ?? null;
    flat.forEach((t, i) => {
      const id = t.id;
      if (!id) {
        return;
      }
      const r = this.taskDocRef(id);
      if (!r) {
        return;
      }
      const kid = t.kanbanColumnId ?? firstCol;
      batch.update(r, { orderIndex: i * 1000, kanbanColumnId: kid });
    });
    try {
      await batch.commit();
    } catch (e) {
      console.error('persistKanbanBoardOrder failed:', e);
    }
  }

  async renameKanbanColumn(col: KanbanColumn): Promise<void> {
    const n = window.prompt('リスト名', col.title);
    if (n === null) {
      return;
    }
    const title = n.trim() || '（無題）';
    const ref = this.kanbanBoardDocRef();
    if (!ref) {
      return;
    }
    const next = this.kanbanColumnList.map((c) =>
      c.id === col.id ? { ...c, title } : c,
    );
    try {
      await setDoc(ref, { columns: next }, { merge: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : '更新に失敗しました');
    }
  }

  async deleteKanbanColumn(col: KanbanColumn): Promise<void> {
    if (this.kanbanColumnList.length <= 1) {
      alert('最後の1列は削除できません。');
      return;
    }
    if (
      !confirm(
        `「${col.title}」を削除しますか？\nこの列のタスクは他の列へ移動します。`,
      )
    ) {
      return;
    }
    const ref = this.kanbanBoardDocRef();
    if (!ref) {
      return;
    }
    const idx = this.kanbanColumnList.findIndex((c) => c.id === col.id);
    if (idx < 0) {
      return;
    }
    const fallbackId =
      idx === 0 ? this.kanbanColumnList[1].id : this.kanbanColumnList[0].id;
    const nextCols = this.kanbanColumnList.filter((c) => c.id !== col.id);
    const affected = this.tasks.filter((t) => {
      const cid = this.columnIdForTask(t);
      return cid === col.id;
    });
    try {
      const batch = writeBatch(this.firestore);
      for (const t of affected) {
        const tid = t.id;
        if (!tid) {
          continue;
        }
        const r = this.taskDocRef(tid);
        if (r) {
          batch.update(r, { kanbanColumnId: fallbackId });
        }
      }
      await batch.commit();
      await setDoc(ref, { columns: nextCols }, { merge: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました');
    }
  }

  async addKanbanColumn(): Promise<void> {
    const ref = this.kanbanBoardDocRef();
    if (!ref) {
      return;
    }
    const id = `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    const title = `リスト ${this.kanbanColumnList.length + 1}`;
    const next = [...this.kanbanColumnList, { id, title }];
    try {
      await setDoc(ref, { columns: next }, { merge: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : '追加に失敗しました');
    }
  }

  onKanbanCardClick(ev: MouseEvent, task: Task): void {
    const el = ev.target as HTMLElement | null;
    if (!el || el.closest('button')) {
      return;
    }
    ev.preventDefault();
    const id = task.id;
    if (!id) {
      return;
    }
    const next = nextTaskStatus(task.status);
    const ref = this.taskDocRef(id);
    if (!ref) {
      return;
    }
    updateDoc(ref, firestoreStatusFields(next)).catch((err) =>
      console.error('kanban status update failed:', err),
    );
  }

  openKanbanDetail(ev: Event, task: Task): void {
    ev.preventDefault();
    ev.stopPropagation();
    const id = task.id;
    if (!id) {
      return;
    }
    saveTaskShellScrollPosition();
    void this.router.navigate(['/task', taskDetailScopeParam(this.taskScope), id], {
      queryParams: { from: 'kanban' },
    });
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
    this.kanbanBoardSub?.unsubscribe();
  }
}
