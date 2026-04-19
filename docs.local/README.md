# docs.local/

本地开发文档目录。**除本 README 外整个被 gitignore**，不会推到 github。

## 📚 文档导航

按"新到老"、"上层到深入"的顺序列在下面。第一次进来按 1→2→3 的顺序读，维护时只改 1、2（3 只改变化、4/5 基本不动）。

### 1. [status.md](status.md) ⭐ **从这里开始**

**项目当前状态一站式快照**：端到端拓扑、运行中组件、核心命令、cron 配置、最近进度、历史里程碑、故障排查速查。

**每次代码 / 部署有变动务必同步这份。** 新对话只读这一份就能 10 分钟内拉齐上下文。

### 2. [backlog.md](backlog.md)

**需求看板**。五段式：Done ✅ / Next up 🔜 / Ideas 💡 / Hard 🧗 / Rejected 🚫。

想做点新东西的第一站 —— 先看这里有没有思考过的方案，以及有没有"明确不做"的条目避免重复讨论。

### 3. [design.md](design.md)

**架构与关键设计决策**。三层组件图、端到端数据流、为什么选 A 不选 B、各内部函数职责表、已知脆弱点。

改代码前读一下这份，避免踩进已知陷阱（比如 postprocess 的 step 顺序、`--migrate` 不落 `_unknown` 的设计选择等）。

### 4. [remote-reading-access.md](remote-reading-access.md)

**NAS 远程阅读部署 runbook**。五阶段实施步骤 + Caddyfile 模板 + 风险矩阵 + 实际实施记录。

到新 NAS / 换 NAS / 需要 troubleshoot 整个公网访问链路时看这份。

### 5. [sesson_history.md](sesson_history.md)

**历史对话摘录**。跟 Claude 几次长对话的记录，不维护，只做历史参考。不需要主动读。

## 规则

- 新增本地文档：加到上面导航
- 敏感凭证：**不要**写进来，即便被 gitignore（万一误推毁了）
- 用户面向说明：应该进根目录 `README.md`，不是这里
- 可复用脚本：应该进 `bin/` 或 `lib/`，不是这里

> 规则实现见根目录 `.gitignore`：`docs.local/*` 整个忽略，仅 `!docs.local/README.md` 被跟踪用作占位。
