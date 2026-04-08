import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Task } from '../../models/task';

@Component({
  selector: 'app-task-form',
  imports: [CommonModule, FormsModule],
  templateUrl: './task-form.html',
  styleUrl: './task-form.css',
})
export class TaskForm implements OnInit {
  constructor() {}

  ngOnInit() {}

  @Output() addTask = new EventEmitter<Task>();

  newTask: Task = {
    title: '',
    done: false,
    deadline: null,
  };

  submit(): void {
    this.addTask.emit({
      title: this.newTask.title, 
      done: false, 
      deadline: this.newTask.deadline ? new Date(this.newTask.deadline) : null
    });
    this.newTask = {
      title: '',
      done: false,
      deadline: null,
    };
  }
}
