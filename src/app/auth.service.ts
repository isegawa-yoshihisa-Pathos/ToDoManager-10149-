import { inject, Injectable, signal } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import {
  Firestore,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { ProjectService } from './project.service';
import { Storage, deleteObject, ref } from '@angular/fire/storage';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly projectService = inject(ProjectService);

  /** Firebase Auth の UID。Firestore の `accounts/{uid}` 等のパスに使用 */
  readonly userId = signal<string | null>(null);

  /** 表示用のユーザー名（プロジェクトメンバー表記など）。変更可。 */
  readonly displayName = signal<string | null>(null);

  /** プロフィール画像 URL（未設定なら null） */
  readonly avatarUrl = signal<string | null>(null);

  /** ログイン中ユーザーのメール（小文字・正規化）。未ログインは null */
  readonly authEmail = signal<string | null>(null);

  /**
   * 新規登録中は authState が updateProfile / setDoc より先に届き、
   * 表示名が uid に落ちるのを防ぐため、この間は hydrate をスキップする。
   */
  private signUpHydrationLock = false;

  constructor() {
    authState(this.auth).subscribe((user) => {
      if (!user) {
        this.userId.set(null);
        this.displayName.set(null);
        this.avatarUrl.set(null);
        this.authEmail.set(null);
        return;
      }
      this.userId.set(user.uid);
      const em = user.email?.trim().toLowerCase() ?? null;
      this.authEmail.set(em && em !== '' ? em : null);
      if (this.signUpHydrationLock) {
        return;
      }
      void this.hydrateProfile(user.uid, user.displayName?.trim() ?? null);
    });
  }

  private async hydrateProfile(uid: string, authDisplayName: string | null): Promise<void> {
    const snap = await getDoc(doc(this.firestore, 'accounts', uid));
    if (!snap.exists()) {
      const live =
        this.auth.currentUser?.uid === uid
          ? this.auth.currentUser.displayName?.trim() ?? ''
          : '';
      const dn =
        (authDisplayName && authDisplayName !== '' ? authDisplayName : '') ||
        (live !== '' ? live : '') ||
        uid;
      this.displayName.set(dn);
      this.avatarUrl.set(null);
      return;
    }
    const d = snap.data() as {
      displayName?: string;
      avatarUrl?: string;
      emailLower?: string;
    };
    const authEm =
      this.auth.currentUser?.uid === uid ? this.auth.currentUser?.email?.trim().toLowerCase() : '';
    if (authEm && authEm !== '') {
      const cur =
        typeof d['emailLower'] === 'string' ? d['emailLower'].trim().toLowerCase() : '';
      if (cur !== authEm) {
        await updateDoc(doc(this.firestore, 'accounts', uid), { emailLower: authEm });
      }
    }
    const dn =
      typeof d['displayName'] === 'string' && d['displayName'].trim() !== ''
        ? d['displayName'].trim()
        : authDisplayName && authDisplayName !== ''
          ? authDisplayName
          : uid;
    this.displayName.set(dn);
    const av =
      typeof d['avatarUrl'] === 'string' && d['avatarUrl'].trim() !== ''
        ? d['avatarUrl'].trim()
        : null;
    this.avatarUrl.set(av);
  }

  async signUp(emailRaw: string, displayNameRaw: string, password: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const displayName = displayNameRaw.trim();
    if (!email) {
      throw new Error('メールアドレスを入力してください');
    }
    if (!displayName) {
      throw new Error('ユーザー名を入力してください');
    }
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    this.signUpHydrationLock = true;
    /** createUser 直後の authState で userId だけ先に立つ間、ラベルに UID が出ないよう先に入れる */
    this.displayName.set(displayName);
    this.avatarUrl.set(null);
    let cred;
    try {
      try {
        cred = await createUserWithEmailAndPassword(this.auth, email, password);
      } catch (e) {
        this.displayName.set(null);
        throw mapFirebaseAuthError(e);
      }
      await updateProfile(cred.user, { displayName });
      await setDoc(doc(this.firestore, 'accounts', cred.user.uid), {
        displayName,
        emailLower: email,
        avatarUrl: null,
      });
    } finally {
      this.signUpHydrationLock = false;
      const u = this.auth.currentUser;
      if (u) {
        void this.hydrateProfile(u.uid, u.displayName?.trim() ?? null);
      }
    }
  }

  async signIn(emailRaw: string, password: string): Promise<boolean> {
    const email = emailRaw.trim().toLowerCase();
    if (!email || !password) {
      return false;
    }
    try {
      await signInWithEmailAndPassword(this.auth, email, password);
      return true;
    } catch {
      return false;
    }
  }

  /** 表示名を更新し、参加中プロジェクトのメンバー文書の displayName も同期する */
  async updateDisplayName(newDisplayName: string): Promise<void> {
    const user = this.auth.currentUser;
    const uid = user?.uid;
    if (!uid) {
      throw new Error('ログインしていません');
    }
    const name = newDisplayName.trim();
    if (!name) {
      throw new Error('ユーザー名を入力してください');
    }
    await updateProfile(user, { displayName: name });
    await updateDoc(doc(this.firestore, 'accounts', uid), { displayName: name });
    this.displayName.set(name);

    const membershipsCol = collection(this.firestore, 'accounts', uid, 'projectMemberships');
    const membershipsSnap = await getDocs(membershipsCol);
    if (membershipsSnap.empty) {
      return;
    }
    const batch = writeBatch(this.firestore);
    for (const d of membershipsSnap.docs) {
      const projectId = d.id;
      const memRef = doc(this.firestore, 'projects', projectId, 'members', uid);
      batch.update(memRef, { displayName: name });
    }
    await batch.commit();
  }

  /** アイコン URL を更新し、参加中プロジェクトのメンバー文書にも同期する */
  async updateAvatarUrl(downloadUrl: string | null): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('ログインしていません');
    }
    const previousUrl =
      typeof this.avatarUrl() === 'string' && this.avatarUrl()!.trim() !== ''
        ? this.avatarUrl()!.trim()
        : null;
    const accRef = doc(this.firestore, 'accounts', uid);
    if (downloadUrl === null || downloadUrl.trim() === '') {
      await updateDoc(accRef, { avatarUrl: null });
      this.avatarUrl.set(null);
      await this.deleteFirebaseStorageFileByUrl(previousUrl);
    } else {
      const u = downloadUrl.trim();
      await updateDoc(accRef, { avatarUrl: u });
      this.avatarUrl.set(u);
      if (previousUrl && previousUrl !== u) {
        await this.deleteFirebaseStorageFileByUrl(previousUrl);
      }
    }
  }

  /** このアプリが Firebase Storage に置いたアバター URL のオブジェクトを削除（失敗しても握りつぶす） */
  private async deleteFirebaseStorageFileByUrl(url: string | null | undefined): Promise<void> {
    if (!url || !url.includes('firebasestorage.googleapis.com')) {
      return;
    }
    try {
      await deleteObject(ref(this.storage, url));
    } catch (e) {
      console.warn('deleteFirebaseStorageFileByUrl:', e);
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }

  async deleteAccount(currentPassword: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user || !user.email) {
      throw new Error('ログインしていません');
    }
    const pwd = currentPassword.trim();
    if (!pwd) {
      throw new Error('パスワードを入力してください');
    }

    const credential = EmailAuthProvider.credential(user.email, pwd);
    try {
      await reauthenticateWithCredential(user, credential);
    } catch (e) {
      throw mapFirebaseAuthError(e);
    }

    const uid = user.uid;

    const membershipsCol = collection(this.firestore, 'accounts', uid, 'projectMemberships');
    const membershipsSnap = await getDocs(membershipsCol);
    for (const d of membershipsSnap.docs) {
      await this.projectService.leaveProject(d.id, uid, uid);
    }

    const accRef = doc(this.firestore, 'accounts', uid);
    const accSnap = await getDoc(accRef);
    if (accSnap.exists()) {
      const av = accSnap.data()?.['avatarUrl'];
      const url = typeof av === 'string' && av.trim() !== '' ? av.trim() : null;
      await this.deleteFirebaseStorageFileByUrl(url);
      await deleteDoc(accRef);
    }

    try {
      await deleteUser(user);
    } catch (e) {
      throw mapFirebaseAuthError(e);
    }
  }
}

function mapFirebaseAuthError(e: unknown): Error {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'auth/email-already-in-use':
        return new Error('このメールアドレスは既に登録されています');
      case 'auth/invalid-email':
        return new Error('メールアドレスの形式が正しくありません');
      case 'auth/weak-password':
        return new Error('パスワードが弱すぎます（6文字以上にしてください）');
      case 'auth/requires-recent-login':
        return new Error(
          'セキュリティのため、一度サインアウトしてから再度ログインし、もう一度お試しください',
        );
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return new Error('パスワードが正しくありません');
      default:
        break;
    }
  }
  return e instanceof Error ? e : new Error('認証に失敗しました');
}
