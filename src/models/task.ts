export interface Task {
  id?: string;
  title: string;
  label: string;
  done: boolean;
  priority: number;
  deadline?: Date | null;
  description?: string;
  /** プロジェクトタスクの担当ユーザー名（プライベートでは未使用） */
  assignee?: string | null;
  /** 手動並び替え用（小さいほど上） */
  orderIndex?: number;
}