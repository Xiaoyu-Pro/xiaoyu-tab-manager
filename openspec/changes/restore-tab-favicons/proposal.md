## Why

Super Tab Out 在归一化 `chrome.tabs.Tab` 时丢弃了浏览器已经提供的 `favIconUrl`，导致 Dashboard 只能依赖 DuckDuckGo 的按域名图标服务。企业内网站点、未被第三方服务收录的站点或加载中的站点因此显示空缺或通用 fallback，降低了标签页识别效率。

## What Changes

- 在标签页归一化结果中保留并校验浏览器提供的 `favIconUrl`。
- Dashboard 优先使用当前标签页的真实 favicon，并保留现有本地缓存和 DuckDuckGo 作为后备来源。
- favicon 加载失败时自动尝试后备来源，全部失败后才隐藏图片。
- 增加覆盖 favicon 保留、危险协议过滤和缺失值降级的回归测试。

## Capabilities

### New Capabilities

- `tab-favicon-rendering`: 规定打开标签页的 favicon 来源优先级、安全过滤与失败降级行为。

### Modified Capabilities

无。当前仓库尚无既有 OpenSpec capability。

## Impact

- 影响 `extension/services/tabs-service.js` 的标签页归一化字段。
- 影响 `extension/app.js` 的 favicon 来源选择与错误处理。
- 影响 `tests/run-tests.mjs` 的标签页服务回归覆盖。
- 不新增依赖、不新增浏览器权限、不改变存储结构或公开交互契约。
