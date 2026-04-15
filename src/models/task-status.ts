/** タスク進捗（一覧の色帯／行クリックで循環、詳細でも変更可） */
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '未着手' },
  { value: 'in_progress', label: '処理中' },
  { value: 'done', label: '完了' },
];

/** 未着手 → 処理中 → 完了 → 未着手 */
export function nextTaskStatus(current: TaskStatus): TaskStatus {
  const order: TaskStatus[] = ['todo', 'in_progress', 'done'];
  const i = order.indexOf(current);
  const next = (i + 1) % order.length;
  return order[next];
}

export function taskStatusLabel(s: TaskStatus): string {
  const m: Record<TaskStatus, string> = {
    todo: '未着手',
    in_progress: '処理中',
    done: '完了',
  };
  return m[s];
}

/** Firestore: `status` が無い／不正な場合は `todo` */
export function normalizeTaskStatusFromDoc(data: Record<string, unknown>): TaskStatus {
  const s = data['status'];
  if (s === 'todo' || s === 'in_progress' || s === 'done') {
    return s;
  }
  return 'todo';
}

export function firestoreStatusFields(status: TaskStatus): { status: TaskStatus } {
  return { status };
}
