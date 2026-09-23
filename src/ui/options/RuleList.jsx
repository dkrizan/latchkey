import { ArrowDown, ArrowUp, Copy, Globe, KeyRound, Laptop, MoreHorizontal, Pencil, ShieldAlert, Trash2, Zap } from 'lucide-react';
import { AL, detectionSummary } from '@/lib/ext';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function RuleList({ rules, access, onToggle, onEdit, onDuplicate, onMove, onDelete, onGrant }) {
  return (
    <ul className="divide-y">
      {rules.map((rule, index) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          index={index}
          count={rules.length}
          access={access}
          onToggle={onToggle}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onMove={onMove}
          onDelete={onDelete}
          onGrant={onGrant}
        />
      ))}
    </ul>
  );
}

function RuleRow({ rule, index, count, access, onToggle, onEdit, onDuplicate, onMove, onDelete, onGrant }) {
  const origin = AL.permissionOrigin(rule.urlPattern);
  const local = AL.isLocalPattern(rule.urlPattern);
  const needsAccess = Boolean(origin) && access[origin] === false;
  const detection = detectionSummary(rule);

  return (
    <li data-testid="rule" data-rule-id={rule.id} className="group flex items-center gap-4 px-6 py-4">
      <Switch checked={rule.enabled} onCheckedChange={(v) => onToggle(rule, v)} aria-label={`Enable ${rule.name}`} />

      <button
        type="button"
        onClick={() => onEdit(rule)}
        className={cn('min-w-0 flex-1 cursor-pointer text-left outline-none', !rule.enabled && 'opacity-50')}
      >
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium group-hover:underline group-hover:underline-offset-4">{rule.name}</span>
          <span className="text-muted-foreground text-xs tabular-nums">#{index + 1}</span>
        </div>
        <div className="text-muted-foreground mt-0.5 truncate font-mono text-[13px]">{rule.urlPattern}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline">
            {local ? <Laptop /> : <Globe />}
            {local ? 'Local' : 'Remote'}
          </Badge>
          {rule.autoSubmit ? (
            <Badge variant="brand">
              <Zap />
              Auto-submit
            </Badge>
          ) : (
            <Badge variant="muted">Fill only</Badge>
          )}
          {rule.username && (
            <Badge variant="muted">
              <KeyRound />
              {rule.username}
            </Badge>
          )}
          <Badge variant="muted" className="font-mono font-normal">
            {detection || 'URL only'}
          </Badge>
          {needsAccess && (
            <Badge variant="warning" data-testid="access-needed">
              <ShieldAlert />
              Access needed
            </Badge>
          )}
        </div>
      </button>

      {needsAccess && (
        <Button size="sm" variant="outline" onClick={() => onGrant(origin)}>
          Grant access
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => onEdit(rule)} data-testid="edit-rule">
        Edit
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${rule.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onEdit(rule)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDuplicate(rule)}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index, -1)}>
            <ArrowUp /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(index, 1)}>
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
}
