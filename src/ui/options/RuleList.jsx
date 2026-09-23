import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Copy, Globe, MoreHorizontal, Trash2, Zap } from 'lucide-react';
import { AL } from '@/lib/ext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const spring = { type: 'spring', stiffness: 420, damping: 34 };

export function RuleList({ rules, access, onToggle, onEdit, onDuplicate, onMove, onDelete, onGrant }) {
  // Stagger only the first render; rows added later animate on their own.
  const firstRender = useRef(true);
  const stagger = firstRender.current;
  useEffect(() => {
    const t = setTimeout(() => (firstRender.current = false), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <ul className="grid gap-2">
      <AnimatePresence initial={true} mode="popLayout">
        {rules.map((rule, index) => {
          const origin = AL.permissionOrigin(rule.urlPattern);
          const remote = !AL.isLocalPattern(rule.urlPattern);
          const needsAccess = Boolean(origin) && access[origin] === false;

          return (
            <motion.li
              key={rule.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -24, scale: 0.96, transition: { duration: 0.2 } }}
              transition={{ ...spring, delay: stagger ? index * 0.05 : 0 }}
              data-testid="rule"
              data-rule-id={rule.id}
              className={cn(
                'group bg-card/80 relative flex items-center gap-4 rounded-xl border px-4 py-3 backdrop-blur-sm transition-[box-shadow,border-color,translate] duration-200',
                'hover:border-brand/40 hover:shadow-brand/10 hover:-translate-y-px hover:shadow-lg'
              )}
            >
              {/* gradient accent on the left edge of enabled rules */}
              <span
                aria-hidden
                className={cn(
                  'bg-brand-gradient absolute inset-y-3 left-0 w-[3px] rounded-full transition-opacity duration-300',
                  rule.enabled ? 'opacity-100' : 'opacity-0'
                )}
              />
              <Switch checked={rule.enabled} onCheckedChange={(v) => onToggle(rule, v)} aria-label={`Enable ${rule.name}`} />

              <button
                type="button"
                data-testid="edit-rule"
                onClick={() => onEdit(rule)}
                className={cn('min-w-0 flex-1 cursor-pointer text-left outline-none transition-opacity duration-300', !rule.enabled && 'opacity-45')}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{rule.name}</span>
                  {rule.autoSubmit && <Zap className="text-brand size-3.5 shrink-0 fill-current/15" aria-label="Auto-submit" />}
                  {remote && <Globe className="text-muted-foreground size-3.5 shrink-0" aria-label="Remote site" />}
                </div>
                <div className="text-muted-foreground truncate font-mono text-xs">{rule.urlPattern}</div>
              </button>

              {needsAccess && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-warning-border text-warning animate-pop"
                  data-testid="access-needed"
                  onClick={() => onGrant(origin)}
                >
                  Grant access
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                    aria-label={`More actions for ${rule.name}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onSelect={() => onDuplicate(rule)}>
                    <Copy /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index, -1)}>
                    <ArrowUp /> Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={index === rules.length - 1} onSelect={() => onMove(index, 1)}>
                    <ArrowDown /> Move down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(rule)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
