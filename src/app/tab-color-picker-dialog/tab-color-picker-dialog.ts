import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TASK_COLOR_CHART } from '../task-colors';

export interface TabColorPickerDialogData {
  /** 現在の #RRGGBB または空 */
  current: string;
}

@Component({
  selector: 'app-tab-color-picker-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  templateUrl: './tab-color-picker-dialog.html',
  styleUrl: './tab-color-picker-dialog.css',
})
export class TabColorPickerDialog {
  readonly chart = TASK_COLOR_CHART;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: TabColorPickerDialogData,
    private readonly ref: MatDialogRef<TabColorPickerDialog, string>,
  ) {}

  pick(hex: string): void {
    this.ref.close(hex);
  }

  isClearSelected(): boolean {
    const c = this.data.current?.trim() ?? '#ffffff';
    return c === '#ffffff';
  }

  isChartColorSelected(chartHex: string): boolean {
    return (this.data.current?.trim() ?? '#ffffff') === chartHex;
  }
}
