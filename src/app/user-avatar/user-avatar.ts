import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { avatarFallbackHue, avatarInitials } from '../avatar-initials';

@Component({
  selector: 'app-user-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-avatar.html',
  styleUrl: './user-avatar.css',
})
export class UserAvatar {
  @Input() userId = '';
  @Input() displayName = '';
  @Input() avatarUrl: string | null | undefined = null;
  /** sm=22px md=28px lg=36px 目安 */
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  initials(): string {
    return avatarInitials(this.displayName, this.userId);
  }

  fallbackBg(): string {
    const h = avatarFallbackHue(this.userId || this.displayName || 'x');
    return `hsl(${h} 42% 46%)`;
  }
}
