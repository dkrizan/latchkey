import { useCallback, useEffect, useState } from 'react';
import { Check, CircleCheck, Minus, Plus, RotateCw, ShieldAlert, TriangleAlert, X, Info } from 'lucide-react';
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

  if (!tab || !state || diag === undefined) return <div className="h-40 w-[360px]" />;

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
    <div className="bg-background w-[360px] text-sm">
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <Logo className="size-6" iconClassName="size-3.5" />
        <span className="font-semibold tracking-tight">AutoLogin Rules</span>
        <Switch className="ml-auto" checked={state.settings.enabled} onCheckedChange={setEnabled} aria-label="Enable all rules" />
      </header>

      <div className="px-4 pt-3">
        <div className="truncate font-mono text-[13px] font-medium" data-testid="site-host">
          {url ? url.host + url.pathname : tab.url || 'Unknown page'}
        </div>
        <div className="text-muted-foreground truncate text-xs">{tab.title}</div>
      </div>

      <div className="grid gap-3 p-4" data-testid="popup-content">
        {diag ? (
          <Diagnosis diag={diag} state={state} tab={tab} onChange={setDiag} />
        ) : (
          <Inactive state={state} tab={tab} scriptable={scriptable} onDiag={setDiag} />
        )}
      </div>

      <footer className="bg-muted/40 flex items-center border-t px-3 py-2.5">
        <Button size="sm" variant="ghost" onClick={() => { api.runtime.openOptionsPage(); window.close(); }}>
          Manage rules
        </Button>
        <Button size="sm" variant="outline" className="ml-auto" disabled={!scriptable} onClick={() => openOptions('new=' + encodeURIComponent(tab.url))}>
          <Plus /> Rule for this site
        </Button>
      </footer>
    </div>
  );
}

function Status({ tone = 'muted', icon: Icon, title, children, actions }) {
  const tones = {
    ok: 'bg-brand-soft text-brand-soft-foreground',
    warn: 'bg-warning-soft text-warning border border-warning-border',
    muted: 'bg-muted text-foreground',
  };
  return (
    <div className={cn('rounded-lg px-3 py-2.5', tones[tone])} data-testid="status" data-tone={tone}>
      <div className="flex items-start gap-2">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
        <div className="grid min-w-0 gap-0.5">
          <div className="font-medium">{title}</div>
          {children && <div className={cn('text-[13px]', tone === 'muted' ? 'text-muted-foreground' : 'opacity-85')}>{children}</div>}
        </div>
      </div>
      {actions && <div className="mt-2.5 flex gap-2 pl-6">{actions}</div>}
    </div>
  );
}

function CheckRow({ ok, label, detail }) {
  const Icon = ok === null ? Minus : ok ? Check : X;
  return (
    <li className="flex items-center gap-2">
      <Icon className={cn('size-3.5 shrink-0', ok === null ? 'text-muted-foreground' : ok ? 'text-success' : 'text-destructive')} strokeWidth={2.5} />
      <span className={cn(ok === false && 'text-destructive')}>{label}</span>
      {detail && <span className="text-muted-foreground ml-auto truncate pl-2 font-mono text-xs" title={detail}>{detail}</span>}
    </li>
  );
}

function Diagnosis({ diag, state, tab, onChange }) {
  const byId = new Map(state.rules.map((r) => [r.id, r]));
  const matching = diag.rules.filter((r) => r.urlMatch && byId.has(r.id));
  const winner = matching.find((r) => r.enabled && r.detection.ok && (r.fields.username || r.fields.password));
  const last = diag.last;

  const banner = (() => {
    if (!diag.globallyEnabled) return <Status tone="warn" icon={Info} title="All rules are paused">Turn the switch above back on to resume.</Status>;
    if (!diag.secure) return <Status tone="warn" icon={TriangleAlert} title="Not filled on plain HTTP">Credentials are only filled over HTTPS on non-local hosts.</Status>;
    if (last?.state === 'blocked') return <Status tone="warn" icon={TriangleAlert} title="Auto-submit paused">Too many submits in a short time. Check the stored password.</Status>;
    if (['filled', 'submitted', 'waiting'].includes(last?.state)) {
      const verb = { filled: 'Filled', submitted: 'Filled and submitted', waiting: 'Filled, submitting…' }[last.state];
      return <Status tone="ok" icon={CircleCheck} title={`${verb} with “${byId.get(last.ruleId)?.name || 'rule'}”`} />;
    }
    return null;
  })();

  if (!diag.secure) return banner;
  if (!matching.length) {
    return (
      <>
        {banner}
        <Status title="No rule for this page">Create one with the button below.</Status>
      </>
    );
  }

  return (
    <>
      {banner}
      {matching.map((r) => {
        const rule = byId.get(r.id);
        const kinds = Object.fromEntries((r.detection?.checks || []).map((c) => [c.kind, c]));
        const isWinner = winner?.id === r.id;
        const canFill = r.fields.username || r.fields.password;
        return (
          <div key={r.id} className={cn('rounded-lg border p-3', isWinner && 'border-brand ring-brand/30 ring-2')} data-testid="popup-rule">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{rule.name}</span>
              {!rule.enabled && <Badge variant="muted">Disabled</Badge>}
              {isWinner && <Badge variant="brand">Active</Badge>}
            </div>
            <ul className="mt-2.5 grid gap-1.5 text-[13px]">
              <CheckRow ok label="URL matches" detail={rule.urlPattern} />
              {kinds.title && <CheckRow ok={kinds.title.ok} label="Title contains" detail={rule.detect.title} />}
              {kinds.selector && <CheckRow ok={kinds.selector.ok} label="Element exists" detail={rule.detect.selector} />}
              {!kinds.title && !kinds.selector && <CheckRow ok={null} label="No page detection" />}
              {rule.username && <CheckRow ok={r.fields.username} label="Username field" detail={rule.usernameSelector || 'auto'} />}
              {rule.password && <CheckRow ok={r.fields.password} label="Password field" detail={rule.passwordSelector || 'auto'} />}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant={isWinner ? 'default' : 'outline'}
                className="flex-1"
                disabled={!canFill}
                onClick={async () => {
                  const next = await askContent(tab.id, { type: 'fillNow', ruleId: rule.id });
                  if (next) onChange(next);
                }}
              >
                {rule.autoSubmit ? 'Fill & submit' : 'Fill now'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => openOptions('edit=' + encodeURIComponent(rule.id))}>
                Edit
              </Button>
            </div>
          </div>
        );
      })}
    </>
  );
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

  if (!scriptable) return <Status title="Not available on this page">Browser pages and extension stores cannot be scripted.</Status>;
  if (!rule) return <Status title="No rule for this page">Create one with the button below.</Status>;
  if (granted === null) return null;

  const fillOnce = (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
        const d = await askContent(tab.id, { type: 'fillNow', ruleId: rule.id });
        if (d) onDiag(d);
      }}
    >
      Fill once
    </Button>
  );

  if (!granted) {
    return (
      <Status
        tone="warn"
        icon={ShieldAlert}
        title={`“${rule.name}” needs access to this site`}
        actions={
          <>
            <Button
              size="sm"
              onClick={() =>
                api.permissions
                  .request({ origins: [origin] })
                  .then((ok) => ok && api.tabs.reload(tab.id))
                  .finally(() => window.close())
              }
            >
              Grant access
            </Button>
            {fillOnce}
          </>
        }
      >
        Grant <span className="font-mono">{origin}</span> so the rule runs automatically.
      </Status>
    );
  }
  return (
    <Status
      tone="warn"
      icon={RotateCw}
      title="Reload to activate"
      actions={
        <>
          <Button size="sm" onClick={() => api.tabs.reload(tab.id).then(() => window.close())}>
            Reload tab
          </Button>
          {fillOnce}
        </>
      }
    >
      “{rule.name}” was added after this tab was opened.
    </Status>
  );
}
