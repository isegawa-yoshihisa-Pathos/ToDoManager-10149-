import type { TaskStatus } from './task-status';

export interface Task {
  id?: string;
  title: string;
  label: string;
  /** 進捗（未着手 / 処理中 / 完了）。従来の done は Firestore 互換のため書き込み時に同期 */
  status: TaskStatus;
  priority: number;
  /**
   * 締切日時（1分単位）。`startAt`/`endAt` とは同時に持たない。
   */
  deadline?: Date | null;
  /** 開始日時（開始・終了ペア用） */
  startAt?: Date | null;
  /** 終了日時（開始・終了ペア用） */
  endAt?: Date | null;
  description?: string;
  /** プロジェクトタスクの担当ユーザー名（プライベートでは未使用） */
  assignee?: string | null;
  /** 手動並び替え用（小さいほど上） */
  orderIndex?: number;
  /** カンバン表示時の列 ID（進捗 status とは独立） */
  kanbanColumnId?: string | null;
}
