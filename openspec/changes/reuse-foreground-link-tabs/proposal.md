## Why

Xiaoyu 目前要求新标签先显示明确的占位页才参与精确网址复用。用户主要通过网页链接直接打开前台新标签；这种打开方式没有占位地址，因而即使完整网址相同也不会复用。

## What Changes

- Xiaoyu 将可识别来源的网页链接打开的前台新标签纳入现有首次加载处理。
- 继续严格比较完整 URL；只有切换到已打开的目标并复核成功后，才关闭本次新页并提醒。
- 后台打开、会话恢复、旧页刷新和来源不明的直开页继续保留。Blue、界面和权限不变。

## Capabilities

### New Capabilities

### Modified Capabilities

- `exact-url-tab-reuse`：扩展 Xiaoyu 的前台首次加载资格，保持 Blue 的现有规则。

## Impact

修改 Xiaoyu 后台的标签创建资格判断，补充行为测试和隔离 Chrome 验证。不新增依赖、权限、开关或存储字段。
