## Why

Dashboard 左上角的问候语目前只有时间段文案，缺少用户希望长期保留的个人署名。需要在不影响日期、语言切换和现有视觉层级的前提下，为问候语增加固定署名 `xiao鱼🐟`。

## What Changes

- 在中文问候语后追加中文逗号和署名：`，xiao鱼🐟`。
- 在英文问候语后追加英文逗号、空格和署名：`, xiao鱼🐟`。
- 保持现有早上、下午、晚上判断以及日期渲染逻辑不变。
- 署名沿用问候语现有样式，不新增配置、依赖或 HTML 渲染能力。

## Capabilities

### New Capabilities

- `greeting-owner-mark`: 定义 Dashboard 问候语中固定署名的多语言展示规则及安全渲染边界。

### Modified Capabilities

无。

## Impact

- 代码：`extension/app.js` 的中英文文案表与 `getGreeting()`。
- UI：仅 Dashboard 左上角问候语文本变化；日期、布局和样式不受影响。
- 兼容性：不改变存储结构、权限、公开接口或扩展清单。
