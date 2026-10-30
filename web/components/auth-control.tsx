'use client';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signInAnonymously, signInWithGoogle, signOut, useAuth } from '@/components/auth';

/** Sign-in buttons. Hidden when the server has no Firebase settings. */
export function AuthControl() {
  const auth = useAuth();
  if (auth.status === 'loading' || auth.status === 'disabled') return null;
  if (auth.status === 'signed_in')
    return (
      <div className="auth-control">
        <span className="auth-name">
          <UserRound size={14} aria-hidden="true" /> {auth.anonymous ? 'Misafir' : (auth.name ?? auth.email ?? 'Hesabın')}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" /> Çıkış
        </Button>
      </div>
    );
  return (
    <div className="auth-control">
      <Button type="button" variant="outline" size="sm" onClick={() => void signInWithGoogle().catch(() => undefined)}>
        <LogIn aria-hidden="true" /> Google ile giriş
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => void signInAnonymously().catch(() => undefined)}>
        Misafir
      </Button>
    </div>
  );
}
