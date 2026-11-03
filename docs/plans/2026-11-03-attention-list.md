# Needs your attention (local proposal)

The expanded sidebar has a compact list of live approval requests, pending questions and failed Bot turns. Choosing an item opens the Bot chat or, for a member working in a group, that group. A request disappears when it is answered; ordinary unread messages are not requests.

Failed turns add one persisted reminder per Bot chat or group. A later failure in that conversation replaces it with a fresh identity. Opening the chat or a later successful turn does not silently remove the reminder: the user explicitly marks it handled. Clearing a stale identity cannot remove a newer failure. The list stores only the destination and timestamp, not error details; the conversation retains the error. Up to 100 conversation failures are kept. Deleted chats do not appear. Existing failures from before this feature are not imported from diagnostic logs, whose entries do not track whether a user has handled them.

This is a local design proposal; coordination with the maintainer and alignment with upstream notification work remain open.
