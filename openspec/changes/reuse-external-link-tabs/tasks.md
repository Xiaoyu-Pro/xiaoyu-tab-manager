## 1. 回归测试与实现

- [x] 1.1 在 `tests/blue-tab-reuse.test.mjs` 编写待加载外部链接、手动复制、同窗来源不明和批量恢复保护用例；先复现新入口不生效。
- [x] 1.2 修改 `extension/services/tab-reuse.js` 和 `extension/background.js`，只接纳有已稳定同窗来源且非新建窗口的直开新页。

## 2. 验证与同步

- [x] 2.1 隔离 Chrome 验证 macOS 外部打开精确复用，手动复制、系统恢复和批量恢复都保留。
- [x] 2.2 运行 Xiaoyu、Blue 和扩展校验；同步规格与中英文说明。
