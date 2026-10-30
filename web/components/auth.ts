'use client';
import { useSyncExternalStore } from 'react';
import type { Auth, User } from 'firebase/auth';
import type { FirebaseWebConfig } from '@/lib/auth';

export type AuthState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; name: string | null; email: string | null; anonymous: boolean };

let state: AuthState = { status: 'loading' };
let auth: Auth | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: AuthState) {
  state = next;
  for (const listener of listeners) listener();
}

function fromUser(user: User | null): AuthState {
  return user
    ? { status: 'signed_in', name: user.displayName, email: user.email, anonymous: user.isAnonymous }
    : { status: 'signed_out' };
}

/** Loads Firebase only when the server publishes sign-in settings. */
async function start() {
  if (started) return;
  started = true;
  try {
    const site = (await (await fetch('/api/site', { cache: 'no-store' })).json()) as {
      firebase?: FirebaseWebConfig | null;
    };
    if (!site.firebase) return publish({ status: 'disabled' });
    const [{ initializeApp }, firebaseAuth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    auth = firebaseAuth.getAuth(initializeApp(site.firebase));
    firebaseAuth.onAuthStateChanged(auth, (user) => publish(fromUser(user)));
  } catch {
    publish({ status: 'disabled' });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void start();
  return () => listeners.delete(listener);
}

const loading: AuthState = { status: 'loading' };

export function useAuth() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => loading,
  );
}

export async function signInWithGoogle() {
  if (!auth) return;
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signInAnonymously() {
  if (!auth) return;
  const firebaseAuth = await import('firebase/auth');
  await firebaseAuth.signInAnonymously(auth);
}

export async function signOut() {
  if (!auth) return;
  const { signOut: firebaseSignOut } = await import('firebase/auth');
  await firebaseSignOut(auth);
}

/** Authorization header for API calls. Empty when not signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  const user = auth?.currentUser;
  return user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {};
}
