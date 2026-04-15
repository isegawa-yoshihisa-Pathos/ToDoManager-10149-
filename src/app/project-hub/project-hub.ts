import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth.service';
import { ProjectService } from '../project.service';

export interface ProjectOpenedPayload {
  projectId: string;
  projectName: string;
}

@Component({
  selector: 'app-project-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './project-hub.html',
  styleUrl: './project-hub.css',
})
export class ProjectHub {
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);

  @Output() projectOpened = new EventEmitter<ProjectOpenedPayload>();
  /** プライベートリストを追加（親でタブを切り替え） */
  @Output() addPrivateList = new EventEmitter<void>();

  createProjectId = '';
  createProjectDisplayName = '';
  createPassword = '';
  joinProjectId = '';
  joinPassword = '';

  async onCreateProject(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    try {
      const row = await this.projectService.createProject(
        this.createProjectId,
        this.createProjectDisplayName,
        this.createPassword,
        userId,
      );
      this.createProjectId = '';
      this.createProjectDisplayName = '';
      this.createPassword = '';
      this.projectOpened.emit({ projectId: row.projectId, projectName: row.projectName });
    } catch (e) {
      alert(e instanceof Error ? e.message : '作成に失敗しました');
    }
  }

  onAddPrivateListClick(): void {
    this.addPrivateList.emit();
  }

  async onJoinProject(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    try {
      const result = await this.projectService.joinProject(
        this.joinProjectId,
        this.joinPassword,
        userId,
      );
      this.joinProjectId = '';
      this.joinPassword = '';
      if (result.status === 'tabOpened') {
        this.projectOpened.emit({
          projectId: result.row.projectId,
          projectName: result.row.projectName,
        });
      } else {
        alert(
          '参加申請を送信しました。管理者がメールを認証するとメンバーとして参加できます。',
        );
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '参加に失敗しました');
    }
  }
}
