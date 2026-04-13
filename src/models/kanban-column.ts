/** カンバン列（進捗 status とは独立） */
export interface KanbanColumn {
  id: string;
  title: string;
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'kb-default-1', title: '未着手' },
  { id: 'kb-default-2', title: '処理中' },
  { id: 'kb-default-3', title: '完了' },
];
