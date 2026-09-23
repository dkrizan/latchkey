import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles.css';
import { applySystemTheme } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import { OptionsApp } from './OptionsApp';

applySystemTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <OptionsApp />
    <Toaster position="bottom-center" />
  </StrictMode>
);
