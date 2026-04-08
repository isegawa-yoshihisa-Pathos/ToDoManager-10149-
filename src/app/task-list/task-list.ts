import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskListItem } from '../task-list-item/task-list-item';
import { TaskForm } from '../task-form/task-form';
import { Task } from '../../models/task';

@Component({
  selector: 'app-task-list',
  imports: [CommonModule, FormsModule, TaskListItem, TaskForm],
  templateUrl: './task-list.html',
  styleUrl: './task-list.css',
})
export class TaskList implements OnInit {
  constructor() {}

  tasks: Task[] = [
    {title: '牛乳を買う', done: false, deadline: new Date('2026-04-09')},
    {title: '可燃ゴミを出す', done: true, deadline: new Date('2026-04-01')},
    {title: '銀行に行く', done: false, deadline: new Date('2026-04-02')},
  ];

  ngOnInit() {}

  addTask(task: Task) {
    this.tasks.push(task);
  }
}
