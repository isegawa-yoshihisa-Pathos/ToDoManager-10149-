/** タスク一覧/カレンダーから詳細へ行く直前の縦スクロール位置（sessionStorage） */
const SESSION_KEY = 'angular-todo-task-shell-scroll-y';

export function saveTaskShellScrollPosition(): void {
  try {
    const y = window.scrollY ?? document.documentElement.scrollTop ?? 0;
    sessionStorage.setItem(SESSION_KEY, String(Math.round(y)));
  } catch {
    /* ストレージ不可時は無視 */
  }
}

/**
 * user-window 表示直後に呼ぶ。非同期レイアウト後も数回試す。
 */
export function restoreTaskShellScrollPosition(): void {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw == null) {
      return;
    }
    sessionStorage.removeItem(SESSION_KEY);
    const y = parseInt(raw, 10);
    if (Number.isNaN(y) || y < 0) {
      return;
    }
    const apply = (): void => {
      window.scrollTo(0, y);
    };
    apply();
    requestAnimationFrame(apply);
    setTimeout(apply, 0);
    setTimeout(apply, 100);
    setTimeout(apply, 280);
  } catch {
    /* ignore */
  }
}
