---
schema_version: 1
id: TG-1
title: "Add history text search and media filters"
slug: telegram_search_filters
status: review
priority: medium
type: feature
created: 2026-10-25T20:42:59Z
updated: 2026-10-25T20:44:50Z
start_date: 2026-10-25T20:42:59Z
commits:
  - 836fe0c
tests:
  - test/telegram-get.test.ts
---

# TG-1 — Add history text search and media filters

## Problem

History supports sender selection but cannot yet search message text or select a native Telegram media category.

## Solution

Extend the existing History operation with optional query and content_type inputs. Use Telegram search and media filters, and preserve all filters across cursor requests without changing the output array.

The MCP schema and any text-only filtering in Node-RED are a subsequent delivery step. The reply ancestry chain tool is cancelled.

## Acceptance criteria

- [x] Text search and each supported media category reach GramJS.
- [x] Query, sender and media selection combine and survive pagination.
- [x] Invalid inputs fail before a Telegram request.
- [x] Existing unfiltered history stays compatible.
- [x] Tests, typecheck, build and documentation pass review.

## Comments

### 2026-10-25T20:42:59Z — Maintainer

Implementation authorized through local preparation before push. Publishing, installation and flow updates require subsequent approval.

### 2026-10-25T20:44:35Z — Maintainer

Version 0.1.4 prepared. All 20 tests, TypeScript checking, build and package dry-run passed. Seven native media categories are supported. Text-only selection is explicitly left to the calling flow so the history array and pagination contract stay intact. Awaiting approval for push and subsequent installation.

### 2026-10-25T20:44:50Z — Maintainer

Implementation recorded in commit 836fe0c. Package prepared for review before push.
