import { useId } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  CircleAlert,
  Clock3,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  WifiOff,
} from 'lucide-react';
import { Button } from './button';
import { cn } from '../../lib/utils';

export type ResourceStatus =
  'loading' | 'empty' | 'error' | 'denied' | 'offline' | 'pending' | 'success';

const icons = {
  loading: LoaderCircle,
  empty: FolderOpen,
  error: CircleAlert,
  denied: LockKeyhole,
  offline: WifiOff,
  pending: Clock3,
  success: Check,
};

interface ResourceStateProps {
  state: ResourceStatus;
  title: string;
  description: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  footnote?: ReactNode;
  className?: string;
}

export function ResourceState({
  state,
  title,
  description,
  icon,
  actionLabel,
  onAction,
  footnote,
  className,
}: ResourceStateProps) {
  const titleId = useId();
  const Icon = icons[state];
  const busy = state === 'loading' || state === 'pending';
  const role =
    state === 'error' || state === 'denied'
      ? 'alert'
      : state === 'empty'
        ? 'region'
        : 'status';
  return (
    <section
      className={cn('destination-empty', className)}
      role={role}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-state={state}
    >
      <div className="empty-icon" aria-hidden="true">
        {icon ?? <Icon size={28} />}
      </div>
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      {actionLabel && onAction ? (
        <Button onClick={onAction} disabled={busy}>
          {actionLabel}
        </Button>
      ) : null}
      {footnote ? <div className="empty-footnote">{footnote}</div> : null}
    </section>
  );
}
