import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className, iconClassName }) {
  return (
    <div
      className={cn(
        'bg-brand-gradient animate-gradient-pan text-brand-foreground shadow-brand/30 grid size-8 shrink-0 place-items-center rounded-lg shadow-md',
        className
      )}
    >
      <KeyRound className={cn('size-4', iconClassName)} strokeWidth={2.25} />
    </div>
  );
}
