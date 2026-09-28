import { ApiError } from '@afb/api-client';
import type { ExceptionKind, MyAvailability, ScheduleException } from '@afb/types';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Textarea,
  dayName,
  describeError,
  formatDateTime,
  formatMinutes,
  useAsync,
  useAuth,
  useToast,
  type Tone,
} from '@afb/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { campusInstant, minutesOf, sortWindows, validateWindows, type WindowRow } from './availability-rules';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

const KIND_INFO: Record<ExceptionKind, { label: string; tone: Tone }> = {
  LEAVE: { label: 'Leave', tone: 'red' },
  MEETING: { label: 'Meeting', tone: 'blue' },
  BLOCKED: { label: 'Blocked time', tone: 'slate' },
};

const KINDS = Object.keys(KIND_INFO) as ExceptionKind[];

const kindInfo = (kind: ExceptionKind) => KIND_INFO[kind];

let nextKey = 0;
const newKey = () => {
  nextKey += 1;
  return `new-${String(nextKey)}`;
};

/** Weekly office hours: edit rows locally, then save the whole set (PUT replaces it in one transaction). */
function WeeklyHours({ data, onSaved }: { data: MyAvailability; onSaved: () => void }) {
  const { api } = useAuth();
  const toast = useToast();
  const initial = sortWindows(data.windows).map(({ dayOfWeek, startTime, endTime, id }) => ({
    key: `saved-${String(id)}`,
    dayOfWeek,
    startTime,
    endTime,
  }));
  const [rows, setRows] = useState<WindowRow[]>(initial);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const errors = { ...serverErrors, ...validateWindows(rows) };
  const dirty =
    JSON.stringify(rows.map(({ key: _key, ...window }) => window)) !==
    JSON.stringify(initial.map(({ key: _key, ...window }) => window));
  const weeklyMinutes = rows.reduce(
    (sum, row) => sum + Math.max(0, minutesOf(row.endTime) - minutesOf(row.startTime)),
    0,
  );

  const update = (key: string, change: Partial<WindowRow>) => {
    setServerErrors({});
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.faculty.replaceAvailability(
        rows.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })),
      );
      toast.success(
        `Office hours saved (${String(result.added)} added, ${String(result.removed)} removed). Students see the new slots now.`,
      );
      onSaved();
    } catch (error) {
      setSaving(false);
      if (error instanceof ApiError) {
        // Field paths look like "windows.2.endTime": point the message at that row.
        const mapped: Record<string, string> = {};
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          const row = rows[Number(field.split('.')[1])];
          if (row !== undefined) {
            mapped[row.key] = message;
          }
        }
        setServerErrors(mapped);
      }
      toast.error(describeError(error));
    }
  };

  return (
    <Card
      title="Weekly office hours"
      actions={
        <span className="text-xs text-slate-500">
          {formatMinutes(weeklyMinutes)} a week · {data.slotMinutes}-minute slots
        </span>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        Students can book {data.slotMinutes}-minute slots inside these windows, except when you teach, are on
        leave, or already have an appointment.
      </p>
      {rows.length === 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No office hours: students cannot book you until you add a window.
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li key={row.key}>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Day" htmlFor={`day-${row.key}`}>
                <Select
                  id={`day-${row.key}`}
                  value={row.dayOfWeek}
                  onChange={(event) => {
                    update(row.key, { dayOfWeek: Number(event.target.value) });
                  }}
                >
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {dayName(day)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From" htmlFor={`start-${row.key}`}>
                <Input
                  id={`start-${row.key}`}
                  type="time"
                  step={300}
                  value={row.startTime}
                  invalid={errors[row.key] !== undefined}
                  onChange={(event) => {
                    update(row.key, { startTime: event.target.value });
                  }}
                />
              </Field>
              <Field label="To" htmlFor={`end-${row.key}`}>
                <Input
                  id={`end-${row.key}`}
                  type="time"
                  step={300}
                  value={row.endTime}
                  invalid={errors[row.key] !== undefined}
                  onChange={(event) => {
                    update(row.key, { endTime: event.target.value });
                  }}
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove window ${String(index + 1)}`}
                onClick={() => {
                  setServerErrors({});
                  setRows((current) => current.filter((other) => other.key !== row.key));
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {errors[row.key] !== undefined && (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {errors[row.key]}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setRows((current) => [
              ...current,
              { key: newKey(), dayOfWeek: 1, startTime: '10:00', endTime: '11:00' },
            ]);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add window
        </Button>
        <Button
          loading={saving}
          disabled={!dirty || Object.keys(errors).length > 0}
          onClick={() => void save()}
        >
          Save office hours
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setServerErrors({});
              setRows(initial);
            }}
          >
            Discard changes
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Leave, meetings and blocked time: recording one releases the appointments it overlaps. */
function Exceptions({ items, onChanged }: { items: ScheduleException[]; onChanged: () => void }) {
  const { api } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState<ExceptionKind>('LEAVE');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ startsAt?: string; endsAt?: string }>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<ScheduleException | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (startsAt === '') {
      found.startsAt = 'Choose when it starts.';
    }
    if (endsAt === '') {
      found.endsAt = 'Choose when it ends.';
    } else if (startsAt !== '' && endsAt <= startsAt) {
      found.endsAt = 'The end must be after the start.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setSaving(true);
    try {
      const result = await api.faculty.addException({
        kind,
        startsAt: campusInstant(startsAt),
        endsAt: campusInstant(endsAt),
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      const released = result.releasedAppointments;
      toast.success(
        `${kindInfo(kind).label} recorded.` +
          (released === 0
            ? ''
            : ` ${String(released)} appointment${released === 1 ? ' was' : 's were'} released and the students notified.`),
      );
      setStartsAt('');
      setEndsAt('');
      setReason('');
      onChanged();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: ScheduleException) => {
    setBusy(true);
    try {
      await api.faculty.removeException(target.id);
      toast.success(`${kindInfo(target.kind).label} removed. Those hours are bookable again.`);
      setRemoving(null);
      onChanged();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Leave, meetings and blocked time">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing planned. Add leave or a meeting below.</p>
      ) : (
        <ul className="-my-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <Badge tone={kindInfo(item.kind).tone}>{kindInfo(item.kind).label}</Badge>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {formatDateTime(item.startsAt)} → {formatDateTime(item.endsAt)}
                </p>
                {item.reason !== null && <p className="text-sm text-slate-600">{item.reason}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${kindInfo(item.kind).label.toLowerCase()} from ${formatDateTime(item.startsAt)}`}
                onClick={() => {
                  setRemoving(item);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        noValidate
        onSubmit={(event) => void add(event)}
        className="mt-6 space-y-4 border-t border-slate-100 pt-5"
      >
        <h3 className="text-sm font-semibold text-slate-900">Add a period (campus time, IST)</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" htmlFor="exception-kind">
            <Select
              id="exception-kind"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as ExceptionKind);
              }}
            >
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {KIND_INFO[item].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts" htmlFor="exception-start" error={errors.startsAt}>
            <Input
              id="exception-start"
              type="datetime-local"
              value={startsAt}
              invalid={errors.startsAt !== undefined}
              onChange={(event) => {
                setStartsAt(event.target.value);
              }}
            />
          </Field>
          <Field label="Ends" htmlFor="exception-end" error={errors.endsAt}>
            <Input
              id="exception-end"
              type="datetime-local"
              value={endsAt}
              invalid={errors.endsAt !== undefined}
              onChange={(event) => {
                setEndsAt(event.target.value);
              }}
            />
          </Field>
        </div>
        <Field label="Reason (optional, shown to affected students)" htmlFor="exception-reason">
          <Textarea
            id="exception-reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <p className="text-sm text-amber-800">
          Pending requests in this period are declined and approved appointments are cancelled; each student
          is notified.
        </p>
        <Button type="submit" loading={saving}>
          Add period
        </Button>
      </form>

      <Modal
        open={removing !== null}
        title="Remove this period?"
        onClose={() => {
          setRemoving(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRemoving(null);
              }}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => void remove(removing as ScheduleException)}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Students will be able to book these hours again. Appointments already released stay released.
        </p>
      </Modal>
    </Card>
  );
}

export function AvailabilityPage() {
  const { api } = useAuth();
  const availability = useAsync(() => api.faculty.myAvailability(), []);

  return (
    <>
      <PageHeader
        title="Availability"
        description="Your weekly office hours and one-off absences decide which slots students can book."
      />
      {availability.status === 'loading' && <LoadingState label="Loading your availability" />}
      {availability.status === 'error' && (
        <ErrorState error={availability.error} onRetry={availability.reload} />
      )}
      {availability.status === 'success' && (
        <div className="grid gap-6 xl:grid-cols-2">
          <WeeklyHours
            key={JSON.stringify(availability.data.windows)}
            data={availability.data}
            onSaved={availability.reload}
          />
          <Exceptions items={availability.data.exceptions} onChanged={availability.reload} />
        </div>
      )}
    </>
  );
}
