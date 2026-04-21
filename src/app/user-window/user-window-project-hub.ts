import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectHub, ProjectOpenedPayload } from '../project-hub/project-hub';
import { PrivateListService } from '../private-list.service';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-user-window-project-hub',
  standalone: true,
  imports: [ProjectHub],
  template: `<app-project-hub
    (projectOpened)="onProjectOpened($event)"
    (addPrivateList)="onAddPrivateList()"
  />`,
})
export class UserWindowProjectHub {
  private readonly router = inject(Router);
  private readonly privateListService = inject(PrivateListService);
  private readonly auth = inject(AuthService);

  onProjectOpened(payload: ProjectOpenedPayload): void {
    void this.router.navigate(['/user-window/project', payload.projectId]);
  }

  async onAddPrivateList(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    try {
      const id = await this.privateListService.createPrivateList(userId);
      void this.router.navigate(['/user-window/private', id]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'リストの追加に失敗しました');
    }
  }
}
