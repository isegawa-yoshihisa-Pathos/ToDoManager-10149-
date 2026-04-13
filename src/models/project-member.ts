/** プロジェクトメンバー（担当者・フィルタ・一覧表示で共通） */
export interface ProjectMemberRow {
  userId: string;
  displayName: string;
  /** Firebase Storage 等の画像 URL。未設定ならイニシャル表示 */
  avatarUrl?: string | null;
}
