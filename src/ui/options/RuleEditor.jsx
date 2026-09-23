import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Eye, EyeOff, Globe, Laptop, Lock, TriangleAlert, CircleAlert } from 'lucide-react';
import { AL, isValidSelector } from '@/lib/ext';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
  const local = parsed.ok && AL.isLocalPattern(draft.urlPattern);
  const urlInvalid = Boolean(draft.urlPattern) && !parsed.ok;

  const submit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!validation.ok) return;
    onSave({ ...draft, updatedAt: Date.now() });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[560px]" data-testid="rule-editor">
        <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle className="text-lg">{isNew ? 'New rule' : 'Edit rule'}</SheetTitle>
            <SheetDescription>Where to log in, how to recognise the page, and what to fill in.</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <Section title="Where">
              <Field id="f-name" label="Name">
                <Input id="f-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="My app (local)" />
              </Field>
              <Field
                id="f-url"
                label="URL pattern"
                hint={
                  <>
                    <code className="font-mono">*</code> is a wildcard. Leave out the port to match any port.
                  </>
                }
              >
                <Input
                  id="f-url"
                  className="font-mono text-[13px]"
                  spellCheck={false}
                  value={draft.urlPattern}
                  aria-invalid={urlInvalid || undefined}
                  onChange={(e) => set({ urlPattern: e.target.value.trim() })}
                  placeholder="http://localhost:3000/login*"
                />
                {parsed.ok && (
                  <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 pt-1 text-xs" data-testid="url-derived">
                    <Badge variant="outline">
                      {local ? <Laptop /> : <Globe />}
                      {local ? 'Local' : 'Remote'}
                    </Badge>
                    {local ? (
                      <span>Always allowed.</span>
                    ) : (
                      <>
                        <span>Needs access to</span>
                        <code className="text-foreground font-mono">{origin}</code>
                        {access[origin] ? <Badge variant="brand">granted</Badge> : <span>· you will be asked on save</span>}
                      </>
                    )}
                  </div>
                )}
              </Field>
            </Section>

            <Separator className="my-6" />

            <Section title="Detect the page" description="Optional. Tells apart apps that share a host, e.g. several projects on localhost.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="f-title" label="Page title contains">
                  <Input id="f-title" value={draft.detect.title} onChange={(e) => setDetect({ title: e.target.value })} placeholder="my app  ·  /^My App/i" spellCheck={false} />
                </Field>
                <Field id="f-selector" label="Element exists">
                  <Input id="f-selector" className="font-mono text-[13px]" value={draft.detect.selector} onChange={(e) => setDetect({ selector: e.target.value })} placeholder='[data-app="my-app"]' spellCheck={false} />
                </Field>
              </div>
              <ToggleGroup
                type="single"
                value={draft.detect.mode || 'all'}
                onValueChange={(v) => v && setDetect({ mode: v })}
                aria-label="Match mode"
              >
                <ToggleGroupItem value="all">All conditions</ToggleGroupItem>
                <ToggleGroupItem value="any">Any condition</ToggleGroupItem>
              </ToggleGroup>
            </Section>

            <Separator className="my-6" />

            <Section title="Credentials">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="f-user" label="Username or e-mail">
                  <Input id="f-user" autoComplete="off" spellCheck={false} value={draft.username} onChange={(e) => set({ username: e.target.value })} />
                </Field>
                <Field id="f-pass" label="Password">
                  <div className="relative">
                    <Input
                      id="f-pass"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      spellCheck={false}
                      className="pr-10"
                      value={draft.password}
                      onChange={(e) => set({ password: e.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground absolute top-1/2 right-0.5 -translate-y-1/2"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </Field>
              </div>
              <p className="text-warning flex items-center gap-1.5 text-xs">
                <Lock className="size-3.5" /> Stored unencrypted in this browser. Use dev and test accounts only.
              </p>
            </Section>

            <Separator className="my-6" />

            <Section title="After filling">
              <label className="flex cursor-pointer items-start justify-between gap-4" htmlFor="f-auto">
                <div className="grid gap-1">
                  <span className="text-sm font-medium">Submit automatically</span>
                  <span className="text-muted-foreground text-sm">Clicks the submit button after a short, cancellable countdown.</span>
                </div>
                <Switch id="f-auto" name="autoSubmit" checked={draft.autoSubmit} onCheckedChange={(v) => set({ autoSubmit: v })} />
              </label>
              <label className="flex cursor-pointer items-start justify-between gap-4" htmlFor="f-enabled">
                <div className="grid gap-1">
                  <span className="text-sm font-medium">Rule enabled</span>
                  <span className="text-muted-foreground text-sm">Disabled rules are kept but never applied.</span>
                </div>
                <Switch id="f-enabled" checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v })} />
              </label>
            </Section>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-6 rounded-lg border">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm font-medium" data-testid="advanced-toggle">
                  <ChevronRight className={cn('text-muted-foreground size-4 transition-transform', advancedOpen && 'rotate-90')} />
                  Form fields
                  <span className="text-muted-foreground font-normal">· auto-detected when empty</span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4 border-t px-4 py-4">
                <Field id="f-usel" label="Username field selector">
                  <Input id="f-usel" className="font-mono text-[13px]" value={draft.usernameSelector} onChange={(e) => set({ usernameSelector: e.target.value })} placeholder='auto  ·  input[name="email"]' spellCheck={false} />
                </Field>
                <Field id="f-psel" label="Password field selector">
                  <Input id="f-psel" className="font-mono text-[13px]" value={draft.passwordSelector} onChange={(e) => set({ passwordSelector: e.target.value })} placeholder='auto  ·  first visible input[type="password"]' spellCheck={false} />
                </Field>
                <Field id="f-ssel" label="Submit button selector">
                  <Input id="f-ssel" className="font-mono text-[13px]" value={draft.submitSelector} onChange={(e) => set({ submitSelector: e.target.value })} placeholder="auto  ·  the form's submit button" spellCheck={false} />
                </Field>
              </CollapsibleContent>
            </Collapsible>

            <div className="mt-6 grid gap-2" data-testid="validation" aria-live="polite">
              {(submitted || draft.urlPattern) &&
                validation.errors
                  .filter((e) => submitted || !/required|Enter a username/.test(e))
                  .map((e) => (
                    <Alert key={e} variant="destructive" className="py-2.5">
                      <CircleAlert />
                      <AlertDescription>{e}</AlertDescription>
                    </Alert>
                  ))}
              {validation.warnings.map((w) => (
                <Alert key={w} variant="warning" className="py-2.5">
                  <TriangleAlert />
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}
            </div>
          </div>

          <SheetFooter className="flex-row items-center border-t px-6 py-4">
            {!isNew && (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive -ml-3" onClick={() => onDelete(draft)}>
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="outline" id="cancel-edit" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" id="save-rule">
              Save rule
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{title}</h3>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
