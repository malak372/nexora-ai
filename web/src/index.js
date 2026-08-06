/**
 * Application entry point.
 *
 * @author Eman
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { queryClient } from './config/queryClient';
import './index.css';

const rootElement = document.getElementById('root');

document.title = 'Voxidence';

if (!rootElement) {
  throw new Error('Root element was not found.');
}

const application = (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);

/**
 * StrictMode intentionally remains opt-in during local development because
 * React executes effects twice to detect unsafe side effects. API-heavy pages
 * can therefore appear slower and can issue duplicate development requests.
 */
const shouldEnableStrictMode =
  process.env.REACT_APP_ENABLE_STRICT_MODE === 'true';

ReactDOM.createRoot(rootElement).render(
  shouldEnableStrictMode
    ? <React.StrictMode>{application}</React.StrictMode>
    : application,
);
