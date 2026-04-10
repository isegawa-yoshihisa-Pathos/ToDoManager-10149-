export type TaskScope =
  | { kind: 'private'; privateListId: 'default' | string }
  | { kind: 'project'; projectId: string };

/** タスク詳細 URL の :scope セグメント（既定プライベートは従来どおり `private`） */
export function taskDetailScopeParam(scope: TaskScope): string {
  if (scope.kind === 'project') {
    return scope.projectId;
  }
  return scope.privateListId === 'default' ? 'private' : `pl-${scope.privateListId}`;
}
