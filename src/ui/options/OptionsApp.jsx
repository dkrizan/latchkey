import { useEffect, useRef, useState } from 'react';
import { CircleAlert, LockOpen, Plus, Search, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { AL, api, useExtensionState, useHostAccess } from '@/lib/ext';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { RuleEditor } from './RuleEditor';
import { RuleList } from './RuleList';
import { SettingsSheet } from './SettingsSheet';

export function OptionsApp() {
  const [state, save] = useExtensionState();
  const [access, refreshAccess] = useHostAccess(state?.rules);
  const [editor, setEditor] = useState({ open: false, rule: null, isNew: false });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const deepLinkHandled = useRef(false);

  // Deep links from the popup: ?new=<url> or ?edit=<ruleId>
  useEffect(() => {
    if (!state || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(location.search);
    if (params.get('edit')) {
      const rule = state.rules.find((r) => r.id === params.get('edit'));
      if (rule) openEditor(rule);
    } else if (params.get('new')) {
      try {
        const u = new URL(params.get('new'));
        const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') + '*' : '/*';
        openEditor(
          AL.createRule({ name: u.hostname, urlPattern: `${u.protocol}//${u.host}${path}`, detect: { title: '', selector: 'input[type="password"]', mode: 'all' } }),
          true
        );
      } catch {
        /* malformed deep link */
      }
    }
    if (params.size) history.replaceState(null, '', location.pathname);
  }, [state]);

  if (!state) return null;

  const localOk = AL.LOCAL_ORIGINS.every((o) => access[o] !== false);

  function openEditor(rule, isNew = false) {
    setEditor({ open: true, rule, isNew });
  }

  const update = (rules) => save({ ...state, rules });

  const grant = (origins) => {
    // Called straight from a click handler: permissions.request needs the user gesture.
    api.permissions
      .request({ origins: [].concat(origins) })
      .catch(() => false)
      .then(async (ok) => {
        await refreshAccess();
        ok ? toast.success('Access granted') : toast.error('Access not granted');
      });
  };

  const removeOrphanPermission = async (origin, rules) => {
    if (!origin || AL.isLocalPattern(origin)) return;
    if (!rules.some((r) => AL.permissionOrigin(r.urlPattern) === origin)) {
      await api.permissions.remove({ origins: [origin] }).catch(() => {});
    }
  };

  const onSave = (rule) => {
    const origin = AL.permissionOrigin(rule.urlPattern);
    const needsGrant = origin && !AL.isLocalPattern(rule.urlPattern) && !access[origin];
    const grantPromise = needsGrant ? api.permissions.request({ origins: [origin] }).catch(() => false) : Promise.resolve(true);

    grantPromise.then(async (granted) => {
      const previous = state.rules.find((r) => r.id === rule.id);
      const rules = previous ? state.rules.map((r) => (r.id === rule.id ? rule : r)) : [...state.rules, rule];
      await update(rules);
      if (previous) await removeOrphanPermission(AL.permissionOrigin(previous.urlPattern), rules);
      await refreshAccess();
      setEditor((e) => ({ ...e, open: false }));
      granted ? toast.success('Saved') : toast.warning('Saved without site access');
    });
  };

  const onDelete = async (rule) => {
    const rules = state.rules.filter((r) => r.id !== rule.id);
    await update(rules);
    await removeOrphanPermission(AL.permissionOrigin(rule.urlPattern), rules);
    await refreshAccess();
    setPendingDelete(null);
    setEditor((e) => ({ ...e, open: false }));
    toast('Deleted');
  };

  const onDuplicate = async (rule) => {
    const copy = AL.createRule({ ...rule, id: undefined, createdAt: undefined, name: `${rule.name} (copy)` });
    const i = state.rules.findIndex((r) => r.id === rule.id);
    await update([...state.rules.slice(0, i + 1), copy, ...state.rules.slice(i + 1)]);
    toast.success('Duplicated');
  };

  const onMove = async (index, delta) => {
    const rules = [...state.rules];
    const [r] = rules.splice(index, 1);
    rules.splice(index + delta, 0, r);
    await update(rules);
  };

  const onToggle = (rule, enabled) => update(state.rules.map((r) => (r.id === rule.id ? { ...r, enabled, updatedAt: Date.now() } : r)));

  const test = testUrl(state.rules, testInput);
  const addTemplate = (t) => openEditor(AL.createRule({ ...t, id: undefined }), true);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-6">
        <Logo />
        <h1 className="font-semibold tracking-tight">AutoLogin Rules</h1>
        <div className="ml-auto flex items-center gap-1">
          <Switch
            id="global-enabled"
            checked={state.settings.enabled}
            onCheckedChange={(enabled) => save({ ...state, settings: { ...state.settings, enabled } })}
            aria-label={state.settings.enabled ? 'Pause all rules' : 'Resume all rules'}
            title={state.settings.enabled ? 'Enabled' : 'Paused'}
            className="mr-2"
          />
          <Button size="icon-sm" variant="ghost" aria-label="Settings" data-testid="open-settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 />
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-3xl gap-4 px-6 pb-12 text-sm">
        {!state.settings.enabled && (
          <p className="text-muted-foreground text-center text-xs" data-testid="global-label">All rules are paused.</p>
        )}

        {!localOk && (
          <div className="border-destructive/30 text-destructive flex items-center gap-3 rounded-lg border px-4 py-2.5" data-testid="local-access-notice">
            <CircleAlert className="size-4 shrink-0" />
            <span className="flex-1">No access to localhost.</span>
            <Button size="sm" variant="outline" onClick={() => grant(AL.LOCAL_ORIGINS.slice())}>
              Grant
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="test-url"
              type="url"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Test a URL"
              className={cn('bg-background pl-9', testInput && 'font-mono text-[13px]')}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="add-rule">
                <Plus /> New rule
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem data-testid="add-blank" onSelect={() => addTemplate({ urlPattern: 'http://localhost:3000/login*' })}>
                <Plus /> Blank
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {AL.TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.key} onSelect={() => addTemplate(t.rule)}>
                  <div className="grid gap-0.5">
                    <span>{t.label}</span>
                    <span className="text-muted-foreground font-mono text-xs">{t.rule.urlPattern}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {test?.status === 'invalid' && <p className="text-muted-foreground px-1 text-xs">Enter a full URL, including http:// or https://</p>}
        {test?.status === 'insecure' && <p className="text-warning px-1 text-xs">Never filled: plain HTTP on a non-local host.</p>}
        {test?.status === 'none' && <p className="text-muted-foreground px-1 text-xs" data-testid="test-none">No rule matches.</p>}

        <div className="bg-card overflow-hidden rounded-xl border">
          {state.rules.length ? (
            <RuleList
              rules={state.rules}
              access={access}
              test={test?.byId}
              onToggle={onToggle}
              onEdit={(r) => openEditor(r)}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onDelete={setPendingDelete}
              onGrant={grant}
            />
          ) : (
            <p className="text-muted-foreground px-6 py-12 text-center" data-testid="empty">
              No rules yet.
            </p>
          )}
        </div>

        <p className="text-muted-foreground flex items-center justify-center gap-1.5 pt-2 text-xs" data-testid="plaintext-note">
          <LockOpen className="size-3.5" />
          Passwords are stored unencrypted. Use test accounts only.
        </p>
      </main>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} state={state} save={save} />

      <RuleEditor
        open={editor.open}
        rule={editor.rule}
        isNew={editor.isNew}
        access={access}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        onSave={onSave}
        onDelete={setPendingDelete}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="confirm-delete" onClick={() => onDelete(pendingDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Which rules would apply to a URL typed into the test box. Page title and elements are unknown here. */
function testUrl(rules, input) {
  const value = input.trim();
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return { status: 'invalid' };
  }
  if (!AL.isSecureEnough(url.href)) return { status: 'insecure' };
  const byId = {};
  let winner = false;
  for (const rule of rules) {
    if (!rule.enabled || !AL.matchesUrl(rule.urlPattern, url.href)) continue;
    byId[rule.id] = winner ? 'match' : 'apply';
    winner = true;
  }
  return winner ? { status: 'ok', byId } : { status: 'none', byId };
}
