import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../auth.service';
import { SignOutLifecycleService } from '../sign-out-lifecycle.service';
import { AvatarSettingsDialog } from '../avatar-settings-dialog/avatar-settings-dialog';
import { UserAvatar } from '../user-avatar/user-avatar';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatDialogModule,
    UserAvatar,
  ],
  templateUrl: './app-header.html',
  styleUrl: './app-header.css',
})
export class AppHeader {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly signOutLifecycle = inject(SignOutLifecycleService);
  readonly auth = inject(AuthService);

  readonly homeLink = computed(() => (this.auth.userId() ? '/user-window' : '/login'));

  /** Firestore ハイドレート前など、表示名がまだ無いときは UID を出さない */
  readonly accountMenuLabel = computed(() => {
    const uid = this.auth.userId();
    const name = this.auth.displayName()?.trim();
    if (!uid) {
      return '';
    }
    return name || '読み込み中…';
  });

  /** イニシャル用。名前未確定時は UID 由来の文字にならないようプレースホルダにする */
  readonly accountAvatarDisplayName = computed(() => {
    const uid = this.auth.userId();
    const name = this.auth.displayName()?.trim();
    if (!uid) {
      return '';
    }
    return name || '?';
  });

  async changeDisplayName(): Promise<void> {
    const cur = this.auth.displayName()?.trim() || '';
    const n = window.prompt('新しいユーザー名', cur);
    if (n === null) {
      return;
    }
    try {
      await this.auth.updateDisplayName(n);
    } catch (e) {
      alert(e instanceof Error ? e.message : '更新に失敗しました');
    }
  }

  openAvatarSettings(): void {
    this.dialog.open(AvatarSettingsDialog, {
      width: 'min(96vw, 400px)',
      autoFocus: 'first-tabbable',
    });
  }

  signOut(): void {
    this.signOutLifecycle.notifyBeforeSignOut();
    void this.auth.signOut().then(() => this.router.navigate(['/login']));
  }

  async deleteAccount(): Promise<void> {
    if (
      !confirm(
        'アカウントを削除すると、このアカウントではログインできなくなります。データの復元はできません。本当に削除しますか？',
      )
    ) {
      return;
    }
    if (!confirm('削除を確定します。よろしいですか？')) {
      return;
    }
    const password = window.prompt(
      'セキュリティのため、現在のログインパスワードを入力してください。',
    );
    if (password === null) {
      return;
    }
    if (password.trim() === '') {
      alert('パスワードを入力してください');
      return;
    }
    this.signOutLifecycle.notifyBeforeSignOut();
    try {
      await this.auth.deleteAccount(password);
      await this.router.navigate(['/login']);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'アカウントの削除に失敗しました');
    }
  }
}
