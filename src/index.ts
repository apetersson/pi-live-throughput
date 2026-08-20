/**
 * Live tokens/sec throughput display for the Pi coding agent.
 *
 * The default widget uses one line while streaming and replaces it with a
 * provider-usage summary that remains visible until the next response starts.
 * Live metrics prefer cumulative provider usage when it advances during the
 * stream. Until then, clearly labeled estimates count text, thinking, and
 * tool-call delta characters using a four-characters-per-token heuristic.
 */

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "throughput";
const STATUS_KEY = "throughput";
const WINDOW_MS = 3000;
const UPDATE_INTERVAL_MS = 200;
const CHARS_PER_TOKEN = 4;

type DisplayMode = "widget" | "status";

interface Sample {
	t: number;
	tokens: number;
}

interface StreamingState {
	kind: "streaming";
	responseStartTime: number;
	measurementStartTime: number;
	totalChars: number;
	providerOutputBaseline: number;
	lastProviderOutput: number;
	reportedOutputTokens: number;
	usesReportedUsage: boolean;
	samples: Sample[];
	peakRate: number;
	lastRender: number;
	model: string;
}

interface FinalState {
	kind: "final";
	outputTokens: number;
	elapsedSec: number;
	averageRate: number;
	peakRate: number;
	model: string;
}

type ThroughputState = StreamingState | FinalState;

export default function (pi: ExtensionAPI) {
	let mode: DisplayMode = "widget";
	let enabled = true;
	let state: ThroughputState | undefined;
	let ui: ExtensionUIContext | undefined;
	let hasUI = false;

	const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
	const fmtRate = (rate: number): string => (rate >= 100 ? rate.toFixed(0) : rate.toFixed(1));
	const estimatedTokens = (chars: number): number => chars / CHARS_PER_TOKEN;

	const clearUi = (): void => {
		ui?.setWidget(WIDGET_KEY, undefined);
		ui?.setStatus(STATUS_KEY, undefined);
	};

	const rollingRate = (stream: StreamingState, now: number): number => {
		const windowStart = Math.max(stream.measurementStartTime, now - WINDOW_MS);
		stream.samples = stream.samples.filter((sample) => sample.t >= windowStart);
		const elapsedMs = now - windowStart;
		if (elapsedMs <= 0 || stream.samples.length === 0) return 0;
		const tokens = stream.samples.reduce((sum, sample) => sum + sample.tokens, 0);
		return tokens / (elapsedMs / 1000);
	};

	const liveOutputTokens = (stream: StreamingState): number =>
		stream.usesReportedUsage ? stream.reportedOutputTokens : estimatedTokens(stream.totalChars);

	const showLine = (line: string): void => {
		if (mode === "status") {
			ui?.setWidget(WIDGET_KEY, undefined);
			ui?.setStatus(STATUS_KEY, line);
		} else {
			ui?.setStatus(STATUS_KEY, undefined);
			ui?.setWidget(WIDGET_KEY, [line]);
		}
	};

	const render = (): void => {
		if (!state || !hasUI || !enabled) return;

		if (state.kind === "final") {
			const model = state.model ? ` · ${state.model}` : "";
			const line =
				mode === "status"
					? `✓ ${fmt(state.outputTokens)} tok · ${fmtRate(state.averageRate)} tok/s`
					: `✓ ${fmt(state.outputTokens)} tok in ${state.elapsedSec.toFixed(1)}s · ${fmtRate(state.averageRate)} tok/s avg · peak ${fmtRate(state.peakRate)} tok/s${model}`;
			showLine(line);
			return;
		}

		const now = Date.now();
		const live = rollingRate(state, now);
		state.peakRate = Math.max(state.peakRate, live);
		const elapsedSec = (now - state.measurementStartTime) / 1000;
		const outputTokens = liveOutputTokens(state);
		const averageRate = outputTokens / Math.max(elapsedSec, 0.001);
		const estimateLabel = state.usesReportedUsage ? "" : "est. ";
		const estimateMark = state.usesReportedUsage ? "" : "~";
		const model = state.model ? ` · ${state.model}` : "";
		const line =
			mode === "status"
				? `⚡ ${estimateLabel}${fmtRate(live)} tok/s · ${estimateMark}${fmt(outputTokens)} tok`
				: `⚡ ${estimateLabel}${fmtRate(live)} tok/s · avg ${fmtRate(averageRate)} tok/s · ${estimateMark}${fmt(outputTokens)} tok · ${elapsedSec.toFixed(1)}s${model}`;
		showLine(line);
	};

	pi.on("session_start", (_event, ctx) => {
		ui = ctx.ui;
		hasUI = ctx.hasUI;
	});

	pi.on("session_shutdown", () => {
		clearUi();
		state = undefined;
		ui = undefined;
		hasUI = false;
	});

	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		ui = ctx.ui;
		hasUI = ctx.hasUI;
		const now = Date.now();
		state = {
			kind: "streaming",
			responseStartTime: now,
			measurementStartTime: now,
			totalChars: 0,
			providerOutputBaseline: 0,
			lastProviderOutput: 0,
			reportedOutputTokens: 0,
			usesReportedUsage: false,
			samples: [],
			peakRate: 0,
			lastRender: now,
			model: event.message.responseModel ?? event.message.model ?? ctx.model?.id ?? "",
		};
		render();
	});

	pi.on("message_update", (event, ctx) => {
		if (event.message.role !== "assistant" || state?.kind !== "streaming") return;
		ui = ctx.ui;
		hasUI = ctx.hasUI;
		const stream = state;
		stream.model = event.message.responseModel ?? event.message.model ?? stream.model;
		const update = event.assistantMessageEvent;
		const now = Date.now();
		const providerOutput = event.message.usage.output;
		let providerAdvanced = false;
		let switchedToReportedUsage = false;

		if (Number.isFinite(providerOutput) && providerOutput > stream.lastProviderOutput) {
			const previousOutput = Math.max(stream.lastProviderOutput, stream.providerOutputBaseline);
			stream.lastProviderOutput = providerOutput;
			if (providerOutput > stream.providerOutputBaseline) {
				providerAdvanced = true;
				if (!stream.usesReportedUsage) {
					stream.usesReportedUsage = true;
					stream.samples = [];
					stream.peakRate = 0;
					switchedToReportedUsage = true;
				}
				stream.reportedOutputTokens = providerOutput - stream.providerOutputBaseline;
				stream.samples.push({ t: now, tokens: providerOutput - previousOutput });
			}
		}

		const isDelta =
			update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta";
		const chars = isDelta ? update.delta.length : 0;
		if (chars > 0) {
			stream.totalChars += chars;
			if (!stream.usesReportedUsage) stream.samples.push({ t: now, tokens: estimatedTokens(chars) });
		}

		const usageOnlyUpdate = providerAdvanced && !isDelta;
		if (switchedToReportedUsage || usageOnlyUpdate || (chars > 0 && now - stream.lastRender >= UPDATE_INTERVAL_MS)) {
			stream.lastRender = now;
			render();
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant" || state?.kind !== "streaming") return;
		ui = ctx.ui;
		hasUI = ctx.hasUI;
		const now = Date.now();
		const stream = state;
		const peakRate = Math.max(stream.peakRate, rollingRate(stream, now));
		const elapsedSec = (now - stream.responseStartTime) / 1000;
		const outputTokens = event.message.usage.output;
		state = {
			kind: "final",
			outputTokens,
			elapsedSec,
			averageRate: outputTokens / Math.max(elapsedSec, 0.001),
			peakRate,
			model: event.message.responseModel ?? event.message.model ?? stream.model,
		};
		render();
	});

	pi.registerCommand("throughput", {
		description: "Show live tokens/sec. Args: on|off|widget|status|reset",
		handler: async (args, ctx) => {
			ui = ctx.ui;
			hasUI = ctx.hasUI;
			const arg = args.trim().toLowerCase();

			if (!arg || arg === "toggle") {
				enabled = !enabled;
				if (enabled) render();
				else clearUi();
				ctx.ui.notify(`Live throughput: ${enabled ? mode : "off"}`, "info");
				return;
			}

			switch (arg) {
				case "on":
					enabled = true;
					render();
					ctx.ui.notify(`Live throughput: ${mode}`, "info");
					return;
				case "off":
					enabled = false;
					clearUi();
					ctx.ui.notify("Live throughput: off", "info");
					return;
				case "widget":
				case "status":
					mode = arg;
					enabled = true;
					clearUi();
					render();
					ctx.ui.notify(`Live throughput: ${mode}`, "info");
					return;
				case "reset":
					if (state?.kind === "streaming") {
						const now = Date.now();
						state.measurementStartTime = now;
						state.totalChars = 0;
						state.providerOutputBaseline = state.lastProviderOutput;
						state.reportedOutputTokens = 0;
						state.samples = [];
						state.peakRate = 0;
						state.lastRender = now;
						clearUi();
						render();
						ctx.ui.notify("Current throughput metrics reset", "info");
					} else if (state?.kind === "final") {
						state = undefined;
						clearUi();
						ctx.ui.notify("Final throughput summary cleared", "info");
					} else {
						ctx.ui.notify("No throughput metrics to reset", "info");
					}
					return;
				default:
					ctx.ui.notify("Usage: /throughput [on|off|widget|status|reset|toggle]", "error");
			}
		},
	});
}
