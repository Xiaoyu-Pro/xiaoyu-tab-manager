# 仪表盘自动合并验证

日期：2026-11-23。实现、专项自审和验证完成，未遗留本次已知功能问题。

## 行为与边界

- 新开关位于“设置 → 标签页 → 自动合并 Xiaoyu 页面”，默认关闭，严格 true 开启，与普通网页网址复用独立。
- 开启后从后续仪表盘加载起执行；修改开关当下不关闭已有页面。关闭后恢复既有重复提示及手动按钮。
- 后台统一协调并保留最新创建的已就绪仪表盘。置顶、隐身、非普通窗口、普通网页、其他扩展和 Tools / Side Panel 不自动关闭；通用新标签地址没有本扩展证明时不猜测归属。
- 通过会话创建顺序、串行队列和导航/创建/设置修订号应对竞态，worker 恢复后老页不会击败较新页。逐项删除前重新核验保留页、目标和设置，失败不会报告关闭成功。
- 帮助文案明确说明旧页未保存输入会丢失，旧窗口若只有仪表盘也可能关闭。日志和会话状态不包含 URL、标题或表单。

## 检查结果

- `npm test`：公开仓库和原加载目录均通过。新增 `dashboard-cleanup.test.mjs` 覆盖默认/无效设置、身份与页面边界、置顶/隐身/弹窗、顺序与 worker 恢复、并发新建中断、通用地址证明和导航失效、存储损坏/写入失败、保留页消失及最后复核、目标变址/置顶/移动、关闭设置。
- `TAB_REUSE_VARIANT=xiaoyu node --test tests/blue-tab-reuse.test.mjs`：15 通过。
- `node --test tests/blue-tab-reuse.test.mjs`：14 通过，1 个既有工具栏测试跳过，0 失败。
- `node scripts/test-chrome-tools.mjs`（Chrome for Testing 路径通过 CHROME_BIN 指定）：最终整套回归通过。包含原快捷搜索、映射库、工具及新增自动合并设置；验证默认关闭、写入失败恢复、开关持久化、跨窗口、真实 chrome://newtab 覆盖页、并发创建、非目标/置顶页保护、关闭模式恢复提示、中英文和 390px 深色布局。未操作用户 Chrome。
- `npm run package` / `npm run validate`：公开仓库和原加载目录均通过，新增两个模块进入共享清单，权限、Blue 和普通网页防重服务没有变化。
- `openspec validate add-automatic-dashboard-cleanup --strict` 通过；主规格校验 11 项通过。已同步 `dashboard-singleton` 主规格，可后续归档。
- `git diff --check` 通过。检查了完整功能 diff、脚本依赖及所有自动删除入口；不引入新依赖、权限或外部服务。

## 排查与修正

- 关闭前将保留页复核放在目标读取之后，并响应新的创建/导航/设置事件，避免旧轮删除新页或在保留页消失后继续清理。
- 原生设置写入失败后重新读取真实状态；测试注入会在 finally 恢复，避免清理代码掩盖原错误。
- 既有手动提示只统计规范仪表盘地址，关闭模式测试按原有规则使用无 query 的页面，未顺带修改旧统计行为。
- 回归中曾遇到一次旧快捷副本数量断言不稳定，以及一次浏览器驱动 Runtime.evaluate 超时；后续整套回归通过。为驱动超时增加表达式上下文，不扩大超时、降低断言或跳过旧测试。

## 交付与证据

- 开发和发布分支：`yzh/feat/automatic-dashboard-cleanup`；按此前授权将本功能独立提交、推送同名分支，不直接推送或合并 main。
- 使用精确增量补丁同步到原浏览器加载目录，不替换其 Git 历史、私有 config.local.js、诊断文件或 Blue；用户无需换安装目录，只需重新加载 Xiaoyu 扩展。
- 界面截图：`/tmp/xiaoyu-dashboard-cleanup-qa-mqEGUm/dashboard-auto-cleanup-light.png` 和 `dashboard-auto-cleanup-mobile-dark.png`，只含合成测试页面。
- 原 ZIP 备份分别位于 `/tmp/xiaoyu-dashboard-cleanup-packages-before-43UyEa/` 和 `/tmp/xiaoyu-dashboard-cleanup-original-before-Hc9rJO/`，两个目录均保留。
- 没有声称实测 Edge 或用户公司内网页面；自动合并仅针对本扩展仪表盘，内网页面原精确网址防重规则未改。
