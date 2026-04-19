# docs.local/

本地开发笔记目录，**不进 git**（除本 README 外）。

此目录适合放：

- 设计草稿、架构演变记录
- 调试时抓到的原始样本（HTML 片段、坏 pattern 示例）
- 临时 TODO、后续改进清单
- 个人实验脚本、一次性数据处理

不适合放：

- 面向用户的安装/使用说明 → 应该进根目录 `README.md`
- 可复用的脚本/工具 → 应该进 `bin/` 或 `lib/`
- 敏感凭证 → 根本不要写进仓库，哪怕是 ignore 的目录也不行

> 规则实现见根目录 `.gitignore`：`docs.local/*` 整个忽略，仅 `!docs.local/README.md` 被跟踪用作占位。
