import { toAppointment } from '../../../src/modules/appointments/appointment.repository';

const base = {
  id: 'a',
  status: 'CANCELLED' as const,
  starts_at: new Date('2030-01-07T05:10:00Z'),
  ends_at: new Date('2030-01-07T05:25:00Z'),
  purpose: 'Discuss',
  decision_note: null,
  created_at: new Date('2030-01-01T00:00:00Z'),
  decided_at: null,
  cancelled_at: new Date('2030-01-02T00:00:00Z'),
  cancelled_by: null as number | null,
  completed_at: null,
  student_id: 1,
  student_name: 'Priya Sharma',
  registration_number: 'RA221100301001',
  batch_name: 'Batch 1',
  faculty_id: 2,
  faculty_name: 'Prof. K. Rao',
  employee_id: 'FAC200',
  faculty_designation: 'Associate Professor',
  faculty_office: 'TP 712',
  department_code: 'CSE',
  department_name: 'Computer Science and Engineering',
};

describe('toAppointment', () => {
  it.each([
    [1, 'STUDENT'],
    [2, 'FACULTY'],
    [null, null],
  ] as const)('maps cancelled_by %p to %p', (cancelledBy, expected) => {
    expect(toAppointment({ ...base, cancelled_by: cancelledBy }).cancelledBy).toBe(expected);
  });

  it('serialises timestamps as ISO strings and nests the parties', () => {
    expect(toAppointment(base)).toMatchObject({
      startsAt: '2030-01-07T05:10:00.000Z',
      cancelledAt: '2030-01-02T00:00:00.000Z',
      decidedAt: null,
      student: { id: 1, registrationNumber: 'RA221100301001' },
      faculty: { id: 2, employeeId: 'FAC200', departmentCode: 'CSE' },
    });
  });
});
