import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { instalarCapturaGlobalDeErros } from './lib/errorReporting';
import './styles/global.css';

// Erro assíncrono (promise rejeitada, callback) NÃO passa pelo ErrorBoundary —
// precisa dos listeners globais para não sumir no console.
instalarCapturaGlobalDeErros();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Por FORA do BrowserRouter de propósito: assim também captura erro do
        próprio roteamento, que ficaria de fora se o boundary estivesse dentro. */}
    <ErrorBoundary contexto="app">
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
