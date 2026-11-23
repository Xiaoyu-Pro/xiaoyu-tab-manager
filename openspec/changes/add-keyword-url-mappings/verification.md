# 快捷搜索验证记录

日期：2026-11-23。状态：DONE。

## 本次范围

只给 Xiaoyu 仪表盘增加独立的关键词页面搜索及本地映射管理。问候语右侧、设置入口左侧新增圆角输入框；原过滤框、域名/工作/窗口、后台自动去重、权限和 Blue 版保持原样。

## 验证结果

- `npm test`：通过，包含新增映射服务的增改删、持久化、同词多页、精确优先/前缀、30 个候选不截断、查询参数及片段、危险 URL、重复映射、写入失败、串行写入与损坏数据保护。
- `XIAOYU_QA_ARTIFACT_DIR=/tmp/xiaoyu-keyword-qa-cl8IF7 node scripts/test-chrome-tools.mjs`：通过新增快捷搜索浏览器回归与原有完整 Chrome tools 回归。覆盖真实表单 CRUD、重新加载、失败保留输入、HTML 文本转义、鼠标/方向键/Enter 单页打开、输入法不误触、Escape、隐私、中英文及浅深主题。
- 响应式验证：1365、1024、768、390 像素宽度，输入框不超出视口，不遮挡问候语或设置。
- `node --test tests/blue-tab-reuse.test.mjs`：14 通过、0 失败、1 个既有工具栏测试跳过；本次未更改该测试及后台复用模块。
- `npm run package`、`npm run validate`：Chrome/Edge ZIP 均生成且闭包校验通过，新服务、视图及样式全部进入包；未包含本地诊断页面。
- `openspec validate --all`：19 项通过、0 失败。
- `git diff --check`：通过。本次相对初始暂存区的 diff 中，`extension/background.js`、`manifest.json`、`services/tab-reuse.js` 和 `variants/blue-tab-manager/` 均为空。

## Review 与修正

按 review 清单复核本次新旧文件差异，未发现未解决的阻断项。已修正管理 dialog 关闭后的二次 focus 抢焦点、隐藏下拉仍保留活动选项的辅助技术状态，并确保保存期间不重复提交。用户自定义名称和 URL 仅通过 `textContent` 渲染；新建标签前的 URL 在存储边界限制为 HTTP(S)。

QA skill 的报告模板和 issue taxonomy 在全局 runtime 中缺失，采用项目既有隔离 Chrome 测试脚本、截图和本记录替代。自动提交、配置改动及外部同步步骤未执行，遵循用户不 commit/push 的约定。

## 产物与限制

- 新包：`dist/xiaoyu-tab-manager-chrome-1.0.10.zip` 与 `dist/xiaoyu-tab-manager-edge-1.0.10.zip`；旧版同名包已在重新生成前备份至 `/tmp/xiaoyu-package-backup-mqP1vj/`。
- 视觉证据：`/tmp/xiaoyu-keyword-qa-cl8IF7/` 中的 desktop、dark、mobile、manager 和 preview PNG，全部使用本地测试网页。
- 未操作用户工作中的 Chrome，也未在真实内网站点或 Edge 浏览器中逐项实测。功能在重新加载 Xiaoyu 并重新打开仪表盘后可用。
- 映射长期保存于本机，卸载扩展会清除；没有云同步或历史/书签导入。
- 主规格已同步，change 保留未归档，后续可按需 Archive。

## 使用方式

1. 在 Chrome 扩展管理页面重新加载 Xiaoyu，重新打开一个新标签页。
2. 点击顶部新搜索框右侧“管理”，输入关键词、页面名称和完整网址，点击“添加页面”；同关键词再添加一条就能形成候选组。
3. 输入关键词，点击候选或用上下键加 Enter 选择其中一页；不需要 `xtm` 前缀。

## 关键词分组折叠增量验证

- 管理列表改用原生 `details/summary` 卡片：默认收起，组头有关键词、箭头和中英文页面数；本页内保留展开状态，新增或编辑后自动展开目标组。列表名称与 URL 单行省略，`title` 保留完整值。
- 先补浏览器断言并确认旧实现失败（预期 2 个 details，实际 0），再实现分组折叠。
- `XIAOYU_QA_ARTIFACT_DIR=/tmp/xiaoyu-mapping-groups-P4poYh node scripts/test-chrome-tools.mjs`：新增与原有完整回归通过。新增覆盖首次默认收起、Enter 展开/收起、增删后的数量、重开弹层/语言切换保留状态、新增自动展开，以及 390px 下长 URL 不溢出、不遮挡操作按钮。
- `npm test`、`npm run package`、`npm run validate`、`openspec validate --all` 和 `git diff --check` 均通过，OpenSpec 仍为 19 项通过。
- 已检查浅色、深色和窄屏截图，产物在 `/tmp/xiaoyu-mapping-groups-P4poYh/`。Chrome/Edge 同名 ZIP 更新前备份于 `/tmp/xiaoyu-group-package-backup-kEEYun/`。
- 本次未改存储服务、已保存映射格式、后台自动复用、Manifest 权限或 Blue。自检未发现未解决的阻断项；仍未操作用户真实 Chrome 或提交、推送代码。

## 跨分组页面名搜索增量验证

- 搜索现在合并组名匹配和跨分组页面名称的包含匹配，忽略大小写及多余空白。组名仍优先完整匹配、无完整组时匹配前缀；页面名匹配不被完整组名命中遮挡。保持保存顺序，每条映射只返回一次，不按 URL 合并不同分组里的映射。
- 每条候选末尾沿用分组名称，并增加完整组名悬停提示；中英文输入提示改为搜索分组或页面名称。没有扩大到 URL、历史记录或未保存的标签。
- 先修改单元断言并确认旧实现失败（页面名“主链路”预期一条、实际零条），再实现匹配。`node tests/keyword-mappings.test.mjs`、`npm test` 均通过；覆盖跨组同名及包含匹配、大小写/空白、组名与页面名并集、重复条件不重复返回、同 URL 不同组分别返回及 URL 不参与搜索。
- `XIAOYU_QA_ARTIFACT_DIR=/tmp/xiaoyu-cross-group-uuXzeH node scripts/test-chrome-tools.mjs`：新增跨组候选与完整 Chrome tools 回归通过。真实表单新增“看板”和“tce”下的两个 argall，输入混合大小写后同时列出两条、尾部分组与悬停提示正确，点击 tce 候选只新开相应完整 URL。截图为该目录的 `keyword-cross-group.png`。
- `npm run package`、`npm run validate`、`openspec validate --all` 和 `git diff --check` 均通过；OpenSpec 仍为 19 项通过。上一版同名 ZIP 备份在 `/tmp/xiaoyu-cross-group-package-backup-PNjpji/`。
- 已自检此次匹配逻辑、渲染、测试和说明差异，无未解决的阻断项。保存格式、管理分组、原标签过滤框、自动复用、权限与 Blue 均未改动；不需要重配已有映射。未操作用户真实 Chrome、未 commit/push，规格已同步，change 继续保留未归档。
