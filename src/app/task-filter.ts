import { Task } from '../models/task';
import type { TaskStatus } from '../models/task-status';
import { TASK_COLOR_CHART } from './task-colors';
import { clampTaskPriority } from './task-priority';

/** 期日は1つだけ選ぶ（複合は色・優先度・担当と AND） */
export type DueDateFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'within_7'
  | 'within_30'
  | 'beyond_30'
  | 'no_deadline';

export interface TaskFilterState {
  /** 空なら色で絞り込まない */
  colors: string[];
  /** 空なら優先度で絞り込まない */
  priorities: number[];
  /** 空なら進捗で絞り込まない */
  statuses: TaskStatus[];
  dueDate: DueDateFilter;
  /** プロジェクトのみ。'all' | 'unassigned' | username */
  assignee: 'all' | 'unassigned' | string;
}

export function defaultTaskFilterState(): TaskFilterState {
  return {
    colors: [],
    priorities: [],
    statuses: [],
    dueDate: 'all',
    assignee: 'all',
  };
}

/** ドラッグ並び替え可能にするにはフィルタを初期状態に近づける必要がある */
export function isFilterDefaultForReorder(
  state: TaskFilterState,
  isProjectScope: boolean,
): boolean {
  return (
    state.colors.length === 0 &&
    state.priorities.length === 0 &&
    state.statuses.length === 0 &&
    state.dueDate === 'all' &&
    (!isProjectScope || state.assignee === 'all')
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 期日の「日」の差（今日を 0、昨日は -1） */
function calendarDaysFromToday(deadline: Date, now: Date): number {
  const a = startOfDay(now).getTime();
  const b = startOfDay(deadline).getTime();
  return Math.round((b - a) / 86400000);
}

function isValidChartColor(hex: string | undefined): boolean {
  const c = hex?.trim() ?? '';
  return c !== '' && (TASK_COLOR_CHART as readonly string[]).includes(c);
}

function matchesDueDateFilter(task: Task, filter: DueDateFilter, now: Date): boolean {
  if (filter === 'all') {
    return true;
  }
  const dl = task.deadline;
  if (filter === 'no_deadline') {
    return dl === undefined || dl === null;
  }
  if (!dl) {
    return false;
  }
  const days = calendarDaysFromToday(dl, now);
  switch (filter) {
    case 'overdue':
      return days < 0 && task.status !== 'done';
    case 'today':
      return days === 0;
    case 'within_7':
      return days >= 0 && days <= 7;
    case 'within_30':
      return days >= 0 && days <= 30;
    case 'beyond_30':
      return days > 30;
    default:
      return true;
  }
}

function matchesAssignee(
  task: Task,
  filter: TaskFilterState['assignee'],
  isProject: boolean,
): boolean {
  if (!isProject || filter === 'all') {
    return true;
  }
  const a = typeof task.assignee === 'string' ? task.assignee.trim() : '';
  if (filter === 'unassigned') {
    return a === '';
  }
  return a === filter;
}

/**
 * 色・優先度・進捗・期日・担当（プロジェクト時）で AND 絞り込み。
 */
export function filterTasks(
  tasks: Task[],
  state: TaskFilterState,
  now: Date,
  isProjectScope: boolean,
): Task[] {
  const colorSet =
    state.colors.length > 0 ? new Set(state.colors.map((c) => c.trim())) : null;
  const priSet =
    state.priorities.length > 0
      ? new Set(state.priorities.map((p) => clampTaskPriority(p)))
      : null;
  const statusSet =
    state.statuses.length > 0 ? new Set<TaskStatus>(state.statuses) : null;

  return tasks.filter((t) => {
    if (colorSet) {
      const lab = t.label?.trim() ?? '';
      if (!lab || !colorSet.has(lab)) {
        return false;
      }
    }
    if (priSet && !priSet.has(clampTaskPriority(t.priority))) {
      return false;
    }
    if (statusSet && !statusSet.has(t.status)) {
      return false;
    }
    if (!matchesDueDateFilter(t, state.dueDate, now)) {
      return false;
    }
    if (!matchesAssignee(t, state.assignee, isProjectScope)) {
      return false;
    }
    return true;
  });
}

/** フィルタ UI 用：チャート外の色がついたタスクも一覧に出るようにマージ */
export function colorFilterOptions(tasks: Task[]): string[] {
  const fromChart = [...TASK_COLOR_CHART];
  const extra = new Set<string>();
  for (const t of tasks) {
    const c = t.label?.trim();
    if (c && !isValidChartColor(c)) {
      extra.add(c);
    }
  }
  return [...fromChart, ...[...extra].sort((a, b) => a.localeCompare(b))];
}
