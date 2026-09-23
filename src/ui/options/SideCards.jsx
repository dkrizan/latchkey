import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AL } from '@/lib/ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function TestUrlCard({ rules }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const results = evaluate(rules, url, title);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test a URL</CardTitle>
        <CardDescription>See which rule would apply, without opening the page.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="test-url">URL</Label>
          <Input id="test-url" type="url" className="font-mono text-[13px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3000/login" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="test-title">
            Page title <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id="test-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My App" />
        </div>
        {results && (
          <ul className="grid gap-2 border-t pt-4 text-sm" data-testid="test-results">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-2" data-testid="test-result" data-status={r.status}>
                <Badge variant={r.variant}>{r.label}</Badge>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                {r.note && <span className="text-muted-foreground truncate font-mono text-xs">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function evaluate(rules, url, title) {
  if (!url.trim()) return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return [{ status: 'invalid', label: 'Invalid URL', variant: 'warning', text: 'Enter a full URL including http:// or https://' }];
  }
  if (!AL.isSecureEnough(parsed.href)) {
    return [{ status: 'insecure', label: 'Skipped', variant: 'warning', text: 'Plain HTTP on a non-local host is never filled.' }];
  }
  const doc = { title, querySelector: () => null };
  let winner = null;
  const out = [];
  for (const rule of rules) {
    if (!AL.matchesUrl(rule.urlPattern, parsed.href)) continue;
    const titleOk = AL.evaluateDetection({ ...rule, detect: { ...rule.detect, selector: '' } }, doc).ok;
    let r;
    if (!rule.enabled) r = { status: 'disabled', label: 'Disabled', variant: 'muted' };
    else if (rule.detect.title && !titleOk) r = { status: 'title', label: 'Title mismatch', variant: 'warning' };
    else if (!winner) {
      winner = rule;
      r = { status: 'apply', label: 'Would apply', variant: 'brand' };
    } else r = { status: 'shadowed', label: 'Shadowed', variant: 'muted' };
    out.push({ ...r, text: rule.name, note: rule.detect.selector ? `+ ${rule.detect.selector}` : null });
  }
  return out.length ? out : [{ status: 'none', label: 'No match', variant: 'muted', text: 'No rule matches this URL.' }];
}

export function BehaviorCard({ state, save }) {
  const fileRef = useRef(null);
  const s = state.settings;

  const setSetting = async (key, value) => {
    await save({ ...state, settings: { ...s, [key]: value } });
  };
  const setNumber = (key, min, max) => async (e) => {
    const n = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0)));
    e.target.value = n;
    if (n !== s[key]) {
      await setSetting(key, n);
      toast.success('Saved');
    }
  };

  const exportRules = () => {
    const blob = new Blob([AL.exportState(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `autologin-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported', { description: 'The file contains passwords in plain text.' });
  };

  const importRules = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = AL.importState(await file.text(), state);
      await save(next);
      toast.success(`Imported ${next.rules.length - state.rules.length} rule(s)`, { description: 'Grant access for remote rules from the list.' });
    } catch (err) {
      toast.error('Import failed', { description: err.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Behavior</CardTitle>
        <CardDescription>Applies to all rules.</CardDescription>
      </CardHeader>
      <CardContent className="grid divide-y">
        <Row title="On-page notifications" description="A small toast after filling, with Cancel before auto-submit." htmlFor="set-toast">
          <Switch id="set-toast" checked={s.showToast} onCheckedChange={(v) => setSetting('showToast', v)} />
        </Row>
        <Row title="Delay before auto-submit" description="Time to press Esc or Cancel." htmlFor="set-delay">
          <Suffix unit="ms">
            <Input id="set-delay" key={s.submitDelayMs} type="number" min={0} max={10000} step={100} defaultValue={s.submitDelayMs} onBlur={setNumber('submitDelayMs', 0, 10000)} className="w-24 text-right" />
          </Suffix>
        </Row>
        <Row title="Loop protection" description="Stop auto-submitting after this many submits within the window." htmlFor="set-attempts">
          <div className="flex items-center gap-2">
            <Suffix unit="×">
              <Input id="set-attempts" key={s.maxAttempts} type="number" min={1} max={20} defaultValue={s.maxAttempts} onBlur={setNumber('maxAttempts', 1, 20)} className="w-16 text-right" />
            </Suffix>
            <Suffix unit="s">
              <Input id="set-window" key={s.attemptWindowSec} type="number" min={5} max={3600} defaultValue={s.attemptWindowSec} onBlur={setNumber('attemptWindowSec', 5, 3600)} className="w-20 text-right" />
            </Suffix>
          </div>
        </Row>
        <Row title="Backup" description="Exports include passwords in plain text.">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportRules}>
              <Download /> Export
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload /> Import
            </Button>
            <input ref={fileRef} id="import-file" type="file" accept="application/json,.json" className="hidden" onChange={importRules} />
          </div>
        </Row>
      </CardContent>
    </Card>
  );
}

function Row({ title, description, htmlFor, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="grid gap-0.5">
        <Label htmlFor={htmlFor} className="font-medium">
          {title}
        </Label>
        <p className="text-muted-foreground text-[13px]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Suffix({ unit, children }) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <span className="text-muted-foreground w-3 text-xs">{unit}</span>
    </div>
  );
}
