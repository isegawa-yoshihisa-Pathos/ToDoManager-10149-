import { Component, DestroyRef, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Firestore,
  doc,
  getDoc,
  updateDoc,
  deleteField,
  Timestamp,
  collection,
  collectionData,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth.service';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { DEFAULT_TASK_LABEL_COLOR, TASK_COLOR_CHART } from '../task-colors';
import {
  clampTaskPriority,
  DEFAULT_TASK_PRIORITY,
  TASK_PRIORITY_OPTIONS,
} from '../task-priority';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatIconModule,
  ],
  templateUrl: './task-detail.html',
  styleUrl: './task-detail.css',
})
export class TaskDetail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly colorChart = TASK_COLOR_CHART;
  readonly priorityOptions = TASK_PRIORITY_OPTIONS;
  readonly assigneeNone = '';

  loading = true;
  notFound = false;
  saveError: string | null = null;

  scopeParam = '';
  taskId = '';

  editTitle = '';
  editLabel: string = DEFAULT_TASK_LABEL_COLOR;
  editPriority = DEFAULT_TASK_PRIORITY;
  editDeadline: Date | null = null;
  editDescription = '';
  editAssignee = '';

  projectMembers: { username: string }[] = [];
  private membersSub?: Subscription;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.scopeParam = params.get('scope') ?? '';
      this.taskId = params.get('taskId') ?? '';
      this.subscribeProjectMembers();
      void this.load();
    });
  }

  private subscribeProjectMembers(): void {
    this.membersSub?.unsubscribe();
    this.membersSub = undefined;
    this.projectMembers = [];
    if (this.scopeParam === 'private' || this.scopeParam.startsWith('pl-') || !this.scopeParam) {
      return;
    }
    const ref = collection(this.firestore, 'projects', this.scopeParam, 'members');
    this.membersSub = collectionData(ref, { idField: 'id' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => ({
            username:
              typeof data['username'] === 'string'
                ? data['username']
                : String(data['id'] ?? ''),
          })),
        ),
      )
      .subscribe((members) => {
        this.projectMembers = members.filter((m) => m.username);
      });
  }

  private taskDocRef() {
    const username = this.auth.username();
    if (!username || !this.taskId) {
      return null;
    }
    if (this.scopeParam === 'private') {
      return doc(this.firestore, 'accounts', username, 'tasks', this.taskId);
    }
    if (this.scopeParam.startsWith('pl-')) {
      const listId = this.scopeParam.slice(3);
      return doc(
        this.firestore,
        'accounts',
        username,
        'privateTaskLists',
        listId,
        'tasks',
        this.taskId,
      );
    }
    return doc(this.firestore, 'projects', this.scopeParam, 'tasks', this.taskId);
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.notFound = false;
    this.saveError = null;
    const ref = this.taskDocRef();
    if (!ref) {
      this.notFound = true;
      this.loading = false;
      return;
    }
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      this.notFound = true;
      this.loading = false;
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    this.editTitle = typeof data['title'] === 'string' ? data['title'] : '';
    const lab = data['label'];
    this.editLabel =
      typeof lab === 'string' && lab.trim() !== '' ? lab : DEFAULT_TASK_LABEL_COLOR;
    const raw = data['deadline'];
    this.editDeadline =
      raw instanceof Timestamp
        ? raw.toDate()
        : raw instanceof Date
          ? raw
          : raw
            ? new Date(raw as string | number)
            : null;
    this.editDescription =
      typeof data['description'] === 'string' ? data['description'] : '';
    this.editPriority = clampTaskPriority(data['priority']);
    const rawAs = data['assignee'];
    this.editAssignee =
      typeof rawAs === 'string' && rawAs.trim() !== '' ? rawAs.trim() : '';
    this.loading = false;
  }

  async save(): Promise<void> {
    this.saveError = null;
    const ref = this.taskDocRef();
    if (!ref) {
      return;
    }
    const payload: Record<string, unknown> = {
      title: this.editTitle.trim() || '（無題）',
      label: this.editLabel.trim() || DEFAULT_TASK_LABEL_COLOR,
      priority: clampTaskPriority(this.editPriority),
      description: this.editDescription,
    };
    if (this.editDeadline) {
      payload['deadline'] = Timestamp.fromDate(new Date(this.editDeadline));
    } else {
      payload['deadline'] = deleteField();
    }
    if (this.scopeParam !== 'private' && !this.scopeParam.startsWith('pl-')) {
      const a =
        typeof this.editAssignee === 'string' ? this.editAssignee.trim() : '';
      if (a) {
        payload['assignee'] = a;
      } else {
        payload['assignee'] = deleteField();
      }
    }
    try {
      await updateDoc(ref, payload);
      void this.router.navigate(['/user-window']);
    } catch (e) {
      this.saveError = e instanceof Error ? e.message : '保存に失敗しました';
    }
  }

  back(): void {
    void this.router.navigate(['/user-window']);
  }

  pageTitle(): string {
    return this.editTitle.trim() || 'タスク詳細';
  }

  /** プロジェクトタスク（担当者あり）かどうか */
  isProjectTaskScope(): boolean {
    return this.scopeParam !== 'private' && !this.scopeParam.startsWith('pl-');
  }

  ngOnDestroy(): void {
    this.membersSub?.unsubscribe();
  }
}
