import { Injectable, signal, computed, effect } from '@angular/core';
import {
  collectionData,
  onSnapshot,
  query,
  where,
  orderBy,
  Unsubscribe,
  Query,
  DocumentData,
} from '@angular/fire/firestore';
import { Subscription, map } from 'rxjs';
import { Task } from '../models/task';
import { mapFirestoreDocToTask } from './task-firestore-mutation';
import {
  TaskFilterState,
  defaultTaskFilterState,
  filterTasks,
} from './task-filter';
import { TaskSortField, sortTasks } from './task-sort';

export type TaskListSortKeys = {
  f1: TaskSortField | null;
  f2: TaskSortField | null;
  f3: TaskSortField | null;
  asc: boolean;
};

function listOrderNum(t: Task): number {
  const v = t.listOrderIndex;
  return typeof v === 'number' && !Number.isNaN(v) ? v : Number.MAX_SAFE_INTEGER;
}

@Injectable()
export class TaskListDataService {
  private _tasks = signal<Task[]>([]);
  readonly tasks = this._tasks.asReadonly();

  private rootSubscription?: Subscription;
  private subTaskUnsubscribers = new Map<string, Unsubscribe>();
  private currentCollectionRef: any;

  /** プロジェクト一覧かどうか（filterTasks の担当者フィルタ等に使用） */
  readonly isProjectScope = signal(false);

  filterState = signal<TaskFilterState>(defaultTaskFilterState());

  sortKeys = signal<TaskListSortKeys>({
    f1: null,
    f2: null,
    f3: null,
    asc: true,
  });

  filteredTasks = computed(() => {
    const now = new Date();
    return filterTasks(
      this._tasks(),
      this.filterState(),
      now,
      this.isProjectScope(),
    );
  });

  displayRootTasks = computed(() => {
    const allFiltered = this.filteredTasks();
    const roots = allFiltered.filter((t) => !t.parentTaskId);
    const s = this.sortKeys();
    const keys = [s.f1, s.f2, s.f3].filter(
      (k): k is TaskSortField => k !== null,
    );
    if (keys.length === 0) {
      return [...roots].sort((a, b) => {
        const oa = listOrderNum(a);
        const ob = listOrderNum(b);
        if (oa !== ob) {
          return oa - ob;
        }
        return (a.title ?? '').localeCompare(b.title ?? '');
      });
    }
    return sortTasks(roots, keys, s.asc);
  });

  expandedTaskIds = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      const ids = this.expandedTaskIds();
      if (!this.currentCollectionRef) return;

      ids.forEach((id) => {
        if (!this.subTaskUnsubscribers.has(id)) {
          this.subscribeSubtasks(id, this.currentCollectionRef);
        }
      });

      this.subTaskUnsubscribers.forEach((unsub, id) => {
        if (!ids.has(id)) {
          unsub();
          this.subTaskUnsubscribers.delete(id);
          this._tasks.update((tasks) =>
            tasks.filter((t) => t.parentTaskId !== id),
          );
        }
      });
    });
  }

  setProjectScope(isProject: boolean): void {
    this.isProjectScope.set(isProject);
  }

  patchFilter(partial: Partial<TaskFilterState>): void {
    this.filterState.update((s) => ({ ...s, ...partial }));
  }

  resetFilters(): void {
    this.filterState.set(defaultTaskFilterState());
  }

  patchSortKeys(partial: Partial<TaskListSortKeys>): void {
    this.sortKeys.update((s) => ({ ...s, ...partial }));
  }

  /**
   * スコープ（プロジェクトやマイリスト）が切り替わった際の初期化
   */
  initForScope(collectionRef: any) {
    this.destroy();
    this.currentCollectionRef = collectionRef;

    const q = query(
      collectionRef,
      where('parentTaskId', '==', null),
      orderBy('listOrderIndex', 'asc'),
    );

    this.rootSubscription = collectionData<DocumentData, 'id'>(
      q as Query<DocumentData>,
      { idField: 'id' },
    )
      .pipe(
        map((rows) =>
          rows.map((row) =>
            mapFirestoreDocToTask(row as Record<string, unknown>),
          ),
        ),
      )
      .subscribe({
        next: (newRootTasks) => {
          this.mergeRootTasks(newRootTasks);
        },
        error: (error) => {
          console.error('mergeRootTasks error:', error);
        },
      });
  }

  private mergeRootTasks(newRoots: Task[]) {
    const newRootIds = new Set(
      newRoots
        .map((t) => t.id)
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    );
    const preservedSubs = this._tasks().filter((t) => {
      return (
        !!t.parentTaskId &&
        this.subTaskUnsubscribers.has(t.parentTaskId) &&
        newRootIds.has(t.parentTaskId)
      );
    });
    this._tasks.set([...newRoots, ...preservedSubs]);
  }

  subscribeSubtasks(parentId: string, collectionRef: any) {
    if (this.subTaskUnsubscribers.has(parentId)) return;

    const q = query(
      collectionRef,
      where('parentTaskId', '==', parentId),
      orderBy('listOrderIndex', 'asc'),
    );

    const unsub = onSnapshot(q, (snapshot) => {
      let newTasks = [...this._tasks()];

      snapshot.docChanges().forEach((change) => {
        const raw: Record<string, unknown> = {
          id: change.doc.id,
          ...(change.doc.data() as Record<string, unknown>),
        };
        const id = change.doc.id;

        if (change.type === 'added' || change.type === 'modified') {
          const data = mapFirestoreDocToTask(raw);
          const index = newTasks.findIndex((t) => t.id === id);
          if (index > -1) {
            newTasks[index] = data;
          } else {
            newTasks.push(data);
          }
        } else if (change.type === 'removed') {
          newTasks = newTasks.filter((t) => t.id !== id);
        }
      });

      this._tasks.set(newTasks);
    });

    this.subTaskUnsubscribers.set(parentId, unsub);
  }

  unsubscribeSubtasks(parentId: string) {
    const unsub = this.subTaskUnsubscribers.get(parentId);
    if (unsub) {
      unsub();
      this.subTaskUnsubscribers.delete(parentId);
    }
  }

  setTasks(newTasks: Task[]) {
    this._tasks.set(newTasks);
  }

  destroy() {
    if (this.rootSubscription) {
      this.rootSubscription.unsubscribe();
      this.rootSubscription = undefined;
    }
    this.subTaskUnsubscribers.forEach((unsub) => unsub());
    this.subTaskUnsubscribers.clear();
    this._tasks.set([]);
    this.expandedTaskIds.set(new Set());
    this.currentCollectionRef = null;
  }
}
