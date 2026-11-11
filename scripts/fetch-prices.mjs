// QLD·QQQ 일봉 확정 종가를 Yahoo Finance에서 받아 data/prices.json으로 저장합니다.
// GitHub Actions에서 매 거래일 장 마감 후 실행됩니다. (Node 20+)
import { writeFile, readFile } from 'node:fs/promises';

const SYMBOLS = ['QLD', 'QQQ'];
const OUT = new URL('../data/prices.json', import.meta.url);
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json',
};

const nyDate = (ms) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ms));

function nyNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: nyDate(Date.now()), minutes: (+parts.hour % 24) * 60 + +parts.minute };
}

async function fetchSymbol(sym) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}/v8/finance/chart/${sym}?range=3y&interval=1d&includePrePost=false`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`${sym} HTTP ${r.status}`);
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const ts = res?.timestamp;
      const close = res?.indicators?.quote?.[0]?.close;
      if (!ts?.length || !close?.length) throw new Error(`${sym} 응답 형식 오류`);
      const map = new Map();
      ts.forEach((t, i) => {
        const c = close[i];
        if (c != null && Number.isFinite(c) && c > 0) map.set(nyDate(t * 1000), Math.round(c * 10000) / 10000);
      });
      let rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      // 장중이면 오늘 봉은 확정 종가가 아니므로 뺍니다 (16:10 ET 이전).
      const now = nyNow();
      if (rows.length && rows.at(-1)[0] === now.date && now.minutes < 16 * 60 + 10) rows = rows.slice(0, -1);
      return rows;
    } catch (e) {
      lastErr = e;
      console.warn(`재시도 ${attempt + 1}/4:`, e.message);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const out = { updated: new Date().toISOString(), source: 'Yahoo Finance (daily close)' };
for (const s of SYMBOLS) out[s] = await fetchSymbol(s);

let prev = null;
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const same = prev && SYMBOLS.every((s) => JSON.stringify(prev[s]) === JSON.stringify(out[s]));
if (same) {
  console.log('변경 없음 · 마지막 종가', out.QLD.at(-1)?.[0]);
} else {
  await writeFile(OUT, JSON.stringify(out) + '\n');
  console.log('저장 완료 · QLD', out.QLD.length, '일, 마지막', out.QLD.at(-1)?.[0]);
}
