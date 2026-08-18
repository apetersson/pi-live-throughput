/**
 * pi-live-throughput
 *
 * Live tokens/sec throughput display for the Pi coding agent.
 *
 * While a model response is streaming, shows:
 *   - live tok/s over a rolling window (3s)
 *   - average tok/s for the current response
 *   - estimated total tokens and elapsed time
 *   - model id
 *
 * When the response completes, the display switches to a final summary using
 * the provider-reported token count (usage.output) and clears after a short
 * hold so it does not linger.
 *
 * Display: widget above the editor (default) or compact footer status line.
 *
 * Commands:
 *   /throughput           toggle on/off
 *   /throughput on|off    force on/off
 *   /throughput widget    widget above the editor
 *   /throughput status    compact status line
 *   /throughput reset     reset the current stream
 *
 * Note: live figures are estimates (~4 chars/token); the final summary uses
 * the exact provider token count.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "throughput";
const STATUS_KEY = "throughput";
const WINDOW_MS = 3000; // rolling window for the live rate
const UPDATE_INTERVAL_MS = 200; // throttle widget refreshes while streaming
const DONE_HOLD_MS = 3000; // how long the final summary stays visible
const CHARS_PER_TOKEN = 4; // heuristic for live token estimation

type DisplayMode = "widget" | "status" | "off";

interface Sample {
	t: number;
	tokens: number;
}

interface StreamState {
	startTime: number;
	totalTokens: number;
	samples: Sample[];
	peakRate: number;
	lastRender: number;
	model: string;
}

export default function (pi: ExtensionAPI) {
	let mode: DisplayMode = "widget";
	let stream: StreamState | undefined;
	let clearTimer: ReturnType<typeof setTimeout> | undefined;
	let ui: ExtensionUIContext | undefined;
	let hasUI = false;

	const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

	const fmtRate = (r: number): string => (r >= 100 ? r.toFixed(0) : r.toFixed(1));

	const estTokens = (delta: string): number => Math.max(1, Math.round(delta.length / CHARS_PER_TOKEN));

	const liveRate = (now: number): number => {
		if (!stream) return 0;
		const cutoff = now - WINDOW_MS;
		stream.samples = stream.samples.filter((s) => s.t >= cutoff);
		if (stream.samples.length < 2) return 0; // need a real span, not a 1ms spike
		const span = Math.max(now - stream.samples[0]!.t, 1);
		const tokens = stream.samples.reduce((sum, s) => sum + s.tokens, 0);
		return (tokens / span) * 1000;
	};

	const clearUi = (): void => {
		ui?.setWidget(WIDGET_KEY, undefined);
		ui?.setStatus(STATUS_KEY, undefined);
	};

	const render = (final?: { outputTokens: number }): void => {
		if (!stream || !hasUI || mode === "off") return;
		const now = Date.now();
		const elapsedSec = (now - stream.startTime) / 1000;
		const live = liveRate(now);
		stream.peakRate = Math.max(stream.peakRate, live);
		const total = final ? final.outputTokens : stream.totalTokens;
		const avg = total / Math.max(elapsedSec, 0.001);
		const model = stream.model;

		if (mode === "status") {
			const text = final
				? `✓ ${fmt(total)} tok · ${fmtRate(avg)} tok/s`
				: `⚡ ${fmtRate(live)} tok/s · ${fmt(total)} tok`;
			ui?.setStatus(STATUS_KEY, text);
			return;
		}

		const lines = final
			? [
					`✓ ${fmt(total)} tok in ${elapsedSec.toFixed(1)}s · ${fmtRate(avg)} tok/s avg`,
					`peak ${fmtRate(stream.peakRate)} tok/s · ${model}`,
				]
			: [
					`⚡ ${fmtRate(live)} tok/s · avg ${fmtRate(avg)} tok/s`,
					`${fmt(total)} tok · ${elapsedSec.toFixed(1)}s · ${model}`,
				];
		ui?.setWidget(WIDGET_KEY, lines);
	};

	const resetStream = (ctx?: ExtensionContext): void => {
		if (clearTimer) {
			clearTimeout(clearTimer);
			clearTimer = undefined;
		}
		stream = {
			startTime: Date.now(),
			totalTokens: 0,
			samples: [],
			peakRate: 0,
			lastRender: 0,
			model: ctx?.model?.id ?? "",
		};
	};

	pi.on("session_start", (_event, ctx) => {
		ui = ctx.ui;
		hasUI = ctx.hasUI;
	});

	pi.on("session_shutdown", () => {
		if (clearTimer) clearTimeout(clearTimer);
		clearTimer = undefined;
		clearUi();
		stream = undefined;
		ui = undefined;
		hasUI = false;
	});

	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		resetStream(ctx);
		render();
	});

	pi.on("message_update", (event, ctx) => {
		if (event.message.role !== "assistant" || !stream) return;
		ui = ctx.ui;
		hasUI = ctx.hasUI;
		const ev = event.assistantMessageEvent;
		if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta") {
			const now = Date.now();
			stream.totalTokens += estTokens(ev.delta);
			stream.samples.push({ t: now, tokens: estTokens(ev.delta) });
			if (now - stream.lastRender >= UPDATE_INTERVAL_MS) {
				stream.lastRender = now;
				render();
			}
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant" || !stream) return;
		const usage = event.message.usage;
		const output = usage?.output ?? Math.round(stream.totalTokens);
		render({ outputTokens: output });
		clearTimer = setTimeout(() => {
			clearUi();
			stream = undefined;
		}, DONE_HOLD_MS);
	});

	pi.registerCommand("throughput", {
		description: "Show live tokens/sec. Args: on|off|widget|status|reset",
		handler: async (args, ctx) => {
			ui = ctx.ui;
			hasUI = ctx.hasUI;
			const arg = args.trim().toLowerCase();

			if (!arg || arg === "toggle") {
				mode = mode === "off" ? "widget" : "off";
				if (mode === "off") clearUi();
				else render();
				ctx.ui.notify(`Live throughput: ${mode}`, "info");
				return;
			}

			switch (arg) {
				case "on":
					mode = mode === "off" ? "widget" : mode;
					render();
					ctx.ui.notify(`Live throughput: ${mode}`, "info");
					return;
				case "off":
					mode = "off";
					clearUi();
					ctx.ui.notify("Live throughput: off", "info");
					return;
				case "widget":
				case "status":
					mode = arg;
					clearUi();
					render();
					ctx.ui.notify(`Live throughput: ${mode}`, "info");
					return;
				case "reset":
					resetStream(ctx);
					clearUi();
					if (mode !== "off") render();
					ctx.ui.notify("Throughput stream reset", "info");
					return;
				default:
					ctx.ui.notify("Usage: /throughput [on|off|widget|status|reset|toggle]", "error");
			}
		},
	});
}
