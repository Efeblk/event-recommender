'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Heart, LoaderCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentCard } from '@/components/agent-card';
import { AssistantMarkdown } from '@/components/assistant-markdown';
import { AuthControl } from '@/components/auth-control';
import { authHeaders, useAuth } from '@/components/auth';
import type { AgentEventCard } from '@/agent/cards';
import type { AgentStreamEvent } from '@/agent/turn';
import { detectMessageLanguage, type SupportedLanguage } from '@/lib/language';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  cards: AgentEventCard[];
  tools: string[];
  language: SupportedLanguage;
  error?: string;
};

const TOOL_LABELS: Record<SupportedLanguage, Record<string, string>> = {
  tr: {
    search_events: 'Etkinlikler aranıyor',
    get_event_details: 'Etkinlik ayrıntıları okunuyor',
    plan_outing: 'Plan kontrol ediliyor',
    plan_route: 'Yol süresi hesaplanıyor',
    get_weather: 'Hava durumuna bakılıyor',
    save_plan: 'Plan kaydediliyor',
    list_plans: 'Kayıtlı planlar okunuyor',
    save_favorite: 'Favorilere ekleniyor',
  },
  en: {
    search_events: 'Searching events',
    get_event_details: 'Checking event details',
    plan_outing: 'Checking outing plan',
    plan_route: 'Checking travel time',
    get_weather: 'Checking weather',
    save_plan: 'Saving plan',
    list_plans: 'Reading saved plans',
    save_favorite: 'Saving favorite',
  },
};
const SESSION_KEY = 'event-rec.agent.session';
const MAX_MESSAGE_CHARS = 1000;

function newSessionId() {
  const id = crypto.randomUUID().replace(/-/g, '');
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

function currentSessionId() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  return stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)
    ? stored
    : newSessionId();
}

/** Reads newline-delimited JSON events from the agent route. */
async function readAgentStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let next = await reader.read();
  while (!next.done) {
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines)
      if (line.trim()) onEvent(JSON.parse(line) as AgentStreamEvent);
    next = await reader.read();
  }
}

function failureMessage(code: string | undefined) {
  return code === 'agent_unavailable'
    ? 'Asistan henüz yapılandırılmadı.'
    : code === 'rate_limited'
      ? 'Çok fazla istek gönderildi. Biraz sonra yeniden dene.'
      : code === 'invalid_token'
        ? 'Oturumun sona erdi. Yeniden giriş yap.'
        : code === 'catalog_unavailable'
          ? 'Etkinlik kataloğu hazır değil. Biraz sonra yeniden dene.'
          : 'Asistan şu anda yanıt veremiyor.';
}

function mergeCards(existing: AgentEventCard[], added: AgentEventCard[]) {
  const byId = new Map(existing.map((card) => [card.id, card]));
  for (const card of added) byId.set(card.id, card);
  return [...byId.values()];
}

export default function PlanAssistant() {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [favorites, setFavorites] = useState<
    Record<string, 'saving' | 'saved' | 'failed'>
  >({});
  const auth = useAuth();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  function update(id: string, change: (turn: Turn) => Turn) {
    setTurns((current) =>
      current.map((turn) => (turn.id === id ? change(turn) : turn)),
    );
  }

  function restart() {
    newSessionId();
    setTurns([]);
    setError('');
  }

  async function send(text = message) {
    const trimmed = text.trim();
    if (!hydrated || !trimmed || busy) return;
    const answerId = crypto.randomUUID();
    const language = detectMessageLanguage(trimmed);
    setTurns((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'user',
        text: trimmed,
        cards: [],
        tools: [],
        language,
      },
      {
        id: answerId,
        role: 'assistant',
        text: '',
        cards: [],
        tools: [],
        language,
      },
    ]);
    setMessage('');
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          sessionId: currentSessionId(),
          message: trimmed,
        }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          code?: string;
        } | null;
        throw new Error(failureMessage(body?.code));
      }
      await readAgentStream(response.body, (event) => {
        if (event.type === 'text')
          update(answerId, (turn) => ({
            ...turn,
            text: turn.text ? `${turn.text}\n\n${event.text}` : event.text,
          }));
        else if (event.type === 'tool')
          update(answerId, (turn) => ({
            ...turn,
            tools: [...turn.tools, event.name],
          }));
        else if (event.type === 'cards')
          update(answerId, (turn) => ({
            ...turn,
            cards: mergeCards(turn.cards, event.cards),
          }));
        else if (event.type === 'error')
          update(answerId, (turn) => ({
            ...turn,
            error: 'Yanıt tamamlanamadı. Yeniden dene.',
          }));
      });
    } catch (failure) {
      setTurns((current) => current.filter((turn) => turn.id !== answerId));
      setError(
        failure instanceof Error
          ? failure.message
          : 'Asistan şu anda yanıt veremiyor.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function favorite(eventId: string) {
    setFavorites((current) => ({ ...current, [eventId]: 'saving' }));
    try {
      const response = await fetch('/api/me/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders()),
        },
        body: JSON.stringify({ eventId }),
      });
      setFavorites((current) => ({
        ...current,
        [eventId]: response.ok ? 'saved' : 'failed',
      }));
    } catch {
      setFavorites((current) => ({ ...current, [eventId]: 'failed' }));
    }
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link
          href="/"
          className="brand"
          aria-label="Event Recommender ana sayfa"
        >
          event recommender<span>✳</span>
        </Link>
        <nav aria-label="Ana menü">
          <Link href="/" aria-current="page">
            Plan asistanı
          </Link>
          {auth.status === 'signed_in' && <Link href="/saved">Kayıtlarım</Link>}
        </nav>
        <AuthControl />
      </header>
      <main className="agent-page">
        <section className="agent-intro" aria-labelledby="agent-title">
          <h1 id="agent-title">Plan asistanı</h1>
          <p>
            Ne yapmak istediğini yaz. Asistan güncel etkinlikleri arar,
            ayrıntıları kontrol eder ve planı seninle birlikte düzenler. Kartlar
            yalnızca bilet sitelerindeki kayıtlardan gelir.
          </p>
        </section>
        <section
          className="agent-thread"
          aria-live="polite"
          aria-label="Sohbet"
        >
          {turns.map((turn) => (
            <div key={turn.id} className={`agent-turn agent-turn-${turn.role}`}>
              {turn.role === 'assistant' && turn.tools.length > 0 && (
                <p className="agent-tools">
                  {[...new Set(turn.tools)]
                    .map((tool) => TOOL_LABELS[turn.language][tool] ?? tool)
                    .join(' · ')}
                </p>
              )}
              {turn.text &&
                (turn.role === 'assistant' ? (
                  <AssistantMarkdown text={turn.text} />
                ) : (
                  <p className="agent-text">{turn.text}</p>
                ))}
              {turn.role === 'assistant' &&
                !turn.text &&
                busy &&
                !turn.error && (
                  <p className="agent-text agent-pending">
                    <LoaderCircle className="spin" size={16} /> Düşünüyor…
                  </p>
                )}
              {turn.error && (
                <p className="agent-error" role="alert">
                  {turn.error}
                </p>
              )}
              {turn.cards.length > 0 && (
                <div className="agent-cards">
                  {turn.cards.map((card) => (
                    <AgentCard
                      key={card.id}
                      card={card}
                      language={turn.language}
                      actions={
                        auth.status === 'signed_in' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={
                              favorites[card.id] === 'saving' ||
                              favorites[card.id] === 'saved'
                            }
                            onClick={() => void favorite(card.id)}
                          >
                            <Heart aria-hidden="true" />
                            {favorites[card.id] === 'saved'
                              ? 'Kaydedildi'
                              : favorites[card.id] === 'failed'
                                ? 'Kaydedilemedi'
                                : 'Favorilere ekle'}
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={bottom} className="agent-thread-bottom" />
        </section>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <form
          className="chat-panel agent-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="agent-message">
            Mesajın
          </label>
          <Textarea
            id="agent-message"
            value={message}
            maxLength={MAX_MESSAGE_CHARS}
            disabled={!hydrated || busy}
            placeholder="Örn. Cumartesi akşamı Kadıköy’de 500 TL altı bir konser"
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="chat-actions">
            <span>Mesajın, plan için Google Gemini’ye gönderilir.</span>
            <div className="chat-action-buttons">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={restart}
                disabled={!hydrated || busy}
                aria-label="Yeni sohbet"
              >
                <RotateCcw />
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={!hydrated || busy}
                aria-label="Gönder"
              >
                {busy ? <LoaderCircle className="spin" /> : <ArrowUp />}
              </Button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
