import { cn } from '@/lib/utils';

export function Logo({ className }) {
  return <img src="icons/icon-128.png" alt="" draggable={false} className={cn('shadow-brand/30 size-8 shrink-0 rounded-full shadow-md', className)} />;
}
