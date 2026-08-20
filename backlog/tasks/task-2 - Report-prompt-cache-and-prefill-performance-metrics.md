---
id: TASK-2
title: Report prompt cache and prefill performance metrics
status: To Do
assignee: []
created_date: '2026-08-20 18:57'
labels:
  - prompt
  - cache
  - metrics
dependencies: []
references:
  - 'https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts'
modified_files:
  - src/index.ts
  - README.md
priority: medium
type: enhancement
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose the prompt-side performance information available through Pi's normalized usage data. Report prompt and cache token counts, time to first output, and a clearly labeled best-effort prompt-processing throughput estimate without implying that network and provider queue latency are true model prefill time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The extension reports normalized input, cache-read, and cache-write token counts when the provider supplies them and omits unavailable metrics cleanly
- [ ] #2 The extension measures time to first output from the provider request boundary and reports it as TTFT
- [ ] #3 A prompt-processing throughput estimate is shown only when the required token and timing data are available and is clearly labeled approximate
- [ ] #4 Cache-read tokens are reported separately and are not presented as tokens processed by the model
- [ ] #5 Documentation defines the prompt-processing estimate and explains that TTFT can include network, queueing, routing, cache lookup, and model startup time
- [ ] #6 Automated tests cover cached, uncached, partially reported, and unavailable provider metrics
<!-- AC:END -->
