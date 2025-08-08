import "dotenv/config";
import fetch from "node-fetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

async function testTelegram() {
	if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
		console.log("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
		return;
	}

	const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: TELEGRAM_CHAT_ID,
			text: "*Test message from Google Flights watcher* 🛫\n\nTelegram integration is working!",
			parse_mode: "Markdown",
		}),
	});

	const result = await response.json();
	console.log("Telegram API response:", result);
}

testTelegram().catch(console.error);
