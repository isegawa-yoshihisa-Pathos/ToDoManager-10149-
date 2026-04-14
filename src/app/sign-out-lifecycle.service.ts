import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * グローバルヘッダーからサインアウトする直前に、UserWindow などがセッションを保存できるようにする。
 */
@Injectable({ providedIn: 'root' })
export class SignOutLifecycleService {
  private readonly beforeSignOutSubject = new Subject<void>();
  readonly beforeSignOut$ = this.beforeSignOutSubject.asObservable();

  notifyBeforeSignOut(): void {
    this.beforeSignOutSubject.next();
  }
}
