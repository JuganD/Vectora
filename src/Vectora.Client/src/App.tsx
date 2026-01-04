import { useState, useEffect } from 'react';
import { validateToken, getAuthStatus } from './api/client';
import LoginPage from './components/LoginPage';
import MainLayout from './components/MainLayout';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);

  useEffect(() => {
    // First check if auth is required
    getAuthStatus()
      .then(status => {
        setAuthRequired(status.authRequired);

        if (!status.authRequired) {
          // No password set, skip authentication entirely
          localStorage.setItem('vectora_token', 'no-auth-required');
          setIsAuthenticated(true);
          return;
        }

        // Auth is required, validate existing token
        const token = localStorage.getItem('vectora_token');
        if (token && token !== 'no-auth-required') {
          validateToken(token)
            .then(valid => {
              setIsAuthenticated(valid);
              if (!valid) localStorage.removeItem('vectora_token');
            })
            .catch(() => {
              setIsAuthenticated(false);
              localStorage.removeItem('vectora_token');
            });
        } else {
          localStorage.removeItem('vectora_token');
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        // If we can't reach the server, show login anyway
        setAuthRequired(true);
        setIsAuthenticated(false);
      });
  }, []);

  if (isAuthenticated === null || authRequired === null) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="animate-pulse text-primary-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  // Handle logout - if auth not required, just refresh the page
  const handleLogout = () => {
    localStorage.removeItem('vectora_token');
    if (authRequired) {
      setIsAuthenticated(false);
    } else {
      // If no auth required, just reload to re-authenticate automatically
      window.location.reload();
    }
  };

  return <MainLayout onLogout={handleLogout} showLogout={authRequired} />;
}

export default App;

