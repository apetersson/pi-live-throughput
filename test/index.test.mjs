import assert from "node:assert/strict";
import test from "node:test";

import throughputExtension from "../src/index.ts";

function createHarness() {
	const handlers = new Map();
	const commands = new Map();
	const view = {
		widget: undefined,
		status: undefined,
		notifications: [],
	};
	const ui = {
		setWidget(_key, content) {
			view.widget = content;
		},
		setStatus(_key, content) {
			view.status = content;
		},
		notify(message, type) {
			view.notifications.push({ message, type });
		},
	};
	const ctx = {
		ui,
		hasUI: true,
		model: { id: "configured-model" },
	};
	const pi = {
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
	};

	throughputExtension(pi);
	handlers.get("session_start")({ reason: "startup" }, ctx);

	return { handlers, commands, ctx, view };
}

function assistantMessage({
	model = "test-model",
	responseModel,
	input = 0,
	output = 0,
	cacheRead = 0,
	cacheWrite = 0,
} = {}) {
	return {
		role: "assistant",
		model,
		responseModel,
		usage: { input, output, cacheRead, cacheWrite },
	};
}

function providerRequest(harness) {
	harness.handlers.get("before_provider_request")({ type: "before_provider_request", payload: {} }, harness.ctx);
}

function update(harness, delta, type = "text_delta", output = 0) {
	harness.handlers.get("message_update")(
		{
			message: assistantMessage({ output }),
			assistantMessageEvent: { type, delta },
		},
		harness.ctx,
	);
}

function usageUpdate(harness, output, type = "text_end") {
	harness.handlers.get("message_update")(
		{
			message: assistantMessage({ output }),
			assistantMessageEvent: { type, contentIndex: 0, content: "" },
		},
		harness.ctx,
	);
}

async function withFakeClock(run) {
	const originalNow = Date.now;
	let now = 1000;
	Date.now = () => now;
	try {
		await run((value) => {
			now = value;
		});
	} finally {
		Date.now = originalNow;
	}
}

test("keeps a stable final summary through display-mode changes", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, commands, ctx, view } = harness;
		const message = assistantMessage();

		handlers.get("message_start")({ message }, ctx);
		assert.deepEqual(view.widget, ["⚡ est. 0.0 tok/s · avg 0.0 tok/s · ~0 tok · 0.0s · test-model"]);

		setNow(1200);
		update(harness, "x".repeat(400));
		assert.deepEqual(view.widget, ["⚡ est. 500 tok/s · avg 500 tok/s · ~100 tok · 0.2s · test-model"]);

		setNow(1400);
		update(harness, "x".repeat(400), "thinking_delta");

		setNow(2000);
		handlers.get("message_end")({ message: assistantMessage({ output: 300 }) }, ctx);
		const finalWidget = "✓ 300 tok in 1.0s · 300 tok/s avg · peak 500 tok/s · test-model";
		assert.deepEqual(view.widget, [finalWidget]);

		setNow(10_000);
		await commands.get("throughput").handler("status", ctx);
		assert.equal(view.widget, undefined);
		assert.equal(view.status, "✓ 300 tok · 300 tok/s");

		await commands.get("throughput").handler("off", ctx);
		assert.equal(view.status, undefined);
		await commands.get("throughput").handler("", ctx);
		assert.equal(view.status, "✓ 300 tok · 300 tok/s", "toggle restores the selected status mode");

		await commands.get("throughput").handler("widget", ctx);
		assert.deepEqual(view.widget, [finalWidget], "final values do not decay while idle");

		await commands.get("throughput").handler("reset", ctx);
		assert.equal(view.widget, undefined, "reset clears an idle final summary");
		await commands.get("throughput").handler("reset", ctx);
		assert.equal(view.widget, undefined, "idle reset does not create a phantom stream");
		assert.equal(view.notifications.at(-1).message, "No throughput metrics to reset");
	});
});

test("switches from estimated deltas to cumulative provider usage", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, ctx, view } = harness;

		handlers.get("message_start")({ message: assistantMessage() }, ctx);

		setNow(1200);
		update(harness, "x".repeat(400));
		assert.deepEqual(view.widget, ["⚡ est. 500 tok/s · avg 500 tok/s · ~100 tok · 0.2s · test-model"]);

		setNow(1400);
		update(harness, "x".repeat(400), "text_delta", 50);
		assert.deepEqual(
			view.widget,
			["⚡ 125 tok/s · avg 125 tok/s · 50 tok · 0.4s · test-model"],
			"the first advancing provider report replaces the heuristic and its rolling samples",
		);

		setNow(1600);
		update(harness, "x".repeat(400), "thinking_delta", 90);
		assert.deepEqual(view.widget, ["⚡ 150 tok/s · avg 150 tok/s · 90 tok · 0.6s · test-model"]);
	});
});

test("observes provider usage on updates without content deltas", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, ctx, view } = harness;

		handlers.get("message_start")({ message: assistantMessage() }, ctx);

		setNow(1100);
		usageUpdate(harness, 20);
		assert.deepEqual(view.widget, ["⚡ 200 tok/s · avg 200 tok/s · 20 tok · 0.1s · test-model"]);

		setNow(1150);
		usageUpdate(harness, 30, "toolcall_end");
		assert.deepEqual(
			view.widget,
			["⚡ 200 tok/s · avg 200 tok/s · 30 tok · 0.1s · test-model"],
			"usage-only events render even inside the normal delta update interval",
		);

		setNow(2000);
		handlers.get("message_end")({ message: assistantMessage({ output: 80 }) }, ctx);
		assert.deepEqual(view.widget, ["✓ 80 tok in 1.0s · 80.0 tok/s avg · peak 200 tok/s · test-model"]);
	});
});

test("reports cached prompt metrics and excludes cache reads from approximate processing", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, ctx, view } = harness;

		providerRequest(harness);
		setNow(1100);
		handlers.get("message_start")({ message: assistantMessage() }, ctx);
		setNow(1300);
		update(harness, "first output");
		setNow(2000);
		handlers.get("message_end")(
			{ message: assistantMessage({ input: 200, output: 50, cacheRead: 800, cacheWrite: 100 }) },
			ctx,
		);

		assert.deepEqual(view.widget, [
			"✓ 50 tok in 0.9s · 55.6 tok/s avg · peak 15.0 tok/s · input 200 tok · cache read 800 tok · cache write 100 tok · TTFT 300ms · approx. prompt 1000 tok/s · test-model",
		]);
		assert.doesNotMatch(view.widget[0], /approx\. prompt 3\.7k tok\/s/, "cache reads are not treated as processed tokens");
	});
});

test("reports uncached input and request-boundary TTFT without cache placeholders", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, ctx, view } = harness;

		providerRequest(harness);
		setNow(1200);
		handlers.get("message_start")({ message: assistantMessage() }, ctx);
		setNow(1500);
		update(harness, "first output");
		setNow(2000);
		handlers.get("message_end")({ message: assistantMessage({ input: 600, output: 40 }) }, ctx);

		assert.match(view.widget[0], /input 600 tok · TTFT 500ms · approx\. prompt 1200 tok\/s/);
		assert.doesNotMatch(view.widget[0], /cache (read|write)/);
	});
});

test("omits unavailable and partially reported prompt metrics cleanly", async () => {
	await withFakeClock(async (setNow) => {
		const partial = createHarness();
		partial.handlers.get("message_start")({ message: assistantMessage() }, partial.ctx);
		setNow(1500);
		partial.handlers.get("message_end")({ message: assistantMessage({ input: 250, output: 10 }) }, partial.ctx);
		assert.match(partial.view.widget[0], /input 250 tok/);
		assert.doesNotMatch(partial.view.widget[0], /cache|TTFT|approx\. prompt/);

		setNow(2000);
		const unavailable = createHarness();
		providerRequest(unavailable);
		setNow(2200);
		unavailable.handlers.get("message_start")({ message: assistantMessage() }, unavailable.ctx);
		setNow(2400);
		update(unavailable, "first output");
		setNow(3000);
		unavailable.handlers.get("message_end")({ message: assistantMessage({ output: 10 }) }, unavailable.ctx);
		assert.match(unavailable.view.widget[0], /TTFT 400ms/);
		assert.doesNotMatch(unavailable.view.widget[0], /input|cache|approx\. prompt/);
	});
});

test("omits TTFT and approximate prompt rate when no output arrives", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, ctx, view } = harness;

		providerRequest(harness);
		setNow(1100);
		handlers.get("message_start")({ message: assistantMessage() }, ctx);
		setNow(2000);
		handlers.get("message_end")({ message: assistantMessage({ input: 300 }) }, ctx);

		assert.match(view.widget[0], /input 300 tok/);
		assert.doesNotMatch(view.widget[0], /TTFT|approx\. prompt/);
	});
});

test("ignores empty deltas and resets only the active measurement window", async () => {
	await withFakeClock(async (setNow) => {
		const harness = createHarness();
		const { handlers, commands, ctx, view } = harness;

		setNow(5000);
		handlers.get("message_start")({ message: assistantMessage() }, ctx);
		const initialLine = view.widget;

		setNow(5100);
		update(harness, "");
		assert.deepEqual(view.widget, initialLine, "empty deltas do not add an estimated token");

		setNow(5200);
		update(harness, "x".repeat(400), "toolcall_delta");
		assert.deepEqual(view.widget, ["⚡ est. 500 tok/s · avg 500 tok/s · ~100 tok · 0.2s · test-model"]);

		setNow(5300);
		await commands.get("throughput").handler("reset", ctx);
		assert.deepEqual(view.widget, ["⚡ est. 0.0 tok/s · avg 0.0 tok/s · ~0 tok · 0.0s · test-model"]);

		setNow(5500);
		update(harness, "x".repeat(400));
		assert.deepEqual(view.widget, ["⚡ est. 500 tok/s · avg 500 tok/s · ~100 tok · 0.2s · test-model"]);

		setNow(6000);
		handlers.get("message_end")({ message: assistantMessage({ output: 500 }) }, ctx);
		assert.deepEqual(view.widget, ["✓ 500 tok in 1.0s · 500 tok/s avg · peak 500 tok/s · test-model"]);

		handlers.get("session_shutdown")({ reason: "quit" }, ctx);
		assert.equal(view.widget, undefined);
		assert.equal(view.status, undefined);
	});
});
