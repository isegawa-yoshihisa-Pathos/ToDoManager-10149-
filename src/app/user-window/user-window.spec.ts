import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserWindow } from './user-window';

describe('UserWindow', () => {
  let component: UserWindow;
  let fixture: ComponentFixture<UserWindow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserWindow]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UserWindow);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
