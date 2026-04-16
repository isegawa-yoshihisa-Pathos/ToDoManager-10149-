import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  getDoc,
  getDocs,
} from '@angular/fire/firestore';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ProjectMembers } from '../project-members/project-members';
import { AuthService } from '../auth.service';
import { ProjectService, PROJECT_PENDING_JOIN_REQUESTS } from '../project.service';
import type { TaskMessageAttachment } from '../../models/task-message';

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
export class ProjectSettings implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);

  private joinReqSub?: Subscription;

  projectId = '';
  projectName = '';
  projectNameEdit = '';
  loading = true;
  notFound = false;
  renameSaving = false;
  renameError: string | null = null;

  approveEmailInput = '';
  approveSaving = false;
  approveError: string | null = null;

  pendingJoinRequests: { userId: string; email: string }[] = [];
  /** 認証／拒否のどちらか処理中の申請ユーザー ID */
  joinRequestBusyUserId: string | null = null;

  /** メンバー | ファイル */
  settingsTab: 'members' | 'files' = 'members';
  filesLoading = false;
  filesError: string | null = null;
  projectChatFileRows: {
    fileName: string;
    url: string;
    taskTitle: string;
    taskId: string;
  }[] = [];

  ngOnInit(): void {
    this.route.paramMap.subscribe((pm) => {
      this.unsubscribeJoinRequests();
      this.pendingJoinRequests = [];
      this.projectId = pm.get('projectId') ?? '';
      void this.load();
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeJoinRequests();
  }

  private unsubscribeJoinRequests(): void {
    this.joinReqSub?.unsubscribe();
    this.joinReqSub = undefined;
  }

  private subscribeJoinRequests(): void {
    if (!this.projectId || this.notFound) {
      return;
    }
    const col = collection(this.firestore, 'projects', this.projectId, PROJECT_PENDING_JOIN_REQUESTS);
    this.joinReqSub = collectionData(col, { idField: 'userId' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => ({
            userId: String(data['userId'] ?? ''),
            email:
              typeof data['emailLower'] === 'string' && data['emailLower'] !== ''
                ? data['emailLower']
                : '',
          })),
        ),
      )
      .subscribe((rows) => {
        this.pendingJoinRequests = rows;
      });
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.notFound = false;
    this.renameError = null;
    this.unsubscribeJoinRequests();
    this.pendingJoinRequests = [];
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
    this.subscribeJoinRequests();
    this.settingsTab = 'members';
    this.projectChatFileRows = [];
    this.filesError = null;
    this.filesLoading = false;
  }

  setSettingsTab(tab: 'members' | 'files'): void {
    this.settingsTab = tab;
    if (tab === 'files') {
      void this.loadProjectChatFiles();
    }
  }

  private async loadProjectChatFiles(): Promise<void> {
    if (!this.projectId || this.notFound) {
      return;
    }
    this.filesLoading = true;
    this.filesError = null;
    try {
      const tasksSnap = await getDocs(
        collection(this.firestore, 'projects', this.projectId, 'tasks'),
      );
      const rows: {
        fileName: string;
        url: string;
        taskTitle: string;
        taskId: string;
      }[] = [];
      await Promise.all(
        tasksSnap.docs.map(async (taskDoc) => {
          const taskId = taskDoc.id;
          const tdata = taskDoc.data() as Record<string, unknown>;
          const taskTitle =
            typeof tdata['title'] === 'string' && tdata['title'].trim() !== ''
              ? tdata['title'].trim()
              : '（無題）';
          const msgSnap = await getDocs(
            collection(this.firestore, 'projects', this.projectId, 'tasks', taskId, 'messages'),
          );
          msgSnap.forEach((md) => {
            const d = md.data() as Record<string, unknown>;
            const attRaw = d['attachments'];
            if (!Array.isArray(attRaw)) {
              return;
            }
            for (const a of attRaw) {
              if (!a || typeof a !== 'object') {
                continue;
              }
              const att = a as TaskMessageAttachment;
              const url = typeof att.url === 'string' ? att.url.trim() : '';
              const name = typeof att.name === 'string' ? att.name.trim() : '';
              if (!url || !name) {
                continue;
              }
              rows.push({ fileName: name, url, taskTitle, taskId });
            }
          });
        }),
      );
      rows.sort((a, b) => {
        const c = a.taskTitle.localeCompare(b.taskTitle, 'ja');
        return c !== 0 ? c : a.fileName.localeCompare(b.fileName, 'ja');
      });
      this.projectChatFileRows = rows;
    } catch (e) {
      this.filesError = e instanceof Error ? e.message : '一覧の取得に失敗しました';
      this.projectChatFileRows = [];
    } finally {
      this.filesLoading = false;
    }
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

  async onGrantApprovedEmail(): Promise<void> {
    const adminId = this.auth.userId();
    if (!adminId || !this.projectId) {
      return;
    }
    this.approveError = null;
    this.approveSaving = true;
    try {
      await this.projectService.grantAuthenticatedEmail(this.projectId, this.approveEmailInput, adminId);
      this.approveEmailInput = '';
    } catch (e) {
      this.approveError = e instanceof Error ? e.message : '認証に失敗しました';
    } finally {
      this.approveSaving = false;
    }
  }

  async onApproveJoinRequest(requestUserId: string): Promise<void> {
    const adminId = this.auth.userId();
    if (!adminId || !this.projectId) {
      return;
    }
    this.joinRequestBusyUserId = requestUserId;
    try {
      await this.projectService.approveJoinRequest(this.projectId, requestUserId, adminId);
    } catch (e) {
      alert(e instanceof Error ? e.message : '承認に失敗しました');
    } finally {
      this.joinRequestBusyUserId = null;
    }
  }

  async onRejectJoinRequest(requestUserId: string): Promise<void> {
    const adminId = this.auth.userId();
    if (!adminId || !this.projectId) {
      return;
    }
    this.joinRequestBusyUserId = requestUserId;
    try {
      await this.projectService.rejectJoinRequest(this.projectId, requestUserId, adminId);
    } catch (e) {
      alert(e instanceof Error ? e.message : '拒否に失敗しました');
    } finally {
      this.joinRequestBusyUserId = null;
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
