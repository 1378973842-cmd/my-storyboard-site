# 每日工作记录（Daily Log）

本文件由 `scripts/daily-log.mjs` 维护，用于记录「每天做了什么 / 做完了什么」。

- **自动**：运行 `npm run hooks:install` 后，每次 `git commit` 会自动追加一条提交摘要；也可随时运行 `npm run log:daily` 补全「今天 0 点起」尚未写入的提交。
- **半自动（Cursor Agent）**：会话结束前执行 `npm run log:daily -- --note "……"`，补充 Git 难以表达的结论（例如「已跑通 init.mjs」「待办：xxx」）。
- **与 PM 文档同步**：`docs/feature_list.json` 标记功能完成；`docs/HANDOFF.md` 写当前焦点与 Blockers（由 Agent 在收尾时更新）。

---
