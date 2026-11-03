# DS Bot Next development notes

DS Bot Next is a local extension of DS Bot. Sidebar groups organize Bots and group chats without changing their membership; they can be collapsed, pinned, and reordered. Needs your attention collects pending approvals and questions, plus failed Bot runs. A failure stays until marked handled; a newer failure in the same conversation cannot be cleared by an older action.

## Validation

On 2026-11-03, the isolated mock environment passed 1,357 unit tests (two platform-specific tests skipped), the generated client check, lint (38 existing warnings), and all 52 smoke steps. Browser testing covered a question appearing and clearing after an answer, a group approval linking from another chat and clearing after rejection, and Bot and group failures linking to the correct chat and clearing explicitly. A failure also survived a mock service restart.

The changes were not tested with Windows, touch input or a screen reader. Local test data, generated installation packages and private working notes are not included in this repository.

## Candidate future work

- Distinguish workgroup activity, unread items and requests, and make organizing chats easier.
- Collect task deliverables with links to their source conversations.
- Offer manually requested workgroup summaries with references.
- Improve independent Next version management and switching.

Upstream feature proposals and contribution decisions remain with the DS Bot maintainer.
