import { escapeLike } from '../../../src/modules/faculty/faculty.repository';
import { minutesOf } from '../../../src/modules/faculty/faculty.schemas';
import { daysInRange } from '../../../src/modules/faculty/faculty.service';

describe('faculty helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('rao')).toBe('rao');
  });

  it('converts HH:MM to minutes', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('14:35')).toBe(875);
  });

  it('counts days in a range inclusively', () => {
    expect(daysInRange('2030-01-07', '2030-01-07')).toBe(1);
    expect(daysInRange('2030-01-07', '2030-01-20')).toBe(14);
    expect(daysInRange('2030-01-10', '2030-01-07')).toBe(-2);
  });
});
