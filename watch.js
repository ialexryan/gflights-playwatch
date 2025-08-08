import { exec } from "child_process";
import "dotenv/config";
const { chromium } = await import("playwright");

import * as fs from "fs/promises";
import fetch from "node-fetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const PRICE_DROP_THRESHOLD = parseInt(
	process.env.PRICE_DROP_THRESHOLD || "25",
	10,
);
const STATE_FILE = "./last-data.json";
const DISPLAY_FILE = "./last-output.txt";

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
	if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
		console.log(text);
		return;
	}
	const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: TELEGRAM_CHAT_ID,
			text: text,
			parse_mode: "Markdown",
		}),
	});
}

async function main() {
	const ctx = await chromium.launchPersistentContext("./user-data", {
		headless: false,
		viewport: { width: 1280, height: 900 },
		args: [
			"--disable-blink-features=AutomationControlled",
			"--start-minimized",
			"--window-position=20000,20000",
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
		],
	});

	exec(
		`osascript -e 'tell application "System Events" to set visible of application process "Chromium" to false'`,
		(err) => {
			if (err) console.warn("AppleScript hide failed", err?.message);
		},
	);

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
		await page.mouse.wheel(0, 14000);
	} catch {}
	await page.waitForTimeout(800);

	// Debug: Check what elements exist on the page
	// const debugInfo = await page.evaluate(() => {
	// 	const cards = document.querySelectorAll(".U5HQrd");
	// 	const priceTexts = document.querySelectorAll(
	// 		'[jsname="z6Z3R"] [role="text"]',
	// 	);
	// 	const cheapestFlight = document.querySelectorAll(".U5HQrd .KHLctd .ogfYpf");
	// 	return {
	// 		cardCount: cards.length,
	// 		priceTextCount: priceTexts.length,
	// 		cheapestFlightCount: cheapestFlight.length,
	// 		pageTitle: document.title,
	// 		bodyText: document.body.innerText.substring(0, 500),
	// 	};
	// });
	// console.log("DEBUG: Page info:", JSON.stringify(debugInfo, null, 2));

	const data = await page.evaluate(extractor).catch(async (e) => {
		await ctx.close();
		throw e;
	});
	await ctx.close();

	// console.log("DEBUG: Extracted data:", JSON.stringify(data, null, 2));

	const now = new Date().toISOString().slice(0, 16).replace("T", " ");
	const output = data.flights
		.concat(
			data.watches.length
				? ["--- Watches (no specific date) ---", ...data.watches]
				: [],
		)
		.join("\\n");

	// Parse flights into structured format
	const structuredFlights = data.flights
		.map((line) => {
			const parts = line.split(" :: ");
			if (parts.length !== 2) return null;

			const flightInfo = parts[0].trim();
			const priceInfo = parts[1].trim();

			// Extract current price (look for $XXX at start)
			const priceMatch = priceInfo.match(/^\$(\d[\d,]*)/);
			if (!priceMatch) return null;
			const currentPrice = parseInt(priceMatch[1].replace(/,/g, ""), 10);

			// Extract "was" price if present
			const wasMatch = priceInfo.match(/was \$(\d[\d,]*)/);
			const wasPrice = wasMatch
				? parseInt(wasMatch[1].replace(/,/g, ""), 10)
				: null;

			// Generate flight ID from the flight info for matching
			const id = flightInfo.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");

			return {
				id,
				flightInfo,
				currentPrice,
				wasPrice,
				fullLine: line,
			};
		})
		.filter(Boolean);

	// console.log('DEBUG: Parsed', structuredFlights.length, 'flights');

	// Load previous data
	let lastData = { timestamp: null, flights: [] };
	try {
		const lastJson = await fs.readFile(STATE_FILE, "utf8");
		lastData = JSON.parse(lastJson);
	} catch {}

	// Create current data structure
	const currentData = {
		timestamp: now,
		flights: structuredFlights,
	};

	// Save current data
	await fs.writeFile(STATE_FILE, JSON.stringify(currentData, null, 2), "utf8");
	await fs.writeFile(DISPLAY_FILE, output, "utf8");

	// Compare prices with last run and find drops
	const drops = [];
	for (const currentFlight of structuredFlights) {
		const lastFlight = lastData.flights.find((f) => f.id === currentFlight.id);
		if (lastFlight && lastFlight.currentPrice > currentFlight.currentPrice) {
			const delta = lastFlight.currentPrice - currentFlight.currentPrice;
			if (delta >= PRICE_DROP_THRESHOLD) {
				const dropLine = `${currentFlight.flightInfo} :: $${currentFlight.currentPrice.toLocaleString()} | was $${lastFlight.currentPrice.toLocaleString()}`;
				drops.push({ line: dropLine, delta });
			}
		}
	}

	// console.log('DEBUG: Drops', drops);

	if (drops.length) {
		await post(
			`*Google Flights price drop(s) — ${now}*\n\n\`\`\`\n${drops.map((d) => d.line).join("\n")}\n\`\`\``,
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
