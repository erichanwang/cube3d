import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RubiksChapter } from './RubiksChapter';
import './cube.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RubiksChapter />
  </StrictMode>,
);
