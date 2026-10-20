import { fileURLToPath } from 'node:url';
import { renderAsync } from '@resvg/resvg-js';

const fonts = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map(name => fileURLToPath(new URL('../assets/fonts/' + name, import.meta.url)));
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const clip = (value, max) => { const chars = [...String(value)]; return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : String(value); };
export const formatMoney = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents === 0 ? 0 : cents / 100);
const compactMoney = cents => Math.abs(cents) >= 100000 ? '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100) : formatMoney(cents);
const dateLabel = day => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
const periodText = period => ({ '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' })[period];

// All text is escaped; reports contain no customer IDs, payment references, or staff notes.
export function renderDashboardSvg(data, { serverName = 'Quilted Tweaks' } = {}) {
  if (!Array.isArray(data.series) || data.series.length < 1 || data.series.length > 90 || !data.totals) throw new Error('Invalid dashboard response.');
  const t = data.totals, green = '#42d6aa', blue = '#66bbf5', muted = '#849a96', white = '#edf7f3';
  const text = (x, y, value, size = 16, fill = white, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${xml(value)}</text>`;
  const rect = (x, y, w, h, fill = '#101e1c', radius = 18, stroke = '#203a34') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
  const metric = (x, label, value, foot, accent = white) => rect(x, 150, 318, 118) + text(x + 22, 180, label, 13, muted) + text(x + 22, 223, value, value.length > 14 ? 25 : 32, accent, 'font-weight="700"') + text(x + 22, 249, foot, 12, muted);
  const reportTitle = data.product ? clip(data.product.name, 50) : 'Sales overview';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" viewBox="0 0 1400 1000"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0c1b18"/><stop offset="1" stop-color="#080e11"/></linearGradient><linearGradient id="area" x2="0" y2="1"><stop stop-color="${green}" stop-opacity=".18"/><stop offset="1" stop-color="${green}" stop-opacity="0"/></linearGradient></defs><rect width="1400" height="1000" rx="28" fill="url(#bg)"/><g font-family="DejaVu Sans">`;
  svg += rect(40, 36, 66, 66, '#14362c', 18, '#28634e') + text(51, 80, 'QT', 29, green, 'font-weight="700"');
  svg += text(124, 55, 'QUILTED TWEAKS', 13, green, 'font-weight="700" letter-spacing="2"') + text(122, 91, reportTitle, 28, white, 'font-weight="700"');
  svg += text(124, 119, clip(serverName, 55), 13, muted);
  svg += rect(1148, 43, 212, 36, '#142923', 18, '#285243') + text(1254, 67, periodText(data.period), 14, green, 'text-anchor="middle"');
  svg += text(1360, 105, data.start ? `${dateLabel(data.start)} – ${dateLabel(data.end)}, ${data.end.slice(0, 4)}` : `Through ${dateLabel(data.end)}, ${data.end.slice(0, 4)}`, 13, muted, 'text-anchor="end"');
  svg += metric(40, 'REVENUE', formatMoney(t.revenueCents), 'Total recorded sale value', green);
  svg += metric(374, 'RECORDED PROFIT', formatMoney(t.profitCents), 'Revenue − recorded costs − fees', t.profitCents < 0 ? '#fc8d9e' : green);
  svg += metric(708, 'SALES', String(t.orders), `${t.units} unit${t.units === 1 ? '' : 's'} sold`);
  svg += metric(1042, 'AVERAGE SALE', formatMoney(t.averageOrderCents), 'Revenue per recorded order');
  svg += rect(40, 290, 870, 364) + text(64, 324, 'Daily performance', 18, white, 'font-weight="700"') + text(64, 347, `${dateLabel(data.chartStart)} – ${dateLabel(data.end)} • ${data.timezone}`, 12, muted);
  svg += `<circle cx="690" cy="322" r="4" fill="${green}"/>` + text(702, 327, 'Revenue', 12, muted) + `<circle cx="785" cy="322" r="4" fill="${blue}"/>` + text(797, 327, 'Profit', 12, muted);
  const x = 115, y = 381, w = 754, h = 208;
  const vals = data.series.flatMap(d => [d.revenueCents, d.profitCents]);
  const low = Math.min(0, ...vals), high = Math.max(100, ...vals), span = high - low;
  const py = value => y + h - (value - low) / span * h, px = i => x + i / Math.max(1, data.series.length - 1) * w;
  for (let i = 0; i <= 4; i++) {
    const value = low + span * i / 4, yy = py(value);
    svg += `<path d="M${x},${yy}H${x + w}" stroke="#223b35" stroke-dasharray="3 5"/>` + text(x - 12, yy + 4, compactMoney(Math.round(value)), 11, muted, 'text-anchor="end"');
  }
  const path = key => data.series.map((d, i) => `${i ? 'L' : 'M'}${px(i).toFixed(2)},${py(d[key]).toFixed(2)}`).join(' ');
  svg += `<path d="${path('revenueCents')} L${px(data.series.length - 1)},${py(0)} L${px(0)},${py(0)}Z" fill="url(#area)"/>`;
  for (const [key, color] of [['revenueCents', green], ['profitCents', blue]]) svg += `<path d="${path(key)}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`;
  const marks = new Set(Array.from({ length: 5 }, (_, i) => Math.round(i * (data.series.length - 1) / 4)));
  for (const i of marks) svg += text(px(i), 617, dateLabel(data.series[i].date), 11, muted, 'text-anchor="middle"');
  if (!t.orders) svg += rect(291, 446, 398, 40, '#10241e', 12, '#294c3e') + text(490, 472, 'No sales recorded for this period', 14, green, 'text-anchor="middle"');
  svg += rect(934, 290, 426, 364) + text(960, 325, 'Profit breakdown', 18, white, 'font-weight="700"');
  const breakdown = [['Revenue', t.revenueCents, green], ['Recorded costs', -t.costCents, muted], ['Payment fees', -t.feeCents, muted]];
  breakdown.forEach(([label, value, color], i) => { svg += text(960, 378 + i * 51, label, 14, muted) + text(1334, 378 + i * 51, formatMoney(value), 18, color, 'text-anchor="end"'); });
  svg += '<path d="M960,505H1334" stroke="#29443b"/>' + text(960, 545, 'Recorded profit', 15, white) + text(1334, 547, formatMoney(t.profitCents), 25, t.profitCents < 0 ? '#fc8d9e' : green, 'text-anchor="end" font-weight="700"');
  svg += text(960, 592, 'Based on the costs and fees you enter.', 12, muted) + text(960, 613, 'Excludes unrecorded expenses and taxes.', 12, muted);
  svg += rect(40, 676, 1320, 254) + text(64, 710, 'Top products', 18, white, 'font-weight="700"') + text(1334, 710, 'By revenue • selected reporting period', 12, muted, 'text-anchor="end"');
  svg += text(720, 741, 'UNITS', 10, muted) + text(1054, 741, 'REVENUE', 10, muted, 'text-anchor="end"') + text(1334, 741, 'PROFIT', 10, muted, 'text-anchor="end"');
  const maxRevenue = Math.max(1, ...data.topProducts.map(p => p.revenueCents));
  data.topProducts.forEach((p, i) => {
    const yy = 769 + i * 33;
    svg += text(64, yy, String(i + 1).padStart(2, '0'), 12, green) + text(100, yy, clip(p.name, 42), 14);
    svg += rect(480, yy - 9, 180, 5, '#203a33', 2, 'none') + rect(480, yy - 9, Math.max(0, p.revenueCents / maxRevenue * 180), 5, green, 2, 'none');
    svg += text(735, yy, String(p.units), 14, muted) + text(1054, yy, formatMoney(p.revenueCents), 15, white, 'text-anchor="end"') + text(1334, yy, formatMoney(p.profitCents), 15, p.profitCents < 0 ? '#fc8d9e' : green, 'text-anchor="end"');
  });
  if (!data.topProducts.length) svg += text(700, 825, 'Your confirmed sales will appear here.', 15, muted, 'text-anchor="middle"');
  const stamp = new Intl.DateTimeFormat('en-US', { timeZone: data.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt));
  svg += text(40, 969, 'PRIVATE SALES LEDGER • USD • VOIDED SALES EXCLUDED', 11, muted, 'letter-spacing="1"') + text(1360, 969, `Generated ${stamp}`, 11, muted, 'text-anchor="end"');
  return svg + '</g></svg>';
}

export async function renderDashboardPng(data, options) {
  const result = await renderAsync(renderDashboardSvg(data, options), { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' } });
  return result.asPng();
}
