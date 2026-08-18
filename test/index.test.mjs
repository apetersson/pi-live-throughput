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

function assistantMessage({ model = "test-model", responseModel, output = 0 } = {}) {
	return {
		role: "assistant",
		model,
		responseModel,
		usage: { output },
	};
}

function update(harness, delta, type = "text_delta") {
	harness.handlers.get("message_update")(
		{
			message: assistantMessage(),
			assistantMessageEvent: { type, delta },
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
		assert.deepEqual(view.widget, ["⚡ 0.0 tok/s · avg 0.0 tok/s · 0 tok · 0.0s · test-model"]);

		setNow(1200);
		update(harness, "x".repeat(400));
		assert.deepEqual(view.widget, ["⚡ 500 tok/s · avg 500 tok/s · 100 tok · 0.2s · test-model"]);

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
		assert.deepEqual(view.widget, ["⚡ 500 tok/s · avg 500 tok/s · 100 tok · 0.2s · test-model"]);

		setNow(5300);
		await commands.get("throughput").handler("reset", ctx);
		assert.deepEqual(view.widget, ["⚡ 0.0 tok/s · avg 0.0 tok/s · 0 tok · 0.0s · test-model"]);

		setNow(5500);
		update(harness, "x".repeat(400));
		assert.deepEqual(view.widget, ["⚡ 500 tok/s · avg 500 tok/s · 100 tok · 0.2s · test-model"]);

		setNow(6000);
		handlers.get("message_end")({ message: assistantMessage({ output: 500 }) }, ctx);
		assert.deepEqual(view.widget, ["✓ 500 tok in 1.0s · 500 tok/s avg · peak 500 tok/s · test-model"]);

		handlers.get("session_shutdown")({ reason: "quit" }, ctx);
		assert.equal(view.widget, undefined);
		assert.equal(view.status, undefined);
	});
});
