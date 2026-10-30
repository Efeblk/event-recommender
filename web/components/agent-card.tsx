import { CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import type { AgentEventCard } from '@/agent/cards';

const sourceName = (source: AgentEventCard['source']) =>
  source === 'bubilet'
    ? 'Bubilet'
    : source === 'biletix'
      ? 'Biletix'
      : source === 'biletinial'
        ? 'Biletinial'
        : 'Bilet sitesi';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const formatPrice = (card: Pick<AgentEventCard, 'price' | 'currency' | 'priceKind'>) => {
  if (card.price === null) return 'Fiyat bilgisi yok';
  if (card.price === 0) return 'Ücretsiz';
  const money = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: card.currency || 'TRY',
    maximumFractionDigits: 2,
  }).format(card.price);
  return card.priceKind === 'starting_at' ? `${money}’den başlayan` : money;
};

/** A compact card built only from a tool result. */
export function AgentCard({ card, actions }: { card: AgentEventCard; actions?: React.ReactNode }) {
  const offers = card.offers.length ? card.offers : [{ source: card.source, url: card.url, price: card.price, currency: card.currency }];
  return (
    <article className="agent-card" data-event-id={card.id}>
      <p className="agent-card-meta">
        <span className="agent-card-category">{card.category}</span>
        <span>
          <CalendarDays size={13} aria-hidden="true" /> {formatDate(card.startsAt)}
        </span>
      </p>
      <h3>{card.title}</h3>
      <p className="agent-card-venue">
        <MapPin size={13} aria-hidden="true" /> {card.venue}
        {card.district ? ` · ${card.district}` : ''}
      </p>
      <p className="agent-card-price">{formatPrice(card)}</p>
      {card.availability === 'sold_out' && <p className="agent-card-warning">Tükendi</p>}
      <ul className="agent-card-offers" aria-label={`${card.title} bilet bağlantıları`}>
        {offers.map((offer) => (
          <li key={offer.url}>
            <a href={offer.url} target="_blank" rel="noopener noreferrer">
              {sourceName(offer.source)}
              {offer.price !== null && offers.length > 1
                ? ` · ${formatPrice({ price: offer.price, currency: offer.currency, priceKind: null })}`
                : ''}{' '}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {actions}
    </article>
  );
}
