import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleAlert, FileText, Plus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { AL, api, useExtensionState, useHostAccess } from '@/lib/ext';
import { Logo } from '@/components/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { RuleEditor } from './RuleEditor';
import { RuleList } from './RuleList';
import { BehaviorCard, TestUrlCard } from './SideCards';

export function OptionsApp() {
  const [state, save] = useExtensionState();
  const [access, refreshAccess] = useHostAccess(state?.rules);
  const [editor, setEditor] = useState({ open: false, rule: null, isNew: false });
  const [pendingDelete, setPendingDelete] = useState(null);
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
        ok ? toast.success('Access granted', { description: [].concat(origins).join(', ') }) : toast.error('Access was not granted');
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
      granted ? toast.success(editor.isNew ? 'Rule added' : 'Rule saved') : toast.warning('Rule saved without site access', { description: 'Grant access from the rule list to activate it.' });
    });
  };

  const onDelete = async (rule) => {
    const rules = state.rules.filter((r) => r.id !== rule.id);
    await update(rules);
    await removeOrphanPermission(AL.permissionOrigin(rule.urlPattern), rules);
    await refreshAccess();
    setPendingDelete(null);
    setEditor((e) => ({ ...e, open: false }));
    toast('Rule deleted', { description: rule.name });
  };

  const onDuplicate = async (rule) => {
    const copy = AL.createRule({ ...rule, id: undefined, createdAt: undefined, name: `${rule.name} (copy)` });
    const i = state.rules.findIndex((r) => r.id === rule.id);
    await update([...state.rules.slice(0, i + 1), copy, ...state.rules.slice(i + 1)]);
    toast.success('Rule duplicated');
  };

  const onMove = async (index, delta) => {
    const rules = [...state.rules];
    const [r] = rules.splice(index, 1);
    rules.splice(index + delta, 0, r);
    await update(rules);
  };

  const onToggle = (rule, enabled) => update(state.rules.map((r) => (r.id === rule.id ? { ...r, enabled, updatedAt: Date.now() } : r)));

  return (
    <div className="min-h-screen">
      <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-6">
          <Logo />
          <h1 className="font-semibold tracking-tight">AutoLogin Rules</h1>
          <Badge variant="outline" className="text-muted-foreground font-mono font-normal" data-testid="version">
            v{api.runtime.getManifest().version}
          </Badge>
          <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-2.5 text-sm" htmlFor="global-enabled">
            <span data-testid="global-label">{state.settings.enabled ? 'Enabled' : 'Paused'}</span>
            <Switch id="global-enabled" checked={state.settings.enabled} onCheckedChange={(enabled) => save({ ...state, settings: { ...state.settings, enabled } })} />
          </label>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 text-sm">
        {!localOk && (
          <Alert variant="destructive" className="items-center" data-testid="local-access-notice">
            <CircleAlert />
            <AlertTitle>Localhost access is not granted</AlertTitle>
            <AlertDescription>Your browser declined access to localhost at install time, so local rules cannot run.</AlertDescription>
            <Button size="sm" variant="outline" className="col-start-2 mt-2 w-fit" onClick={() => grant(AL.LOCAL_ORIGINS.slice())}>
              Grant access
            </Button>
          </Alert>
        )}

        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Credentials are stored in plain text</AlertTitle>
          <AlertDescription>
            Rules are saved unencrypted in this browser profile and included as-is in exports. Use development, test and staging accounts, not
            personal or production passwords. Encryption with a master password is planned.
          </AlertDescription>
        </Alert>

        <Card className="gap-0 pb-0">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Rules</CardTitle>
            <CardDescription>The first enabled rule that matches the URL and page detection is used. Order matters.</CardDescription>
            <CardAction className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="template-btn">
                    Template <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Start from a template</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {AL.TEMPLATES.map((t) => (
                    <DropdownMenuItem key={t.key} className="items-start" onSelect={() => openEditor(AL.createRule({ ...t.rule, id: undefined }), true)}>
                      <FileText className="mt-0.5" />
                      <div className="grid gap-0.5">
                        <span>{t.label}</span>
                        <span className="text-muted-foreground font-mono text-xs">{t.rule.urlPattern}</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" data-testid="add-rule" onClick={() => openEditor(AL.createRule({ urlPattern: 'http://localhost:3000/login*' }), true)}>
                <Plus /> Add rule
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {state.rules.length ? (
              <RuleList
                rules={state.rules}
                access={access}
                onToggle={onToggle}
                onEdit={(r) => openEditor(r)}
                onDuplicate={onDuplicate}
                onMove={onMove}
                onDelete={setPendingDelete}
                onGrant={grant}
              />
            ) : (
              <div className="grid place-items-center gap-2 px-6 py-14 text-center" data-testid="empty">
                <Logo className="size-10 rounded-lg" iconClassName="size-5" />
                <p className="mt-2 font-medium">No rules yet</p>
                <p className="text-muted-foreground max-w-sm text-sm">
                  Add the URL of a login page and the credentials to use. Start from a template if you are unsure.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <TestUrlCard rules={state.rules} />
          <BehaviorCard state={state} save={save} />
        </div>

        <p className="text-muted-foreground pt-2 text-center text-xs">
          Runs only on <code className="font-mono">localhost</code>, <code className="font-mono">127.0.0.1</code> and sites you explicitly grant.
          Nothing leaves your browser.
        </p>
      </main>

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
            <AlertDialogDescription>The rule and its stored credentials are removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="confirm-delete" onClick={() => onDelete(pendingDelete)}>
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
