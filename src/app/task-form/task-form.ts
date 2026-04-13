import {
  Component,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Task } from '../../models/task';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { DEFAULT_TASK_LABEL_COLOR, TASK_COLOR_CHART } from '../task-colors';
import { DEFAULT_TASK_PRIORITY, TASK_PRIORITY_OPTIONS } from '../task-priority';
import { TaskScope } from '../task-scope';
import { AuthService } from '../auth.service';
import { DEFAULT_TASK_ASSIGNEE } from '../task-assignee';
import type { ProjectMemberRow } from '../../models/project-member';
import { UserAvatar } from '../user-avatar/user-avatar';

@Component({
  selector: 'app-task-form',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    UserAvatar,
  ],
  templateUrl: './task-form.html',
  styleUrl: './task-form.css',
})
export class TaskForm implements OnInit, OnChanges {
  private readonly auth = inject(AuthService);

  ngOnInit() {}

  readonly colorChart = TASK_COLOR_CHART;
  readonly priorityOptions = TASK_PRIORITY_OPTIONS;

  /** 担当が個人メンバー以外（未設定）のとき */
  readonly assigneeNone = '';

  @Input() taskScope: TaskScope = { kind: 'private', privateListId: 'default' };
  @Input() projectMembers: ProjectMemberRow[] = [];

  @Output() addTask = new EventEmitter<Task>();

  newTask: Task = this.emptyTask();

  private emptyTask(): Task {
    return {
      title: '',
      label: DEFAULT_TASK_LABEL_COLOR,
      status: 'todo',
      priority: DEFAULT_TASK_PRIORITY,
      deadline: null,
      description: '',
      assignee: DEFAULT_TASK_ASSIGNEE(this.auth.userId()) ?? '',
    };
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['taskScope']) {
      this.newTask.assignee =
        this.taskScope.kind === 'project'
          ? DEFAULT_TASK_ASSIGNEE(this.auth.userId()) ?? ''
          : null;
    }
  }

  submit(): void {
    const base: Task = {
      title: this.newTask.title,
      label: this.newTask.label?.trim() || DEFAULT_TASK_LABEL_COLOR,
      status: 'todo',
      priority: this.newTask.priority,
      deadline: this.newTask.deadline ? new Date(this.newTask.deadline) : null,
      description: '',
    };
    if (this.taskScope.kind === 'project') {
      const a =
        typeof this.newTask.assignee === 'string' ? this.newTask.assignee.trim() : '';
      base.assignee = a || null;
    }
    this.addTask.emit(base);
    this.newTask = this.emptyTask();
  }
}
