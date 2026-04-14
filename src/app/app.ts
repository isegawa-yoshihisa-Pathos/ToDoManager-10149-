import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { AppHeader } from './app-header/app-header';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, AppHeader],
  templateUrl: './app.html',
  styleUrl: './app.css'
})

export class App {  
}
