import type { AuditEntry } from '@afb/types';
import { Badge, formatDateTime, type Tone } from '@afb/ui';

const ACTION_TONES: Record<AuditEntry['action'], Tone> = { INSERT: 'green', UPDATE: 'blue', DELETE: 'red' };

/** Who changed what, when — one line per audit row. */
export function actorLabel(entry: AuditEntry): string {
  if (entry.actor === null) {
    return 'System';
  }
  return `${entry.actor.name ?? `User ${String(entry.actor.id)}`}${entry.actor.loginId === null ? '' : ` (${entry.actor.loginId})`}`;
}

export function AuditSummary({ entry }: { entry: AuditEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Badge tone={ACTION_TONES[entry.action]}>{entry.action}</Badge>
      <span className="font-medium text-slate-900">{entry.tableName}</span>
      <span className="text-slate-500">#{entry.recordId}</span>
      {entry.changedFields !== null && (
        <span className="text-slate-600">({entry.changedFields.join(', ')})</span>
      )}
      <span className="text-slate-500">
        by {actorLabel(entry)} · {formatDateTime(entry.occurredAt)}
      </span>
    </div>
  );
}
