import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from '../App';
import {applyStoredThemeMode} from './services/appearance';
import {clearLegacyGeminiApiKey} from './services/secrets';

clearLegacyGeminiApiKey();
applyStoredThemeMode();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
