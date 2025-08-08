\
import "dotenv/config";
const { chromium } = await import("playwright");

import * as fs from "fs/promises";
import fetch from "node-fetch";

const WEBHOOK = process.env.SLACK_WEBHOOK || "";
const PRICE_DROP_THRESHOLD = parseInt(
	process.env.PRICE_DROP_THRESHOLD || "25",
	10,
);
const STATE_FILE = "./last-output.txt";

const extractor = `
(() => {
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const uniq  = arr => Array.from(new Set(arr));

  const priceRe  = /[$€£]\\s?\\d[\\d,]*(?:\\.\\d{2})?/;
  const routeRe  = /(?:^|[^A-Z0-9])([A-Z]{3})[^A-Z0-9]{1,6}([A-Z]{3})(?=[^A-Z0-9]|$)/u;
  const flightRe = /(?!A\\d{3}\\b)(?!B\\d{3}\\b)[A-Z]{2,3}\\s?\\d{1,5}\\b/g;
  const dateTokRe = /\\b(?:(\\d{1,2})\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2}))\\b/;
  const monthIdx = m => ({Jan:0,Feb:1,Mar:2,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11, Apr:3})[m]; // Apr fix

  const DATE_W = 6, FLT_W = 8;
  const pad = (s, w) => (s + ' '.repeat(w)).slice(0, w);

  function parseDateToken(t) {
    if (!t) return null;
    const m = t.match(dateTokRe);
    if (!m) return null;
    const day = parseInt(m[1] || m[4], 10);
    const mon = (m[2] || m[3]);
    const now = new Date();
    // Map month
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const mm = months[mon];
    let d = new Date(now.getFullYear(), mm, day);
    if (d.getTime() < now.getTime() - 30*864e5) d.setFullYear(d.getFullYear() + 1);
    return { sort: d.getTime(), display: \`\${day} \${mon}\` };
  }

  // gather cards (price anchor + explicit "Cheapest flight")
  const cardsSet = new Set(
    Array.from(document.querySelectorAll('[jsname="z6Z3R"] [role="text"]'))
      .map(el => el.closest('.U5HQrd'))
      .filter(Boolean)
  );
  document.querySelectorAll('.U5HQrd .KHLctd .ogfYpf').forEach(h => {
    const t = clean(h.textContent);
    if (/^Cheapest flight/i.test(t)) {
      const c = h.closest('.U5HQrd');
      if (c) cardsSet.add(c);
    }
  });
  const cards = Array.from(cardsSet);

  const flightRows = [];
  const watchRows  = [];

  for (const card of cards) {
    const cardText = clean(card.innerText);
    const headEl = card.querySelector('[data-current-price-modifier] [role="text"]'); // header (arrow)
    const bodyEl = card.querySelector('[jsname="z6Z3R"] [role="text"]');             // lower

    const headPrice = headEl && (headEl.textContent.match(priceRe) || [])[0];
    const bodyPrice = bodyEl && (bodyEl.textContent.match(priceRe) || [])[0];

    const heading = clean(card.querySelector('.KHLctd .ogfYpf')?.textContent) || '';
    const isWatch = /^Cheapest flight/i.test(heading);

    if (isWatch) {
      // WATCH: header = current, body = previous
      const current = headPrice || '';
      const was     = (bodyPrice && bodyPrice !== current) ? bodyPrice : '';
      const metaBits = Array.from(card.querySelectorAll('.fNaLEf .vIXxDe')).map(e => clean(e.innerText)).filter(Boolean);
      const title = \`[Watch] \${heading}\${metaBits.length ? ' • ' + metaBits.join(' • ') : ''}\`;
      const pricePart = current ? (was ? \`\${current} | was \${was}\` : current) : (was || '');
      watchRows.push(\`\${title} :: \${pricePart}\`);
      continue;
    }

    if (!routeRe.test(cardText)) {
      continue; // skip non-flight widgets
    }

    // FLIGHT: header = current, body = was
    const current = headPrice || bodyPrice || '';
    const was = (bodyPrice && bodyPrice !== current) ? bodyPrice
             : (headPrice && headPrice !== current ? headPrice : '');
    const pricePart = current ? (was ? \`\${current} | was \${was}\` : current) : (was || '');

    let legBlocks = Array.from(card.querySelectorAll('.NHmuVd'));
    if (!legBlocks.length) legBlocks = [card];

    const legs = [];
    for (const block of legBlocks) {
      const bt = clean(block.innerText);
      const rm = bt.match(routeRe);
      if (!rm) continue;
      const route = \`\${rm[1]}–\${rm[2]}\`;

      const prominent = clean(block.querySelector('.YMlIz')?.innerText);
      const dateTok = (prominent.match(dateTokRe) || [])[0] || (bt.match(dateTokRe) || [])[0];
      const date = parseDateToken(dateTok);
      if (!date) continue;

      let nearText = bt;
      const routeEl = Array.from(block.querySelectorAll('*')).find(e => routeRe.test(e.textContent || ''));
      if (routeEl) nearText = clean(routeEl.parentElement?.innerText) || bt;

      let flt = '—';
      const nearMatch = nearText.match(flightRe);
      if (nearMatch && nearMatch.length) flt = nearMatch[0];
      if (flt === '—') {
        const all = bt.match(flightRe);
        if (all && all.length) flt = all[0];
      }

      legs.push({ date, route, flt });
    }

    if (!legs.length) continue;

    const label = legs
      .map(l => \`\${(l.date.display+'  ').padEnd(DATE_W+2)}\${(l.flt+'  ').padEnd(FLT_W+2)}\${l.route}\`)
      .join(' • ');
    const earliest = Math.min(...legs.map(l => l.date.sort));
    flightRows.push({ line: \`\${label} :: \${pricePart}\`, sort: earliest });
  }

  flightRows.sort((a,b)=>a.sort-b.sort);
  return { flights: flightRows.map(f=>f.line), watches: watchRows };
})()
`;

async function post(text) {
	if (!WEBHOOK) {
		console.log(text);
		return;
	}
	await fetch(WEBHOOK, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
	});
}

async function main() {
	const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
	let ctx;
	try {
		ctx = await chromium.launchPersistentContext("./user-data", {
			channel,
			headless: true,
			args: ["--disable-blink-features=AutomationControlled"],
		});
	} catch (e) {
		console.warn(
			`> Could not use channel="${channel}", falling back to bundled Chromium.`,
		);
		ctx = await chromium.launchPersistentContext("./user-data", {
			headless: true,
			args: ["--disable-blink-features=AutomationControlled"],
		});
	}

	const page = await ctx.newPage();
	await page.goto("https://www.google.com/travel/flights/saves", {
		waitUntil: "domcontentloaded",
		timeout: 60000,
	});

	// If Google kicked us to login/verify, notify and bail fast
	const url = page.url();
	const html = await page.content();
	if (
		/ServiceLogin|accounts\.google\.com/.test(url) ||
		/Verify it'?s you/i.test(html)
	) {
		await ctx.close();
		await post(
			"*Google Flights watcher:* Reauth needed. Run `npm run login` to refresh the session.",
		);
		return;
	}

	// Let SPA settle and load all tiles (basic scroll)
	await page.waitForTimeout(3500);
	try {
		await page.mouse.wheel(0, 1400);
	} catch {}
	await page.waitForTimeout(800);

	const data = await page.evaluate(extractor).catch(async (e) => {
		await ctx.close();
		throw e;
	});
	await ctx.close();

	const now = new Date().toISOString().slice(0, 16).replace("T", " ");
	const output = data.flights
		.concat(
			data.watches.length
				? ["--- Watches (no specific date) ---", ...data.watches]
				: [],
		)
		.join("\\n");

	// diff vs last
	let last = "";
	try {
		last = await fs.readFile(STATE_FILE, "utf8");
	} catch {}
	await fs.writeFile(STATE_FILE, output, "utf8");

	// Parse flight price drops from current output
	const drops = [];
	for (const line of data.flights) {
		const m = line.match(
			/::\\s*\\$(\\d[\\d,]*)\\b(?:\\s*\\|\\s*was\\s*\\$(\\d[\\d,]*))?/,
		);
		if (!m) continue;
		const curr = parseInt(m[1].replace(/,/g, ""), 10);
		const was = m[2] ? parseInt(m[2].replace(/,/g, ""), 10) : null;
		const delta = was ? was - curr : 0;
		if (delta >= PRICE_DROP_THRESHOLD) drops.push({ line, delta });
	}

	if (drops.length) {
		await post(
			`*Google Flights price drop(s) — ${now}*\\n\\\n\\\n\`\`\`\\n${drops.map((d) => d.line).join("\\n")}\\n\`\`\``,
		);
	}

	// Always print the full snapshot to console for local visibility
	console.log(output);
}

main().catch(async (e) => {
	console.error("Watcher error:", e);
	try {
		await post("*Google Flights watcher:* encountered an error. Check logs.");
	} catch {}
	process.exit(1);
});
