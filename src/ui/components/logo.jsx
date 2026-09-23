import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className, iconClassName }) {
  return (
    <div className={cn('bg-brand text-brand-foreground grid size-7 shrink-0 place-items-center rounded-md', className)}>
      <KeyRound className={cn('size-4', iconClassName)} strokeWidth={2.25} />
    </div>
  );
}
