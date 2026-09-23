import { useCallback, useEffect, useState } from 'react';
import { Check, Pause, Plus, RotateCw, Settings2, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { AL, api } from '@/lib/ext';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const CONTENT_FILES = ['lib/core.js', 'content/content.js'];

async function getTargetTab() {
  // ?tabId= lets tests and screenshots open the popup as a regular page.
  const forced = new URLSearchParams(location.search).get('tabId');
  if (forced) return api.tabs.get(Number(forced));
  const [active] = await api.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function askContent(tabId, message) {
  try {
    return await api.tabs.sendMessage(tabId, message);
  } catch {
    return null; // content script not injected on this page
  }
}

function openOptions(query) {
  api.tabs.create({ url: api.runtime.getURL('options.html') + (query ? '?' + query : '') });
  window.close();
}

export function PopupApp() {
  const [tab, setTab] = useState(null);
  const [state, setState] = useState(null);
  const [diag, setDiag] = useState(undefined); // undefined = loading, null = not injected

  const refresh = useCallback(async (t = tab) => {
    if (!t) return;
    const s = await AL.loadState(api);
    setState(s);
    const d = await askContent(t.id, { type: 'diagnose' });
    setDiag(d && !d.error ? d : null);
  }, [tab]);

  useEffect(() => {
    getTargetTab().then((t) => {
      setTab(t);
      refresh(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tab || !state || diag === undefined) return <div className="h-32 w-[340px]" />;

  let url = null;
  try {
    url = new URL(tab.url);
  } catch {
    /* about:blank etc. */
  }
  const scriptable = /^https?:/.test(tab.url || '');

  const setEnabled = async (enabled) => {
    const next = await AL.saveState(api, { ...state, settings: { ...state.settings, enabled } });
    setState(next);
    refresh();
  };

  return (
    <div className="bg-background w-[340px] text-sm">
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Logo className="size-6" iconClassName="size-3.5" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight tracking-tight">AutoLogin</div>
          <div className="text-muted-foreground truncate font-mono text-xs" data-testid="site-host" title={tab.title}>
            {url ? url.host : tab.url || 'Unknown page'}
          </div>
        </div>
        <Switch checked={state.settings.enabled} onCheckedChange={setEnabled} aria-label="Enable all rules" />
        <Button size="icon-sm" variant="ghost" className="text-muted-foreground -mr-1.5" aria-label="Settings" onClick={() => { api.runtime.openOptionsPage(); window.close(); }}>
          <Settings2 />
        </Button>
      </header>

      <div className="grid gap-2 px-3 pb-3" data-testid="popup-content">
        {diag ? (
          <Diagnosis diag={diag} state={state} tab={tab} onChange={setDiag} />
        ) : (
          <Inactive state={state} tab={tab} scriptable={scriptable} onDiag={setDiag} />
        )}
        {scriptable && (
          <Button size="sm" variant="ghost" className="text-muted-foreground justify-start" onClick={() => openOptions('new=' + encodeURIComponent(tab.url))}>
            <Plus /> Add rule for this site
          </Button>
        )}
      </div>
    </div>
  );
}

function Notice({ tone = 'muted', icon: Icon, children, action }) {
  return (
    <div
      className={cn('flex items-center gap-2 rounded-lg px-3 py-2.5', tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground')}
      data-testid="status"
      data-tone={tone}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

const STATE_LABEL = { filled: 'Filled', submitted: 'Submitted', waiting: 'Submitting', blocked: 'Paused' };

function Diagnosis({ diag, state, tab, onChange }) {
  const byId = new Map(state.rules.map((r) => [r.id, r]));
  const matching = diag.rules.filter((r) => r.urlMatch && byId.has(r.id));
  const winner = matching.find((r) => r.enabled && r.detection.ok && (r.fields.username || r.fields.password));

  if (!diag.globallyEnabled) return <Notice icon={Pause}>Paused</Notice>;
  if (!diag.secure) return <Notice tone="warn" icon={TriangleAlert}>Not filled over plain HTTP</Notice>;
  if (!matching.length) return <Notice>No rule for this page</Notice>;

  return matching.map((r) => {
    const rule = byId.get(r.id);
    const isWinner = winner?.id === r.id;
    const kinds = Object.fromEntries((r.detection?.checks || []).map((c) => [c.kind, c]));
    const failed = [
      kinds.title && !kinds.title.ok && `Title doesn’t contain “${rule.detect.title}”`,
      kinds.selector && !kinds.selector.ok && `No element ${rule.detect.selector}`,
      rule.username && !r.fields.username && 'Username field not found',
      rule.password && !r.fields.password && 'Password field not found',
    ].filter(Boolean);
    const status = isWinner && diag.last?.ruleId === r.id ? STATE_LABEL[diag.last.state] : null;
    const canFill = r.fields.username || r.fields.password;

    return (
      <div key={r.id} className={cn('rounded-lg border px-3 py-2.5', isWinner && 'border-brand/60 bg-brand-soft/40')} data-testid="popup-rule">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{rule.name}</span>
              {status && (
                <Badge variant={diag.last.state === 'blocked' ? 'warning' : 'brand'} className="px-1.5" data-testid="rule-status">
                  {diag.last.state === 'blocked' ? <TriangleAlert /> : <Check />}
                  {status}
                </Badge>
              )}
              {!rule.enabled && <Badge variant="muted">Off</Badge>}
            </div>
            <div className="text-muted-foreground truncate font-mono text-xs">{rule.urlPattern}</div>
          </div>
          <Button
            size="sm"
            variant={isWinner ? 'default' : 'outline'}
            disabled={!canFill}
            onClick={async () => {
              const next = await askContent(tab.id, { type: 'fillNow', ruleId: rule.id });
              if (next) onChange(next);
            }}
          >
            Fill
          </Button>
        </div>
        {failed.length > 0 && (
          <ul className="mt-2 grid gap-1 text-xs" data-testid="failed-checks">
            {failed.map((f) => (
              <li key={f} className="text-destructive flex items-center gap-1.5">
                <X className="size-3" strokeWidth={2.5} />
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  });
}

/** The content script is not running on this page: explain why and offer a fix. */
function Inactive({ state, tab, scriptable, onDiag }) {
  const [granted, setGranted] = useState(null);
  const matching = state.rules.filter((r) => AL.matchesUrl(r.urlPattern, tab.url));
  const rule = matching.find((r) => r.enabled) || matching[0];
  const origin = rule && AL.permissionOrigin(rule.urlPattern);

  useEffect(() => {
    if (origin) api.permissions.contains({ origins: [origin] }).then(setGranted, () => setGranted(false));
  }, [origin]);

  if (!scriptable) return <Notice>Not available on this page</Notice>;
  if (!rule) return <Notice>No rule for this page</Notice>;
  if (granted === null) return null;

  const fillOnce = async () => {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    const d = await askContent(tab.id, { type: 'fillNow', ruleId: rule.id });
    if (d) onDiag(d);
  };

  if (!granted) {
    return (
      <Notice
        tone="warn"
        icon={ShieldAlert}
        action={
          <Button
            size="sm"
            onClick={() =>
              api.permissions
                .request({ origins: [origin] })
                .then((ok) => ok && api.tabs.reload(tab.id))
                .finally(() => window.close())
            }
          >
            Grant
          </Button>
        }
      >
        Needs access to this site
      </Notice>
    );
  }
  return (
    <Notice
      icon={RotateCw}
      action={
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={fillOnce}>
            Fill
          </Button>
          <Button size="sm" onClick={() => api.tabs.reload(tab.id).then(() => window.close())}>
            Reload
          </Button>
        </div>
      }
    >
      Reload to activate
    </Notice>
  );
}
