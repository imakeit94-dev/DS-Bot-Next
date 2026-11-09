# Parallel group calls and existing relay controls

This fork incorporates the parallel group-call engine from upstream DS Bot PR #746 while preserving Next's existing relay controls and saved state. The relay safety boundary and its tests apply to both existing teams and newly created teams.

> Status note (0.2.7): this design was superseded. The integrated `main` follows upstream 0.2.5 and the newer engine: the editable per-group `relayLimit` and the Continue control described below no longer exist, and saved `relayLimit`/`relays` fields are dropped by the existing migration. The `room.paused` parked queue remains: a parked call runs in the group's next round once you write. The text below is kept as the record of the 0.2.6-era compatibility layer.

- Members explicitly called together start concurrently when their group has enough relay capacity. A plain message in everyone mode remains ordered. A Bot's own Session still handles one group call at a time.
- The existing per-group `relayLimit` remains editable and defaults to three times the member count. `relays` and `paused` are retained when existing state is loaded; no migration removes them.
- Each Bot-to-Bot call occupies one count when it starts. When a parallel batch exceeds the available capacity, calls within the limit start and the rest are parked once, with their original caller and note. A single pause notice identifies the waiting members. Calls originating from the user do not consume the limit.
- A user message or Continue resets the count. Calls selected by the user run before parked calls resume. A Continue on an unpaused group does nothing. A paused queue survives a restart.
- The upstream six-turn guard for repetitive no-tool acknowledgements also pauses calls. The same Continue control or a user message releases them.
- Existing workgroups, attention failures, deliverables, privacy checks, member-specific group folders, and subagent support are not removed. A post that requests a report returns to its originating conversation, and long posts retain mentions beyond the preview.

Parallel answers can observe the same preceding conversation state; they should not be treated as an ordered sequence. A plain message to everyone is still ordered where that order matters.
