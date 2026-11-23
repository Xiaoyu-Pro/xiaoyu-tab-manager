## ADDED Requirements

### Requirement: 首次工作组织由当前域名聚合初始化
系统 SHALL 在工作模型尚未初始化且用户首次进入“工作编排”时，以当前域名聚合卡片创建初始工作，并 MUST NOT 在后续访问时重复初始化。

#### Scenario: 首次进入工作编排
- **WHEN** `workspaceState` 不存在且当前有三个非空域名聚合
- **THEN** 系统创建三个名称唯一的工作并把当前标签归属到对应工作

#### Scenario: 再次进入工作编排
- **WHEN** `workspaceState` 已初始化
- **THEN** 系统加载已保存工作且不根据当前域名重新创建或覆盖工作

#### Scenario: 首次进入时没有可编排标签
- **WHEN** `workspaceState` 不存在且当前没有符合条件的标签页
- **THEN** 系统创建已初始化的空工作状态并展示空状态

### Requirement: 用户可维护长期工作列表
系统 SHALL 支持新建、重命名和删除工作；工作名称经去除首尾空格后 MUST 非空且 MUST 在不区分大小写时唯一。

#### Scenario: 新建有效工作
- **WHEN** 用户提交一个非空且不重名的工作名称
- **THEN** 系统创建工作、长期保存并立即显示工作卡片

#### Scenario: 提交无效工作名称
- **WHEN** 用户提交空名称或与现有工作仅大小写不同的名称
- **THEN** 系统拒绝写入并显示可理解的错误信息

#### Scenario: 删除包含标签归属的工作
- **WHEN** 用户确认删除一个非空工作
- **THEN** 系统删除该工作并让相关当前标签回到“待整理”

#### Scenario: 存储模型来自未来版本
- **WHEN** `workspaceState.schemaVersion` 高于当前扩展支持的版本
- **THEN** 系统拒绝编辑或降级覆盖该数据，回退到域名视图并提示用户升级扩展

### Requirement: 标签页可被逻辑重新归属且不改变真实窗口
系统 SHALL 支持通过拖拽或键盘“移动到”操作把一个当前标签归属到目标工作，并 MUST NOT 因该操作调用真实窗口移动。

#### Scenario: 拖拽标签到另一个工作
- **WHEN** 用户把可操作标签从工作 A 投放到工作 B
- **THEN** 系统立即保存逻辑归属、重新渲染两张卡片且保持该标签的 `windowId` 不变

#### Scenario: 撤销最近一次逻辑移动
- **WHEN** 用户在 Toast 中撤销刚完成的工作归属变更
- **THEN** 系统恢复该标签先前的工作或待整理状态

#### Scenario: 拖拽期间收到标签事件
- **WHEN** 用户正在拖拽且 Chrome 报告标签更新
- **THEN** 系统推迟 DOM 重渲染并在拖拽结束后合并刷新一次

### Requirement: 工作归属按会话实例与精确页面长期匹配
系统 SHALL 优先使用当前会话 `tabId` 归属，并在不存在会话归属时使用移除 fragment 后的精确 URL SHA-256 键匹配；系统 MUST NOT 使用同域名猜测长期归属。

#### Scenario: 页面仅 fragment 不同
- **WHEN** 新标签 URL 与已归属页面只有 fragment 不同
- **THEN** 系统匹配到相同长期工作

#### Scenario: 页面 query 不同
- **WHEN** 新标签 URL 与已归属页面的 query 参数不同
- **THEN** 系统把它视为不同精确页面且在没有会话归属时放入待整理

#### Scenario: 同一精确 URL 在当前会话有不同实例归属
- **WHEN** 两个相同 URL 标签分别具有不同的 `tabId` 会话归属
- **THEN** 系统在当前会话按各自 `tabId` 展示到不同工作

#### Scenario: 长期保存页面归属
- **WHEN** 系统写入精确页面的长期归属
- **THEN** `chrome.storage.local` 只保存 URL 的 SHA-256 键而不保存明文 URL

### Requirement: 未匹配页面进入待整理
系统 SHALL 把没有有效工作归属的当前标签展示在“待整理”区域，并 SHALL 在该区域内按域名聚合以降低整理成本。

#### Scenario: 打开一个从未归属的新页面
- **WHEN** 标签没有会话归属且精确页面键没有长期归属
- **THEN** 系统在待整理的对应域名分组中展示该标签

#### Scenario: 把待整理标签分配到工作
- **WHEN** 用户把待整理标签拖入一个工作
- **THEN** 系统从待整理移除该标签并保存其会话与长期归属
