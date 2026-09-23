import { useRef } from 'react';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AL } from '@/lib/ext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';

export function SettingsSheet({ open, onOpenChange, state, save }) {
  const fileRef = useRef(null);
  const s = state.settings;

  const setSetting = (key, value) => save({ ...state, settings: { ...s, [key]: value } });
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
    toast('Exported with plain-text passwords');
  };

  const importRules = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = AL.importState(await file.text(), state);
      await save(next);
      toast.success(`Imported ${next.rules.length - state.rules.length} rules`);
    } catch (err) {
      toast.error('Import failed', { description: err.message });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-sm" data-testid="settings">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription className="sr-only">Behavior and backup</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-6 py-4 text-sm">
          <Row label="Show notifications" htmlFor="set-toast">
            <Switch id="set-toast" checked={s.showToast} onCheckedChange={(v) => setSetting('showToast', v)} />
          </Row>
          <Row label="Submit delay" htmlFor="set-delay">
            <Unit unit="ms">
              <Input id="set-delay" key={s.submitDelayMs} type="number" min={0} max={10000} step={100} defaultValue={s.submitDelayMs} onBlur={setNumber('submitDelayMs', 0, 10000)} className="h-8 w-20 text-right" />
            </Unit>
          </Row>
          <Row label="Max auto-submits" htmlFor="set-attempts">
            <div className="flex items-center gap-1.5">
              <Input id="set-attempts" key={s.maxAttempts} type="number" min={1} max={20} defaultValue={s.maxAttempts} onBlur={setNumber('maxAttempts', 1, 20)} className="h-8 w-14 text-right" />
              <span className="text-muted-foreground text-xs">per</span>
              <Unit unit="s">
                <Input id="set-window" key={s.attemptWindowSec} type="number" min={5} max={3600} defaultValue={s.attemptWindowSec} onBlur={setNumber('attemptWindowSec', 5, 3600)} className="h-8 w-16 text-right" />
              </Unit>
            </div>
          </Row>
          <Separator />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={exportRules}>
              <Download /> Export
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload /> Import
            </Button>
            <input ref={fileRef} id="import-file" type="file" accept="application/json,.json" className="hidden" onChange={importRules} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, htmlFor, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={htmlFor} className="font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Unit({ unit, children }) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <span className="text-muted-foreground w-4 text-xs">{unit}</span>
    </div>
  );
}
