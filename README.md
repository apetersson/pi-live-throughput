# pi-live-throughput

Live tokens/sec throughput display for the [Pi coding agent](https://pi.dev).

While the model streams a response, shows a live widget (above the editor)
with:

- **live tok/s** over a rolling 3-second window
- **average tok/s** for the current response
- **estimated total tokens** and elapsed time
- **model id**

When a response finishes, the widget switches to a final summary using the
provider-reported token count (`usage.output`) and stays visible until the
next response starts streaming.

## Install

From this directory (local path install):

```bash
pi install /Users/andreas/code/pi-live-throughput
```

Or from a git URL once pushed:

```bash
pi install git:github.com/<you>/pi-live-throughput
```

Or quick-test without installing:

```bash
pi -e ./src/index.ts
```

## Usage

The display is on by default as a widget above the editor.

| Command | Effect |
|---------|--------|
| `/throughput` | Toggle on/off |
| `/throughput on` / `off` | Force on/off |
| `/throughput widget` | Widget above the editor (default) |
| `/throughput status` | Compact footer status line (`⚡ 42 tok/s`) |
| `/throughput reset` | Reset the current stream counters |

## How it works

- Subscribes to `message_update` events and counts streamed deltas
  (`text_delta`, `thinking_delta`, `toolcall_delta`).
- Live token estimates use the `~4 chars/token` heuristic.
- The final summary after each response uses the exact `usage.output`
  token count reported by the provider.
- Widget updates are throttled to ~200ms while streaming.

## Development

```bash
npm install
npm run check   # typecheck with tsc --noEmit
```

## License

MIT
