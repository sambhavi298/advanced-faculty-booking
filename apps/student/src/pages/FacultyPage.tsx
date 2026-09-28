import { ApiError } from '@afb/api-client';
import type { FacultyAvailability, TimeSlot } from '@afb/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Textarea,
  cn,
  dayName,
  describeError,
  formatCalendarDate,
  formatClock,
  formatDate,
  formatTime,
  formatTimeRange,
  useAsync,
  useAuth,
  useToast,
} from '@afb/ui';
import { ArrowLeft, Building2, MapPin } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

const PURPOSE_MIN = 10;
const PURPOSE_MAX = 500;

/** The slot-picker and request form. Keyed by the availability data so it resets when that reloads. */
function BookingPanel({
  data,
  onBooked,
  onConflict,
}: {
  data: FacultyAvailability;
  onBooked: () => void;
  onConflict: () => void;
}) {
  const { api } = useAuth();
  const toast = useToast();
  const daysWithSlots = data.days.filter((day) => day.slots.length > 0);
  const [date, setDate] = useState<string | undefined>(daysWithSlots[0]?.date);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [purpose, setPurpose] = useState('');
  const [purposeError, setPurposeError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  if (daysWithSlots.length === 0) {
    return (
      <EmptyState
        title="No free slots in this period"
        description="Every slot is taken or clashes with the faculty member's classes or yours. Try again later."
      />
    );
  }
  const slots = data.days.find((day) => day.date === date)?.slots ?? [];

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = purpose.trim();
    if (text.length < PURPOSE_MIN) {
      setPurposeError(`Describe the purpose in at least ${String(PURPOSE_MIN)} characters.`);
      return;
    }
    setPurposeError(undefined);
    setSubmitting(true);
    try {
      await api.appointments.create({
        facultyId: data.faculty.id,
        startsAt: (slot as TimeSlot).startsAt,
        purpose: text,
      });
      toast.success(`Request sent to ${data.faculty.name}. You will be notified when they respond.`);
      onBooked();
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiError && error.status === 400 && error.fieldErrors.purpose !== undefined) {
        setPurposeError(error.fieldErrors.purpose);
        return;
      }
      toast.error(describeError(error));
      if (error instanceof ApiError && error.status === 409) {
        onConflict(); // the slot was taken or became unavailable — show fresh slots
      }
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-700">1. Choose a day</h3>
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Days">
          {data.days.map((day) => (
            <button
              key={day.date}
              type="button"
              disabled={day.slots.length === 0}
              aria-pressed={day.date === date}
              onClick={() => {
                setDate(day.date);
                setSlot(null);
              }}
              className={cn(
                'flex min-w-24 flex-col items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm ring-1 ring-inset disabled:cursor-not-allowed disabled:opacity-40',
                day.date === date
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
              )}
            >
              <span className="font-medium">{formatCalendarDate(day.date)}</span>
              <span className="text-xs opacity-80">
                {day.slots.length === 0 ? 'No slots' : `${String(day.slots.length)} free`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-700">2. Choose a time</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="group" aria-label="Times">
          {slots.map((candidate) => (
            <button
              key={candidate.startsAt}
              type="button"
              aria-pressed={slot?.startsAt === candidate.startsAt}
              onClick={() => {
                setSlot(candidate);
              }}
              className={cn(
                'rounded-lg px-2 py-2 text-sm font-medium ring-1 ring-inset',
                slot?.startsAt === candidate.startsAt
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-brand-50',
              )}
            >
              {formatTime(candidate.startsAt)}
            </button>
          ))}
        </div>
      </div>

      {slot !== null && (
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="space-y-4 rounded-xl bg-brand-50/60 p-4 ring-1 ring-brand-100"
        >
          <p className="text-sm text-slate-800">
            <span className="font-medium">{formatDate(slot.startsAt)}</span>,{' '}
            {formatTimeRange(slot.startsAt, slot.endsAt)} with {data.faculty.name}
          </p>
          <Field
            label="3. Purpose of the meeting"
            htmlFor="purpose"
            error={purposeError}
            hint={`${String(purpose.trim().length)}/${String(PURPOSE_MAX)} characters`}
          >
            <Textarea
              id="purpose"
              rows={3}
              maxLength={PURPOSE_MAX}
              placeholder="e.g. Doubt in normalisation — BCNF decomposition example from lecture 7"
              value={purpose}
              invalid={purposeError !== undefined}
              onChange={(event) => {
                setPurpose(event.target.value);
              }}
            />
          </Field>
          <Button type="submit" loading={submitting}>
            Request appointment
          </Button>
        </form>
      )}
    </div>
  );
}

export function FacultyPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const availability = useAsync(() => api.faculty.availability(id), [id]);

  if (availability.status === 'loading') {
    return <LoadingState label="Loading free slots" rows={4} />;
  }
  if (availability.status === 'error') {
    return <ErrorState error={availability.error} onRetry={availability.reload} />;
  }
  const data = availability.data;
  const { faculty } = data;

  return (
    <>
      <Link
        to="/faculty"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All faculty
      </Link>
      <div className="mb-6 rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">{faculty.name}</h1>
        <p className="text-sm text-slate-500">
          {faculty.designation} · {faculty.employeeId}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-slate-700">
          <span className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" /> {faculty.department.name}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" /> {faculty.officeLocation}
          </span>
          <span>{faculty.slotMinutes}-minute appointments</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Book a slot" className="lg:col-span-2">
          <BookingPanel
            key={JSON.stringify(data.days)}
            data={data}
            onBooked={() => {
              void navigate('/appointments?status=PENDING');
            }}
            onConflict={availability.reload}
          />
        </Card>
        <div className="space-y-6">
          <Card title="Weekly office hours">
            {data.weeklyAvailability.length === 0 ? (
              <p className="text-sm text-slate-500">No weekly office hours set.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.weeklyAvailability.map((window) => (
                  <li key={window.id} className="flex justify-between gap-3">
                    <span className="text-slate-600">{dayName(window.dayOfWeek)}</span>
                    <span className="font-medium text-slate-900">
                      {formatClock(window.startTime)} – {formatClock(window.endTime)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Teaching timetable">
            {data.teaching.length === 0 ? (
              <p className="text-sm text-slate-500">No classes scheduled.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.teaching.map((session) => (
                  <li key={`${String(session.dayOfWeek)}-${session.startTime}-${session.batchName}`}>
                    <p className="font-medium text-slate-900">{session.courseTitle}</p>
                    <p className="text-slate-500">
                      {dayName(session.dayOfWeek)} {formatClock(session.startTime)}–
                      {formatClock(session.endTime)} · {session.batchName}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
