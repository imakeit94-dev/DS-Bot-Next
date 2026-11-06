# Upstream fix review: v0.2.4 to v0.2.6

Reviewed against upstream v0.2.6 (`5c514ad`) and the Next development baseline `dd262dc`. Statuses describe source ancestry and this local integration, not verification against personal data. Upstream PRs retain their original Apache-2.0 provenance.

## Integrated in this local change

- [#774](https://github.com/Fei2411/DS-Bot/pull/774): preserve an externally edited team state and prevent stale queued saves overwriting it.
- [#750](https://github.com/Fei2411/DS-Bot/pull/750): avoid repeatedly retrying invalid memory-review changes; preserve valid changes and report omissions.
- [#777](https://github.com/Fei2411/DS-Bot/pull/777): remove only orphaned, unapproved local MCP capabilities when deleting a Bot.
- [#767](https://github.com/Fei2411/DS-Bot/pull/767): avoid repeated scans of unchanged conversations in usage reporting; migrate its local cache.
- [#773](https://github.com/Fei2411/DS-Bot/pull/773): keep the last of rapid group permission preset changes.
- [#772](https://github.com/Fei2411/DS-Bot/pull/772): apply a Bot's thinking level to its existing group sessions after restart.

## Integrated in the second local change

- [#749](https://github.com/Fei2411/DS-Bot/pull/749): group folder recovery, clear handling for oversized notices, and registered working folders.
- [#751](https://github.com/Fei2411/DS-Bot/pull/751): remove empty gaps from collapsed conversation cells.
- [#762](https://github.com/Fei2411/DS-Bot/pull/762): copy the complete code from a folded message.
- [#764](https://github.com/Fei2411/DS-Bot/pull/764): keep the chat attachment menu available as the team loads.
- [#768](https://github.com/Fei2411/DS-Bot/pull/768): prevent model picker overlap with messages.
- [#769](https://github.com/Fei2411/DS-Bot/pull/769): keep sidebar resize and collapse aligned with pointer movement.
- [#770](https://github.com/Fei2411/DS-Bot/pull/770): restore macOS window dragging on the chat header.

## Third local change: group fixes

- [#756](https://github.com/Fei2411/DS-Bot/pull/756): reports return to the group conversation that posted the request, while posts from a private chat still return there.
- [#776](https://github.com/Fei2411/DS-Bot/pull/776): save mentions from the entire Bot post, including text beyond a long-message preview. Adapted to the current sequential group engine.
- [#753](https://github.com/Fei2411/DS-Bot/pull/753), partial: a group's member status only shows work in that group. The prompt-error interception is not ported: upstream replaces a DSH controller method, which needs an independently supported plugin API under this fork's no-patching rule.
- [#775](https://github.com/Fei2411/DS-Bot/pull/775), partial: a member's working-directory change in one group is isolated from other groups and private chat, including privacy checks. The group's own Session moving to a new part and its file panel need the upstream group-session migration and are not included.

## Parallel group engine with Next compatibility

Upstream [#746](https://github.com/Fei2411/DS-Bot/pull/746) and [#727](https://github.com/Fei2411/DS-Bot/pull/727) were integrated for 0.2.6 with a fork-specific compatibility layer that preserved per-group relay limits, counters, paused calls, and Continue. See [the compatibility design](plans/2026-11-03-parallel-groups-compat.md). **This no longer describes 0.2.7:** the integrated `main` follows upstream 0.2.5 and the newer engine, where that setting, the parked queue and Continue are gone and the six-turn idle guard parks the next call until the user writes.

Upstream [#800](https://github.com/Fei2411/DS-Bot/pull/800) disables DSH subagents and workflows for Bots. It is not integrated because that would remove an existing ability contrary to this fork's preservation requirement. Immediate private-chat steering [#728](https://github.com/Fei2411/DS-Bot/pull/728) and reduced remote polling [#766](https://github.com/Fei2411/DS-Bot/pull/766) already belong to the baseline.

## Already in the baseline

The corresponding upstream merge commits are ancestors of the baseline. This is source-history evidence, not a separate claim that every case was manually reproduced.

- [#752](https://github.com/Fei2411/DS-Bot/pull/752) Bot-to-Bot delivery recovery; [#754](https://github.com/Fei2411/DS-Bot/pull/754) folder protection; [#761](https://github.com/Fei2411/DS-Bot/pull/761) secret environment recovery.
- [#748](https://github.com/Fei2411/DS-Bot/pull/748) repeated model-error part switching; [#779](https://github.com/Fei2411/DS-Bot/pull/779) tool scope; [#755](https://github.com/Fei2411/DS-Bot/pull/755) Chinese memory search; [#757](https://github.com/Fei2411/DS-Bot/pull/757) quoted Bot names.
- [#758](https://github.com/Fei2411/DS-Bot/pull/758) voice; [#759](https://github.com/Fei2411/DS-Bot/pull/759) macOS local network; [#760](https://github.com/Fei2411/DS-Bot/pull/760) startup error; [#765](https://github.com/Fei2411/DS-Bot/pull/765) model route recovery; [#771](https://github.com/Fei2411/DS-Bot/pull/771) narrow-screen cards.

## Deferred for dependency or product review

These are not represented as applied. Group-related patches conflict with or depend on upstream's changed group engine; review their individual behavior and tests before porting. UI changes also need review against Next's sidebar and existing local changes.

- Group Session folder and file-panel scope [#775](https://github.com/Fei2411/DS-Bot/pull/775); sanitized rejection details [#753](https://github.com/Fei2411/DS-Bot/pull/753).
- The upstream change that disables subagents and workflows remains excluded to preserve existing capabilities.

## Desktop-app-specific

- [#747](https://github.com/Fei2411/DS-Bot/pull/747) addresses Linux desktop image processing, not the DSH plugin installation used here.
- [#837](https://github.com/Fei2411/DS-Bot/pull/837), the v0.2.6 hotfix, repairs sessions imported into upstream's standalone desktop app by old versions. It is not included in the plugin; applicability would need a separate review if using that app or importing such a team.
