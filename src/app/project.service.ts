import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
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

export interface ProjectMembershipRow {
  projectId: string;
  projectName: string;
  joinedAt: Timestamp | null;
}

/** プロジェクトへの「参加」操作の結果 */
export type JoinProjectResult =
  | { status: 'tabOpened'; row: ProjectMembershipRow }
  | { status: 'pendingApproval'; projectId: string; projectName: string };

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 認証済みメールアドレス（ドキュメント ID = メール小文字）。作成・フォーム・参加申請の承認で追加。 */
export const PROJECT_AUTHENTICATED_EMAILS = 'authenticatedEmails';

/** 未認証での参加試行（ドキュメント ID = ユーザー UID）。承認で認証フォルダへ移しメンバー化、拒否で削除。 */
export const PROJECT_PENDING_JOIN_REQUESTS = 'pendingJoinRequests';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private assertProjectId(projectId: string): string {
    const id = projectId.trim();
    if (!id) {
      throw new Error('プロジェクトIDを入力してください');
    }
    if (!/^[A-Za-z0-9]+$/.test(id)) {
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
    const creatorEmailRaw = this.auth.currentUser?.email;
    const creatorEmail = creatorEmailRaw ? normalizeAccountEmail(creatorEmailRaw) : '';
    if (!creatorEmail) {
      throw new Error('ログイン中のメールアドレスが取得できません。プロジェクトを作成できません。');
    }
    if (this.auth.currentUser?.uid !== userId) {
      throw new Error('認証情報が一致しません。');
    }

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

  /**
   * パスワードで参加。管理者のメール承認または参加申請が必要。
   * メンバーになった時点でタブ用の projectMemberships も付与する。
   */
  async joinProject(
    projectIdRaw: string,
    password: string,
    userId: string,
  ): Promise<JoinProjectResult> {
    const projectId = this.assertProjectId(projectIdRaw);
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    const emailRaw = this.auth.currentUser?.email;
    const email = emailRaw ? normalizeAccountEmail(emailRaw) : '';
    if (!email) {
      throw new Error('ログイン中のメールアドレスが取得できません。');
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
    const projectName = typeof data['name'] === 'string' ? data['name'] : projectId;

    const memberRef = doc(this.firestore, 'projects', projectId, 'members', userId);
    const memberSnap = await getDoc(memberRef);
    const tabRef = doc(this.firestore, 'accounts', userId, 'projectMemberships', projectId);
    const tabSnap = await getDoc(tabRef);

    if (memberSnap.exists()) {
      if (!tabSnap.exists()) {
        await this.saveMembership(userId, projectId, projectName);
      }
      return {
        status: 'tabOpened',
        row: { projectId, projectName, joinedAt: null },
      };
    }

    const authenticatedRef = doc(
      this.firestore,
      'projects',
      projectId,
      PROJECT_AUTHENTICATED_EMAILS,
      email,
    );
    const authenticatedSnap = await getDoc(authenticatedRef);
    if (authenticatedSnap.exists()) {
      await this.addMember(projectId, userId);
      await this.saveMembership(userId, projectId, projectName);
      return {
        status: 'tabOpened',
        row: { projectId, projectName, joinedAt: null },
      };
    }

    await setDoc(
      doc(this.firestore, 'projects', projectId, PROJECT_PENDING_JOIN_REQUESTS, userId),
      {
        emailLower: email,
        requestedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return { status: 'pendingApproval', projectId, projectName };
  }

  /** 設定画面: メールを認証済みフォルダに追加（パスワード参加を許可） */
  async grantAuthenticatedEmail(
    projectId: string,
    emailRaw: string,
    adminUserId: string,
  ): Promise<void> {
    await this.assertIsProjectMember(projectId, adminUserId);
    const email = normalizeAccountEmail(emailRaw);
    if (!email || !email.includes('@')) {
      throw new Error('有効なメールアドレスを入力してください');
    }
    await setDoc(
      doc(this.firestore, 'projects', projectId, PROJECT_AUTHENTICATED_EMAILS, email),
      {
        invitedAt: serverTimestamp(),
        invitedBy: adminUserId,
      },
    );
  }

  /** 未認証の参加申請を承認 → 認証フォルダへ反映しメンバー化（タブ用 membership も付与） */
  async approveJoinRequest(
    projectId: string,
    requestUserId: string,
    adminUserId: string,
  ): Promise<void> {
    await this.assertIsProjectMember(projectId, adminUserId);
    const reqRef = doc(
      this.firestore,
      'projects',
      projectId,
      PROJECT_PENDING_JOIN_REQUESTS,
      requestUserId,
    );
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) {
      throw new Error('申請が見つかりません');
    }
    const projectRef = doc(this.firestore, 'projects', projectId);
    const projectSnap = await getDoc(projectRef);
    const pn = projectSnap.data() as { name?: string };
    const projectName =
      projectSnap.exists() && typeof pn['name'] === 'string' ? pn['name'] : projectId;
    const reqData = reqSnap.data() as { emailLower?: string };
    const reqEmail =
      typeof reqData['emailLower'] === 'string' && reqData['emailLower'].trim() !== ''
        ? normalizeAccountEmail(reqData['emailLower'])
        : '';
    await this.addMember(projectId, requestUserId);
    if (reqEmail) {
      await this.ensureAuthenticatedEmailRecord(projectId, reqEmail, adminUserId);
    }
    await this.saveMembership(requestUserId, projectId, projectName);
    await deleteDoc(reqRef);
  }

  /** 未認証の参加申請を拒否（pending から削除のみ） */
  async rejectJoinRequest(
    projectId: string,
    requestUserId: string,
    adminUserId: string,
  ): Promise<void> {
    await this.assertIsProjectMember(projectId, adminUserId);
    const reqRef = doc(
      this.firestore,
      'projects',
      projectId,
      PROJECT_PENDING_JOIN_REQUESTS,
      requestUserId,
    );
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) {
      throw new Error('申請が見つかりません');
    }
    await deleteDoc(reqRef);
  }

  private async assertIsProjectMember(projectId: string, uid: string): Promise<void> {
    const ref = doc(this.firestore, 'projects', projectId, 'members', uid);
    const s = await getDoc(ref);
    if (!s.exists()) {
      throw new Error('この操作を行う権限がありません');
    }
  }

  /** `authenticatedEmails` にメールを登録（認証済み扱い） */
  private async ensureAuthenticatedEmailRecord(
    projectId: string,
    emailLower: string,
    invitedByUid: string,
  ): Promise<void> {
    const email = normalizeAccountEmail(emailLower);
    if (!email) {
      return;
    }
    await setDoc(
      doc(this.firestore, 'projects', projectId, PROJECT_AUTHENTICATED_EMAILS, email),
      { invitedAt: serverTimestamp(), invitedBy: invitedByUid },
      { merge: true },
    );
  }

  private async addMember(projectId: string, userId: string): Promise<void> {
    const accSnap = await getDoc(doc(this.firestore, 'accounts', userId));
    let displayName = userId;
    let avatarUrl: string | null = null;
    let emailFromAccount: string | null = null;
    if (accSnap.exists()) {
      const d = accSnap.data() as {
        displayName?: string;
        username?: string;
        avatarUrl?: string;
        emailLower?: string;
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
      if (typeof d['emailLower'] === 'string' && d['emailLower'].trim() !== '') {
        emailFromAccount = normalizeAccountEmail(d['emailLower']);
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

    let emailForApproved = emailFromAccount;
    if (!emailForApproved && this.auth.currentUser?.uid === userId) {
      const e = this.auth.currentUser.email;
      emailForApproved = e ? normalizeAccountEmail(e) : null;
    }
    if (emailForApproved) {
      await this.ensureAuthenticatedEmailRecord(projectId, emailForApproved, userId);
    }
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

    let emailForApproval: string | null = null;
    const curUid = this.auth.currentUser?.uid;
    if (curUid === username) {
      const e = this.auth.currentUser?.email;
      emailForApproval = e ? normalizeAccountEmail(e) : null;
    } else {
      const accSnap = await getDoc(doc(this.firestore, 'accounts', username));
      if (accSnap.exists()) {
        const d = accSnap.data() as { emailLower?: string };
        if (typeof d['emailLower'] === 'string' && d['emailLower'].trim() !== '') {
          emailForApproval = normalizeAccountEmail(d['emailLower']);
        }
      }
    }

    const authEmailRef =
      emailForApproval !== null && emailForApproval !== ''
        ? doc(
            this.firestore,
            'projects',
            projectId,
            PROJECT_AUTHENTICATED_EMAILS,
            emailForApproval,
          )
        : null;

    const ops: Promise<unknown>[] = [deleteDoc(memberRef), deleteDoc(membershipRef)];
    if (authEmailRef) {
      ops.push(deleteDoc(authEmailRef));
    }
    await Promise.all(ops);
  }

  /** メンバーなら誰でも削除可能。サブコレクションと全員の membership を消す。 */
  async deleteProject(projectId: string, requesterUsername: string): Promise<void> {
    await this.assertIsProjectMember(projectId, requesterUsername);
    await deleteDoc(doc(this.firestore, 'projects', projectId));
  }
}
