## ADDED Requirements

### Requirement: 问候语展示固定署名
Dashboard SHALL 在按当前时间生成的问候语后展示固定署名 `xiao鱼🐟`，且 SHALL 保持现有早上、下午、晚上时间段判断不变。

#### Scenario: 中文下午问候语
- **WHEN** 当前语言为中文且当前时间属于下午时间段
- **THEN** 问候语 SHALL 显示为 `下午好，xiao鱼🐟`

#### Scenario: 英文下午问候语
- **WHEN** 当前语言为英文且当前时间属于下午时间段
- **THEN** 问候语 SHALL 显示为 `Good afternoon, xiao鱼🐟`

#### Scenario: 其他时间段
- **WHEN** 当前时间属于早上或晚上时间段
- **THEN** Dashboard SHALL 在对应时间段问候语后使用当前语言的标点追加同一署名

### Requirement: 署名不影响日期与视觉样式
Dashboard MUST 保持日期为独立文本，并 SHALL 让署名继承问候语的现有标题样式，不新增独立布局或富文本渲染。

#### Scenario: 渲染带署名的问候语
- **WHEN** Dashboard 渲染问候语和日期
- **THEN** 日期 SHALL 继续显示在原日期节点中，问候语 SHALL 通过纯文本写入原标题节点
