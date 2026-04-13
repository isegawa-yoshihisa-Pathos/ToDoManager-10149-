import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { isValidProjectIdChars } from './nav-tab-order';

export interface ProjectMembershipRow {
  projectId: string;
  projectName: string;
  joinedAt: Timestamp | null;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly firestore = inject(Firestore);

  private assertProjectId(projectId: string): string {
    const id = projectId.trim();
    if (!id) {
      throw new Error('プロジェクトIDを入力してください');
    }
    if (!isValidProjectIdChars(id)) {
      throw new Error('プロジェクトIDは半角英数字のみ使用できます');
    }
    if (id.length < 2 || id.length > 64) {
      throw new Error('プロジェクトIDは2〜64文字の半角英数字にしてください');
    }
    return id;
  }

  async createProject(
    projectIdRaw: string,
    projectDisplayName: string,
    password: string,
    userId: string,
  ): Promise<ProjectMembershipRow> {
    const projectId = this.assertProjectId(projectIdRaw);
    const name = projectDisplayName.trim();
    if (!name) {
      throw new Error('プロジェクト名を入力してください');
    }
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    const projectRef = doc(this.firestore, 'projects', projectId);
    const existing = await getDoc(projectRef);
    if (existing.exists()) {
      throw new Error('このプロジェクトIDは既に使われています。別のIDを指定するか、参加から入ってください。');
    }
    await setDoc(projectRef, {
      name,
      password,
      createdBy: userId,
      createdAt: serverTimestamp(),
    });
    await this.addMember(projectId, userId);
    await this.saveMembership(userId, projectId, name);
    return { projectId, projectName: name, joinedAt: null };
  }

  async joinProject(
    projectIdRaw: string,
    password: string,
    userId: string,
  ): Promise<ProjectMembershipRow> {
    const projectId = this.assertProjectId(projectIdRaw);
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    const projectRef = doc(this.firestore, 'projects', projectId);
    const snap = await getDoc(projectRef);
    if (!snap.exists()) {
      throw new Error('プロジェクトが見つかりません。プロジェクトIDとパスワードを確認してください。');
    }
    const data = snap.data() as { password?: string; name?: string };
    if (data['password'] !== password) {
      throw new Error('パスワードが正しくありません');
    }
    const displayName = typeof data['name'] === 'string' ? data['name'] : projectId;
    await this.addMember(projectId, userId);
    await this.saveMembership(userId, projectId, displayName);
    return { projectId, projectName: displayName, joinedAt: null };
  }

  private async addMember(projectId: string, userId: string): Promise<void> {
    const accSnap = await getDoc(doc(this.firestore, 'accounts', userId));
    let displayName = userId;
    let avatarUrl: string | null = null;
    if (accSnap.exists()) {
      const d = accSnap.data() as {
        displayName?: string;
        username?: string;
        avatarUrl?: string;
      };
      displayName =
        typeof d['displayName'] === 'string' && d['displayName'].trim() !== ''
          ? d['displayName'].trim()
          : typeof d['username'] === 'string' && d['username'].trim() !== ''
            ? d['username'].trim()
            : userId;
      if (typeof d['avatarUrl'] === 'string' && d['avatarUrl'].trim() !== '') {
        avatarUrl = d['avatarUrl'].trim();
      }
    }
    const memberRef = doc(this.firestore, 'projects', projectId, 'members', userId);
    const payload: Record<string, unknown> = {
      userId,
      displayName,
      username: userId,
      joinedAt: serverTimestamp(),
    };
    if (avatarUrl) {
      payload['avatarUrl'] = avatarUrl;
    }
    await setDoc(memberRef, payload);
  }

  private async saveMembership(
    userId: string,
    projectId: string,
    projectName: string,
  ): Promise<void> {
    const mRef = doc(this.firestore, 'accounts', userId, 'projectMemberships', projectId);
    await setDoc(mRef, {
      projectName,
      joinedAt: serverTimestamp(),
    });
  }

  /**
   * 表示名を変更する。`projects/{id}.name` と全メンバーの `projectMemberships` の `projectName` を更新する。
   */
  async renameProject(
    projectId: string,
    newName: string,
    requesterUsername: string,
  ): Promise<void> {
    const name = newName.trim();
    if (!name) {
      throw new Error('プロジェクト名を入力してください');
    }
    const memberRef = doc(this.firestore, 'projects', projectId, 'members', requesterUsername);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      throw new Error('このプロジェクトのメンバーではありません');
    }
    const projectRef = doc(this.firestore, 'projects', projectId);
    await updateDoc(projectRef, { name });

    const membersCol = collection(this.firestore, 'projects', projectId, 'members');
    const membersSnap = await getDocs(membersCol);
    const batch = writeBatch(this.firestore);
    for (const d of membersSnap.docs) {
      const uname = d.id;
      const mRef = doc(this.firestore, 'accounts', uname, 'projectMemberships', projectId);
      batch.update(mRef, { projectName: name });
    }
    await batch.commit();
  }

  /** 自分だけメンバーと参加一覧から外す。プロジェクト本体・他メンバー・タスクは残る。 */
  async leaveProject(projectId: string, username: string): Promise<void> {
    const memberRef = doc(this.firestore, 'projects', projectId, 'members', username);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      throw new Error('このプロジェクトのメンバーではありません');
    }
    const membershipRef = doc(this.firestore, 'accounts', username, 'projectMemberships', projectId);
    await Promise.all([deleteDoc(memberRef), deleteDoc(membershipRef)]);
  }

  /** メンバーなら誰でも削除可能。サブコレクションと全員の membership を消す。 */
  async deleteProject(projectId: string, requesterUsername: string): Promise<void> {
    const memberRef = doc(this.firestore, 'projects', projectId, 'members', requesterUsername);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      throw new Error('このプロジェクトのメンバーではありません');
    }

    const tasksCol = collection(this.firestore, 'projects', projectId, 'tasks');
    const membersCol = collection(this.firestore, 'projects', projectId, 'members');
    const [tasksSnap, membersSnap] = await Promise.all([
      getDocs(tasksCol),
      getDocs(membersCol),
    ]);

    const ops: Promise<unknown>[] = [];
    for (const d of tasksSnap.docs) {
      ops.push(deleteDoc(d.ref));
    }
    for (const d of membersSnap.docs) {
      const uname = d.id;
      ops.push(deleteDoc(d.ref));
      ops.push(
        deleteDoc(doc(this.firestore, 'accounts', uname, 'projectMemberships', projectId)),
      );
    }
    ops.push(deleteDoc(doc(this.firestore, 'projects', projectId)));
    await Promise.all(ops);
  }
}
