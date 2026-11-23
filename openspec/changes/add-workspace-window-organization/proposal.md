## Why

当前 Dashboard 只能按域名或 Chrome 原生标签组查看页面；同一域名可能同时服务多个工作，而多个 Chrome 窗口也缺少统一编排入口，导致“创建分组”与真实工作上下文脱节。需要在不破坏现有域名视图的前提下，引入可持久化的工作组织和可控的窗口重排，让扩展从页面统计工具演进为真正的工作台。

## What Changes

- 将打开标签页区域固定为“域名 / 工作 / 窗口”三个可切换的一级视图，保留现有域名聚合行为。
- 在“工作”下提供“工作编排 / Chrome 标签组”二级视图；即使没有原生标签组也保持入口可见并展示空状态。
- 首次进入工作编排时以当前域名聚合生成可编辑工作；支持新建、重命名、删除、拖拽重新归属和长期保存。
- 对新页面或无法匹配长期归属的页面提供“待整理”区域，并在其中按域名聚合。
- “工作”拖拽只修改逻辑归属并可撤销，不立即改变真实 Chrome 窗口。
- “窗口”视图展示当前 Chrome profile 的普通窗口，支持拖拽标签页到其他窗口并立即生效，同时提供一次撤销。
- “窗口”视图末尾始终提供一个不计入窗口数量的虚拟“新窗口”投放目标；拖入标签或通过键盘选择后，在后台创建真实普通窗口，并继续保留该虚拟目标。
- 新增“按照现有组织重新分配窗口”，以最低标签移动数为目标复用现有窗口，不足时才创建新窗口。
- 扩展单工作“创建标签组”：先把该工作的标签页聚合到最合适的窗口，再创建或安全复用 Chrome 原生标签组。
- 在“域名 / 工作 / 窗口 / Chrome 标签组”的每个真实标签行提供关闭按钮；单行关闭严格按 `tabId` 关闭一个实例，不误关相同 URL 的其他标签。
- 置顶标签、隐身窗口、内部页面和非普通窗口不参与自动重排；执行前展示明确摘要。

## Capabilities

### New Capabilities

- `organization-views`: 定义“域名 / 工作 / 窗口”一级导航、工作二级导航、空状态和视图持久化行为。
- `workspace-organization`: 定义工作模型、精确页面归属、待整理、逻辑拖拽、CRUD、长期保存与撤销。
- `window-organization`: 定义真实窗口展示、永久虚拟新窗口目标、跨窗口拖拽、最低移动成本重排、原生标签组创建、保护边界与撤销。

### Modified Capabilities

无。

## Impact

- 新增 `extension/services/workspace-*.js`、`extension/services/drag-controller.js` 和 `extension/views/*.js` 模块。
- 扩展 `extension/services/tabs-service.js` 对 `chrome.tabs`、`chrome.windows` 和 `chrome.tabGroups` 的封装。
- 修改 `extension/app.js`、`extension/index.html` 与 `extension/style.css` 接入状态机、导航、拖拽和现有视觉体系。
- 使用既有 `storage`、`tabs`、`tabGroups` 权限，不新增远端服务或第三方运行时依赖。
- 长期存储工作信息和精确 URL 的 SHA-256 键；会话数据仅用于当前 tab/window/group ID 与一次撤销。
- 更新 Node 测试、扩展静态校验、README 和隐私说明；保留 Apache-2.0、NOTICE 与上游归属。
