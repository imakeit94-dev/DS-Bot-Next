# Deliverables by sidebar group (local proposal)

The sidebar offers an on-demand list of files explicitly declared with DSH's `present` tool. It reads team-owned Session history using the documented `sessionQuery` service: a Bot entry includes its own chat parts; a group-chat entry includes its members' current and earlier group Sessions. A sidebar group filters by its assigned conversation entries. Clicking a result opens its source Bot or group conversation. The list shows a filename, source and timestamp; it does not read or return file contents or full paths.

The list is refreshed on opening, changing the filter, or pressing Refresh. At most 200 newest files are shown; truncation and unreadable Sessions are reported. An unavailable query service is an error, not an empty result. Inherited fork events are excluded to avoid duplicated ownership. Files not explicitly presented, including ordinary chat messages and undeclared workspace files, are not included. A file declaration references its current source file and does not preserve a version. The source conversation, rather than the exact historical turn, is opened.

This is a local proposal for user testing, not an upstream design decision.
