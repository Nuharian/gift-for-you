'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check if already authenticated
    if (typeof window !== 'undefined') {
      const auth = sessionStorage.getItem('gfy_admin_auth');
      if (auth === 'true') router.push('/dashboard');
    }
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        sessionStorage.setItem('gfy_admin_auth', 'true');
        router.push('/dashboard');
      } else {
        setError(data.message || 'Wrong password. Try again! 🔒');
      }
    } catch (err) {
      setError('Unable to connect. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="login-page animate-fadeIn">
      <div className="card login-card">
        <span className="login-icon">🎁</span>
        <h1 className="login-title">
          <span className="text-gradient">Gift For You</span>
        </h1>
        <p className="login-subtitle">Teacher Dashboard — Enter password to continue</p>

        <form onSubmit={handleLogin} className="login-form">
          <input
            className="input"
            type="password"
            placeholder="Enter password…"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button
            className="btn btn-primary btn-lg"
            type="submit"
            disabled={loading || !password.trim()}
          >
            {loading ? '⏳ Checking...' : 'Enter Dashboard 🚀'}
          </button>
        </form>

        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
