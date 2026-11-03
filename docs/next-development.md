# DS Bot Next development notes

DS Bot Next is a local extension of DS Bot. Sidebar groups organize Bots and group chats without changing their membership; they can be collapsed, pinned, and reordered. Needs your attention collects pending approvals and questions, plus failed Bot runs. A failure stays until marked handled; a newer failure in the same conversation cannot be cleared by an older action.

## Validation

On 2026-11-03, the isolated mock environment passed 1,357 unit tests (two platform-specific tests skipped), the generated client check, lint (38 existing warnings), and all 52 smoke steps. Browser testing covered a question appearing and clearing after an answer, a group approval linking from another chat and clearing after rejection, and Bot and group failures linking to the correct chat and clearing explicitly. A failure also survived a mock service restart.

The changes were not tested with Windows, touch input or a screen reader. Local test data, generated installation packages and private working notes are not included in this repository.

## Candidate future work

- Offer manually requested workgroup summaries with references.
- Improve independent Next version management and switching.

Upstream feature proposals and contribution decisions remain with the DS Bot maintainer.

## Workgroup status update

Workgroup headers now distinguish attention needed, unread activity and ongoing work. The New sidebar group control stays above the scrollable list. On 2026-11-03, the isolated mock environment verified the create control and all three indicators; 1,359 unit tests passed with two platform-specific skips, and the generated client check and lint passed.

## Batch grouping

The group menu can move several Bots and group chats in one operation, including chats from other groups. The destination and all selections are checked before any membership changes. On 2026-11-03, isolated browser testing moved two mock Bots and one mock group chat from multiple locations, verified persistence after reload and preserved group-chat membership.

## Deliverables

The local sidebar lists explicitly presented files from team conversations, filters by sidebar group and links to the source conversation. It reads Session history on demand and shows only file names and metadata; it does not read file contents. See the local design note for limits.

## Fork identity and feedback

Visible labels and project links identify DS Bot Next. About identifies Fei2411 and the DS Bot contributors, links to the original project, and provides license and notice links. The package includes LICENSE and NOTICE. GitHub feedback opens a blank issue without putting descriptions or diagnostics in the URL; users explicitly copy what they choose to share. Display links point to the fork without changing the existing package install or DSH verification logic.

The local fork changes the project-facing sidebar, About and feedback screens;
it does not rename the internal data keys or the existing plugin API. The local
source files preserve the upstream repository metadata used for DSH compatibility
checks; the fork-facing source, release, Star and issue links are configured
separately. No automatic issue content is transmitted by the feedback button.

## Versioning

DS Bot Next uses its own numeric release versions, beginning with 0.2.5 after 0.2.4-next.2. Each build delivered for installation receives a new version; subsequent updates may use 0.2.6, 0.2.7, and so on. A milestone or larger planned change can move to 0.3.0; there is no automatic jump after 0.2.9. A local, unreleased development edit need not change the version.

The installed package remains `ds-bot-next`, and local builds are updated explicitly; the version number does not make the official DS Bot an update source. Keep upstream license and attribution notices, and never package local data.
