import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import type { TaskScope } from '../task-scope';


export interface CalendarScopeCandidate {
  scope: TaskScope;
  label: string;
}
export interface CalendarScopeDialogData {
  candidates: CalendarScopeCandidate[];
  initialSelected: TaskScope[];
  /** `single` はラジオで1件のみ（タスク追加先の選択など） */
  selectionMode?: 'multi' | 'single';
  /** ダイアログタイトル（省略時はモードに応じた既定文言） */
  title?: string;
}

export type CalendarScopeDialogResult = TaskScope[] | undefined;

@Component({
  selector: 'app-calendar-scope-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatRadioModule,
  ],
  templateUrl: './calendar-scope-dialog.html',
  styleUrl: './calendar-scope-dialog.css',
})
export class CalendarScopeDialog implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<CalendarScopeDialog, CalendarScopeDialogResult>,
  );
  readonly data = inject<CalendarScopeDialogData>(MAT_DIALOG_DATA);
  /** 現在の選択（チェックボックスと双方向） */
  selectedScopes: TaskScope[] = [];
  /** `selectionMode === 'single'` のとき（`mat-radio-group` は文字列値でバインド） */
  singleSelectedKey = '';

  get selectionMode(): 'multi' | 'single' {
    return this.data.selectionMode ?? 'multi';
  }

  get dialogTitle(): string {
    if (this.data.title?.trim()) {
      return this.data.title.trim();
    }
    return this.selectionMode === 'single'
      ? 'タスクを追加するリスト'
      : 'まとめて表示するタスクリストを選択';
  }

  ngOnInit(): void {
    if (this.selectionMode === 'single') {
      const init =
        this.data.initialSelected[0] ?? this.data.candidates[0]?.scope ?? null;
      this.singleSelectedKey = init ? this.keyForScope(init) : '';
      return;
    }
    this.selectedScopes = this.data.initialSelected.map((s) =>
      s.kind === 'private'
        ? { kind: 'private' as const, privateListId: s.privateListId }
        : { kind: 'project' as const, projectId: s.projectId },
    );
  }
  isSelected(scope: TaskScope): boolean {
    return this.selectedScopes.some((x) => this.compareScopes(x, scope));
  }
  toggle(scope: TaskScope, checked: boolean): void {
    if (checked) {
      if (!this.isSelected(scope)) {
        this.selectedScopes = [...this.selectedScopes, scope];
      }
    } else {
      this.selectedScopes = this.selectedScopes.filter(
        (x) => !this.compareScopes(x, scope),
      );
    }
  }
  compareScopes(a: TaskScope, b: TaskScope): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'private') {
      return b.kind === 'private' && a.privateListId === b.privateListId;
    } else {
      return b.kind === 'project' && a.projectId === b.projectId;
    }
  }

  keyForScope(s: TaskScope): string {
    return s.kind === 'private'
      ? `pv:${s.privateListId}`
      : `p:${s.projectId}`;
  }

  private scopeFromKey(key: string): TaskScope | null {
    const found = this.data.candidates.find((c) => this.keyForScope(c.scope) === key);
    return found?.scope ?? null;
  }

  get privateOptions(): CalendarScopeCandidate[] {
    return this.data.candidates.filter((c) => c.scope.kind === 'private');
  }
  get projectOptions(): CalendarScopeCandidate[] {
    return this.data.candidates.filter((c) => c.scope.kind === 'project');
  }
  onConfirm(): void {
    if (this.selectionMode === 'single') {
      const scope = this.scopeFromKey(this.singleSelectedKey);
      if (!scope) {
        return;
      }
      this.dialogRef.close([scope]);
      return;
    }
    this.dialogRef.close(this.selectedScopes);
  }
  onCancel(): void {
    this.dialogRef.close(undefined);
  }
}