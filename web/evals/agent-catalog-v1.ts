/**
 * Synthetic Istanbul catalog for the agent evaluation (agent-v1).
 * Real venues and districts, invented sessions. No provider data.
 * Reference time: Wednesday 2026-11-04 12:00 Istanbul.
 */
import type { EventRecord } from '../lib/types.ts';

export const AGENT_EVAL_REFERENCE_TIME = '2026-11-04T09:00:00.000Z';
const CHECKED_AT = '2026-11-04T06:00:00.000Z';

type Row = [
  id: string,
  title: string,
  category: string,
  district: string,
  venue: string,
  /** Istanbul local time, YYYY-MM-DDTHH:MM */
  local: string,
  price: number | null,
  description: string,
  source?: 'biletinial' | 'bubilet' | 'biletix',
];

const rows: Row[] = [
  ['caz-moda-cmt', 'Moda Caz Gecesi', 'Konser', 'Kadıköy', 'Moda Sahnesi', '2026-11-07T21:00', 450, 'Canlı konser: akustik caz üçlüsü.'],
  ['caz-moda-cmt-bb', 'Moda Caz Gecesi', 'Konser', 'Kadıköy', 'Moda Sahnesi', '2026-11-07T21:00', 450, 'Canlı konser: akustik caz üçlüsü.', 'bubilet'],
  ['rock-zorlu-cmt', 'Kuzey Rüzgârı Rock Konseri', 'Konser', 'Beşiktaş', 'Zorlu PSM', '2026-11-07T20:30', 900, 'Canlı konser: alternatif rock grubu.', 'biletix'],
  ['klasik-crr-paz', 'Pazar Matinesi: Mozart ve Haydn', 'Konser', 'Şişli', 'Cemal Reşit Rey Konser Salonu', '2026-11-08T15:00', 300, 'Oda orkestrası ile klasik müzik konseri.'],
  ['pop-harbiye-cum', 'Yıldızlar Altında Pop Konseri', 'Konser', 'Şişli', 'Harbiye Cemil Topuzlu Açıkhava Tiyatrosu', '2026-11-06T21:00', 1200, 'Canlı konser: pop şarkıları.', 'biletix'],
  ['caz-nardis-sal', 'Nardis Caz Akşamı', 'Konser', 'Beyoğlu', 'Nardis Jazz Club', '2026-11-10T22:00', 600, 'Canlı konser: caz standartları.'],
  ['tiyatro-kadikoy-cmt', 'Bir Yaz Gecesi Rüyası', 'Tiyatro', 'Kadıköy', 'Kadıköy Haldun Taner Sahnesi', '2026-11-07T20:00', 350, 'Tiyatro oyunu: Shakespeare uyarlaması.'],
  ['tiyatro-beyoglu-cum', 'Martı', 'Tiyatro', 'Beyoğlu', 'Beyoğlu Sahnesi', '2026-11-06T20:30', 500, 'Tiyatro oyunu: Çehov klasiği.'],
  ['tiyatro-uskudar-paz', 'Kahvede Bir Gün', 'Tiyatro', 'Üsküdar', 'Üsküdar Tekel Sahnesi', '2026-11-08T18:00', 250, 'Tiyatro oyunu: güldürü.'],
  ['tiyatro-kadikoy-paz', 'Hamlet', 'Tiyatro', 'Kadıköy', 'Kadıköy Haldun Taner Sahnesi', '2026-11-08T19:30', 400, 'Tiyatro oyunu: klasik tragedya.'],
  ['standup-kadikoy-cmt', 'Gece Kuşu', 'Stand-up', 'Kadıköy', 'Kadıköy Komedi Kulübü', '2026-11-07T22:30', 400, 'Gece Kuşu stand up gösterisi. 18 yaş sınırı vardır.'],
  ['standup-besiktas-cum', 'Ofis Hikâyeleri', 'Stand-up', 'Beşiktaş', 'BKM Mutfak', '2026-11-06T21:00', 650, 'Ofis Hikâyeleri stand up gösterisi.'],
  ['standup-sisli-cmt', 'Trafikte Bir Ömür', 'Stand-up', 'Şişli', 'Bonus Parkorman Sahnesi', '2026-11-07T19:00', 750, 'Trafikte Bir Ömür stand up gösterisi.', 'bubilet'],
  ['sergi-beyoglu', 'Işık ve Gölge Fotoğraf Sergisi', 'Sergi', 'Beyoğlu', 'Pera Müzesi', '2026-11-07T10:00', 200, 'Fotoğraf sergisi.'],
  ['sergi-sariyer', 'Boğaz Resimleri Sergisi', 'Sergi', 'Sarıyer', 'Sakıp Sabancı Müzesi', '2026-11-08T11:00', 300, 'Resim sergisi.'],
  ['cocuk-uskudar-cmt', 'Kukla Masalları', 'Gösteri', 'Üsküdar', 'Üsküdar Çocuk Sahnesi', '2026-11-07T14:00', 150, 'Çocuklar için kukla gösterisi. 4 yaş ve üzeri.'],
  ['cocuk-kadikoy-paz', 'Minik Kaşifler Atölyesi', 'Workshop', 'Kadıköy', 'Kadıköy Bilim Merkezi', '2026-11-08T11:00', 250, 'Çocuklar için bilim atölyesi. 6-10 yaş.'],
  ['dans-zorlu-paz', 'Kuğu Gölü Balesi', 'Dans', 'Beşiktaş', 'Zorlu PSM', '2026-11-08T20:00', 1500, 'Bale gösterisi.', 'biletix'],
  ['festival-maltepe-cmt', 'Sokak Lezzetleri Festivali', 'Festival', 'Maltepe', 'Maltepe Etkinlik Alanı', '2026-11-07T12:00', 0, 'Açık hava yemek ve müzik festivali.'],
  ['sinema-beyoglu-cum', 'Sessiz Film Gecesi', 'Sinema', 'Beyoğlu', 'Atlas 1948 Sineması', '2026-11-06T19:00', 180, 'Canlı müzik eşliğinde sessiz film gösterimi.'],
  ['soylesi-kadikoy-sal', 'Şehir ve Bellek Söyleşisi', 'Söyleşi', 'Kadıköy', 'Kadıköy Kitap Kafe', '2026-11-10T19:00', 0, 'Yazarlarla söyleşi.'],
  ['spor-besiktas-paz', 'Basketbol Süper Ligi Maçı', 'Spor', 'Beşiktaş', 'Beşiktaş Spor Salonu', '2026-11-08T17:00', 350, 'Basketbol maçı.'],
  ['atolye-besiktas-cmt', 'Seramik Atölyesi', 'Workshop', 'Beşiktaş', 'Beşiktaş Sanat Evi', '2026-11-07T13:00', 800, 'Yetişkinler için seramik atölyesi.'],
  ['konser-kadikoy-cum', 'Anadolu Rock Gecesi', 'Konser', 'Kadıköy', 'Dorock XL Kadıköy', '2026-11-06T22:00', 550, 'Canlı konser: Anadolu rock.'],
  ['konser-uskudar-paz', 'Türk Sanat Müziği Konseri', 'Konser', 'Üsküdar', 'Üsküdar Kültür Merkezi', '2026-11-08T19:00', 200, 'Klasik Türk müziği konseri.'],
  ['tiyatro-sisli-cmt', 'Cimri', 'Tiyatro', 'Şişli', 'Şişli Kenter Tiyatrosu', '2026-11-07T15:00', 450, 'Tiyatro oyunu: Molière komedisi.'],
  ['konser-besiktas-sonraki', 'Elektronik Gece', 'Konser', 'Beşiktaş', 'Babylon Bomonti', '2026-11-14T23:00', 700, 'Canlı konser: elektronik müzik. 18 yaş sınırı vardır.'],
  ['tiyatro-kadikoy-sonraki', 'Bernarda Alba’nın Evi', 'Tiyatro', 'Kadıköy', 'Kadıköy Haldun Taner Sahnesi', '2026-11-14T20:00', 380, 'Tiyatro oyunu: Lorca klasiği.'],
  ['tukendi-kadikoy-cmt', 'Tükenen Konser', 'Konser', 'Kadıköy', 'Moda Sahnesi', '2026-11-07T18:00', 300, 'Canlı konser.'],
];

const istanbulToUtc = (local: string) => new Date(`${local}:00+03:00`).toISOString();

export function agentEvalCatalog(): EventRecord[] {
  return rows.map(([id, title, category, district, venue, local, price, description, source = 'biletinial']) => ({
    id: `${source}:${id}`,
    title,
    description,
    startsAt: istanbulToUtc(local),
    venue,
    city: 'İstanbul',
    district,
    address: `${venue}, ${district}, İstanbul`,
    price,
    currency: 'TRY',
    url: `https://${source}.example/${id}`,
    imageUrl: '',
    category,
    availability: id.startsWith('tukendi') ? 'sold_out' : 'available',
    source,
    checkedAt: CHECKED_AT,
  }));
}
