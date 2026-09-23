import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/lib/theme';

function Toaster(props) {
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={{ '--normal-bg': 'var(--popover)', '--normal-text': 'var(--popover-foreground)', '--normal-border': 'var(--border)' }}
      {...props}
    />
  );
}

export { Toaster };
