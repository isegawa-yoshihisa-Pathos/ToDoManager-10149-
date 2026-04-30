import { Component, inject, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, collection, collectionData, Timestamp } from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { Subscription, combineLatest } from 'rxjs';
import { ProjectService } from '../project.service';
import { AuthService } from '../auth.service';
import { MatFormFieldModule } from "@angular/material/form-field";

export interface ProjectMemberRow {
  userId: string;
  displayName: string;
  joinedAt: Date | null;
}

export interface InvitedEmailRow {
  email: string;
  invitedAt: Date | null;
  invitedBy: string;
}

@Component({
  selector: 'app-project-members',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, MatIconModule, MatFormFieldModule],
  templateUrl: './project-members.html',
  styleUrl: './project-members.css',
})
export class ProjectMembers implements OnInit, OnDestroy {
  private readonly firestore = inject(Firestore);
  private readonly projectService = inject(ProjectService);
  private readonly auth = inject(AuthService);
  private sub?: Subscription;
  private invitedSub?: Subscription;

  @Input({ required: true }) projectId!: string;

  members: ProjectMemberRow[] = [];
  invited: InvitedEmailRow[] = [];

  ngOnInit(): void {
    const membersRef = collection(this.firestore, 'projects', this.projectId, 'members');
    const invitedRef = collection(this.firestore, 'projects', this.projectId, 'invitedEmails');
  
    this.sub = combineLatest([
      collectionData(membersRef, { idField: 'id' }),
      collectionData(invitedRef, { idField: 'email' })
    ]).pipe(
      map(([memberRows, invitedRows]) => {
        const memberMap = new Map<string, string>();
        memberRows.forEach((m) => {
          const id = String(m['id'] ?? '');
          const name = (typeof m['displayName'] === 'string' && m['displayName'].trim() !== '')
            ? m['displayName'].trim()
            : id;
          memberMap.set(id, name);
        });
  
        const invited = (invitedRows as Record<string, unknown>[]).map((data) => {
          const email = String(data['email'] ?? '');
          const invitedAt = data['invitedAt'] instanceof Timestamp
            ? data['invitedAt'].toDate()
            : data['invitedAt'] instanceof Date
              ? data['invitedAt']
              : null;
  
          const inviterId = String(data['invitedBy'] ?? '');
          const invitedByDisplayName = memberMap.get(inviterId) ?? inviterId;
  
          return { email, invitedAt, invitedBy: invitedByDisplayName };
        });
  
        const members = (memberRows as Record<string, unknown>[]).map((data) => {
          const userId = String(data['id'] ?? '');
          const joinedAt = data['joinedAt'] instanceof Timestamp ? data['joinedAt'].toDate() : null;
          const displayName = memberMap.get(userId) ?? userId;
          return { userId, displayName, joinedAt };
        });
  
        return { members, invited };
      })
    ).subscribe((result) => {
      this.members = result.members;
      this.invited = result.invited;
    });
  }

  notYou(userId: string): boolean {
    return userId !== this.auth.userId();
  }

  async onCancelInvitation(email: string): Promise<void> {
    const adminUserId = this.auth.userId();
    if (!adminUserId) {
      return;
    }
    if (
      !confirm(
        `「${email}」の招待をキャンセルしますか？`,
      )
    ) {
      return;
    }
    try {
      await this.projectService.cancelInvitation(this.projectId, email);
    } catch (e) {
      alert(e instanceof Error ? e.message : '招待を取り消すことに失敗しました');
    }
  }

  async onLeaveMember(userId: string): Promise<void> {
    const adminUserId = this.auth.userId();
    if (!adminUserId) {
      return;
    }
    if (
      !confirm(
        `「${this.members.find((m) => m.userId === userId)?.displayName}」を脱退させますか？`,
      )
    ) {
      return;
    }
    try {
      await this.projectService.leaveProject(this.projectId, userId, adminUserId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'メンバーを脱退させることに失敗しました');
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.invitedSub?.unsubscribe();
  }
}
