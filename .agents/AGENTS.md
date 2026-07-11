# Custom Rules for pluto20139/content-hub

## ID Naming and Logging Conventions (V1.2 Optimization)

To prevent confusion between similar-looking database IDs of different entities (e.g. `contents.id` vs `monitors.id`), the following conventions are strictly enforced:

1. **Explicit Suffix Naming**:
   - In all TypeScript code, scripts, database queries, and variables:
     - Use `contentId` (or `content_id` in snake_case) instead of a generic `id`.
     - Use `monitorId` (or `monitor_id` in snake_case) instead of a generic `id`.
     - Only use generic `id` inside a strictly scoped callback (like mapping) where the context is single-line and obvious.

2. **Explicit Console Logging**:
   - When printing log output to `console.log`, `console.error`, or other output channels, always suffix or prefix the ID with its explicit entity type:
     - Correct: `[DIFY] Processing Video (Content ID: 15)`
     - Incorrect: `[DIFY] Processing video 15`
     - Correct: `[CRON] Syncing Monitor (Monitor ID: 3)`
     - Incorrect: `[CRON] Syncing Monitor 3`

3. **Verify ID Mappings in Database Operations**:
   - Before writing scripts that manually update or query records, crosscheck the ID types to ensure a content ID is never compared directly with a monitor ID, and verify the correct foreign keys.
