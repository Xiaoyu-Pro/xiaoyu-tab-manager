## Context

`chrome.tabs.query()` 在项目已有的 `tabs` 权限下会返回 `favIconUrl`，但 `TabsService.normalizeTab()` 当前只保留 URL、标题、分组等字段。Dashboard 随后按域名请求 `icons.duckduckgo.com`；这个来源无法覆盖所有企业内网和长尾站点，加载失败后现有全局错误监听器直接隐藏 `<img>`。

该问题横跨标签页数据边界与 Dashboard 渲染边界，但不需要新增依赖、权限或存储迁移。

## Goals / Non-Goals

**Goals:**

- 优先展示 Chrome 已识别的当前标签页 favicon。
- 保持危险 URL 不进入 DOM，并保持“禁用外部 favicon 请求”的隐私设置有效。
- 当前标签页 favicon 失败时继续使用已有缓存或 DuckDuckGo 后备来源。
- 用纯函数测试覆盖字段保留和协议过滤。

**Non-Goals:**

- 不改变 Dashboard 布局、尺寸、颜色或图标视觉样式。
- 不引入新的 favicon 服务或浏览器权限。
- 不迁移、清除或重建现有 favicon 缓存。

## Decisions

### 1. 在标签页服务边界保留并校验 `favIconUrl`

`normalizeTab()` 是浏览器对象进入应用的统一边界，因此在这里增加 `normalizeTabFaviconUrl()`：允许 `http:`、`https:` 和 `data:image/*`，拒绝 `javascript:`、非图片 `data:`、浏览器内部协议和无效值。

替代方案是在 `app.js` 每次渲染时直接信任原始值；这会重复安全判断，也无法防止未来其他消费者拿到未校验字段。

### 2. 使用有序候选来源而不是单一 URL

渲染层按以下顺序构造候选：

1. 当前标签页经校验的 `favIconUrl`；
2. 当前域名的本地缓存 data URL；
3. 隐私设置允许时的 DuckDuckGo 域名 favicon。

首个候选加载失败时，委托式 `error` 监听器切换到下一个后备来源；后备来源也失败才隐藏图片。这样既修复内网站点，也不牺牲现有长尾站点降级能力。

### 3. 隐私开关继续约束网络请求

当 `externalFavicons` 为 `false` 时，只允许浏览器提供的 `data:image/*` 和已有本地缓存；`http:`/`https:` 的标签页 favicon 与 DuckDuckGo URL 都不进入候选列表，避免隐式网络请求。

## Risks / Trade-offs

- [部分站点返回的 `favIconUrl` 仍可能失效] → 使用已有缓存和 DuckDuckGo 作为后备，全部失败时保持当前隐藏行为。
- [不同页面使用不同 favicon，域名缓存可能保存最后成功的图标] → 当前打开标签页始终优先于域名缓存；缓存只承担后备职责。
- [`data:image/svg+xml` 可能携带复杂内容] → 仅作为 `<img>` 资源展示，不进入 HTML 或脚本执行路径；所有属性仍经过 HTML 转义。

## Migration Plan

无需数据迁移。扩展重新加载后，新查询到的标签页会自动携带 favicon；回滚只需恢复三个实现/测试文件，现有缓存保持不变。

## Open Questions

无。
