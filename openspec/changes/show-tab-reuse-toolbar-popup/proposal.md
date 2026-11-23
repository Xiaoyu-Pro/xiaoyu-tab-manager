## Why

用户在 macOS 通知中心也没有看到标签复用提醒，希望在切回已有标签时直接在 Chrome 工具栏看到反馈。

## What Changes

- Xiaoyu 成功切换、复核并关闭新页后，从目标窗口的工具栏自动打开短提示，不需要点击，5 秒后关闭。
- 不向网页注入脚本，不发送系统通知，不申请额外权限。
- 保留同址判断、关闭保护、复制标签页和工具栏原有入口；Blue 不变。

## Capabilities

### New Capabilities

### Modified Capabilities

- `exact-url-tab-reuse`：将 Xiaoyu 的成功反馈从系统通知改为工具栏短弹层。

## Impact

Xiaoyu 复用服务、设置、提示页、权限说明与打包。保留既有开关值。
