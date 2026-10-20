// Generates an explicitly labeled demo image; does not connect to Discord or the database.
import fs from 'node:fs/promises';
import { renderDashboardPng } from '../src/salesDashboard.js';

const products = [
  { id: 'demo-1', name: 'QT Premium Utility', price: 2500, cost: 200 },
  { id: 'demo-2', name: 'Full PC Optimization', price: 3500, cost: 500 },
  { id: 'demo-3', name: 'Optimization + Utility Bundle', price: 5000, cost: 700 }
].map(p => ({ ...p, orders: 0, units: 0, revenueCents: 0, profitCents: 0 }));
const totals = { orders: 0, units: 0, revenueCents: 0, costCents: 0, feeCents: 0, profitCents: 0, averageOrderCents: 0 };
const series = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.parse('2026-09-20T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
  const day = { date, orders: i % 6 === 0 ? 0 : (i * 7 % 4) + 1, revenueCents: 0, profitCents: 0 };
  for (let j = 0; j < day.orders; j++) {
    const p = products[(i + j) % 3], units = (i + j) % 11 === 0 ? 2 : 1, fee = 75;
    const revenue = p.price * units, cost = p.cost * units, profit = revenue - cost - fee;
    day.revenueCents += revenue; day.profitCents += profit;
    p.orders++; p.units += units; p.revenueCents += revenue; p.profitCents += profit;
    totals.orders++; totals.units += units; totals.revenueCents += revenue; totals.costCents += cost; totals.feeCents += fee; totals.profitCents += profit;
  }
  return day;
});
totals.averageOrderCents = Math.round(totals.revenueCents / totals.orders);
const report = { currency: 'USD', timezone: 'America/New_York', period: '30d', start: '2026-09-20', end: '2026-10-19', chartStart: '2026-09-20', generatedAt: '2026-10-19T23:48:00Z', product: null, totals, topProducts: products.sort((a, b) => b.revenueCents - a.revenueCents), series };
const output = process.argv[2] || 'dashboard-preview.png';
await fs.writeFile(output, await renderDashboardPng(report, { serverName: 'DEMO DATA • Dashboard preview' }));
console.log(`Wrote demo dashboard: ${output}`);
