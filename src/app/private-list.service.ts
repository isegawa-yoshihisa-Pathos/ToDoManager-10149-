import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteField,
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class PrivateListService {
  private readonly firestore = inject(Firestore);

  privateUiDoc(username: string) {
    return doc(this.firestore, 'accounts', username, 'config', 'privateUi');
  }

  async createPrivateList(username: string): Promise<string> {
    const col = collection(this.firestore, 'accounts', username, 'privateTaskLists');
    const existing = await getDocs(col);
    const ref = await addDoc(col, {
      title: `プライベート ${existing.size + 2}`,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async renameExtraList(username: string, listId: string, title: string): Promise<void> {
    const name = title.trim() || '（無題）';
    await updateDoc(doc(this.firestore, 'accounts', username, 'privateTaskLists', listId), {
      title: name,
    });
  }

  async renameDefaultListLabel(username: string, title: string): Promise<void> {
    const name = title.trim() || 'プライベート';
    await setDoc(this.privateUiDoc(username), { defaultListLabel: name }, { merge: true });
  }

  // 追加リストと `tasks` サブコレクションを削除
  async deleteExtraList(username: string, listId: string): Promise<void> {
    const listRef = doc(this.firestore, 'accounts', username, 'privateTaskLists', listId);
    const kanbanRef = doc(this.firestore, 'accounts', username, 'config', `kanban_pl_${listId}`);
    const colorRef = doc(this.firestore, 'accounts', username, 'config', 'tabAppearance');
    await updateDoc(colorRef, {[`colors.pl:${listId}`]: deleteField()});
    await deleteDoc(listRef);
    await deleteDoc(kanbanRef);
  }
}
