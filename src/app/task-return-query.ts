/** タスク詳細から user-window へ戻るときのクエリ（TaskList と共有） */
export const TASK_RETURN_QUERY = {
  /** 開いた画面: list | calendar（詳細 URL の ?from= に対応） */
  taskView: 'taskView',
  /** カレンダー時の月/週: month | week（詳細 URL の ?cal= に対応） */
  cal: 'cal',
  /** 詳細を開いた元: list | calendar */
  from: 'from',
} as const;
