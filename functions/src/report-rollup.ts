import * as admin from 'firebase-admin';

export type TaskScope =
  | { kind: 'private'; privateListId: 'default' | string }
  | { kind: 'project'; projectId: string };

export function taskScopeFromDetailRouteParam(scopeParam: string): TaskScope {
    const s = scopeParam?.trim() ?? '';
    if (s === '' || s === 'private') {
    return { kind: 'private', privateListId: 'default' };
    }
    if (s.startsWith('pl-')) {
    return { kind: 'private', privateListId: s.slice(3) };
    }
    return { kind: 'project', projectId: s };
}

export function scopeStorageKey(scope: TaskScope): string {
    if (scope.kind === 'project') {
    return `p:${scope.projectId}`;
    }
    return `pv:${scope.privateListId}`;
}

function tasksCollection(
    db: admin.firestore.Firestore,
    userId: string,
    scope: TaskScope,
): admin.firestore.CollectionReference {
    if (scope.kind === 'project') {
    return db.collection('projects').doc(scope.projectId).collection('tasks');
    }
    if (scope.privateListId === 'default') {
    return db.collection('accounts').doc(userId).collection('tasks');
    }
    return db.collection('accounts').doc(userId).collection('privateTaskLists').doc(scope.privateListId).collection('tasks');
}

function timestampLikeToDate(raw: unknown): Date | null{
    if (raw == null) {
        return null;
    }
    if (raw instanceof admin.firestore.Timestamp) {
        return raw.toDate();
    }
    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw;
    }
    if (typeof raw === 'number' || typeof raw === 'string') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function taskDueEndAt(task: TaskLite): Date | null {
    const m = taskScheduleMode(task);
    if (m === 'deadline' && task.deadline) {
      return timestampLikeToDate(task.deadline);
    }
    if (m === 'window' && task.endAt) {
      return timestampLikeToDate(task.endAt);
    }
    return null;
}

type TaskStatus = 'todo' | 'in_progress' | 'done';

function normalizeTaskStatusFromDoc(data: Record<string, unknown>): TaskStatus {
    const s = data['status'];
    if (s === 'todo' || s === 'in_progress' || s === 'done') {
        return s;
    }
    return 'todo';
}

interface TaskLite {
    status: 'todo' | 'in_progress' | 'done';
    deadline: Date | null;
    startAt: Date | null;
    endAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    completedAt: Date | null;
}

function mapDocToTaskLite(data: admin.firestore.DocumentData): TaskLite {
    const record = data as Record<string, unknown>;
    const status = normalizeTaskStatusFromDoc(record);
    return {
        status,
        deadline: timestampLikeToDate(record['deadline']),
        startAt: timestampLikeToDate(record['startAt']),
        endAt: timestampLikeToDate(record['endAt']),
        createdAt: timestampLikeToDate(record['createdAt']),
        updatedAt: timestampLikeToDate(record['updatedAt']),
        completedAt: timestampLikeToDate(record['completedAt']),
    };
}

function taskScheduleMode(task: TaskLite): 'deadline' | 'window' | 'none' {
    const dl = task.deadline;
    const s = task.startAt;
    const e = task.endAt;
    if (s && e) {
        return 'window';
    }
    if (dl) {
        return 'deadline';
    }
    return 'none';
}

const MS_DAY = 24 * 60 * 60 * 1000;

function rollingSince(now: Date, days: number): Date {
    return new Date(now.getTime() - days * MS_DAY);
}

function rollingUntil(now: Date, days: number): Date {
    return new Date(now.getTime() + days * MS_DAY);
}

function countStatusBreakdown(tasks: TaskLite[]): Record<TaskStatus, number> {
    const out = { todo: 0, in_progress: 0, done: 0 };
    for (const t of tasks) {
        out[t.status]++;
    }
    return out;
}

function countCreatedInLastDays(tasks: TaskLite[], now: Date, days: number): number {
    const since = rollingSince(now, days);
    let n = 0;
    for (const t of tasks) {
        const c = t.createdAt;
        if (c && c >= since && c <= now) {
            n++;
        }
    }
    return n;
}

function countUpdatedInLastDays(tasks: TaskLite[], now: Date, days: number): number {
    const since = rollingSince(now, days);
    let n = 0;
    for (const t of tasks) {
        const u = t.updatedAt;
        if (!u || u < since || u > now) {
            continue;
        }
        const c = t.createdAt;
        if (c && u.getTime() - c.getTime() <=2000) {
            continue;
        }
        n++;
    }
    return n;
}
  
function countCompletedInLastDays(tasks: TaskLite[], now: Date, days: number): number {
    const since = rollingSince(now, days);
    let n = 0;
    for (const t of tasks) {
        const x = t.completedAt;
        if (x && x >= since && x <= now) {
            n++;
        }
    }
    return n;
}

function countDueInNextDays(tasks: TaskLite[], now: Date, days: number): number {
    const end = rollingUntil(now, days);
    let n = 0;
    for (const t of tasks) {
        if (t.status === 'done') {
            continue;
        }
        const due = taskDueEndAt(t);
        if (!due) {
            continue;
        }
        if (due.getTime() >= now.getTime() && due.getTime() <= end.getTime()) {
            n++;
        }
    }
    return n;
}

  /**
 * タスク一覧を読み、`accounts/{uid}/reportRollups/{scopeKey}` に集計結果を書く。
 * Angular の task-report-stats と同じ算定ロジック。
 */
export async function computeAndWriteRollup(
    db: admin.firestore.Firestore,
    uid: string,
    scope: TaskScope,
): Promise<void> {
    const col = tasksCollection(db, uid, scope);
    const snap = await col.get();
    const tasks: TaskLite[] = snap.docs.map((d) => mapDocToTaskLite(d.data()));
    const now = new Date();
    const days = 7;
    const breakdown = countStatusBreakdown(tasks);
    const sk = scopeStorageKey(scope);
    const docRef = db.collection('accounts').doc(uid).collection('reportRollups').doc(sk);
    await docRef.set(
    {
        scopeKey: sk,
        windowDays: days,
        breakdown,
        addedLast7: countCreatedInLastDays(tasks, now, days),
        completedLast7: countCompletedInLastDays(tasks, now, days),
        updatedLast7: countUpdatedInLastDays(tasks, now, days),
        dueNext7: countDueInNextDays(tasks, now, days),
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
    );
}
  /**
   * 既定プライベート・追加プライベート・参加プロジェクトをまとめて更新（日次スケジュール用）。
   */
export async function refreshAllRollupsForUser(db: admin.firestore.Firestore, uid: string): Promise<void> {
    await computeAndWriteRollup(db, uid, { kind: 'private', privateListId: 'default' });
    const plSnap = await db.collection('accounts').doc(uid).collection('privateTaskLists').get();
    for (const d of plSnap.docs) {
        await computeAndWriteRollup(db, uid, { kind: 'private', privateListId: d.id });
    }
    const memSnap = await db.collection('accounts').doc(uid).collection('projectMemberships').get();
    for (const d of memSnap.docs) {
        const data = d.data() as Record<string, unknown>;
        const pid =
            typeof data['projectId'] === 'string' && data['projectId'].trim() !== ''
            ? String(data['projectId']).trim()
            : d.id;
        if (pid) {
            await computeAndWriteRollup(db, uid, { kind: 'project', projectId: pid });
        }
    }
}