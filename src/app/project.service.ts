import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, updateDoc, serverTimestamp, Timestamp, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseError } from 'firebase/app';

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

/** Cloud Functions `joinProject` / `approveInvitation` の戻り値 */
interface ProjectGateCallableResult {
  status: boolean;
  projectName: string;
}

function parseProjectGateResult(data: unknown): ProjectGateCallableResult {
  if (!data || typeof data !== 'object') {
    throw new Error('サーバーから無効な応答がありました');
  }
  const o = data as Record<string, unknown>;
  const projectName = typeof o['projectName'] === 'string' ? o['projectName'] : '';
  const status = o['status'] === true;
  return { status, projectName };
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);

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

    const createProjectFn = httpsCallable(this.functions, 'createProject');
    try {
      await createProjectFn({ projectId, projectName: name, password, userId, email: creatorEmail });
    } catch (error: unknown) {
      console.error('createProject callable failed', error);
      if (error instanceof FirebaseError && error.message) {
        throw new Error(error.message);
      }
      if (error instanceof Error && error.message) {
        throw error;
      }
      throw new Error('プロジェクト作成に失敗しました');
    }
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

    const joinProjectFn = httpsCallable(this.functions, 'joinProject');
    const result = await joinProjectFn({ projectId, password, userId, email });
    return result.data as JoinProjectResult;
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
    
    const approveInvitationFn = httpsCallable(this.functions, 'approveInvitation');
    const result = await approveInvitationFn({ projectId, userId, email });
    const gate = parseProjectGateResult(result.data);
    if (gate.status) {
      return { projectId, projectName: gate.projectName };
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
    await setDoc(
      doc(this.firestore, 'projects', projectId, 'invitedEmails', email),
      {
        invitedAt: serverTimestamp(),
        invitedBy: adminUserId,
      },
    );
  }

  /**
   * 未認証の参加申請を承認 → メンバー化（Functions）後に authenticatedEmails を更新し、申請 doc を削除。
   * 途中で失敗した場合は再試行・手動整理が必要になるため、エラー時は UI で再読込を促す。
   */
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
    const addMemberFn = httpsCallable(this.functions, 'addMember');
    await addMemberFn({ projectId, userId: requestUserId, projectName });
    if (reqEmail) {
      await this.ensureAuthenticatedEmailRecord(projectId, reqEmail, adminUserId);
    }
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
    const uid = this.auth.currentUser?.uid;
    const selfEmailNorm = this.auth.currentUser?.email
      ? normalizeAccountEmail(this.auth.currentUser.email)
      : '';
    const argEmailNorm = normalizeAccountEmail(email);
    if (uid && selfEmailNorm !== '' && selfEmailNorm === argEmailNorm) {
      await deleteDoc(doc(this.firestore, 'accounts', uid, 'invitedProjects', projectId));
      return;
    }
    const emailLower = argEmailNorm;
    if (!emailLower || !emailLower.includes('@')) {
      throw new Error('有効なメールアドレスを入力してください');
    }
    await deleteDoc(doc(this.firestore, 'projects', projectId, 'invitedEmails', emailLower));
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

  /**
   * 表示名を変更する。`projects/{id}.name` と全メンバーの `projectMemberships` の `projectName` を更新する。
   */
  async renameProject(
    projectId: string,
    newName: string,
    requesterUserId: string,
  ): Promise<void> {
    const name = newName.trim();
    if (!name) {
      throw new Error('プロジェクト名を入力してください');
    }
    const memberRef = doc(this.firestore, 'projects', projectId, 'members', requesterUserId);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      throw new Error('このプロジェクトのメンバーではありません');
    }
    const projectRef = doc(this.firestore, 'projects', projectId);
    await updateDoc(projectRef, { name });
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
    await deleteDoc(memberRef);
  }

  /** メンバーなら誰でも削除可能。サブコレクションと全員の membership を消す。 */
  async deleteProject(projectId: string, requesterUserId: string): Promise<void> {
    await this.assertIsProjectMember(projectId, requesterUserId);
    await deleteDoc(doc(this.firestore, 'projects', projectId));
  }
}
