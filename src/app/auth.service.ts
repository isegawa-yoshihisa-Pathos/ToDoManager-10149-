import { inject, Injectable, signal } from '@angular/core';
import {
  Firestore,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { isValidProjectIdChars } from './nav-tab-order';

const SESSION_USER_ID_KEY = 'angular-todo-user-id';
/** 旧キー（移行用） */
const LEGACY_SESSION_USERNAME_KEY = 'angular-todo-username';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firestore = inject(Firestore);

  /** Firestore `accounts/{userId}` のドキュメントID。半角英数字のみ。変更不可。 */
  readonly userId = signal<string | null>(null);

  /** 表示用のユーザー名（プロジェクトメンバー表記など）。変更可。 */
  readonly displayName = signal<string | null>(null);

  /** プロフィール画像 URL（未設定なら null） */
  readonly avatarUrl = signal<string | null>(null);

  constructor() {
    const stored =
      sessionStorage.getItem(SESSION_USER_ID_KEY) ??
      sessionStorage.getItem(LEGACY_SESSION_USERNAME_KEY);
    if (stored) {
      if (!sessionStorage.getItem(SESSION_USER_ID_KEY)) {
        sessionStorage.setItem(SESSION_USER_ID_KEY, stored);
        sessionStorage.removeItem(LEGACY_SESSION_USERNAME_KEY);
      }
      this.userId.set(stored);
      void this.hydrateProfile(stored);
    }
  }

  private async hydrateProfile(uid: string): Promise<void> {
    const snap = await getDoc(doc(this.firestore, 'accounts', uid));
    if (!snap.exists()) {
      return;
    }
    const d = snap.data() as {
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    };
    const dn =
      typeof d['displayName'] === 'string' && d['displayName'].trim() !== ''
        ? d['displayName'].trim()
        : typeof d['username'] === 'string' && d['username'].trim() !== ''
          ? d['username'].trim()
          : uid;
    this.displayName.set(dn);
    const av =
      typeof d['avatarUrl'] === 'string' && d['avatarUrl'].trim() !== ''
        ? d['avatarUrl'].trim()
        : null;
    this.avatarUrl.set(av);
  }

  private assertValidUserId(id: string): string {
    const u = id.trim();
    if (!u) {
      throw new Error('ユーザーIDを入力してください');
    }
    if (!isValidProjectIdChars(u)) {
      throw new Error('ユーザーIDは半角英数字のみ使用できます');
    }
    if (u.length < 2 || u.length > 64) {
      throw new Error('ユーザーIDは2〜64文字の半角英数字にしてください');
    }
    return u;
  }

  async signUp(userIdRaw: string, displayNameRaw: string, password: string): Promise<void> {
    const userId = this.assertValidUserId(userIdRaw);
    const displayName = displayNameRaw.trim();
    if (!displayName) {
      throw new Error('ユーザー名を入力してください');
    }
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    const ref = doc(this.firestore, 'accounts', userId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      throw new Error('このユーザーIDは既に使われています');
    }
    await setDoc(ref, { displayName, password });
  }

  async signIn(userIdRaw: string, password: string): Promise<boolean> {
    const userId = this.assertValidUserId(userIdRaw);
    if (!password) {
      return false;
    }
    const ref = doc(this.firestore, 'accounts', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return false;
    }
    const data = snap.data() as {
      password?: string;
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    };
    if (data['password'] !== password) {
      return false;
    }
    const dn =
      typeof data['displayName'] === 'string' && data['displayName'].trim() !== ''
        ? data['displayName'].trim()
        : typeof data['username'] === 'string' && data['username'].trim() !== ''
          ? data['username'].trim()
          : userId;
    this.userId.set(userId);
    this.displayName.set(dn);
    const av =
      typeof data['avatarUrl'] === 'string' && data['avatarUrl'].trim() !== ''
        ? data['avatarUrl'].trim()
        : null;
    this.avatarUrl.set(av);
    sessionStorage.setItem(SESSION_USER_ID_KEY, userId);
    sessionStorage.removeItem(LEGACY_SESSION_USERNAME_KEY);
    return true;
  }

  /** 表示名を更新し、参加中プロジェクトのメンバー文書の displayName も同期する */
  async updateDisplayName(newDisplayName: string): Promise<void> {
    const uid = this.userId();
    if (!uid) {
      throw new Error('ログインしていません');
    }
    const name = newDisplayName.trim();
    if (!name) {
      throw new Error('ユーザー名を入力してください');
    }
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
    const uid = this.userId();
    if (!uid) {
      throw new Error('ログインしていません');
    }
    const ref = doc(this.firestore, 'accounts', uid);
    if (downloadUrl === null || downloadUrl.trim() === '') {
      await updateDoc(ref, { avatarUrl: deleteField() });
      this.avatarUrl.set(null);
    } else {
      const u = downloadUrl.trim();
      await updateDoc(ref, { avatarUrl: u });
      this.avatarUrl.set(u);
    }

    const membershipsCol = collection(this.firestore, 'accounts', uid, 'projectMemberships');
    const membershipsSnap = await getDocs(membershipsCol);
    if (membershipsSnap.empty) {
      return;
    }
    const batch = writeBatch(this.firestore);
    for (const d of membershipsSnap.docs) {
      const projectId = d.id;
      const memRef = doc(this.firestore, 'projects', projectId, 'members', uid);
      if (downloadUrl === null || downloadUrl.trim() === '') {
        batch.update(memRef, { avatarUrl: deleteField() });
      } else {
        batch.update(memRef, { avatarUrl: downloadUrl.trim() });
      }
    }
    await batch.commit();
  }

  signOut(): void {
    this.userId.set(null);
    this.displayName.set(null);
    this.avatarUrl.set(null);
    sessionStorage.removeItem(SESSION_USER_ID_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_USERNAME_KEY);
  }
}
