import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  constructor(
    private router: Router
  ) {}

  email: string = '';
  password: string = '';

  signIn() {
    if (this.email === 'admin' && this.password === 'pass') {
      this.router.navigate(['/user-window']);
    } else {
      alert('Invalid email or password');
    }
  }
}
