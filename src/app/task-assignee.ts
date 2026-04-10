/**
 * 新規タスクの既定担当者（ログイン中のユーザー名）。
 * 未ログイン時は null。
 */
export function DEFAULT_TASK_ASSIGNEE(username: string | null | undefined): string | null {
  const u = typeof username === 'string' ? username.trim() : '';
  return u || null;
}
