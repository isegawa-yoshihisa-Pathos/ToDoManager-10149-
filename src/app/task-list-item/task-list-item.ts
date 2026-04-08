import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Task } from '../../models/task';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzTagModule } from 'ng-zorro-antd/tag';

@Component({
  selector: 'app-task-list-item',
  imports: [ CommonModule, FormsModule, NzCheckboxModule, NzTagModule],
  templateUrl: './task-list-item.html',
  styleUrl: './task-list-item.css',
})

export class TaskListItem implements OnInit {
  constructor() {}

  ngOnInit() {}

  @Input() task: Task = {title: '', done: false, deadline: new Date()};

  isOverdue(task: Task) {
    return !task.done && task.deadline && task.deadline.getTime() < new Date().setHours(0, 0, 0, 0);
  }
}
