import { Badge, Button, Modal, describeError, useAuth, useToast } from '@afb/ui';
import { useState } from 'react';

/**
 * Active/deactivated badge with the button that flips it. Deactivation is confirmed first because it
 * signs the person out everywhere at once (the API re-checks is_active on every request).
 */
export function AccountStatus({
  user,
  onChanged,
}: {
  user: { id: number; name: string; isActive: boolean };
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = async (isActive: boolean) => {
    setBusy(true);
    try {
      await api.admin.setUserStatus(user.id, isActive);
      toast.success(
        isActive ? `${user.name} can sign in again.` : `${user.name} has been deactivated and signed out.`,
      );
      setConfirming(false);
      onChanged();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Badge tone={user.isActive ? 'green' : 'red'}>{user.isActive ? 'Active' : 'Deactivated'}</Badge>
      {user.isActive ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Deactivate ${user.name}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Deactivate
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Reactivate ${user.name}`}
          loading={busy}
          onClick={() => void apply(true)}
        >
          Reactivate
        </Button>
      )}
      <Modal
        open={confirming}
        title={`Deactivate ${user.name}?`}
        onClose={() => {
          setConfirming(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void apply(false)}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          They are signed out immediately and cannot sign in until reactivated. Their appointments and history
          are kept. The change is recorded in the audit log under your name.
        </p>
      </Modal>
    </div>
  );
}
