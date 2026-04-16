import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-signup',
  imports: [CommonModule, FormsModule],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class SignUp {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private removePeekEndListeners: (() => void) | null = null;

  email = '';
  displayName = '';
  password = '';
  passwordVisible = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearPeekEndListeners();
      this.passwordVisible = false;
    });
  }

  onPasswordPeekStart(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.clearPeekEndListeners();
    this.passwordVisible = true;
    const finish = () => {
      this.passwordVisible = false;
      this.clearPeekEndListeners();
    };
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    this.removePeekEndListeners = () => {
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
    };
  }

  private clearPeekEndListeners(): void {
    this.removePeekEndListeners?.();
    this.removePeekEndListeners = null;
  }

  async signUp() {
    try {
      await this.auth.signUp(this.email, this.displayName, this.password);
      await this.router.navigate(['/user-window']);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'アカウント作成に失敗しました');
    }
  }

  backToLogin() {
    void this.router.navigate(['/login']);
  }
}
