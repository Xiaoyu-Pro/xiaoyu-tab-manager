## Purpose

确保 Dashboard 优先展示浏览器已识别的真实标签页 favicon，并在来源失效或用户限制外部请求时安全、可预测地降级。

## Requirements

### Requirement: 优先展示当前标签页 favicon
系统 SHALL 在 Dashboard 的打开标签页行中优先使用浏览器为该标签页提供且通过安全校验的 `favIconUrl`。

#### Scenario: 企业内网站点具有浏览器 favicon
- **WHEN** `chrome.tabs.query()` 返回某打开标签页的有效 `favIconUrl`
- **THEN** Dashboard 使用该 favicon，而不是直接使用第三方按域名图标服务

#### Scenario: favicon 使用危险协议
- **WHEN** 标签页返回 `javascript:`、非图片 `data:` 或其他不允许协议的 `favIconUrl`
- **THEN** 系统丢弃该值且不会把它写入图片 `src`

### Requirement: favicon 来源失败时安全降级
系统 SHALL 在首选 favicon 加载失败时尝试现有本地缓存或允许的域名后备来源，并在所有候选均失败后隐藏图片。

#### Scenario: 当前标签页 favicon 加载失败
- **WHEN** 首选 `favIconUrl` 触发图片加载错误且存在后备来源
- **THEN** Dashboard 自动切换到后备来源而不是立即隐藏图标

#### Scenario: 所有 favicon 来源均失败
- **WHEN** 首选与后备 favicon 都无法加载
- **THEN** Dashboard 隐藏损坏的图片且不影响标签页标题和操作按钮

### Requirement: favicon 遵循隐私设置
系统 MUST 在用户禁用外部 favicon 请求时避免为 favicon 创建新的 HTTP 或 HTTPS 请求。

#### Scenario: 用户禁用外部 favicon
- **WHEN** `externalFavicons` 设置为 `false`
- **THEN** Dashboard 只使用浏览器提供的 `data:image/*` 或已有本地缓存，不使用 HTTP/HTTPS favicon 候选
