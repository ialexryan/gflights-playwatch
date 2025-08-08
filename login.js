const { chromium } = await import("playwright");

import fs from "fs/promises";

(async () => {
	const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
	let ctx;
	try {
		ctx = await chromium.launchPersistentContext("./user-data", {
			channel,
			headless: false,
			viewport: { width: 1280, height: 900 },
			args: ["--disable-blink-features=AutomationControlled"],
		});
	} catch (e) {
		console.warn(
			`> Could not use channel="${channel}", falling back to bundled Chromium.`,
		);
		ctx = await chromium.launchPersistentContext("./user-data", {
			headless: false,
			viewport: { width: 1280, height: 900 },
			args: ["--disable-blink-features=AutomationControlled"],
		});
	}
	const page = await ctx.newPage();
	await page.goto("https://www.google.com/travel/flights/saves", {
		waitUntil: "domcontentloaded",
	});
	console.log("> 1) Log in to Google (if prompted)");
	console.log(
		"> 2) Ensure the Saved Flights list renders (scroll once if needed)",
	);
	console.log("> 3) Press Enter here to save the session.");
	process.stdin.resume();
	process.stdin.once("data", async () => {
		await ctx.close();
		console.log("> Saved. Persistent profile is in ./user-data");
		process.exit(0);
	});
})();
