import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { CircleAlert, LockOpen, Pause, Play, Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { AL, api, useExtensionState, useHostAccess } from '@/lib/ext';
import { Backdrop } from '@/components/backdrop';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalToggle } from '@/components/global-toggle';
import { RuleEditor } from './RuleEditor';
import { RuleList } from './RuleList';
import { SettingsSheet } from './SettingsSheet';

export function OptionsApp() {
  const [state, save] = useExtensionState();
  const [access, refreshAccess] = useHostAccess(state?.rules);
  const [editor, setEditor] = useState({ open: false, rule: null, isNew: false });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const addTemplate = (t) => openEditor(AL.createRule({ ...t, id: undefined }), true);

  return (
    <MotionConfig reducedMotion="user">
      <Backdrop />
      <header className="mx-auto flex h-20 max-w-3xl items-center gap-3 px-6">
        <Logo />
        <h1 className="text-lg font-semibold tracking-tight">
          Latch<span className="text-brand-gradient">key</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {/* When paused, the banner below carries the status and the Resume button. */}
          {state.settings.enabled && <GlobalToggle enabled onChange={(enabled) => save({ ...state, settings: { ...state.settings, enabled } })} />}
          <Button
            size="icon-sm"
            variant="ghost"
            className="group/settings text-muted-foreground"
            aria-label="Settings"
            data-testid="open-settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="transition-transform duration-500 group-hover/settings:rotate-90" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="group/new ml-1" data-testid="add-rule">
                <Plus className="transition-transform duration-300 group-hover/new:rotate-90" /> New rule
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
      </header>

      <main className="mx-auto grid max-w-3xl gap-4 px-6 pb-12 text-sm">
        <AnimatePresence>
          {!state.settings.enabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
              data-testid="global-label"
            >
              <div className="border-warning-border bg-warning-soft flex items-center gap-3 rounded-xl border px-4 py-3">
                <div className="bg-warning/15 text-warning grid size-9 shrink-0 place-items-center rounded-full">
                  <Pause className="size-4 fill-current" />
                </div>
                <div className="grid flex-1 gap-0.5">
                  <p className="text-warning font-semibold">All rules are paused</p>
                  <p className="text-muted-foreground text-xs">Nothing is filled or submitted until you resume.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => save({ ...state, settings: { ...state.settings, enabled: true } })}>
                  <Play className="fill-current" /> Resume
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!localOk && (
          <div className="border-destructive/30 text-destructive bg-card flex items-center gap-3 rounded-xl border px-4 py-2.5" data-testid="local-access-notice">
            <CircleAlert className="size-4 shrink-0" />
            <span className="flex-1">No access to localhost.</span>
            <Button size="sm" variant="outline" onClick={() => grant(AL.LOCAL_ORIGINS.slice())}>
              Grant
            </Button>
          </div>
        )}

        {state.rules.length ? (
          <div className={cn('transition-opacity duration-300', !state.settings.enabled && 'opacity-50')}>
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
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/70 grid place-items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center backdrop-blur-sm"
            data-testid="empty"
          >
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
              <Logo className="size-11 rounded-xl" />
            </motion.div>
            <p className="text-muted-foreground">No rules yet.</p>
          </motion.div>
        )}

        <p className="text-muted-foreground flex items-center justify-center gap-1.5 pt-3 text-xs" data-testid="plaintext-note">
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
    </MotionConfig>
  );
}

