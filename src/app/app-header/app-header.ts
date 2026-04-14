import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
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

  async changeDisplayName(): Promise<void> {
    const cur = this.auth.displayName() ?? this.auth.userId() ?? '';
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
    this.auth.signOut();
    void this.router.navigate(['/login']);
  }
}
