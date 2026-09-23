import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, CircleAlert, Eye, EyeOff, LockOpen, Send, TriangleAlert } from 'lucide-react';
import { AL, isValidSelector } from '@/lib/ext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * Side sheet for creating and editing a rule.
 * `onSave(rule)` is called synchronously from the submit handler so the caller can
 * request host permissions while the user gesture is still active.
 */
export function RuleEditor({ open, rule, isNew, access, onOpenChange, onSave, onDelete }) {
  const [draft, setDraft] = useState(rule);
  const [showPassword, setShowPassword] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [urlFocused, setUrlFocused] = useState(false);
  const pointerDown = useRef(false);

  // The URL helper pushes the form down. Collapsing it on blur mid-click would move the
  // element under the pointer, so wait for the click to finish before hiding it.
  useEffect(() => {
    const down = () => (pointerDown.current = true);
    const up = () => (pointerDown.current = false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
    };
  }, []);
  const hideUrlHelp = () => {
    if (!pointerDown.current) return setUrlFocused(false);
    window.addEventListener('pointerup', () => setTimeout(() => setUrlFocused(false)), { once: true });
  };

  useEffect(() => {
    if (!open || !rule) return;
    setDraft(rule);
    setShowPassword(false);
    setSubmitted(false);
    setAdvancedOpen(Boolean(rule.usernameSelector || rule.passwordSelector || rule.submitSelector));
  }, [open, rule]);

  const validation = useMemo(() => (draft ? AL.validateRule(draft, isValidSelector) : { ok: false, errors: [], warnings: [] }), [draft]);
  if (!draft) return null;

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setDetect = (patch) => setDraft((d) => ({ ...d, detect: { ...d.detect, ...patch } }));

  const parsed = AL.parseUrlPattern(draft.urlPattern);
  const origin = parsed.ok ? AL.permissionOrigin(draft.urlPattern) : null;
  const remote = parsed.ok && !AL.isLocalPattern(draft.urlPattern);
  const bothConditions = Boolean(draft.detect.title && draft.detect.selector);

  // Show "missing field" errors only after a save attempt; everything else live.
  const errors = validation.errors.filter((e) => submitted || !/required|Enter a username/.test(e));

  const submit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!validation.ok) return;
    onSave({ ...draft, updatedAt: Date.now() });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md" data-testid="rule-editor">
        <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="flex-row items-center justify-between gap-4 pt-6 pr-14 pb-2 pl-6">
            <SheetTitle className="text-lg">{isNew ? 'New rule' : 'Edit rule'}</SheetTitle>
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 transition-colors',
                draft.enabled ? 'border-transparent' : 'border-warning-border bg-warning-soft'
              )}
            >
              <Label htmlFor="f-enabled" className={cn('font-normal', draft.enabled ? 'text-muted-foreground' : 'text-warning font-medium')}>
                {draft.enabled ? 'Enabled' : 'Disabled'}
              </Label>
              <Switch id="f-enabled" checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v })} />
            </div>
            <SheetDescription className="sr-only">URL, page detection and credentials</SheetDescription>
          </SheetHeader>

          <div key={draft.id} className="stagger-in grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-4">
            <Field id="f-name" label="Name">
              <Input id="f-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>

            <Field id="f-url" label="URL">
              <div>
                <Input
                  id="f-url"
                  className="font-mono text-[13px]"
                  spellCheck={false}
                  value={draft.urlPattern}
                  aria-invalid={(Boolean(draft.urlPattern) && !parsed.ok) || undefined}
                  onChange={(e) => set({ urlPattern: e.target.value.trim() })}
                  onFocus={() => setUrlFocused(true)}
                  onBlur={hideUrlHelp}
                  aria-describedby={urlFocused ? 'f-url-help' : undefined}
                  placeholder="http://localhost:3000-3999/login*"
                />
                <AnimatePresence initial={false}>{urlFocused && <UrlHelp />}</AnimatePresence>
              </div>
              {remote && (
                <p className="text-muted-foreground text-xs" data-testid="url-derived">
                  {access[origin] ? 'Access granted to ' : 'Asks for access to '}
                  <span className="font-mono">{origin}</span>
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field id="f-user" label="Username">
                <Input id="f-user" autoComplete="off" spellCheck={false} value={draft.username} onChange={(e) => set({ username: e.target.value })} />
              </Field>
              <Field
                id="f-pass"
                label={
                  <>
                    Password
                    <LockOpen className="text-muted-foreground size-3.5" aria-label="Stored unencrypted" />
                  </>
                }
                title="Stored unencrypted"
              >
                <div className="relative">
                  <Input
                    id="f-pass"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="pr-9"
                    value={draft.password}
                    onChange={(e) => set({ password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer [&_svg]:size-4"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </Field>
            </div>

            <div
              className={cn(
                'flex items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors',
                draft.autoSubmit ? 'border-primary/50 bg-primary/10' : 'bg-muted/40'
              )}
            >
              <div className="flex items-center gap-3">
                <Send className={cn('size-4 shrink-0', draft.autoSubmit ? 'text-foreground' : 'text-muted-foreground')} />
                <div className="grid gap-0.5">
                  <Label htmlFor="f-auto">Submit automatically</Label>
                  <p className="text-muted-foreground text-xs">Log in right after filling</p>
                </div>
              </div>
              <Switch id="f-auto" checked={draft.autoSubmit} onCheckedChange={(v) => set({ autoSubmit: v })} />
            </div>

            <fieldset className="grid gap-3 rounded-lg border p-4">
              <legend className="-ml-1 px-1 text-sm">
                Page detection <span className="text-muted-foreground">(optional)</span>
              </legend>
              <Field id="f-title" label="Title contains">
                <Input id="f-title" value={draft.detect.title} onChange={(e) => setDetect({ title: e.target.value })} spellCheck={false} />
              </Field>
              <div className={cn('flex items-center gap-3 transition-opacity', !bothConditions && 'opacity-40')}>
                <Separator className="flex-1" />
                <ToggleGroup
                  type="single"
                  value={draft.detect.mode || 'all'}
                  onValueChange={(v) => v && setDetect({ mode: v })}
                  disabled={!bothConditions}
                  aria-label="Combine conditions"
                  title={bothConditions ? undefined : 'Fill in both conditions to combine them'}
                >
                  <ToggleGroupItem value="all" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7 px-3 text-xs data-[disabled]:pointer-events-none">
                    AND
                  </ToggleGroupItem>
                  <ToggleGroupItem value="any" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7 px-3 text-xs data-[disabled]:pointer-events-none">
                    OR
                  </ToggleGroupItem>
                </ToggleGroup>
                <Separator className="flex-1" />
              </div>
              <Field id="f-selector" label="Element exists">
                <Input id="f-selector" className="font-mono text-[13px]" value={draft.detect.selector} onChange={(e) => setDetect({ selector: e.target.value })} spellCheck={false} />
              </Field>
            </fieldset>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-sm" data-testid="advanced-toggle">
                  <ChevronRight className={cn('size-4 transition-transform', advancedOpen && 'rotate-90')} />
                  Selectors
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-3 pt-3">
                <Selector id="f-usel" label="Username" value={draft.usernameSelector} onChange={(v) => set({ usernameSelector: v })} />
                <Selector id="f-psel" label="Password" value={draft.passwordSelector} onChange={(v) => set({ passwordSelector: v })} />
                <Selector id="f-ssel" label="Submit" value={draft.submitSelector} onChange={(v) => set({ submitSelector: v })} />
              </CollapsibleContent>
            </Collapsible>

            {(errors.length > 0 || validation.warnings.length > 0) && (
              <ul className="grid gap-1.5 text-xs" data-testid="validation" aria-live="polite">
                {errors.map((e) => (
                  <li key={e} className="text-destructive flex gap-1.5">
                    <CircleAlert className="mt-px size-3.5 shrink-0" />
                    {e}
                  </li>
                ))}
                {validation.warnings.map((w) => (
                  <li key={w} className="text-warning flex gap-1.5">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <SheetFooter className="flex-row items-center border-t px-6 py-4">
            {!isNew && (
              <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive -ml-3" onClick={() => onDelete(draft)}>
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="ghost" id="cancel-edit" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" id="save-rule">
              Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ id, label, optional, title, className, children }) {
  return (
    <div className={cn('grid min-w-0 gap-2', className)} title={title}>
      <Label htmlFor={id} className="font-normal">
        {label}
        {optional && <span className="text-muted-foreground">(optional)</span>}
      </Label>
      {children}
    </div>
  );
}

const URL_EXAMPLES = [
  ['http://localhost:3000/login*', 'Exact port, /login…'],
  ['http://localhost/*', 'Any port'],
  ['http://localhost:3000-3999/*', 'Port range'],
  ['http://localhost:3*/*', 'Ports starting with 3'],
  ['*://127.0.0.1:8080/*', 'http or https'],
  ['https://*.example.com/*', 'Domain + subdomains'],
];

function UrlHelp() {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="overflow-hidden"
    >
      <div id="f-url-help" className="bg-muted/40 mt-2 grid gap-2 rounded-md border p-3 text-xs" data-testid="url-help">
        <p className="text-muted-foreground font-mono">scheme://host[:port]/path</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {URL_EXAMPLES.map(([pattern, meaning]) => (
            <div key={pattern} className="contents">
              <dt className="font-mono">{pattern}</dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </motion.div>
  );
}

function Selector({ id, label, value, onChange }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
      <Label htmlFor={id} className="text-muted-foreground font-normal">
        {label}
      </Label>
      <Input id={id} className="h-8 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} placeholder="auto" spellCheck={false} />
    </div>
  );
}
