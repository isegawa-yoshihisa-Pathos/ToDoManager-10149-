import { Component, Injector, Input, OnInit, inject, runInInjectionContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Task } from '../../models/task';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { doc, Firestore, updateDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-task-list-item',
  imports: [CommonModule, FormsModule, NzCheckboxModule, NzTagModule],
  templateUrl: './task-list-item.html',
  styleUrl: './task-list-item.css',
})
export class TaskListItem implements OnInit {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(Injector);

  ngOnInit() {}

  @Input() task: Task = { title: '', done: false, deadline: new Date() };

  onDoneChange(done: boolean): void {
    this.task.done = done;
    const id = this.task.id;
    if (!id) {
      return;
    }
    const ref = doc(this.firestore, 'tasks', id);
    runInInjectionContext(this.injector, () => {
      updateDoc(ref, { done }).catch((err) => console.error('updateDoc failed:', err));
    });
  }

  isOverdue(task: Task) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return (
      !task.done &&
      !!task.deadline &&
      task.deadline.getTime() < start.getTime()
    );
  }
}