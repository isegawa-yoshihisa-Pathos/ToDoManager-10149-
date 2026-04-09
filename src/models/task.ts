export interface Task {
  id?: string;
  title: string;
  done: boolean;
  deadline?: Date | null;
}