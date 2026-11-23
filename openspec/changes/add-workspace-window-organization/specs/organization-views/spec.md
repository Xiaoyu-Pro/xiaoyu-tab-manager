## ADDED Requirements

### Requirement: 始终提供三种一级组织视图
Dashboard SHALL 在打开标签页区域始终提供“域名”“工作”“窗口”三个一级入口，并 SHALL 允许用户在不离开 Dashboard 的情况下切换。

#### Scenario: Dashboard 初次加载
- **WHEN** 用户打开尚未保存组织视图偏好的 Dashboard
- **THEN** 系统显示三个一级入口并默认选中“域名”

#### Scenario: 用户切换一级视图
- **WHEN** 用户选择“工作”或“窗口”
- **THEN** 系统在原打开标签页区域渲染对应视图并保存该偏好

#### Scenario: 已保存偏好无效
- **WHEN** 保存的组织视图值不属于 `domain`、`workspace`、`window`
- **THEN** 系统回退到“域名”且不阻止 Dashboard 加载

### Requirement: 工作视图始终提供二级入口
Dashboard SHALL 在“工作”一级视图内提供“工作编排”和“Chrome 标签组”两个二级入口，且 MUST NOT 因没有原生标签组而隐藏后者或强制切换视图。

#### Scenario: 当前不存在 Chrome 标签组
- **WHEN** 用户选择“Chrome 标签组”且查询结果为空
- **THEN** 系统显示明确空状态并继续展示两个二级入口

#### Scenario: 当前存在 Chrome 标签组
- **WHEN** 用户选择“Chrome 标签组”且查询到一个或多个组
- **THEN** 系统沿用现有标签组卡片能力展示这些组

### Requirement: 新视图延续现有视觉与可访问性
新增导航、卡片、标签行和按钮 SHALL 使用现有设计令牌和组件风格，并 SHALL 同时提供鼠标与键盘可操作路径。

#### Scenario: 使用键盘切换视图
- **WHEN** 键盘焦点位于一级或二级导航按钮并触发该按钮
- **THEN** 系统切换视图且通过 `aria-selected` 暴露当前状态

#### Scenario: 用户启用减少动画偏好
- **WHEN** `prefers-reduced-motion: reduce` 生效
- **THEN** 拖拽和视图状态不依赖位移动画表达

#### Scenario: 渲染标签页图标
- **WHEN** 工作或窗口视图渲染一个具有安全 favicon 候选的标签页
- **THEN** 系统使用与域名视图相同的安全 favicon 和失败降级规则

### Requirement: 每个可管理标签支持精确关闭
Dashboard SHALL 在“域名”“工作”“窗口”和“Chrome 标签组”视图的每个可管理标签行提供关闭按钮，并 MUST 以该行的真实 `tabId` 为关闭目标。

#### Scenario: 关闭一个普通标签
- **WHEN** 用户点击某一标签行的关闭按钮且目标仍然存在并未置顶
- **THEN** 系统只关闭该 `tabId`，从 Chrome 重新获取状态，并刷新当前视图的卡片与数量

#### Scenario: 相同 URL 存在多个实例
- **WHEN** 两个或更多标签具有完全相同的 URL 且用户关闭其中一个标签行
- **THEN** 系统只关闭该行对应的实例，并保持其他相同 URL 标签打开

#### Scenario: 关闭时目标状态已经变化
- **WHEN** 目标标签已被关闭、已变为置顶或 Chrome 拒绝关闭
- **THEN** 系统不从界面乐观删除其他标签、不记录成功，并刷新真实状态后提示用户

#### Scenario: 键盘操作关闭按钮
- **WHEN** 键盘焦点位于任意标签行的关闭按钮并触发该按钮
- **THEN** 系统执行与鼠标点击相同的精确关闭，并通过 `aria-label` 说明关闭目标
