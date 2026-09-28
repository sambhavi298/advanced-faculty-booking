import { ApiError } from '@afb/api-client';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppointmentCard } from '../src/components/AppointmentCard';
import { Button } from '../src/components/Button';
import { Badge, Card, PageHeader, StatCard } from '../src/components/Card';
import { Field, Input, Select, Textarea } from '../src/components/Form';
import { Modal } from '../src/components/Modal';
import { EmptyState, ErrorState, LoadingState } from '../src/components/States';
import { StatusBadge } from '../src/components/StatusBadge';
import { Tabs } from '../src/components/Tabs';
import { ToastProvider, useToast } from '../src/components/Toast';
import { appointment } from './fixtures';

describe('Button', () => {
  it('runs its action, and is disabled with a spinner while loading', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button loading variant="danger" size="sm" onClick={onClick}>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('form controls', () => {
  it('shows either the validation message or the hint, and marks invalid controls', () => {
    const { rerender } = render(
      <Field label="Purpose" htmlFor="p" hint="At least 10 characters">
        <Textarea id="p" />
      </Field>,
    );
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument();

    rerender(
      <Field label="Purpose" htmlFor="p" error="Too short">
        <Textarea id="p" invalid />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');
    expect(screen.getByLabelText('Purpose')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders inputs and selects', () => {
    render(
      <>
        <Field label="Name" htmlFor="n">
          <Input id="n" />
        </Field>
        <Field label="Kind" htmlFor="k" error="">
          <Select id="k" invalid={false}>
            <option>LEAVE</option>
          </Select>
        </Field>
      </>,
    );
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Kind')).toHaveValue('LEAVE');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('layout pieces', () => {
  it('renders cards, headers, badges and stats', () => {
    render(
      <>
        <PageHeader title="Dashboard" description="Overview" actions={<button type="button">Act</button>} />
        <PageHeader title="Bare" />
        <Card title="Card title" actions={<span>actions</span>}>
          body
        </Card>
        <Card>untitled</Card>
        <Badge>plain</Badge>
        <StatCard label="Pending" value={3} tone="amber" icon={<span>i</span>} />
        <StatCard label="Total" value={9} />
        <StatusBadge status="APPROVED" />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Card title' })).toBeInTheDocument();
    expect(screen.getByText('untitled')).toBeInTheDocument();
    expect(screen.getByText('Pending').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });
});

describe('feedback states', () => {
  it('announces loading', () => {
    render(<LoadingState label="Loading slots" rows={2} />);
    expect(screen.getByRole('status', { name: 'Loading slots' })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an empty state with an optional action', () => {
    render(
      <EmptyState
        title="Nothing here"
        description="Add something"
        action={<button type="button">Add</button>}
        icon={<span>*</span>}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('shows the error, its reference and a retry button', async () => {
    const retry = vi.fn();
    render(
      <ErrorState
        error={
          new ApiError(
            503,
            'DATABASE_UNAVAILABLE',
            'The database is temporarily unavailable.',
            undefined,
            'req-9',
          )
        }
        onRetry={retry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The database is temporarily unavailable.');
    expect(screen.getByText('Reference: req-9')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('works without a reference or retry', () => {
    render(<ErrorState error={new Error('x')} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Tabs', () => {
  function Harness() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
    return (
      <Tabs
        label="Status"
        value={value}
        onChange={setValue}
        items={[
          { id: 'a', label: 'Alpha', count: 2 },
          { id: 'b', label: 'Beta' },
          { id: 'c', label: 'Gamma', count: 0 },
        ]}
      />
    );
  }

  it('selects by click and moves with the arrow keys (wrapping around)', async () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Gamma/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /Gamma/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: /Gamma/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Modal', () => {
  it('renders only when open, focuses the first field, and closes on Escape or the close button', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={false} title="Cancel?" onClose={onClose}>
        <textarea aria-label="Reason" />
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <Modal open title="Cancel?" onClose={onClose} footer={<button type="button">Confirm</button>}>
        <textarea aria-label="Reason" />
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Cancel?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('a');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('toasts', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            toast.success('Saved.');
          }}
        >
          ok
        </button>
        <button
          type="button"
          onClick={() => {
            toast.error('Failed.');
          }}
        >
          fail
        </button>
      </>
    );
  }

  it('shows success and error messages, which can be dismissed or expire', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider durationMs={1000}>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ok' }));
    await userEvent.click(screen.getByRole('button', { name: 'fail' }));
    expect(screen.getByText('Saved.')).toBeInTheDocument();
    expect(screen.getByText('Failed.')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('Failed.')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('must be used inside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger />)).toThrow('useToast must be used inside <ToastProvider>');
  });
});

describe('AppointmentCard', () => {
  it('shows a student the faculty member and, once approved, where to meet', () => {
    render(
      <AppointmentCard
        perspective="student"
        appointment={appointment({ status: 'APPROVED', decisionNote: 'Bring your notes.' })}
        actions={<button type="button">Cancel</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Prof. K. Rao' })).toBeInTheDocument();
    expect(screen.getByText('Meet at Tech Park, Staff Room 712')).toBeInTheDocument();
    expect(screen.getByText('Note from faculty:')).toBeInTheDocument();
    expect(screen.getByText('10:40 am – 10:55 am')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows a faculty member the student, and no meeting place', () => {
    render(
      <AppointmentCard
        perspective="faculty"
        appointment={appointment({ status: 'REJECTED', decisionNote: 'Use office hours.' })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Priya Sharma' })).toBeInTheDocument();
    expect(screen.getByText('RA221100301001 · Batch 1')).toBeInTheDocument();
    expect(screen.queryByText(/Meet at/)).not.toBeInTheDocument();
    expect(screen.getByText('Reason:')).toBeInTheDocument();
  });
});
