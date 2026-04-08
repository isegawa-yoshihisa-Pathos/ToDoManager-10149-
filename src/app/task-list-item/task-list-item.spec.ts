import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaskListItem } from './task-list-item';

describe('TaskListItem', () => {
  let component: TaskListItem;
  let fixture: ComponentFixture<TaskListItem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskListItem]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TaskListItem);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
