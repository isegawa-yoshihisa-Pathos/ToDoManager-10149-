/**
 * 新規タスクの既定担当者（ログイン中のユーザーID。Firestore の assignee に保存）。
 * 未ログイン時は null。
 */
export function DEFAULT_TASK_ASSIGNEE(userId: string | null | undefined): string | null {
  const u = typeof userId === 'string' ? userId.trim() : '';
  return u || null;
}
