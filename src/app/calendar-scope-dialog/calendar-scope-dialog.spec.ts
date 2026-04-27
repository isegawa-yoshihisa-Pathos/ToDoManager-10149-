import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CalendarScopeDialog } from './calendar-scope-dialog';

describe('CalendarScopeDialog', () => {
  let component: CalendarScopeDialog;
  let fixture: ComponentFixture<CalendarScopeDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarScopeDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CalendarScopeDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
