'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarPlus, ExternalLink, MapPin, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthControl } from '@/components/auth-control';
import { authHeaders, useAuth } from '@/components/auth';
import { icsFileName, planToIcs } from '@/lib/ics';
import type { SavedFavorite, SavedPlan } from '@/lib/user-store';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

function downloadIcs(plan: SavedPlan) {
  const url = URL.createObjectURL(new Blob([planToIcs(plan)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = icsFileName(plan);
  link.click();
  URL.revokeObjectURL(url);
}

async function api<T>(path: string, method: 'GET' | 'DELETE' = 'GET'): Promise<T> {
  const response = await fetch(path, { method, headers: await authHeaders() });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

async function loadSaved() {
  const [planBody, favoriteBody] = await Promise.all([
    api<{ plans: SavedPlan[] }>('/api/me/plans'),
    api<{ favorites: SavedFavorite[] }>('/api/me/favorites'),
  ]);
  return { plans: planBody.plans, favorites: favoriteBody.favorites };
}

export default function SavedPage() {
  const auth = useAuth();
  const [plans, setPlans] = useState<SavedPlan[] | null>(null);
  const [favorites, setFavorites] = useState<SavedFavorite[] | null>(null);
  const [error, setError] = useState('');
  const signedIn = auth.status === 'signed_in';

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    loadSaved().then(
      (saved) => {
        if (!active) return;
        setPlans(saved.plans);
        setFavorites(saved.favorites);
        setError('');
      },
      () => active && setError('Kayıtlar yüklenemedi. Biraz sonra yeniden dene.'),
    );
    return () => {
      active = false;
    };
  }, [signedIn]);

  async function remove(kind: 'plans' | 'favorites', id: string) {
    try {
      await api(`/api/me/${kind}?id=${encodeURIComponent(id)}`, 'DELETE');
      if (kind === 'plans') setPlans((current) => current?.filter((plan) => plan.id !== id) ?? null);
      else setFavorites((current) => current?.filter((favorite) => favorite.eventId !== id) ?? null);
    } catch {
      setError('Silinemedi. Yeniden dene.');
    }
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Bi’ Plan ana sayfa">
          bi’ plan<span>✳</span>
        </Link>
        <nav aria-label="Ana menü">
          <Link href="/plan">Plan asistanı</Link>
          <Link href="/saved" aria-current="page">
            Kayıtlarım
          </Link>
        </nav>
        <AuthControl />
      </header>
      <main className="agent-page">
        <section className="agent-intro">
          <h1>Kayıtlarım</h1>
          <p>Kaydettiğin planlar ve favori etkinlikler. Planları takvimine .ics dosyası olarak ekleyebilirsin.</p>
        </section>
        {auth.status === 'disabled' && <p>Giriş bu sunucuda kapalı.</p>}
        {auth.status === 'signed_out' && <p>Kayıtlarını görmek için giriş yap.</p>}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {signedIn && (
          <>
            <section aria-labelledby="plans-title" className="saved-section">
              <h2 id="plans-title">Planlar</h2>
              {plans?.length === 0 && <p>Henüz plan yok. Plan asistanına “bunu kaydet” diyebilirsin.</p>}
              {plans?.map((plan) => (
                <article key={plan.id} className="agent-card saved-plan">
                  <h3>{plan.title}</h3>
                  {plan.note && <p>{plan.note}</p>}
                  <ol>
                    {plan.items.map((item, index) => {
                      const leg = plan.legs.find((l) => l.toEventId === item.eventId);
                      return (
                        <li key={item.eventId}>
                          {index > 0 && leg?.minutes != null && (
                            <span className="saved-leg">↓ yaklaşık {leg.minutes} dk yol</span>
                          )}
                          <strong>{formatDate(item.startsAt)}</strong> · {item.title}
                          <span className="agent-card-venue">
                            <MapPin size={12} aria-hidden="true" /> {item.venue}
                            {item.district ? ` · ${item.district}` : ''}
                          </span>
                          <a href={item.url} target="_blank" rel="noopener noreferrer">
                            Bilet <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="saved-actions">
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadIcs(plan)}>
                      <CalendarPlus aria-hidden="true" /> Takvime ekle
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void remove('plans', plan.id)}>
                      <Trash2 aria-hidden="true" /> Sil
                    </Button>
                  </div>
                </article>
              ))}
            </section>
            <section aria-labelledby="favorites-title" className="saved-section">
              <h2 id="favorites-title">Favoriler</h2>
              {favorites?.length === 0 && <p>Henüz favori yok.</p>}
              <div className="agent-cards">
                {favorites?.map((favorite) => (
                  <article key={favorite.eventId} className="agent-card">
                    <p className="agent-card-meta">{formatDate(favorite.startsAt)}</p>
                    <h3>{favorite.title}</h3>
                    <p className="agent-card-venue">
                      <MapPin size={12} aria-hidden="true" /> {favorite.venue}
                    </p>
                    <div className="saved-actions">
                      <a href={favorite.url} target="_blank" rel="noopener noreferrer">
                        Bilet <ExternalLink size={12} aria-hidden="true" />
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove('favorites', favorite.eventId)}
                        aria-label={`${favorite.title} favorisini sil`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
