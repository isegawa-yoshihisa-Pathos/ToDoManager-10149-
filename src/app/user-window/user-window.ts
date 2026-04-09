import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskList } from '../task-list/task-list';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import {Router} from '@angular/router';

@Component({
  selector: 'app-user-window',
  standalone: true,
  imports: [CommonModule, FormsModule, TaskList, NzPageHeaderModule],
  templateUrl: './user-window.html',
  styleUrl: './user-window.css'
})

export class UserWindow { 
  constructor(
    private router: Router
  ) {}
  
  signOut() {
    this.router.navigate(['/login']);
  }
}
