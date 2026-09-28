import { EmptyState } from '@afb/ui';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you were looking for does not exist."
      action={
        <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
          Go to the dashboard
        </Link>
      }
    />
  );
}
