import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { api } from './api';
import { FacultyApp } from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <FacultyApp api={api} />
    </BrowserRouter>
  </StrictMode>,
);
