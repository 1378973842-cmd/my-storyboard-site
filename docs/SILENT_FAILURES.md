# 静默失效清单（silent failures）

同一族：读不到 / 写不下 / 解析失败时，悄悄按最宽或空值继续，不报错。
原则：加载失败按异常处理，不凭记忆继续。

| 项 | 行为 | 状态 |
|---|---|---|
| 容量表找不到模型 | 曾用可用模型最大上限放行 | 已修：显式「不在容量表里」+ 合法值（`41bf451`） |
| duration.md 缺容量表 | 曾跳过容量拦截 | 已修：显式「duration.md 缺容量表」（`41bf451`） |
| write_task_artifact 超 200,000 字符 | `slice` 静默截断 | **待办**：应改为显式报错，报当前字符数/上限/怎么分段；模型输出 8192 tokens 够不到，不阻塞跑片 |
| 知识选择超上限 | 曾 `slice` 静默丢尾部，`selected` 仍报全 | 已修：按段丢并返回 `dropped`，tool log「知识层未拼全」/ review `[knowledge_truncated]`；prompt cap 5,000→10,000 |

## 相关但已处理

- tool arguments JSON 坏了 → 显式报错 + failed 日志（`2688739`）
- 枚举非法 / nodeId 不存在 → 显式报错（`2688739`）
- `readTaskState` 文件损坏静默回 DB → 仍待办；当前读文件失败会回 DB，属同族，碰时一起修
