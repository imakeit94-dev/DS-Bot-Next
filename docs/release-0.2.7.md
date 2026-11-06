# DS Bot Next 0.2.7

0.2.7 is the first release on this fork's `main`. Two things carry the same version number and are not the same build:

- The installable package `ds-bot-next-0.2.7.tgz`, built from the maintenance line (`e8e76d0`), contains only the deliverables ordering change below.
- `main` (this repository's default branch) also integrates that maintenance line with the newer upstream-derived engine. It is source only: no `0.2.7` package has been published from it.

## Deliverables ordering

- Items presented at the same `time` now keep a stable order. The id, which starts with the Session id, is the secondary key, so scanning two Sessions in either order produces the same list.
- With more than 200 items across Sessions, the same items are discarded regardless of scan order.
- Three regression tests cover both scan orders, two Sessions that reuse the same sequence number, and the 200-item cut.
- Files: `ds-bot/src/host/deliverables.js`, `ds-bot/test/deliverables.test.js`.

## What the main integration adds on top

- The deliverables list now includes a group's own Session and its earlier parts, where the group itself presents files. Before, only member Sessions under `room.sessions` / `room.segments` were scanned.
- Group relay behavior follows main's protocol, which came from upstream 0.2.5: there is no per-group relay-limit setting and no Continue button. Bots may relay without limit while they use tools or produce new content. After six consecutive acknowledgement-only turns without a tool call, the next call is parked with a notice in the group until you write. Saved `relayLimit` and `relays` fields from older state are dropped by the existing migration.
- The maintenance line's workgroups, needs-your-attention list, deliverables list, fork identity and selected upstream fixes are present, as the README describes.

## Known issue, not fixed here

On DSH 0.2.2-rc.1, moving a group to a new conversation part can fail: `dsh-schedule.list` returns a paged object while `ds-bot/src/host/schedules.js:132` treats it as an array, so the call throws `TypeError: records is not iterable` and the group keeps its old schedule. Apart from the diagnostics entry the failure is silent. Whether queued tasks are kept or still fire was not verified. DSH 0.2.1-rc.4 does not show this.

## Checks

- 1452 unit tests: 1450 pass, 2 platform-specific skips, 0 fail. The generated client check and lint (0 errors) pass.
- Isolated smoke on DSH 0.2.1-rc.4: 52 of 52 steps. The smoke run does not cover the deliverables list; that path is covered by unit tests and a separate empty-state API check, not by non-empty runtime data.
- Not tested on Windows.
