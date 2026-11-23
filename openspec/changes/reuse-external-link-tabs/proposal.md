## Why

从 Codex 这类桌面应用打开链接时，Chrome 创建的前台标签可能已经带有待加载地址。当前只接受明确占位页或地址为空的链接新页，导致已打开的完全同址页面不能复用。

## What Changes

- Xiaoyu 接受已有普通窗口中带明确来源的前台待加载网页标签，并沿用完整 URL 匹配、切换复核、关新页和提示。
- Chrome「复制标签页」保留两份；新建窗口恢复和其他来源不明的直开继续保留。Blue 和权限不变。

## Capabilities

### Modified Capabilities

- `exact-url-tab-reuse`：增加受约束的外部链接打开方式，明确保护手动复制。

## Impact

只扩展 Xiaoyu 的候选来源判断和回归测试，不改提示文案、时长或页面。
