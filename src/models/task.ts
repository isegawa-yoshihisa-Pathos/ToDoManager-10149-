import type { TaskStatus } from './task-status';

export interface Task {
  id?: string;
  title: string;
  label: string;
  /** 進捗（未着手 / 処理中 / 完了）。従来の done は Firestore 互換のため書き込み時に同期 */
  status: TaskStatus;
  priority: number;
  deadline?: Date | null;
  description?: string;
  /** プロジェクトタスクの担当ユーザー名（プライベートでは未使用） */
  assignee?: string | null;
  /** 手動並び替え用（小さいほど上） */
  orderIndex?: number;
  /** カンバン表示時の列 ID（進捗 status とは独立） */
  kanbanColumnId?: string | null;
}
