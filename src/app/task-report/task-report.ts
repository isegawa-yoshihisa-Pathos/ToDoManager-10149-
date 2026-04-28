import { Component, DestroyRef, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
  doc,
  getDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../auth.service';
import {
  TaskScope,
  taskListViewStorageKey,
  taskScopeFromDetailRouteParam,
} from '../task-scope';
import { timestampLikeToDate } from '../task-schedule';
import { TASK_STATUS_OPTIONS, type TaskStatus } from '../../models/task-status';
import { pieGradientFromBreakdown } from '../task-report-stats';
import type { TaskActivityAction } from '../task-activity-log.service';
@Component({
  standalone: true,
  selector: 'app-task-report',
  imports: [CommonModule, MatButtonModule],
  templateUrl: './task-report.html',
  styleUrl: './task-report.css',
})

export class TaskReport implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private logSub?: Subscription;

  scopeParam = '';
  taskScope: TaskScope = { kind: 'private', privateListId: 'default' };
  loading = true;
  listTitle = '';
  pieGradient: string | null = null;
  breakdown: Record<TaskStatus, number> = { todo: 0, in_progress: 0, done: 0 };
  readonly statusLegend = TASK_STATUS_OPTIONS;

  addedLast7 = 0;
  completedLast7 = 0;
  updatedLast7 = 0;
  dueNext7 = 0;
  rollupGeneratedAt: Date | null = null;
  rollupRefreshing = false;

  activityRows: {
    id: string;
    at: Date | null;
    action: TaskActivityAction;
    actionLabel: string;
    actorDisplayName: string;
    subjectTitle: string;
    subjectId: string;
  }[] = [];

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.scopeParam = params.get('scope') ?? '';
      this.taskScope = taskScopeFromDetailRouteParam(this.scopeParam);
      void this.subscribeData();
    });
  }

  ngOnDestroy(): void {
    this.logSub?.unsubscribe();
  }

  private async subscribeData(): Promise<void> {
    this.logSub?.unsubscribe();
    this.loading = true;
    const userId = this.auth.userId();
    if (!userId) {
      void this.router.navigate(['/login']);
      this.loading = false;
      return;
    }
    try {
      await Promise.all([this.getListTitle(), this.loadRollupFromFirestore()]);
    } finally {
      this.loading = false;
    }
    const logRef = this.activityLogCollectionRef(userId, this.taskScope);
    const q = query(logRef, orderBy('at', 'desc'), limit(100));
    this.logSub = collectionData(q, { idField: 'id' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => {
            const id = String(data['id'] ?? '');
            const at = timestampLikeToDate(data['at']);
            const raw = data['action'];
            const action: TaskActivityAction =
              raw === 'create' ||
              raw === 'update' ||
              raw === 'delete' ||
              raw === 'createKanban' ||
              raw === 'updateKanban' ||
              raw === 'deleteKanban'
                ? raw
                : 'update';
            const subjectTitle =
              typeof data['subjectTitle'] === 'string' ? data['subjectTitle'] : '';
            const subjectId = typeof data['subjectId'] === 'string' ? data['subjectId'] : '';
            const actorDisplayName =
              typeof data['actorDisplayName'] === 'string' &&
              data['actorDisplayName'].trim() !== ''
                ? data['actorDisplayName'].trim()
                : typeof data['actorUserId'] === 'string'
                  ? data['actorUserId']
                  : '';
            return {
              id,
              at,
              action,
              actionLabel:
                action === 'create'
                  ? 'タスクを追加'
                  : action === 'delete'
                    ? 'タスクを削除'
                    : action === 'update'
                      ? 'タスクを編集'
                      : action === 'createKanban'
                        ? 'カンバンを追加'
                        : action === 'updateKanban'
                          ? 'カンバン名を編集'
                          : action === 'deleteKanban'
                            ? 'カンバンを削除'
                            : '不明な操作',
              actorDisplayName,
              subjectTitle: subjectTitle || '（無題）',
              subjectId,
            };
          }),
        ),
      )
      .subscribe((rows) => {
        this.activityRows = rows;
      });
  }

  private activityLogCollectionRef(userId: string, scope: TaskScope) {
    if (scope.kind === 'project') {
      return collection(this.firestore, 'projects', scope.projectId, 'taskActivityLog');
    }
    const pid = scope.privateListId;
    return pid === 'default'
      ? collection(this.firestore, 'accounts', userId, 'taskActivityLog')
      : collection(
          this.firestore,
          'accounts',
          userId,
          'privateTaskLists',
          pid,
          'taskActivityLog',
        );
  }

  private async loadRollupFromFirestore(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      this.applyEmptyRollup();
      return;
    }
    let docRef;
    if (this.taskScope.kind === 'project') {
      docRef = doc(this.firestore, 'projects', this.taskScope.projectId, 'reportRollups', 'latest');
    } else if (this.taskScope.privateListId === 'default') {
      docRef = doc(this.firestore, 'accounts', userId, 'reportRollups', 'latest');
    } else {
      docRef = doc(this.firestore, 'accounts', userId, 'privateTaskLists', this.taskScope.privateListId, 'reportRollups', 'latest');
    }
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) {
      this.applyEmptyRollup();
      return;
    }
    const raw = snapshot.data();
    if (!raw) {
      this.applyEmptyRollup();
      return;
    }
    this.applyRollupData(raw as Record<string, unknown>);
  }

  private applyEmptyRollup(): void {
    this.breakdown = { todo: 0, in_progress: 0, done: 0 };
    this.pieGradient = pieGradientFromBreakdown(this.breakdown);
    this.addedLast7 = 0;
    this.completedLast7 = 0;
    this.updatedLast7 = 0;
    this.dueNext7 = 0;
    this.rollupGeneratedAt = null;
  }

  private applyRollupData(data: Record<string, unknown>): void {
    const b = data['breakdown'];
    if (b && typeof b === 'object' && b !== null) {
      const o = b as Record<string, unknown>;
      this.breakdown = {
        todo: Number(o['todo']) || 0,
        in_progress: Number(o['in_progress']) || 0,
        done: Number(o['done']) || 0,
      };
    } else {
      this.breakdown = { todo: 0, in_progress: 0, done: 0 };
    }
    this.pieGradient = pieGradientFromBreakdown(this.breakdown);
    this.addedLast7 = Number(data['addedLast7']) || 0;
    this.completedLast7 = Number(data['completedLast7']) || 0;
    this.updatedLast7 = Number(data['updatedLast7']) || 0;
    this.dueNext7 = Number(data['dueNext7']) || 0;
    const ga = data['generatedAt'];
    if (ga instanceof Timestamp) {
      this.rollupGeneratedAt = ga.toDate();
    } else if (ga && typeof (ga as { toDate?: () => Date }).toDate === 'function') {
      this.rollupGeneratedAt = (ga as { toDate: () => Date }).toDate();
    } else {
      this.rollupGeneratedAt = null;
    }
  }

  async forceRefreshRollup(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId || this.rollupRefreshing) {
      return;
    }
    this.rollupRefreshing = true;
    try {
      const fn = httpsCallable<{ scopeParam: string }, { ok?: boolean }>(
        this.functions,
        'refreshTaskReportRollup',
      );
      await fn({ scopeParam: this.scopeParam });
      await this.loadRollupFromFirestore();
    } catch (e) {
      console.error('forceRefreshRollup failed:', e);
    } finally {
      this.rollupRefreshing = false;
    }
  }

  private async getListTitle(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      this.listTitle = '';
      return;
    }
    const scope = this.taskScope;
    if (scope.kind === 'project') {
      const docRef = doc(this.firestore, 'projects', scope.projectId);
      const snapshot = await getDoc(docRef);
      this.listTitle = snapshot.data()?.['name'] ?? '';
      return;
    }
    const pid = scope.privateListId;
    if (pid === 'default') {
      const docRef = doc(this.firestore, 'accounts', userId, 'config', 'privateUi');
      const snapshot = await getDoc(docRef);
      this.listTitle = snapshot.data()?.['defaultListLabel'] ?? '';
      return;
    }
    const docRef = doc(this.firestore, 'accounts', userId, 'privateTaskLists', pid);
    const snapshot = await getDoc(docRef);
    this.listTitle = snapshot.data()?.['title'] ?? '';
  }
  
  back(): void {
    const listUrl =
      this.scopeParam === 'private'
        ? `private/default`
        : this.scopeParam.startsWith('pl-')
          ? `private/${this.scopeParam.slice(3)}`
          : `project/${this.scopeParam}`;
    void this.router.navigate([`/user-window/${listUrl}`]);
  }
}