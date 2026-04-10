import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ProjectMembers } from '../project-members/project-members';
import { AuthService } from '../auth.service';
import { ProjectService } from '../project.service';

@Component({
  selector: 'app-project-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ProjectMembers,
  ],
  templateUrl: './project-settings.html',
  styleUrl: './project-settings.css',
})
export class ProjectSettings implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);

  projectId = '';
  projectName = '';
  projectNameEdit = '';
  loading = true;
  notFound = false;
  renameSaving = false;
  renameError: string | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe((pm) => {
      this.projectId = pm.get('projectId') ?? '';
      void this.load();
    });
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.notFound = false;
    this.renameError = null;
    if (!this.projectId) {
      this.notFound = true;
      this.loading = false;
      return;
    }
    const ref = doc(this.firestore, 'projects', this.projectId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      this.notFound = true;
      this.loading = false;
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    this.projectName = typeof data['name'] === 'string' ? data['name'] : '（無題）';
    this.projectNameEdit = this.projectName;
    this.loading = false;
  }

  back(): void {
    void this.router.navigate(['/user-window']);
  }

  async saveProjectName(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId || !this.projectId) {
      return;
    }
    const name = this.projectNameEdit.trim();
    if (!name) {
      this.renameError = 'プロジェクト名を入力してください';
      return;
    }
    if (name === this.projectName) {
      this.renameError = null;
      return;
    }
    this.renameSaving = true;
    this.renameError = null;
    try {
      await this.projectService.renameProject(this.projectId, name, userId);
      this.projectName = name;
      this.projectNameEdit = name;
    } catch (e) {
      this.renameError = e instanceof Error ? e.message : '名前の更新に失敗しました';
    } finally {
      this.renameSaving = false;
    }
  }

  async onLeaveProject(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId || !this.projectId) {
      return;
    }
    if (
      !confirm(
        `「${this.projectName}」から脱退します。タブ一覧からも消えます。あとから「参加」で再参加できます。よろしいですか？`,
      )
    ) {
      return;
    }
    try {
      await this.projectService.leaveProject(this.projectId, userId);
      void this.router.navigate(['/user-window']);
    } catch (e) {
      alert(e instanceof Error ? e.message : '脱退に失敗しました');
    }
  }

  async onDeleteProject(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId || !this.projectId) {
      return;
    }
    if (
      !confirm(
        `プロジェクト「${this.projectName}」を削除します。全メンバーの参加情報とタスクが失われます。よろしいですか？`,
      )
    ) {
      return;
    }
    try {
      await this.projectService.deleteProject(this.projectId, userId);
      void this.router.navigate(['/user-window']);
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました');
    }
  }
}
