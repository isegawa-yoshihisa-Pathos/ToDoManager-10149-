import { Component, EventEmitter, Output, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../auth.service';
import { ProjectService } from '../project.service';
import { Firestore, collection, getDocs, Timestamp } from '@angular/fire/firestore';

export interface ProjectOpenedPayload {
  projectId: string;
  projectName: string;
}

@Component({
  selector: 'app-project-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatTooltipModule],
  templateUrl: './project-hub.html',
  styleUrl: './project-hub.css',
})
export class ProjectHub implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);
  private readonly firestore = inject(Firestore);
  @Output() projectOpened = new EventEmitter<ProjectOpenedPayload>();
  /** プライベートリストを追加（親でタブを切り替え） */
  @Output() addPrivateList = new EventEmitter<void>();

  createProjectId = '';
  createProjectDisplayName = '';
  createPassword = '';
  joinProjectId = '';
  joinPassword = '';

  invitedProjects: { projectId: string, invitedAt: Timestamp }[] = [];

  ngOnInit(): void {
    this.getInvitedProjects();
  }

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

  generateProjectId(): void {
    this.createProjectId = Math.random().toString(36).substring(2, 15);
  }

  onAddPrivateListClick(): void {
    this.addPrivateList.emit();
  }

  async getInvitedProjects(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const invitedProjects = collection(this.firestore, 'accounts', userId, 'invitedProjects');
    const invitedProjectsSnap = await getDocs(invitedProjects);
    this.invitedProjects = invitedProjectsSnap.docs.map((doc) => {
      return { projectId: doc.id, invitedAt: doc.data()['invitedAt'] as Timestamp };
    });
  }

  async onCancelInvitation(projectId: string): Promise<void> {
    const email = this.auth.authEmail();
    if (!email) {
      return;
    }
    await this.projectService.cancelInvitation(projectId, email);
    this.getInvitedProjects();
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

  async onApproveInvitation(projectId: string): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) {
      return;
    }
    const result = await this.projectService.approveInvitation(projectId, userId);
    this.projectOpened.emit({
      projectId: result.projectId,
      projectName: result.projectName,
    });
    this.getInvitedProjects();
  }
}
