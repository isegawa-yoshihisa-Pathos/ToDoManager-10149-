import type { Timestamp } from 'firebase/firestore';

export type TaskMessageAttachmentKind = 'image' | 'file';

export interface TaskMessageAttachment {
  kind: TaskMessageAttachmentKind;
  /** 表示名 */
  name: string;
  /** ダウンロード URL */
  url: string;
}

/** タスク詳細のチャット（Firestore サブコレクション `messages`） */
export interface TaskMessageDoc {
  id?: string;
  authorUserId: string;
  authorDisplayName: string;
  authorAvatarUrl?: string | null;
  text: string;
  createdAt: Timestamp | null;
  attachments?: TaskMessageAttachment[];
}
