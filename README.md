# DS Bot Next

DS Bot Next is an independently maintained fork of [DS Bot](https://github.com/Fei2411/DS-Bot), a team of persistent Bots and group chats for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). The original project was created by Fei2411 and contributors and is licensed under Apache License 2.0.

English | [中文](README.zh.md)

## What Next adds

- **Workgroups:** organize Bots and group chats, collapse or pin groups, drag to reorder them, and move entries in batches.
- **Needs your attention:** find approvals, questions, and failed runs and open the relevant conversation. Failures stay until you clear them.
- **Deliverables:** browse explicitly presented files by workgroup and open the source conversation. The list does not read file contents.
- **Parallel group calls:** members named together can start concurrently while existing relay limits, parked calls, and Continue remain available. Ordinary messages in everyone mode still go in order.
- **Selected upstream fixes:** data protection, message reliability, and interface fixes. See the [upstream review](docs/upstream-fix-review-0.2.6.md) for coverage and remaining differences.

Parallel members may see the same prior conversation state; arrange tasks in steps when strict ordering matters.

## Install the plugin

The current download is a **DSH plugin package**, not a standalone Windows `.exe`. Install DeepSeek Harness Desktop and configure a model first. Version 0.2.6 has been used with DSH Desktop 0.2.1-rc.5 on macOS; **it has not yet been tested on a Windows machine**.

1. Download `ds-bot-next-0.2.6.tgz` from this repository's [Releases](https://github.com/imakeit94-dev/DS-Bot-Next/releases).
2. In DSH Desktop, choose **Plugins → Add plugin → Install third-party plugin**, and enter the downloaded file's full path, for example `C:\Downloads\ds-bot-next-0.2.6.tgz`.
3. Select **Install** and enable `ds-bot-next`. If the interface still shows the old version, quit DSH completely and reopen it.

Next and original DS Bot use the same Bot service and data location: **do not enable both at once**. Disable the original plugin first if it is enabled. Back up your DSH data before changing versions; chats, model settings, and other data do not automatically sync between computers.

This fork does not provide automatic updates or a standalone Windows installer. Report issues in [this repository](https://github.com/imakeit94-dev/DS-Bot-Next/issues); review and remove private information from descriptions and diagnostics before submitting them publicly.

## Development and tests

The `main` branch keeps the upstream baseline; the maintained Next source is on the [Next branch](https://github.com/imakeit94-dev/DS-Bot-Next/tree/codex/ds-bot-next), in `ds-bot/`. See [AGENTS.md](AGENTS.md) and the [Next development notes](docs/next-development.md) for dependencies, builds, and mock testing. Tests use isolated directories and a mock model, not the user's DSH data. The source checkout retains the upstream package name for maintenance; the distributed package uses the separate `ds-bot-next` identity.

To create a local Next archive after installing the build dependencies, run `node scripts/package-next.mjs` in `ds-bot/`. It writes to the ignored `artifacts-local/` directory and checks the plugin identity before packing. Packaging on Windows has not been tested.

DS Bot Next is a personal fork; the upstream maintainers decide whether to adopt any contribution. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for origin, copyright, and license information.
