import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, CircleAlert, Eye, EyeOff, LockOpen, TriangleAlert } from 'lucide-react';
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
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle className="text-lg">{isNew ? 'New rule' : 'Edit rule'}</SheetTitle>
            <SheetDescription className="sr-only">URL, page detection and credentials</SheetDescription>
          </SheetHeader>

          <div key={draft.id} className="stagger-in grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-4">
            <Field id="f-name" label="Name">
              <Input id="f-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>

            <Field id="f-url" label="URL">
              <Input
                id="f-url"
                className="font-mono text-[13px]"
                spellCheck={false}
                value={draft.urlPattern}
                aria-invalid={(Boolean(draft.urlPattern) && !parsed.ok) || undefined}
                onChange={(e) => set({ urlPattern: e.target.value.trim() })}
                placeholder="http://localhost:3000/login*"
              />
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

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <Field id="f-title" label="Title contains" optional>
                <Input id="f-title" value={draft.detect.title} onChange={(e) => setDetect({ title: e.target.value })} spellCheck={false} />
              </Field>
              <Field id="f-selector" label="Element exists" optional>
                <Input id="f-selector" className="font-mono text-[13px]" value={draft.detect.selector} onChange={(e) => setDetect({ selector: e.target.value })} spellCheck={false} />
              </Field>
            </div>
            {bothConditions && (
              <ToggleGroup type="single" value={draft.detect.mode || 'all'} onValueChange={(v) => v && setDetect({ mode: v })} aria-label="Match mode" className="-mt-2">
                <ToggleGroupItem value="all">Both</ToggleGroupItem>
                <ToggleGroupItem value="any">Either</ToggleGroupItem>
              </ToggleGroup>
            )}

            <Separator />

            <SwitchRow id="f-auto" label="Submit automatically" checked={draft.autoSubmit} onChange={(v) => set({ autoSubmit: v })} />
            <SwitchRow id="f-enabled" label="Enabled" checked={draft.enabled} onChange={(v) => set({ enabled: v })} />

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

function Field({ id, label, optional, title, children }) {
  return (
    <div className="grid min-w-0 gap-2" title={title}>
      <Label htmlFor={id} className="font-normal">
        {label}
        {optional && <span className="text-muted-foreground">(optional)</span>}
      </Label>
      {children}
    </div>
  );
}

function SwitchRow({ id, label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
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
