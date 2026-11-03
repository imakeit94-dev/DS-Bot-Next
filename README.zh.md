# DS Bot Next

DS Bot Next 是 [DS Bot](https://github.com/Fei2411/DS-Bot) 的独立维护分支，为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供长期运行的 Bot、群聊和团队工作区。原项目由 Fei2411 和贡献者开发，采用 Apache License 2.0。

[English](README.md) | 中文

## Next 提供什么

- **工作组**：把 Bot 和群聊放进工作组，支持折叠、置顶、拖动排序和批量移动。
- **需要你处理**：集中查看审批、问题和运行失败提醒，并跳转到对应对话。失败提醒由用户手动清除。
- **成果**：按工作组查看 Bot 明确交付的文件，并跳转到来源对话；列表不读取文件内容。
- **并行群聊**：一条消息同时点名多位成员时可并行开始，同时保留已有的接力上限、暂停队列和继续控制。全员轮流的普通消息仍按顺序处理。
- **上游修复**：选择性吸收数据保护、消息可靠性和界面修复。具体范围与尚未移植的内容见[上游对照](docs/upstream-fix-review-0.2.6.md)。

并行成员可能看到相同的已有对话内容；依赖严格顺序的任务，请分步安排。

## 安装插件

当前提供的是 **DSH 插件包**，不是 Windows 独立 `.exe`。需先在 Windows 或 macOS 安装 DeepSeek Harness Desktop，并配置模型。0.2.6 已在 macOS DSH Desktop 0.2.1-rc.5 使用；**Windows 尚未实机验证**。

1. 从本仓库的 [Releases](https://github.com/imakeit94-dev/DS-Bot-Next/releases) 下载 `ds-bot-next-0.2.6.tgz`，保存到本机。
2. 在 DSH Desktop 打开 **插件 → 添加插件 → 安装第三方插件**，输入下载文件的完整路径，例如 `C:\Downloads\ds-bot-next-0.2.6.tgz`。
3. 选择 **安装**，完成后启用 `ds-bot-next`；若界面仍是旧版本，完全退出 DSH 再打开。

Next 和原版 DS Bot 使用同一套 Bot 服务和数据位置，**不要同时启用**。如原版已启用，先在插件页禁用它。升级或切换前请备份 DSH 数据；更换电脑不会自动同步聊天、模型配置或其他数据。

本项目不提供自动更新或 Windows 独立安装程序。发现问题可在[本仓库反馈](https://github.com/imakeit94-dev/DS-Bot-Next/issues)；公开提交前请自行检查描述和诊断信息，移除私人内容。

## 开发与测试

`main` 分支保留上游基线；Next 源码维护在 [Next 分支](https://github.com/imakeit94-dev/DS-Bot-Next/tree/codex/ds-bot-next)的 `ds-bot/` 目录。开发依赖、构建和模拟测试见 [AGENTS.md](AGENTS.md) 与 [Next 开发记录](docs/next-development.md)。测试使用独立目录和模拟模型，不访问用户的 DSH 数据。源码目录保留上游包名以便维护；发布包使用独立的 `ds-bot-next` 标识。

安装构建依赖后，可在 `ds-bot/` 运行 `node scripts/package-next.mjs` 生成本地 Next 安装包。脚本在打包前检查插件标识，默认输出到不会提交的 `artifacts-local/` 目录。Windows 上的打包流程尚未测试。

DS Bot Next 是个人维护的分支，功能是否被上游采用由原项目维护者决定。有关来源、版权和许可证，请参阅 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
