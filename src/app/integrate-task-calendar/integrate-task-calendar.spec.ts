import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntegrateTaskCalendar } from './integrate-task-calendar';

describe('IntegrateTaskCalendar', () => {
  let component: IntegrateTaskCalendar;
  let fixture: ComponentFixture<IntegrateTaskCalendar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntegrateTaskCalendar]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntegrateTaskCalendar);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
