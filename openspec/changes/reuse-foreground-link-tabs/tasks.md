## 1. 创建资格与回归测试

- [x] 1.1 在 `tests/blue-tab-reuse.test.mjs` 加入 Chrome 链接创建事件和排除场景；修复前同一测试应在 Xiaoyu 失败、在 Blue 通过。
- [x] 1.2 仅修改 `extension/services/tab-reuse.js` 的 `onCreated` 创建资格：保留占位页分支，同时接纳地址为空且有有效 `openerTabId` 的前台新页。运行两版本测试确认既有首次加载和关页保护不变。

## 2. 浏览器验证与规格同步

- [x] 2.1 用隔离 Chrome 和本地测试网页实际点击，验证同完整 URL 时聚焦已有页、只关闭新页；验证不同参数、后台打开和会话恢复保持正常。
- [x] 2.2 运行 `npm test`、`npm run validate`，检查 Blue 和 manifest 无本次改动；同步中英文使用说明及 `openspec/specs/exact-url-tab-reuse/spec.md`，并执行 `openspec validate --all`。
