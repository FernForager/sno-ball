// Renders qa/sweep-results.json as the Markdown table used in REPORT.md.
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(new URL('./sweep-results.json', import.meta.url), 'utf8'));
const short = { rich: 'R', thin: 'T', empty: 'E', loading: 'L', missing: '-' };
console.log('| # | Query | Outcome | Geocoded as | lat,lng | Precise | Rings H/B/S/N/C/Co/R/St/P (status:facts) | Settle | Status line | Console errors | Non-2xx hosts |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const rings = r.rings.map((g) => `${short[g.status] ?? g.status}${g.facts}`).join(' ');
  const bad = [...new Set(r.badResponses.map((b) => `${b.host}:${b.status}`))].join(', ') || '—';
  const errs = r.consoleErrors.length + r.pageErrors.length;
  const ll = r.lat != null ? `${r.lat},${r.lng}` : '—';
  const name = (r.displayName ?? r.errorMessage ?? '').replace(/\|/g, '\\|');
  console.log(`| ${r.n} | ${r.query} | ${r.outcome} | ${name} | ${ll} | ${r.precise == null ? '—' : r.precise ? 'yes' : 'no (area)'} | ${rings} | ${(r.settleMs / 1000).toFixed(1)}s | ${(r.statusLine || '—').replace(/\|/g, '\\|').slice(0, 60)} | ${errs} | ${bad} |`);
}
console.log('\nRing key: R rich, T thin, E empty, L still loading; the number is the fact count. Order: house, block, street, neighborhood, city, county, region, state, plate.');
console.log('\n## Ring names and hero sentences\n');
for (const r of rows) {
  console.log(`**${r.n}. ${r.query}** → ${r.outcome}`);
  if (r.hero) console.log(`- Hero: ${r.hero}`);
  if (r.errorMessage) console.log(`- Error: ${r.errorMessage}`);
  if (r.rings.some((g) => g.status !== 'missing')) console.log(`- Rings: ${r.rings.map((g) => `${g.level}=“${g.name}”`).join('; ')}`);
  if (r.rock) console.log(`- Rock: ${r.rock.replace(/\s+/g, ' ').slice(0, 140)}`);
  if (r.consoleErrors.length || r.pageErrors.length) console.log(`- Console: ${[...r.pageErrors, ...r.consoleErrors].map((e) => e.replace(/\s+/g, ' ').slice(0, 160)).join(' ‖ ')}`);
  if (r.badResponses.length) console.log(`- Non-2xx: ${r.badResponses.map((b) => `${b.host}${b.path} ${b.status}`).join('; ')}`);
  if (r.failedRequests.length) console.log(`- Failed requests: ${[...new Set(r.failedRequests.map((f) => `${f.host} (${f.error})`))].join('; ')}`);
  console.log('');
}
