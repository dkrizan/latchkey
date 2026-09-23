import { Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Master on/off for all rules: a status pill that toggles on click. */
export function GlobalToggle({ enabled, onChange, className }) {
  return (
    <button
      type="button"
      id="global-enabled"
      aria-pressed={!enabled}
      title={enabled ? 'Click to pause all rules' : 'Click to resume all rules'}
      onClick={() => onChange(!enabled)}
      className={cn(
        'focus-visible:ring-ring/50 inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px]',
        enabled ? 'bg-background hover:bg-muted' : 'border-warning-border bg-warning-soft text-warning hover:brightness-95',
        className
      )}
    >
      {enabled ? (
        <span className="relative flex size-2">
          <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" />
          <span className="bg-success relative inline-flex size-2 rounded-full" />
        </span>
      ) : (
        <Pause className="size-3 fill-current" />
      )}
      {enabled ? 'Active' : 'Paused'}
    </button>
  );
}
