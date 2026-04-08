import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskList } from './task-list/task-list';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, NzPageHeaderModule, TaskList],
  templateUrl: './app.html',
  styleUrl: './app.css'
})


export class App {  
}
