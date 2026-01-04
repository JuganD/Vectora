import { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { login } from '../api/client';

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(password);
      if (result.success && result.token) {
        localStorage.setItem('vectora_token', result.token);
        onLogin();
      } else {
        setError(result.error || 'Invalid password');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-dark-800 border border-dark-600 rounded-2xl shadow-lg shadow-primary-500/20 mb-4">
            <img src="/vectora-logo.svg" alt="Vectora" className="w-14 h-14 drop-shadow-[0_0_8px_rgba(14,165,233,0.5)]" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary-400 to-purple-400 bg-clip-text text-transparent">
            Vectora
          </h1>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-dark-800/50 backdrop-blur-sm border border-dark-700 rounded-2xl p-8 shadow-xl">
          <div className="mb-6">
            <label htmlFor="password" className="block text-sm font-medium text-dark-300 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-dark-900 border border-dark-600 rounded-lg text-white placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder="Enter your password"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="mb-6 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 px-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-500/25"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

