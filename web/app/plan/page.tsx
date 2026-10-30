'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, MapPin, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentCard } from '@/components/agent-card';
import type { AgentEventCard } from '@/agent/cards';
import type { AgentStreamEvent } from '@/agent/turn';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  cards: AgentEventCard[];
  tools: string[];
  error?: string;
};

const TOOL_LABELS: Record<string, string> = {
  search_events: 'Etkinlikler aranıyor',
  get_event_details: 'Etkinlik ayrıntıları okunuyor',
};
const SESSION_KEY = 'biplan.agent.session';
const MAX_MESSAGE_CHARS = 1000;

function newSessionId() {
  const id = crypto.randomUUID().replace(/-/g, '');
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

function currentSessionId() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  return stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored) ? stored : newSessionId();
}

/** Reads newline-delimited JSON events from the agent route. */
async function readAgentStream(body: ReadableStream<Uint8Array>, onEvent: (event: AgentStreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let next = await reader.read();
  while (!next.done) {
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AgentStreamEvent);
    next = await reader.read();
  }
}

function failureMessage(code: string | undefined) {
  return code === 'agent_unavailable'
    ? 'Asistan henüz yapılandırılmadı.'
    : code === 'rate_limited'
      ? 'Çok fazla istek gönderildi. Biraz sonra yeniden dene.'
      : code === 'catalog_unavailable'
        ? 'Etkinlik kataloğu hazır değil. Biraz sonra yeniden dene.'
        : 'Asistan şu anda yanıt veremiyor.';
}

function mergeCards(existing: AgentEventCard[], added: AgentEventCard[]) {
  const byId = new Map(existing.map((card) => [card.id, card]));
  for (const card of added) byId.set(card.id, card);
  return [...byId.values()];
}

export default function PlanPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  function update(id: string, change: (turn: Turn) => Turn) {
    setTurns((current) => current.map((turn) => (turn.id === id ? change(turn) : turn)));
  }

  function restart() {
    newSessionId();
    setTurns([]);
    setError('');
  }

  async function send(text = message) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const answerId = crypto.randomUUID();
    setTurns((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text: trimmed, cards: [], tools: [] },
      { id: answerId, role: 'assistant', text: '', cards: [], tools: [] },
    ]);
    setMessage('');
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId(), message: trimmed }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        throw new Error(failureMessage(body?.code));
      }
      await readAgentStream(response.body, (event) => {
        if (event.type === 'text')
          update(answerId, (turn) => ({ ...turn, text: turn.text ? `${turn.text}\n\n${event.text}` : event.text }));
        else if (event.type === 'tool')
          update(answerId, (turn) => ({ ...turn, tools: [...turn.tools, event.name] }));
        else if (event.type === 'cards')
          update(answerId, (turn) => ({ ...turn, cards: mergeCards(turn.cards, event.cards) }));
        else if (event.type === 'error')
          update(answerId, (turn) => ({ ...turn, error: 'Yanıt tamamlanamadı. Yeniden dene.' }));
      });
    } catch (failure) {
      setTurns((current) => current.filter((turn) => turn.id !== answerId));
      setError(failure instanceof Error ? failure.message : 'Asistan şu anda yanıt veremiyor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Bi’ Plan ana sayfa">
          bi’ plan<span>✳</span>
        </Link>
        <nav aria-label="Ana menü">
          <Link href="/">Etkinlikler</Link>
          <Link href="/plan" aria-current="page">
            Plan asistanı
          </Link>
        </nav>
        <div className="header-city">
          <MapPin size={14} /> İstanbul
        </div>
      </header>
      <main className="agent-page">
        <section className="agent-intro" aria-labelledby="agent-title">
          <h1 id="agent-title">Plan asistanı</h1>
          <p>
            Ne yapmak istediğini yaz. Asistan güncel etkinlikleri arar, ayrıntıları kontrol eder ve
            planı seninle birlikte düzenler. Kartlar yalnızca bilet sitelerindeki kayıtlardan gelir.
          </p>
        </section>
        <section className="agent-thread" aria-live="polite" aria-label="Sohbet">
          {turns.map((turn) => (
            <div key={turn.id} className={`agent-turn agent-turn-${turn.role}`}>
              {turn.role === 'assistant' && turn.tools.length > 0 && (
                <p className="agent-tools">
                  {[...new Set(turn.tools)].map((tool) => TOOL_LABELS[tool] ?? tool).join(' · ')}
                </p>
              )}
              {turn.text && <p className="agent-text">{turn.text}</p>}
              {turn.role === 'assistant' && !turn.text && busy && !turn.error && (
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
                    <AgentCard key={card.id} card={card} />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={bottom} />
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
            disabled={busy}
            placeholder="Örn. Cumartesi akşamı Kadıköy’de 500 TL altı bir konser"
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="chat-actions">
            <span>Mesajın, plan için Google Gemini’ye gönderilir.</span>
            <Button type="button" variant="ghost" size="icon" onClick={restart} disabled={busy} aria-label="Yeni sohbet">
              <RotateCcw />
            </Button>
            <Button type="submit" size="icon" disabled={busy} aria-label="Gönder">
              {busy ? <LoaderCircle className="spin" /> : <ArrowUp />}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
