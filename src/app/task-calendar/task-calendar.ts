import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { Task } from '../../models/task';
import { TaskScope, taskDetailScopeParam } from '../task-scope';
import { clampTaskPriority } from '../task-priority';
import { saveTaskShellScrollPosition } from '../task-shell-scroll';

/** 月表示：同一日付に並べるタスクの最大数 */
export const CALENDAR_MONTH_MAX_PER_DAY = 5;
/** 週表示：同一日付に並べるタスクの最大数 */
export const CALENDAR_WEEK_MAX_PER_DAY = 30;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function compareTasksInCell(a: Task, b: Task): number {
  const pa = clampTaskPriority(a.priority);
  const pb = clampTaskPriority(b.priority);
  if (pb !== pa) {
    return pb - pa;
  }
  return (a.title ?? '').localeCompare(b.title ?? '');
}

/** 月グリッド用：含まれる月の viewMonth の週（日曜始まり）×7日 */
function buildMonthWeeks(viewMonth: Date): Date[][] {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const weeks: Date[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

function startOfWeekSunday(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

@Component({
  selector: 'app-task-calendar',
  standalone: true,
  imports: [CommonModule, MatButtonModule],
  templateUrl: './task-calendar.html',
  styleUrl: './task-calendar.css',
})
export class TaskCalendar {
  private readonly router = inject(Router);

  @Input({ required: true }) tasks: Task[] = [];
  @Input({ required: true }) taskScope!: TaskScope;
  @Input() granularity: 'month' | 'week' = 'month';

  readonly maxMonth = CALENDAR_MONTH_MAX_PER_DAY;
  readonly maxWeek = CALENDAR_WEEK_MAX_PER_DAY;

  /** ナビゲーションの基準日（ローカル日付の意味で使用） */
  viewDate = new Date();

  readonly weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

  openTask(task: Task): void {
    const id = task.id;
    if (!id) {
      return;
    }
    const scope = taskDetailScopeParam(this.taskScope);
    saveTaskShellScrollPosition();
    void this.router.navigate(['/task', scope, id], {
      queryParams: {
        from: 'calendar',
        cal: this.granularity,
      },
    });
  }

  goToday(): void {
    this.viewDate = new Date();
  }

  goPrevMonth(): void {
    const x = new Date(this.viewDate);
    x.setDate(1);
    x.setMonth(x.getMonth() - 1);
    this.viewDate = x;
  }

  goNextMonth(): void {
    const x = new Date(this.viewDate);
    x.setDate(1);
    x.setMonth(x.getMonth() + 1);
    this.viewDate = x;
  }

  goPrevWeek(): void {
    const x = new Date(this.viewDate);
    x.setDate(x.getDate() - 7);
    this.viewDate = x;
  }

  goNextWeek(): void {
    const x = new Date(this.viewDate);
    x.setDate(x.getDate() + 7);
    this.viewDate = x;
  }

  get monthTitle(): string {
    const y = this.viewDate.getFullYear();
    const m = this.viewDate.getMonth() + 1;
    return `${y}年 ${m}月`;
  }

  get weekTitleRange(): string {
    const start = startOfWeekSunday(this.viewDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const y1 = start.getFullYear();
    const m1 = start.getMonth() + 1;
    const d1 = start.getDate();
    const m2 = end.getMonth() + 1;
    const d2 = end.getDate();
    if (y1 === end.getFullYear()) {
      return `${y1}年 ${m1}/${d1} – ${m2}/${d2}`;
    }
    return `${y1}年 ${m1}/${d1} – ${end.getFullYear()}年 ${m2}/${d2}`;
  }

  get monthWeeks(): { date: Date; inMonth: boolean; items: Task[]; overflow: number }[][] {
    const vm = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), 1);
    const weeks = buildMonthWeeks(vm);
    const byDay = this.tasksByDayKey();
    const ym = vm.getMonth();
    return weeks.map((row) =>
      row.map((date) => {
        const inMonth = date.getMonth() === ym;
        const key = dayKey(date);
        const all = byDay.get(key) ?? [];
        const sorted = [...all].sort(compareTasksInCell);
        const cap = this.maxMonth;
        const items = sorted.slice(0, cap);
        const overflow = Math.max(0, sorted.length - cap);
        return { date, inMonth, items, overflow };
      }),
    );
  }

  get weekDays(): { date: Date; items: Task[]; overflow: number }[] {
    const start = startOfWeekSunday(this.viewDate);
    const byDay = this.tasksByDayKey();
    const out: { date: Date; items: Task[]; overflow: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = dayKey(date);
      const all = byDay.get(key) ?? [];
      const sorted = [...all].sort(compareTasksInCell);
      const cap = this.maxWeek;
      const items = sorted.slice(0, cap);
      const overflow = Math.max(0, sorted.length - cap);
      out.push({ date, items, overflow });
    }
    return out;
  }

  /** 期日未設定のタスク（カレンダー上の日付に載せない） */
  get unscheduledTasks(): Task[] {
    return this.tasks.filter((t) => !t.deadline).sort(compareTasksInCell);
  }

  private tasksByDayKey(): Map<string, Task[]> {
    const map = new Map<string, Task[]>();
    for (const t of this.tasks) {
      const dl = t.deadline;
      if (!dl) {
        continue;
      }
      const d = dl instanceof Date ? dl : new Date(dl);
      if (Number.isNaN(d.getTime())) {
        continue;
      }
      const key = dayKey(d);
      const arr = map.get(key);
      if (arr) {
        arr.push(t);
      } else {
        map.set(key, [t]);
      }
    }
    return map;
  }

  isToday(d: Date): boolean {
    return sameCalendarDay(d, new Date());
  }

  /** リスト行の `labelStripColor` と同じ（ラベル色の帯・背景トーン用） */
  labelColor(task: Task): string {
    const c = task.label?.trim();
    return c || '#e0e0e0';
  }
}
