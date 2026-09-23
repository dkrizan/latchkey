import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles.css';
import { applySystemTheme } from '@/lib/theme';
import { PopupApp } from './PopupApp';

applySystemTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
);
