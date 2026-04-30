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

    const authenticatedRef = doc(this.firestore, 'projects', projectId, 'authenticatedEmails', email);
    const invitedRef = doc(this.firestore, 'projects', projectId, 'invitedEmails', email);
    const invitedProjectRef = doc(this.firestore, 'accounts', userId, 'invitedProjects', projectId);
    const authenticatedSnap = await getDoc(authenticatedRef);
    const invitedSnap = await getDoc(invitedRef);
    const invitedProjectSnap = await getDoc(invitedProjectRef);
    if (authenticatedSnap.exists() || invitedSnap.exists() || invitedProjectSnap.exists()) {
      if (!authenticatedSnap.exists()) {
        const data = invitedSnap.data() as { invitedBy: string };
        const invitedBy = data.invitedBy;
        await this.ensureAuthenticatedEmailRecord(projectId, email, invitedBy);
        await deleteDoc(invitedProjectRef);
        await deleteDoc(invitedRef);
      }
      await this.addMember(projectId, userId);
      await this.saveMembership(userId, projectId, projectName);
      return {
        status: 'tabOpened',
        row: { projectId, projectName, joinedAt: null },
      };
    }

    await setDoc(
      doc(this.firestore, 'projects', projectId, 'pendingJoinRequests', userId),
      {
        emailLower: email,
        requestedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return { status: 'pendingApproval', projectId, projectName };
  }

  async approveInvitation(
    projectIdRaw: string,
    userId: string,
  ): Promise<{ projectId: string; projectName: string }> {
    const projectId = this.assertProjectId(projectIdRaw);
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
    const projectName = typeof data['name'] === 'string' ? data['name'] : projectId;

    const authenticatedRef = doc(this.firestore, 'projects', projectId, 'authenticatedEmails', email);
    const invitedRef = doc(this.firestore, 'projects', projectId, 'invitedEmails', email);
    const invitedProjectRef = doc(this.firestore, 'accounts', userId, 'invitedProjects', projectId);
    const authenticatedSnap = await getDoc(authenticatedRef);
    const invitedSnap = await getDoc(invitedRef);
    const invitedProjectSnap = await getDoc(invitedProjectRef);
    if (authenticatedSnap.exists() || invitedSnap.exists() || invitedProjectSnap.exists()) {
      if (!authenticatedSnap.exists()) {
        const data = invitedSnap.data() as { invitedBy: string };
        const invitedBy = data.invitedBy;
        await this.ensureAuthenticatedEmailRecord(projectId, email, invitedBy);
        await deleteDoc(invitedProjectRef);
        await deleteDoc(invitedRef);
      }
      await this.addMember(projectId, userId);
      await this.saveMembership(userId, projectId, projectName);
      return {projectId, projectName};
    }
    throw new Error('招待が見つかりません');
  }


  /** 設定画面: メールを招待済みフォルダに追加 */
  async grantInvitedEmail(
    projectId: string,
    emailRaw: string,
    adminUserId: string,
  ): Promise<void> {
    await this.assertIsProjectMember(projectId, adminUserId);
    const email = normalizeAccountEmail(emailRaw);
    if (!email || !email.includes('@')) {
      throw new Error('有効なメールアドレスを入力してください');
    }
    const accountCol = collection(this.firestore, 'accounts');
    const accountSnap = await getDocs(accountCol);
    for (const account of accountSnap.docs) {
      const accountData = account.data() as { emailLower?: string };
      if (accountData['emailLower'] === email) {
        await setDoc(doc(this.firestore, 'accounts', account.id, 'invitedProjects', projectId), {
          invitedAt: serverTimestamp(),
          invitedBy: adminUserId,
        });
        break;
      }
    }
    await setDoc(
      doc(this.firestore, 'projects', projectId, 'invitedEmails', email),
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
      'pendingJoinRequests',
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
      'pendingJoinRequests',
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

  async cancelInvitation(projectId: string, email: string): Promise<void> {
    const invitedRef = doc(this.firestore, 'projects', projectId, 'invitedEmails', email);
    const invitedSnap = await getDoc(invitedRef);
    if (!invitedSnap.exists()) {
      throw new Error('招待が見つかりません');
    }
    await deleteDoc(invitedRef);
    const accountCol = collection(this.firestore, 'accounts');
    const accountSnap = await getDocs(accountCol);
    for (const account of accountSnap.docs) {
      const accountData = account.data() as { emailLower?: string };
      if (accountData['emailLower'] === email){
        await deleteDoc(doc(this.firestore, 'accounts', account.id, 'invitedProjects', projectId));
        break;
      }
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
      doc(this.firestore, 'projects', projectId, 'authenticatedEmails', email),
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
        avatarUrl?: string;
        emailLower?: string;
      };
      displayName =
        typeof d['displayName'] === 'string' && d['displayName'].trim() !== ''
          ? d['displayName'].trim()
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

  /** プロジェクトから脱退させる。再参加は再認証が必要。最後の人は抜けられない。 */
  async leaveProject(projectId: string, userId: string, adminUserId: string): Promise<void> {
    await this.assertIsProjectMember(projectId, adminUserId);
    const memberRef = doc(this.firestore, 'projects', projectId, 'members', userId);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      throw new Error('このプロジェクトのメンバーではありません');
    }
    const membersCol = collection(this.firestore, 'projects', projectId, 'members');
    const membersSnap = await getDocs(membersCol);
    if (membersSnap.docs.length === 1) {
      throw new Error('最後のメンバーは抜けられません\nプロジェクトを削除してください');
    }
    const membershipRef = doc(this.firestore, 'accounts', userId, 'projectMemberships', projectId);

    let emailForApproval: string | null = null;
    const curUid = this.auth.currentUser?.uid;
    if (curUid === userId) {
      const e = this.auth.currentUser?.email;
      emailForApproval = e ? normalizeAccountEmail(e) : null;
    } else {
      const accSnap = await getDoc(doc(this.firestore, 'accounts', userId));
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
            'authenticatedEmails',
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
