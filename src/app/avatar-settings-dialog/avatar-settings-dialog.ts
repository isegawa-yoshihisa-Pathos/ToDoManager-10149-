import { Component, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { AuthService } from '../auth.service';
import { UserAvatar } from '../user-avatar/user-avatar';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-avatar-settings-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, UserAvatar],
  templateUrl: './avatar-settings-dialog.html',
  styleUrl: './avatar-settings-dialog.css',
})
export class AvatarSettingsDialog implements OnDestroy {
  private readonly dialogRef = inject(MatDialogRef<AvatarSettingsDialog, void>);
  private readonly storage = inject(Storage);
  readonly auth = inject(AuthService);

  uploading = false;
  error: string | null = null;

  previewUrl: string | null = null;
  pendingFile: File | null = null;

  onPickFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.error = '画像ファイルを選んでください';
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      this.error = '2MB 以下の画像にしてください';
      return;
    }
    this.error = null;
    this.pendingFile = file;
    this.revokePreview();
    this.previewUrl = URL.createObjectURL(file);
  }

  private revokePreview(): void {
    if (this.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.previewUrl);
    }
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }

  displayAvatarUrl(): string | null {
    return this.previewUrl ?? this.auth.avatarUrl();
  }

  async save(): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) {
      return;
    }
    this.error = null;
    if (!this.pendingFile) {
      this.dialogRef.close();
      return;
    }
    this.uploading = true;
    try {
      const safe = this.pendingFile.name.replace(/[^\w.\-]+/g, '_');
      const path = `avatars/${uid}/${Date.now()}_${safe}`;
      const r = ref(this.storage, path);
      await uploadBytes(r, this.pendingFile, { contentType: this.pendingFile.type });
      const url = await getDownloadURL(r);
      await this.auth.updateAvatarUrl(url);
      this.dialogRef.close();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '保存に失敗しました';
    } finally {
      this.uploading = false;
    }
  }

  clearAvatar(): void {
    this.error = null;
    if (this.pendingFile) {
      this.revokePreview();
      this.previewUrl = null;
      this.pendingFile = null;
      return;
    }
    void this.removeServerAvatar();
  }

  private async removeServerAvatar(): Promise<void> {
    if (!this.auth.avatarUrl()) {
      return;
    }
    this.uploading = true;
    try {
      await this.auth.updateAvatarUrl(null);
      this.dialogRef.close();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '削除に失敗しました';
    } finally {
      this.uploading = false;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
