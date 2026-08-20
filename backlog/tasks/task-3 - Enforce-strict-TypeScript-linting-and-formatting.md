---
id: TASK-3
title: Enforce strict TypeScript linting and formatting
status: Done
assignee:
  - '@andreas'
created_date: '2026-08-20 22:04'
updated_date: '2026-08-20 22:08'
labels:
  - tooling
  - typescript
  - quality
dependencies: []
modified_files:
  - .prettierignore
  - .prettierrc.json
  - eslint.config.js
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - README.md
  - src/index.ts
  - test/index.test.mjs
priority: high
type: chore
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raise the project's static-analysis baseline with strict TypeScript compiler options, type-aware ESLint rules, and deterministic Prettier formatting. Contributors and CI should have one verification command that rejects type errors, lint violations, formatting drift, and test failures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TypeScript compilation enables strict safety options beyond the base strict flag and the existing source compiles without suppressing project errors
- [x] #2 ESLint uses a maintained flat configuration with type-aware strict and stylistic TypeScript rules and checks the project's source, tests, and configuration files
- [x] #3 Prettier defines deterministic project formatting and a check command detects formatting drift
- [x] #4 The verification command runs formatting checks, TypeScript checks, ESLint, and tests
- [x] #5 All configured checks and tests pass after the existing codebase is formatted and corrected
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add strict compiler safety options that apply to project source while retaining dependency declaration compatibility. 2. Add an ESLint flat config using maintained recommended, strict type-checked, and stylistic type-checked TypeScript rule sets, with repository-specific strict rules and explicit exclusions for generated/user state. 3. Add deterministic Prettier configuration and scripts, then format owned source/config/test files. 4. Make verify run format checking, TypeScript, zero-warning ESLint, and tests; resolve findings without broad rule suppressions. 5. Run the full verification command and record objective completion evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation passed: pnpm install --frozen-lockfile; pnpm run verify (Prettier check, strict tsc, ESLint with zero warnings, and 8/8 tests); git diff --check. ESLint --print-config confirmed strict-boolean-expressions, no-unnecessary-condition, switch-exhaustiveness-check, and no-unsafe-assignment at error severity. A deliberately malformed temporary TypeScript file made Prettier --check fail, confirming drift detection.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added strict project TypeScript options, type-aware ESLint 10 flat configuration, deterministic Prettier configuration, documented scripts, and an aggregate verification pipeline. Formatted and corrected existing code without broad rule suppressions; all checks and 8 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
