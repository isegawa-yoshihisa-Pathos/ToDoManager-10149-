import {
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskList } from '../task-list/task-list';
import { ProjectHub, ProjectOpenedPayload } from '../project-hub/project-hub';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { ProjectSessionService } from '../project-session.service';
import { TaskScope } from '../task-scope';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { PrivateListService } from '../private-list.service';

@Component({
  selector: 'app-user-window',
  standalone: true,
  imports: [
    CommonModule,
    TaskList,
    ProjectHub,
    MatToolbarModule,
    MatButtonModule,
    MatMenuModule,
  ],
  templateUrl: './user-window.html',
  styleUrl: './user-window.css',
})
export class UserWindow implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly projectSession = inject(ProjectSessionService);
  private readonly firestore = inject(Firestore);
  private readonly privateListService = inject(PrivateListService);
  private membershipSub?: Subscription;
  private privateListsSub?: Subscription;
  private privateUiSub?: Subscription;

  mainTab = signal<'private' | 'project'>('private');
  activeProject = signal<{ id: string; name: string } | null>(null);

  activePrivateListId = signal<'default' | string>('default');
  defaultPrivateLabel = signal('プライベート');
  privateLists = signal<{ id: string; title: string }[]>([]);

  privateTaskScope = computed<TaskScope>(() => ({
    kind: 'private',
    privateListId: this.activePrivateListId(),
  }));

  projectTaskScope = computed<TaskScope>(() => {
    const p = this.activeProject();
    if (!p) {
      return { kind: 'private', privateListId: 'default' };
    }
    return { kind: 'project', projectId: p.id };
  });

  memberships: { projectId: string; projectName: string }[] = [];

  ngOnInit(): void {
    const s = this.projectSession.load();
    this.mainTab.set(s.mainTab);
    this.activeProject.set(s.activeProject);
    this.memberships = s.projectTabsCache;
    this.activePrivateListId.set(
      typeof s.activePrivateListId === 'string' && s.activePrivateListId.length > 0
        ? s.activePrivateListId
        : 'default',
    );
    this.defaultPrivateLabel.set(s.defaultPrivateListLabel);
    this.privateLists.set(s.privateListsCache);

    const username = this.auth.username();
    if (!username) {
      return;
    }
    this.subscribePrivateUi(username);
    this.subscribePrivateLists(username);

    const ref = collection(this.firestore, 'accounts', username, 'projectMemberships');
    this.membershipSub = collectionData(ref, { idField: 'projectId' })
      .pipe(
        map((rows) =>
          (rows as Record<string, unknown>[]).map((data) => ({
            projectId: String(data['projectId'] ?? ''),
            projectName:
              typeof data['projectName'] === 'string' ? data['projectName'] : '（無題）',
          })),
        ),
      )
      .subscribe((rows) => {
        this.memberships = rows;
        this.persistSession();
      });
  }

  private subscribePrivateUi(username: string): void {
    const ref = doc(this.firestore, 'accounts', username, 'config', 'privateUi');
    this.privateUiSub = docData(ref).subscribe((d) => {
      const label =
        d && typeof (d as Record<string, unknown>)['defaultListLabel'] === 'string'
          ? String((d as Record<string, unknown>)['defaultListLabel'])
          : 'プライベート';
      this.defaultPrivateLabel.set(label.trim() || 'プライベート');
      this.persistSession();
    });
  }

  private subscribePrivateLists(username: string): void {
    const ref = collection(this.firestore, 'accounts', username, 'privateTaskLists');
    this.privateListsSub = collectionData(ref, { idField: 'id' })
      .pipe(
        map((rows) => {
          const list = (rows as Record<string, unknown>[]).map((data) => ({
            id: String(data['id'] ?? ''),
            title:
              typeof data['title'] === 'string' && data['title'].trim() !== ''
                ? data['title']
                : '（無題）',
          }));
          return list.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
        }),
      )
      .subscribe((rows) => {
        this.privateLists.set(rows);
        const active = this.activePrivateListId();
        if (active !== 'default' && !rows.some((r) => r.id === active)) {
          this.activePrivateListId.set('default');
        }
        this.persistSession();
      });
  }

  ngOnDestroy(): void {
    this.membershipSub?.unsubscribe();
    this.privateListsSub?.unsubscribe();
    this.privateUiSub?.unsubscribe();
    this.persistSession();
  }

  private persistSession(): void {
    this.projectSession.save({
      mainTab: this.mainTab(),
      activeProject: this.activeProject(),
      projectTabsCache: this.memberships,
      activePrivateListId: this.activePrivateListId(),
      privateListsCache: this.privateLists(),
      defaultPrivateListLabel: this.defaultPrivateLabel(),
    });
  }

  selectDefaultPrivateTab(): void {
    this.mainTab.set('private');
    this.activeProject.set(null);
    this.activePrivateListId.set('default');
    this.persistSession();
  }

  selectPrivateList(listId: string): void {
    this.mainTab.set('private');
    this.activeProject.set(null);
    this.activePrivateListId.set(listId);
    this.persistSession();
  }

  selectProjectHub(): void {
    this.mainTab.set('project');
    this.activeProject.set(null);
    this.persistSession();
  }

  onProjectOpened(payload: ProjectOpenedPayload): void {
    this.mainTab.set('project');
    this.activeProject.set({ id: payload.projectId, name: payload.projectName });
    this.persistSession();
  }

  signOut(): void {
    this.persistSession();
    this.auth.signOut();
    void this.router.navigate(['/login']);
  }

  openProject(p: { projectId: string; projectName: string }): void {
    this.mainTab.set('project');
    this.activeProject.set({ id: p.projectId, name: p.projectName });
    this.persistSession();
  }

  openProjectSettings(ev: Event, p: { projectId: string }): void {
    ev.stopPropagation();
    ev.preventDefault();
    void this.router.navigate(['/project', p.projectId, 'settings']);
  }

  isProjectHubActive(): boolean {
    return this.mainTab() === 'project' && this.activeProject() === null;
  }

  isProjectTabActive(projectId: string): boolean {
    return (
      this.mainTab() === 'project' && this.activeProject()?.id === projectId
    );
  }

  isDefaultPrivateTabActive(): boolean {
    return this.mainTab() === 'private' && this.activePrivateListId() === 'default';
  }

  isPrivateListTabActive(listId: string): boolean {
    return this.mainTab() === 'private' && this.activePrivateListId() === listId;
  }

  async onAddPrivateList(): Promise<void> {
    const username = this.auth.username();
    if (!username) {
      return;
    }
    try {
      const id = await this.privateListService.createPrivateList(username);
      this.activePrivateListId.set(id);
      this.mainTab.set('private');
      this.activeProject.set(null);
      this.persistSession();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'リストの追加に失敗しました');
    }
  }

  async promptRenameDefaultPrivate(): Promise<void> {
    const username = this.auth.username();
    if (!username) {
      return;
    }
    const cur = this.defaultPrivateLabel();
    const n = window.prompt('リストの名称', cur);
    if (n === null) {
      return;
    }
    try {
      await this.privateListService.renameDefaultListLabel(username, n);
    } catch (e) {
      alert(e instanceof Error ? e.message : '名称の変更に失敗しました');
    }
  }

  async renameExtraPrivate(pl: { id: string; title: string }): Promise<void> {
    const username = this.auth.username();
    if (!username) {
      return;
    }
    const n = window.prompt('リストの名称', pl.title);
    if (n === null) {
      return;
    }
    try {
      await this.privateListService.renameExtraList(username, pl.id, n);
    } catch (e) {
      alert(e instanceof Error ? e.message : '名称の変更に失敗しました');
    }
  }

  async deleteExtraPrivate(pl: { id: string; title: string }): Promise<void> {
    const username = this.auth.username();
    if (!username) {
      return;
    }
    if (!window.confirm(`「${pl.title}」を削除しますか？\n含まれるタスクもすべて削除されます。`)) {
      return;
    }
    try {
      await this.privateListService.deleteExtraList(username, pl.id);
      if (this.activePrivateListId() === pl.id) {
        this.activePrivateListId.set('default');
      }
      this.persistSession();
    } catch (e) {
      alert(e instanceof Error ? e.message : '削除に失敗しました');
    }
  }
}
