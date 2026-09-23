import { ArrowDown, ArrowUp, Copy, Globe, MoreHorizontal, Trash2, Zap } from 'lucide-react';
import { AL } from '@/lib/ext';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * @param {object} props
 * @param {Record<string, 'apply'|'match'|'title'>} [props.test] Result of the URL test, by rule id.
 */
export function RuleList({ rules, access, test, onToggle, onEdit, onDuplicate, onMove, onDelete, onGrant }) {
  return (
    <ul className="divide-y">
      {rules.map((rule, index) => {
        const origin = AL.permissionOrigin(rule.urlPattern);
        const remote = !AL.isLocalPattern(rule.urlPattern);
        const needsAccess = Boolean(origin) && access[origin] === false;
        const result = test?.[rule.id];
        const dimmed = !rule.enabled || (test && !result);

        return (
          <li
            key={rule.id}
            data-testid="rule"
            data-rule-id={rule.id}
            data-test-result={result || undefined}
            className="hover:bg-muted/40 group flex items-center gap-4 px-5 py-3 transition-colors"
          >
            <Switch checked={rule.enabled} onCheckedChange={(v) => onToggle(rule, v)} aria-label={`Enable ${rule.name}`} />

            <button
              type="button"
              data-testid="edit-rule"
              onClick={() => onEdit(rule)}
              className={cn('min-w-0 flex-1 cursor-pointer text-left outline-none', dimmed && 'opacity-45')}
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{rule.name}</span>
                {rule.autoSubmit && <Zap className="text-brand-soft-foreground size-3.5 shrink-0" aria-label="Auto-submit" />}
                {remote && <Globe className="text-muted-foreground size-3.5 shrink-0" aria-label="Remote site" />}
              </div>
              <div className="text-muted-foreground truncate font-mono text-xs">{rule.urlPattern}</div>
            </button>

            {result === 'apply' && <Badge variant="brand">Applies</Badge>}
            {result === 'title' && <Badge variant="muted">Title differs</Badge>}
            {result === 'match' && <Badge variant="muted">Shadowed</Badge>}

            {needsAccess && (
              <Button size="sm" variant="outline" className="border-warning-border text-warning" data-testid="access-needed" onClick={() => onGrant(origin)}>
                Grant access
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
          </li>
        );
      })}
    </ul>
  );
}
