import { Component, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  Timestamp,
  serverTimestamp,
  collectionData,
  writeBatch,
  updateDoc,
  getDoc,
  setDoc,
  docData,
  increment,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { Subscription } from 'rxjs';
import { Task } from '../../models/task';
import { firestoreStatusFields } from '../../models/task-status';
import type { ProjectMemberRow } from '../../models/project-member';
import {
  TaskScope,
  STANDALONE_CALENDAR_PAGE_VIEW_STORAGE_KEY,
  taskDetailScopeParam,
} from '../task-scope';
import { TASK_RETURN_QUERY } from '../task-return-query';
import {
  TaskCalendar,
  type TaskCalendarGranularity,
  type TaskCalendarWeekdayStart,
} from '../task-calendar/task-calendar';
import { AuthService } from '../auth.service';
import { TaskCollectionReferenceService } from '../task-collection-reference.service';
import { ProjectSessionService } from '../project-session.service';
import { TaskActivityLogService } from '../task-activity-log.service';
import { TaskListDataService } from '../task-list/task-list-data.service';
import { TaskListContextActionsService } from '../task-list/task-list-context-actions.service';
import { TaskListTaskCtxMenu } from '../task-list/task-list-ctx-menu';
import { saveTaskShellScrollPosition } from '../task-shell-scroll';
import {
  CalendarScopeDialog,
  type CalendarScopeCandidate,
  type CalendarScopeDialogData,
  type CalendarScopeDialogResult,
} from '../calendar-scope-dialog/calendar-scope-dialog';
import {
  DEFAULT_KANBAN_COLUMNS,
  type KanbanColumn,
} from '../../models/kanban-column';

/** `/user-window/calendar` 専用：マージ購読・まとめて表示はこのコンポーネントのみで行う */
@Component({
  selector: 'app-integrate-task-calendar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TaskCalendar,
    TaskListTaskCtxMenu,
    MatButtonToggleModule,
    MatMenuModule,
    MatDialogModule,
  ],
  templateUrl: './integrate-task-calendar.html',
  styleUrl: './integrate-task-calendar.css',
  providers: [TaskListDataService, TaskListContextActionsService],
})
export class IntegrateTaskCalendar implements OnInit, OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectSession = inject(ProjectSessionService);
  private readonly taskActivityLog = inject(TaskActivityLogService);
  private readonly taskCollectionRef = inject(TaskCollectionReferenceService);
  readonly DataService = inject(TaskListDataService);
  readonly ContextActions = inject(TaskListContextActionsService);
  private readonly dialog = inject(MatDialog);

  private subscriptions = new Subscription();
  private dialogSourceSub = new Subscription();
  private integrateDialogSourcesStarted = false;
  private integrateSub = new Subscription();

  private calendarIntegrateScopes: TaskScope[] = [];
  private integrateScopesStorageKeyPresent = false;

  private integrateUiLabel = 'プライベート';
  private integratePrivateLists: { id: string; title: string }[] = [];
  private integrateMemberships: { projectId: string; projectName: string }[] = [];

  readonly fallbackTaskScope: TaskScope = {
    kind: 'private',
    privateListId: 'default',
  };

  calendarGranularity: TaskCalendarGranularity = 'month';
  calendarViewDate = new Date();
  calendarWeekdayStart: TaskCalendarWeekdayStart = 'Sunday';

  @ViewChild('dayCtxMenuTrigger') dayCtxMenuTrigger?: MatMenuTrigger;
  @ViewChild(TaskListTaskCtxMenu) taskCtxMenu?: TaskListTaskCtxMenu;

  contextMenuX = 0;
  contextMenuY = 0;
  ctxTask: Task | null = null;
  ctxDate: Date | null = null;
  ctxBulkMode = false;
  ctxBulkIds: string[] = [];

  get displayRootTasks(): Task[] {
    return this.DataService.displayRootTasks();
  }

  get calendarSourceScopeForCalendar(): TaskScope | undefined {
    if (this.calendarIntegrateScopes.length > 0) {
      return undefined;
    }
    if (
      this.integrateScopesStorageKeyPresent &&
      this.calendarIntegrateScopes.length === 0
    ) {
      return undefined;
    }
    return this.fallbackTaskScope;
  }

  ngOnInit(): void {
    this.loadViewPrefsFromStorage();
    this.syncIntegrateScopesFromStorage();
    this.ensureIntegrateDialogSourcesSubscription();
    this.syncContextActionsGranularity();
    this.DataService.setProjectScope(false);
    this.restartSubscriptions();
    this.onCalendarViewUiChange();
  }

  private syncContextActionsGranularity(): void {
    this.ContextActions.calendarGranularity = this.calendarGranularity;
  }

  private restartSubscriptions(): void {
    this.integrateSub.unsubscribe();
    this.integrateSub = new Subscription();

    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();

    const uid = this.auth.userId();
    if (!uid) {
      return;
    }

    const calendarOnlyEmptyExplicit =
      this.integrateScopesStorageKeyPresent &&
      this.calendarIntegrateScopes.length === 0;

    if (calendarOnlyEmptyExplicit) {
      this.DataService.destroy();
    } else if (this.calendarIntegrateScopes.length > 0) {
      const sub = this.DataService.initForMergedScopes(
        this.calendarIntegrateScopes,
        (scope) => this.taskCollectionRef.tasksCollectionRef(uid, scope),
      );
      this.integrateSub.add(sub);
    } else {
      this.subscribeTasks();
    }
  }

  private subscribeTasks(): void {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const baseRef = this.taskCollectionRef.tasksCollectionRef(
      userId,
      this.fallbackTaskScope,
    );
    if (!baseRef) {
      return;
    }
    this.DataService.initForScope(baseRef);
  }

  private ensureIntegrateDialogSourcesSubscription(): void {
    if (this.integrateDialogSourcesStarted) {
      return;
    }
    if (!this.auth.userId()) {
      return;
    }
    this.integrateDialogSourcesStarted = true;
    this.subscribeIntegrateDialogSources();
  }

  private subscribeIntegrateDialogSources(): void {
    const uid = this.auth.userId();
    if (!uid) {
      return;
    }

    const uiRef = doc(this.firestore, 'accounts', uid, 'config', 'privateUi');
    const uiSub = docData(uiRef).subscribe((d) => {
      const raw =
        d && typeof (d as Record<string, unknown>)['defaultListLabel'] === 'string'
          ? String((d as Record<string, unknown>)['defaultListLabel']).trim()
          : '';
      const fb = this.projectSession.load().defaultPrivateListLabel;
      this.integrateUiLabel = raw || fb || 'プライベート';
    });

    const plRef = collection(this.firestore, 'accounts', uid, 'privateTaskLists');
    const plSub = collectionData(plRef, { idField: 'id' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[])
            .map((data) => ({
              id: String(data['id'] ?? ''),
              title:
                typeof data['title'] === 'string' && data['title'].trim() !== ''
                  ? data['title']
                  : '（無題）',
            }))
            .filter((r) => r.id.length > 0)
            .sort((a, b) => a.title.localeCompare(b.title, 'ja')),
        ),
      )
      .subscribe((rows) => {
        this.integratePrivateLists = rows;
      });

    const memRef = collection(this.firestore, 'accounts', uid, 'projectMemberships');
    const memSub = collectionData(memRef, { idField: 'projectId' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => ({
            projectId: String(data['projectId'] ?? ''),
            projectName:
              typeof data['projectName'] === 'string' ? data['projectName'] : '（無題）',
          })),
        ),
      )
      .subscribe((rows) => {
        this.integrateMemberships = rows;
      });

    this.dialogSourceSub.add(uiSub);
    this.dialogSourceSub.add(plSub);
    this.dialogSourceSub.add(memSub);
  }

  private loadViewPrefsFromStorage(): void {
    const pref = this.projectSession.getTaskListViewPref(
      STANDALONE_CALENDAR_PAGE_VIEW_STORAGE_KEY,
    );
    if (!pref) {
      this.calendarGranularity = 'month';
      this.calendarViewDate = new Date();
      this.calendarWeekdayStart = 'Sunday';
      return;
    }
    this.calendarGranularity = pref.calendarGranularity;
    const d = new Date(pref.calendarViewDateIso);
    this.calendarViewDate = Number.isNaN(d.getTime()) ? new Date() : d;
    if (pref.calendarWeekdayStart === 'Monday' || pref.calendarWeekdayStart === 'Sunday') {
      this.calendarWeekdayStart = pref.calendarWeekdayStart;
    } else {
      this.calendarWeekdayStart = 'Sunday';
    }
  }

  private persistCurrentViewPrefsToStorage(): void {
    this.projectSession.setTaskListViewPref(STANDALONE_CALENDAR_PAGE_VIEW_STORAGE_KEY, {
      viewMode: 'calendar',
      calendarGranularity: this.calendarGranularity,
      calendarViewDateIso: this.calendarViewDate.toISOString(),
      calendarWeekdayStart: this.calendarWeekdayStart,
    });
  }

  private integrateStorageKey(): string {
    const uid = this.auth.userId();
    return uid
      ? `angular-todo-calendar-integrate:${uid}`
      : 'angular-todo-calendar-integrate:guest';
  }

  private isValidTaskScope(x: unknown): x is TaskScope {
    if (!x || typeof x !== 'object') {
      return false;
    }
    const o = x as Record<string, unknown>;
    if (o['kind'] === 'private') {
      return typeof o['privateListId'] === 'string';
    }
    if (o['kind'] === 'project') {
      return typeof o['projectId'] === 'string';
    }
    return false;
  }

  private syncIntegrateScopesFromStorage(): void {
    const key = this.integrateStorageKey();
    let raw = localStorage.getItem(key);
    if (!raw) {
      const legacy = localStorage.getItem('global:calender-integrate');
      if (legacy) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem('global:calender-integrate');
        raw = legacy;
      }
    }
    if (!raw) {
      this.integrateScopesStorageKeyPresent = false;
      this.calendarIntegrateScopes = [];
      return;
    }
    this.integrateScopesStorageKeyPresent = true;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) {
        this.integrateScopesStorageKeyPresent = false;
        this.calendarIntegrateScopes = [];
        return;
      }
      this.calendarIntegrateScopes = arr.filter((item): item is TaskScope =>
        this.isValidTaskScope(item),
      );
    } catch {
      this.integrateScopesStorageKeyPresent = false;
      this.calendarIntegrateScopes = [];
    }
  }

  private applyCalendarIntegrateScopes(scopes: TaskScope[]): void {
    this.calendarIntegrateScopes = scopes;
    this.integrateScopesStorageKeyPresent = true;
    try {
      localStorage.setItem(
        this.integrateStorageKey(),
        JSON.stringify(this.calendarIntegrateScopes),
      );
    } catch (e) {
      console.error('applyCalendarIntegrateScopes storage failed:', e);
    }
    this.restartSubscriptions();
  }

  openCalendarIntegrateDialog(): void {
    let initialSelected: TaskScope[];
    if (
      this.integrateScopesStorageKeyPresent &&
      this.calendarIntegrateScopes.length === 0
    ) {
      initialSelected = [];
    } else if (this.calendarIntegrateScopes.length > 0) {
      initialSelected = this.calendarIntegrateScopes.map((s) =>
        s.kind === 'private'
          ? { kind: 'private' as const, privateListId: s.privateListId }
          : { kind: 'project' as const, projectId: s.projectId },
      );
    } else {
      initialSelected = [{ kind: 'private' as const, privateListId: 'default' as const }];
    }
    const data: CalendarScopeDialogData = {
      candidates: this.buildCalendarScopeCandidates(),
      initialSelected,
    };
    this.dialog
      .open<CalendarScopeDialog, CalendarScopeDialogData, CalendarScopeDialogResult>(
        CalendarScopeDialog,
        { width: '480px', data },
      )
      .afterClosed()
      .subscribe((scopes) => {
        if (scopes === undefined) {
          return;
        }
        this.applyCalendarIntegrateScopes(scopes);
      });
  }

  private buildCalendarScopeCandidates(): CalendarScopeCandidate[] {
    const out: CalendarScopeCandidate[] = [];
    const session = this.projectSession.load();
    const defaultLabel =
      this.integrateUiLabel.trim() ||
      session.defaultPrivateListLabel ||
      'プライベート';
    out.push({
      scope: { kind: 'private', privateListId: 'default' },
      label: defaultLabel,
    });

    const lists =
      this.integratePrivateLists.length > 0
        ? this.integratePrivateLists
        : session.privateListsCache ?? [];
    for (const pl of lists) {
      if (!pl.id) {
        continue;
      }
      out.push({
        scope: { kind: 'private', privateListId: pl.id },
        label: pl.title || '（無題）',
      });
    }

    const members =
      this.integrateMemberships.length > 0
        ? this.integrateMemberships
        : session.projectTabsCache ?? [];
    for (const m of members) {
      if (!m.projectId) {
        continue;
      }
      out.push({
        scope: { kind: 'project', projectId: m.projectId },
        label: m.projectName || '（無題）',
      });
    }

    return out;
  }

  onCalendarViewDateChange(d: Date): void {
    this.calendarViewDate = d;
    this.onCalendarViewUiChange();
  }

  onCalendarWeekdayStartChange(v: TaskCalendarWeekdayStart): void {
    this.calendarWeekdayStart = v;
    this.onCalendarViewUiChange();
  }

  onPickCalendarDayFromMonth(d: Date): void {
    this.calendarViewDate = d;
    this.calendarGranularity = 'day';
    this.onCalendarViewUiChange();
  }

  onCalendarViewUiChange(): void {
    this.DataService.clearTaskSelection();
    this.syncContextActionsGranularity();
    this.persistCurrentViewPrefsToStorage();
    const queryParams: Record<string, string | null> = {
      [TASK_RETURN_QUERY.taskView]: 'calendar',
      [TASK_RETURN_QUERY.cal]: this.calendarGranularity,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private resolveTaskScope(task: Task | null | undefined): TaskScope {
    return task?.calendarSourceScope ?? this.fallbackTaskScope;
  }

  taskDocRef(taskId: string, scope: TaskScope = this.fallbackTaskScope) {
    const userId = this.auth.userId();
    if (!userId) {
      return null;
    }
    if (scope.kind === 'project') {
      return doc(this.firestore, 'projects', scope.projectId, 'tasks', taskId);
    }
    const pid = scope.privateListId;
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

  private kanbanBoardDocRefForScope(scope: TaskScope): ReturnType<typeof doc> | null {
    const uid = this.auth.userId();
    if (!uid) {
      return null;
    }
    if (scope.kind === 'project') {
      return doc(this.firestore, 'projects', scope.projectId, 'config', 'kanban');
    }
    const scopeKey =
      scope.privateListId === 'default'
        ? 'private'
        : `pl_${scope.privateListId}`;
    return doc(this.firestore, 'accounts', uid, 'config', `kanban_${scopeKey}`);
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

  private async firstKanbanColumnIdForScope(scope: TaskScope): Promise<string | undefined> {
    const ref = this.kanbanBoardDocRefForScope(scope);
    if (!ref) {
      return DEFAULT_KANBAN_COLUMNS[0]?.id;
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
      console.error('firstKanbanColumnIdForScope seed failed:', e);
    }
    try {
      const snap = await getDoc(ref);
      const cols = this.normalizeKanbanColumnsFromDoc(
        snap.exists() ? (snap.data() as { columns?: unknown })?.['columns'] : undefined,
      );
      return cols[0]?.id;
    } catch (e) {
      console.error('firstKanbanColumnIdForScope read failed:', e);
      return DEFAULT_KANBAN_COLUMNS[0]?.id;
    }
  }

  async addTaskForScope(scope: TaskScope, task: Task): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const col = this.taskCollectionRef.tasksCollectionRef(userId, scope);
    if (!col) {
      return;
    }
    const firstCol = await this.firstKanbanColumnIdForScope(scope);
    const payload: Record<string, unknown> = {
      title: task.title,
      label: task.label,
      ...firestoreStatusFields(task.status),
      priority: task.priority,
      description: task.description ?? '',
    };
    if (task.deadline) {
      payload['deadline'] = Timestamp.fromDate(new Date(task.deadline));
      payload['startAt'] = null;
      payload['endAt'] = null;
    } else if (task.startAt && task.endAt) {
      payload['deadline'] = null;
      payload['startAt'] = Timestamp.fromDate(new Date(task.startAt));
      payload['endAt'] = Timestamp.fromDate(new Date(task.endAt));
    } else {
      payload['deadline'] = null;
      payload['startAt'] = null;
      payload['endAt'] = null;
    }
    if (scope.kind === 'project') {
      const a = typeof task.assignee === 'string' ? task.assignee.trim() : '';
      payload['assignee'] = a || null;
    }
    if (firstCol) {
      payload['kanbanColumnId'] = firstCol;
    }
    const roots = this.DataService.tasks().filter((t) => !t.parentTaskId);
    let maxList = -1;
    let maxKb = -1;
    for (const t of roots) {
      const l = t.listOrderIndex;
      if (typeof l === 'number' && !Number.isNaN(l)) {
        maxList = Math.max(maxList, l);
      }
      const k = t.kanbanOrderIndex;
      if (typeof k === 'number' && !Number.isNaN(k)) {
        maxKb = Math.max(maxKb, k);
      }
    }
    const nextList = maxList < 0 ? 0 : maxList + 1000;
    const nextKb = maxKb < 0 ? 0 : maxKb + 1000;
    payload['listOrderIndex'] = nextList;
    payload['kanbanOrderIndex'] = nextKb;
    payload['createdAt'] = serverTimestamp();
    payload['updatedAt'] = serverTimestamp();
    payload['parentTaskId'] = null;
    void addDoc(col, payload).then((docRef) =>
      this.taskActivityLog.logCreate(scope, {
        subjectId: docRef.id,
        subjectTitle: task.title,
      }),
    );
  }

  private async loadProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
    const ref = collection(this.firestore, 'projects', projectId, 'members');
    return firstValueFrom(
      collectionData(ref, { idField: 'id' }).pipe(
        take(1),
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
      ),
    ).then((members) => members.filter((m) => m.userId));
  }

  /** 日付右クリック「タスクを作成」: リストを選んでからフォーム */
  openPickScopeThenAddTask(): void {
    const date = this.ctxDate;
    this.ctxDate = null;
    const data: CalendarScopeDialogData = {
      candidates: this.buildCalendarScopeCandidates(),
      initialSelected: [{ kind: 'private', privateListId: 'default' }],
      selectionMode: 'single',
    };
    this.dialog
      .open<CalendarScopeDialog, CalendarScopeDialogData, CalendarScopeDialogResult>(
        CalendarScopeDialog,
        { width: '480px', data },
      )
      .afterClosed()
      .subscribe((scopes) => {
        if (!scopes?.length) {
          return;
        }
        const scope = scopes[0]!;
        void this.openAddTaskForm(scope, date, []);
      });
  }

  private async openAddTaskForm(
    scope: TaskScope,
    date: Date | null,
    projectMembers: ProjectMemberRow[],
  ): Promise<void> {
    let members = projectMembers;
    if (scope.kind === 'project' && members.length === 0) {
      members = await this.loadProjectMembers(scope.projectId);
    }
    this.ContextActions.openAddTask(scope, members, date, (task: Task) =>
      void this.addTaskForScope(scope, task),
    );
  }

  private syncCtxMenuStateForTask(task: Task): void {
    const tid = task.id;
    if (
      tid &&
      this.DataService.selectedTaskIdSet().size >= 2 &&
      this.DataService.isTaskSelected(tid)
    ) {
      this.ctxBulkMode = true;
      this.ctxBulkIds = [...this.DataService.selectedTaskIdSet()];
    } else {
      this.ctxBulkMode = false;
      this.ctxBulkIds = [];
    }
    this.ctxTask = task;
  }

  onCalendarTaskContextMenu(payload: {
    clientX: number;
    clientY: number;
    task: Task;
  }): void {
    this.syncCtxMenuStateForTask(payload.task);
    this.taskCtxMenu?.open(payload.clientX, payload.clientY, payload.task);
  }

  openDayContextMenuAt(clientX: number, clientY: number, date: Date): void {
    this.ctxDate = date;
    this.contextMenuX = clientX;
    this.contextMenuY = clientY;
    queueMicrotask(() => this.dayCtxMenuTrigger?.openMenu());
  }

  ctxNavigateDetail(): void {
    const t = this.ctxTask;
    if (!t?.id) {
      return;
    }
    this.ContextActions.navigateToDetail(
      t,
      this.resolveTaskScope(t),
      'integrated-calendar',
    );
  }

  ctxBulkEditNavigate(): void {
    const ids = this.ctxBulkIds;
    if (ids.length < 2) {
      return;
    }
    const scope = this.ctxTask
      ? this.resolveTaskScope(this.ctxTask)
      : this.fallbackTaskScope;
    saveTaskShellScrollPosition();
    void this.router.navigate(['/tasks', 'bulk-edit', taskDetailScopeParam(scope)], {
      queryParams: { ids: ids.join(','), from: 'list' },
    });
  }

  ctxBulkDeleteFromMenu(): void {
    const ids = this.ctxBulkIds;
    if (ids.length < 2) {
      return;
    }
    if (!confirm(`${ids.length}件のタスクを削除しますか？\n選択されていない子タスクも削除されます。`)) {
      return;
    }
    void this.bulkDeleteTaskIds(ids).then(() => this.DataService.clearTaskSelection());
  }

  ctxDuplicateTasks(): void {
    const scope = this.ctxTask
      ? this.resolveTaskScope(this.ctxTask)
      : this.fallbackTaskScope;
    this.ContextActions.openDuplicateDialog(
      this.ctxBulkMode,
      this.ctxBulkIds,
      this.ctxTask,
      scope,
    );
  }

  async ctxOpenCreateSubtaskDialog(): Promise<void> {
    const t = this.ctxTask;
    if (!t?.id || t.parentTaskId) {
      return;
    }
    const scope = this.resolveTaskScope(t);
    const date = this.ctxDate;
    this.ctxDate = null;
    let members: ProjectMemberRow[] = [];
    if (scope.kind === 'project') {
      members = await this.loadProjectMembers(scope.projectId);
    }
    this.ContextActions.openAddSubtask(scope, members, t, date, (task: Task) =>
      void this.addSubtaskForScope(scope, t, task),
    );
  }

  private async addSubtaskForScope(
    scope: TaskScope,
    parent: Task,
    task: Task,
  ): Promise<void> {
    const userId = this.auth.userId();
    const parentId = parent.id;
    if (!userId || !parentId) {
      return;
    }
    const col = this.taskCollectionRef.tasksCollectionRef(userId, scope);
    if (!col) {
      return;
    }
    const pCol =
      (await this.firstKanbanColumnIdForScope(scope)) ??
      DEFAULT_KANBAN_COLUMNS[0]?.id ??
      '';
    const batch = writeBatch(this.firestore);
    const payload: Record<string, unknown> = {
      title: task.title,
      label: task.label,
      ...firestoreStatusFields(task.status),
      priority: task.priority,
      description: task.description ?? '',
      parentTaskId: parentId,
    };
    if (task.deadline) {
      payload['deadline'] = Timestamp.fromDate(new Date(task.deadline));
      payload['startAt'] = null;
      payload['endAt'] = null;
    } else if (task.startAt && task.endAt) {
      payload['deadline'] = null;
      payload['startAt'] = Timestamp.fromDate(new Date(task.startAt));
      payload['endAt'] = Timestamp.fromDate(new Date(task.endAt));
    } else {
      payload['deadline'] = null;
      payload['startAt'] = null;
      payload['endAt'] = null;
    }
    if (scope.kind === 'project') {
      const a = typeof task.assignee === 'string' ? task.assignee.trim() : '';
      payload['assignee'] = a || null;
    }
    payload['kanbanColumnId'] = pCol;
    const siblings = this.DataService.tasks().filter((t) => t.parentTaskId === parentId);
    let maxList = -1;
    let maxKb = -1;
    for (const t of siblings) {
      const l = t.listOrderIndex;
      if (typeof l === 'number' && !Number.isNaN(l)) {
        maxList = Math.max(maxList, l);
      }
      const k = t.kanbanOrderIndex;
      if (typeof k === 'number' && !Number.isNaN(k)) {
        maxKb = Math.max(maxKb, k);
      }
    }
    const nextList = maxList < 0 ? 0 : maxList + 1000;
    const nextKb = maxKb < 0 ? 0 : maxKb + 1000;
    payload['listOrderIndex'] = nextList;
    payload['kanbanOrderIndex'] = nextKb;
    payload['createdAt'] = serverTimestamp();
    payload['updatedAt'] = serverTimestamp();

    const newRef = doc(col);
    batch.set(newRef, payload);
    const pr = this.taskDocRef(parentId, scope);
    if (pr) {
      batch.update(pr, { childTaskCount: increment(1) });
    }
    try {
      await batch.commit();
    } catch (e) {
      console.error('addSubtaskForScope failed:', e);
    }
  }

  private async bulkDeleteTaskIds(rootIds: string[]): Promise<void> {
    const all = new Set<string>();
    for (const id of rootIds) {
      for (const x of this.collectSubtreeIds(id)) {
        all.add(x);
      }
    }
    const byId = new Map(this.DataService.tasks().map((t) => [t.id, t]));
    const batch = writeBatch(this.firestore);
    for (const id of all) {
      const t = byId.get(id);
      if (!t) {
        continue;
      }
      const scope = this.resolveTaskScope(t);
      const title = t.title.trim() || '（無題）';
      void this.taskActivityLog.logDelete(scope, {
        subjectId: id,
        subjectTitle: title,
      });
      const r = this.taskDocRef(id, scope);
      if (r) {
        batch.delete(r);
      }
    }
    try {
      await batch.commit();
    } catch (e) {
      console.error('bulkDeleteTaskIds failed:', e);
    }
  }

  private collectSubtreeIds(rootId: string): Set<string> {
    const out = new Set<string>();
    const walk = (pid: string) => {
      out.add(pid);
      for (const x of this.DataService.tasks()) {
        if (x.parentTaskId === pid && x.id) {
          walk(x.id);
        }
      }
    };
    walk(rootId);
    return out;
  }

  async ctxDeleteTask(): Promise<void> {
    const t = this.ctxTask;
    if (!t?.id) {
      return;
    }
    const id = t.id;
    if (!confirm('このタスクを削除しますか？')) {
      return;
    }
    const scope = this.resolveTaskScope(t);
    try {
      await this.taskActivityLog.logDelete(scope, {
        subjectId: id,
        subjectTitle: t.title || '（無題）',
      });
      await this.deleteTask(id, scope);
    } catch (err) {
      console.error('task delete failed:', err);
    }
  }

  private async deleteTask(rootId: string, scope: TaskScope): Promise<void> {
    const r = this.taskDocRef(rootId, scope);
    if (!r) {
      return;
    }
    let parentTaskId: string | null = null;
    try {
      const snap = await getDoc(r);
      if (!snap.exists()) {
        return;
      }
      const p = snap.data()['parentTaskId'];
      parentTaskId =
        typeof p === 'string' && p.trim() !== '' ? p.trim() : null;
    } catch (e) {
      console.error('deleteTask: read parentTaskId failed:', e);
      return;
    }
    const batch = writeBatch(this.firestore);
    batch.delete(r);
    if (parentTaskId) {
      const pr = this.taskDocRef(parentTaskId, scope);
      if (pr) {
        batch.update(pr, {
          childTaskCount: increment(-1),
        });
      }
    }
    try {
      await batch.commit();
    } catch (e) {
      console.error('deleteTask failed:', e);
    }
  }

  ngOnDestroy(): void {
    this.persistCurrentViewPrefsToStorage();
    this.integrateSub.unsubscribe();
    this.dialogSourceSub.unsubscribe();
    this.subscriptions.unsubscribe();
    this.DataService.destroy();
  }
}
