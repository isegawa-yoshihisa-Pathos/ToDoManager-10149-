import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { AuthService } from '../auth.service';
import { ProjectService } from '../project.service';

export interface ProjectOpenedPayload {
  projectId: string;
  projectName: string;
}

@Component({
  selector: 'app-project-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, NzInputModule],
  templateUrl: './project-hub.html',
  styleUrl: './project-hub.css',
})
export class ProjectHub {
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);

  @Output() projectOpened = new EventEmitter<ProjectOpenedPayload>();

  createProjectName = '';
  createPassword = '';
  joinProjectName = '';
  joinPassword = '';

  async onCreateProject(): Promise<void> {
    const username = this.auth.username();
    if (!username) {
      return;
    }
    try {
      const row = await this.projectService.createProject(
        this.createProjectName,
        this.createPassword,
        username,
      );
      this.createProjectName = '';
      this.createPassword = '';
      this.projectOpened.emit({ projectId: row.projectId, projectName: row.projectName });
    } catch (e) {
      alert(e instanceof Error ? e.message : '作成に失敗しました');
    }
  }

  async onJoinProject(): Promise<void> {
    const username = this.auth.username();
    if (!username) {
      return;
    }
    try {
      const row = await this.projectService.joinProject(
        this.joinProjectName,
        this.joinPassword,
        username,
      );
      this.joinProjectName = '';
      this.joinPassword = '';
      this.projectOpened.emit({ projectId: row.projectId, projectName: row.projectName });
    } catch (e) {
      alert(e instanceof Error ? e.message : '参加に失敗しました');
    }
  }
}
