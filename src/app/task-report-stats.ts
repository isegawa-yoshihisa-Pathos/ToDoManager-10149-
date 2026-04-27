import type { TaskStatus } from '../models/task-status';

export function pieGradientFromBreakdown(
  breakdown: Record<TaskStatus, number>,
): string | null {
  const total = breakdown.todo + breakdown.in_progress + breakdown.done;
  if (total <= 0) {
    return null;
  }
  const cTodo = '#a9ffad';
  const cProg = '#f5a37d';
  const cDone = '#d1d1d1';
  let start = 0;
  const segs: string[] = [];
  const add = (count: number, color: string) => {
    if (count <= 0) {
      return;
    }
    const frac = count / total;
    const deg = frac * 360;
    const a = start;
    const b = start + deg;
    segs.push(`${color} ${a}deg ${b}deg`);
    start = b;
  };
  add(breakdown.todo, cTodo);
  add(breakdown.in_progress, cProg);
  add(breakdown.done, cDone);
  if (segs.length === 0) {
    return null;
  }
  return `conic-gradient(${segs.join(', ')})`;
}
