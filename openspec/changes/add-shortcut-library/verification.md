# 验证记录

日期：2026-11-23。结论：实现与专项自审完成，当前没有未解决的本次问题。

## 交付范围

- 一级入口增加“快捷 / Shortcuts”，按映射分组渲染持久卡片，与顶部搜索共用 `keywordPageMappings`。原过滤框只在快捷视图隐藏，保持原值。
- 搜索和卡片显示已打开及窗口状态；普通选择严格匹配完整 URL，优先当前窗口，再选其他普通窗口最近使用的精确标签。无匹配才新建，目标变化或失败不盲目另开，没有删除标签的调用。
- 右键菜单与搜索 Shift+Enter 显式新开副本；真实标签行的“＋”收录预填标题、完整 URL，用户选组后保存。
- 支持每页多个别名及跨组包含匹配；旧记录缺少 aliases 时按空数组读取，不改原 ID、名称和 URL。
- 本地版本化 JSON 备份：2 MiB / 5000 条导入上限，整份校验、预览、确认后锁内重新合并并原子保存。重复组名＋URL 保留本机数据，仅合并别名。导出不包含内部 ID 或窗口数据。

## 已执行检查

- `npm test`：通过；新增 `tests/shortcut-library.test.mjs`，覆盖旧数据、多别名、危险 URL、坏文件/版本/别名、大小与条数上限、预览不写入、合并保留本机值、重复导入幂等、配额失败、损坏存储不覆盖、目标变址/消失、查询/聚焦失败、参数/片段区别、当前窗口优先及安全 HTML。
- `node scripts/test-chrome-tools.mjs`：通过。使用全新临时 profile 的独立 Chrome for Testing，原有搜索 CRUD、折叠、键盘、隐私、主题及工具回归继续通过。新增专项覆盖跨组别名、跨窗口和当前窗口优先复用、参数不同新建、右键/键盘菜单/Shift+Enter 副本保留、窗口行点击收录及域名行原生回车收录、导入预览/取消/坏文件替换/写失败重试/幂等合并和导出序列化、偏好重载、关闭真实页面后快捷入口仍保留、实时状态、浅深主题、1365/768/390 宽度和隐私遮罩；原搜索另覆盖 1024 宽度。无新增运行时异常。
- `node --test tests/blue-tab-reuse.test.mjs`：14 通过，1 个既有工具栏反馈用例跳过，0 失败。
- `npm run package`：已重新生成 Chrome、Edge 两个本地 1.0.10 包。新模块进入共享白名单，诊断 trace 与 config.local 未被打包，法律文件保留。
- `npm run validate`：通过。
- `openspec validate add-shortcut-library --strict`：通过。
- `openspec validate --specs --strict`：10 个主规格通过。
- `git diff --check`：通过。
- 相对本轮开始的暂存基线，`extension/background.js`、`extension/manifest.json` 和 `variants/blue-tab-manager/` 没有新增 diff；未增加权限、依赖，也未更改自动防重策略。

## 两轮自审及修正

1. 新的 shortcuts 值逐一核对导航、偏好白名单、渲染、旧过滤异步回调和打包依赖；独立打开服务不使用旧的域名兜底。查验全部打开与导入失败路径以及文本转义。
2. 检查截图发现旧瀑布流把工具条和快捷卡片分列，已仅对新视图取消 columns；管理按钮复用既有 action-btn。增加网格位置断言并复测。
3. 文档级键盘事件的 target 可能是 Document，已使用可选 closest；收录按钮隔离旧 role=button 行的回车冒泡，同时保留原生按钮行为。测试驱动的 Enter 补充与旧测试一致的回车字符，不以修改业务代码掩盖测试输入问题。
4. 新选择的无效备份会清除旧预览，防止误确认之前的文件；确认写入失败则保留当前预览供重试。

## 证据与边界

- 测试截图：`/tmp/xiaoyu-shortcuts-qa-5kyQWA/`，包括 `shortcut-library-light.png`、`shortcut-library-dark.png`、`shortcut-library-mobile.png`、`shortcut-library-closed-pages.png`、`shortcut-backup.png`；只含本地合成页面。
- 替换前两个本地 ZIP 已复制保留在 `/tmp/xiaoyu-shortcuts-packages-before-CTtQPM/`，可恢复旧产物。
- 没有操作用户正在工作的 Chrome，没有读取或改写用户真实映射，也没有 commit、push 或发布。用户需自行重新加载 Xiaoyu 后刷新仪表盘。
- 实际浏览器验证针对本机 Chrome for Testing；Edge 仅验证打包及资源闭包，没有声称实测 Edge 或公司内网重定向。既有转发防重逻辑未变，本次快捷入口不推断不同 URL 等价。
- 导出测试核对下载请求及 Blob JSON 内容，未操作用户下载目录。备份含完整内网 URL 与参数，界面和文档均提示本地妥善保管。
- QA 技能的报告模板与 issue-taxonomy 本机缺失，沿用项目隔离浏览器与本文件记录，不安装环境、不按技能默认流程提交代码。

## 规格与后续

已同步 `keyword-page-search`、`organization-views` 和新增 `shortcut-library` 主规格。任务完成后可归档 `add-shortcut-library`；本轮不擅自归档其他历史变更。
