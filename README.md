# pi-live-throughput

A single-line live tokens/sec display for the [Pi coding agent](https://pi.dev).

While an assistant response streams, the extension shows its rolling throughput,
average throughput, estimated output tokens, elapsed time, and model:

```text
⚡ 92.3 tok/s · avg 84.5 tok/s · 1.2k tok · 14.2s · deepseek-v4-flash
```

When streaming finishes, it replaces the live metrics with a final summary that
stays visible until the next assistant response starts:

```text
✓ 512 tok in 2.0s · 256 tok/s avg · peak 319 tok/s · deepseek-v4-flash
```

Live figures are estimates based on streamed text, thinking, and tool-call
deltas. The final token count uses Pi's provider-reported `usage.output` value.

## Install

Install from npm:

```bash
pi install npm:pi-live-throughput
```

Alternatively, install directly from GitHub:

```bash
pi install git:github.com/apetersson/pi-live-throughput
```

For local development, install the checkout instead:

```bash
pi install /absolute/path/to/pi-live-throughput
```

Use `/reload` if Pi was already running when you installed or changed the
extension.

## Commands

The widget is enabled above the editor by default.

| Command | Effect |
| --- | --- |
| `/throughput` | Toggle the display on or off |
| `/throughput on` | Enable the previously selected display mode |
| `/throughput off` | Hide the display |
| `/throughput widget` | Enable the full single-line widget above the editor |
| `/throughput status` | Enable a compact footer status instead |
| `/throughput reset` | Reset an active measurement or clear the final summary |

## Development

This project uses pnpm only:

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

To load the local extension without installing it:

```bash
pi -e ./src/index.ts
```

## License

[MIT](LICENSE)
