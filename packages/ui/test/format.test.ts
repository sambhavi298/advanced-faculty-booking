import { describe, expect, it } from 'vitest';
import { cn } from '../src/cn';
import { describeError } from '../src/errors';
import { ApiError } from '@afb/api-client';
import {
  dayName,
  formatCalendarDate,
  formatClock,
  formatDate,
  formatDateTime,
  formatMinutes,
  formatTime,
  formatTimeRange,
} from '../src/format';

describe('formatting (campus time)', () => {
  it('formats instants in Asia/Kolkata whatever the device time zone', () => {
    expect(formatDate('2030-01-07T05:10:00.000Z')).toBe('Mon, 7 Jan 2030');
    expect(formatTime('2030-01-07T05:10:00.000Z')).toBe('10:40 am');
    expect(formatTimeRange('2030-01-07T05:10:00.000Z', '2030-01-07T05:25:00.000Z')).toBe(
      '10:40 am – 10:55 am',
    );
    expect(formatDateTime('2030-01-07T08:00:00.000Z')).toBe('Mon, 7 Jan 2030, 1:30 pm');
    expect(formatCalendarDate('2030-01-07')).toBe('Mon, 7 Jan');
  });

  it('formats clock times, weekdays and durations', () => {
    expect(formatClock('00:05')).toBe('12:05 am');
    expect(formatClock('12:00')).toBe('12:00 pm');
    expect(formatClock('14:30')).toBe('2:30 pm');
    expect(formatClock('')).toBe('12:00 am');
    expect(dayName(1)).toBe('Monday');
    expect(dayName(7)).toBe('Sunday');
    expect(dayName(9)).toBe('Day 9');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(580)).toBe('9 h 40 min');
  });
});

describe('cn and describeError', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('turns failures into readable sentences', () => {
    expect(describeError(new ApiError(409, 'SLOT_CONFLICT', 'Slot taken.'))).toBe('Slot taken.');
    expect(describeError(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(describeError(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(
      'Something went wrong on our side. Please try again in a moment.',
    );
    expect(describeError(new ApiError(502, 'UNEXPECTED_RESPONSE', 'x'))).toMatch(/our side/);
    expect(describeError(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});
