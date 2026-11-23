## RENAMED Requirements

- FROM: `### Requirement: 始终提供三种一级组织视图`
- TO: `### Requirement: 始终提供四种一级组织视图`

## MODIFIED Requirements

### Requirement: 始终提供四种一级组织视图
Dashboard SHALL 始终提供“域名”“工作”“窗口”“快捷”四个一级入口，并 SHALL 允许用户在不离开 Dashboard 的情况下切换。“快捷”展示持久映射，不改变原三个视图的标签组织语义。

#### Scenario: Dashboard 初次加载
- **WHEN** 用户打开尚未保存组织视图偏好的 Dashboard
- **THEN** 显示四个一级入口并默认选中“域名”

#### Scenario: 用户切换一级视图
- **WHEN** 用户选择“工作”“窗口”或“快捷”
- **THEN** 在原内容区域渲染对应视图并保存偏好，快捷页不展示原标签过滤框

#### Scenario: 已保存偏好无效
- **WHEN** 保存的视图值不属于 domain、workspace、window、shortcuts
- **THEN** 回退到“域名”且不阻止加载，既有工作二级视图不受影响
