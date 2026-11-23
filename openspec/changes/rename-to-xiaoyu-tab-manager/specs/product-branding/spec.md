## ADDED Requirements

### Requirement: 当前产品身份统一展示
系统 SHALL 在浏览器扩展清单、Dashboard、Side Panel、Tools、Omnibox、导出文件、README、隐私说明和商店文案中将当前产品名称显示为 “Xiaoyu Tab Manager”。

#### Scenario: 用户打开任意产品入口
- **WHEN** 用户查看扩展管理页、Dashboard、Side Panel 或 Tools 页面
- **THEN** 当前产品名称显示为 “Xiaoyu Tab Manager”
- **AND** 页面标题与页面内品牌不存在把 “Super Tab Out” 当作当前产品名的冲突文案

#### Scenario: 用户导出工具数据
- **WHEN** 用户从 Tools 页面导出数据
- **THEN** 下载文件名使用 `xiaoyu-tab-manager` 品牌前缀

### Requirement: 上游署名完整保留
系统 SHALL 明确说明 Xiaoyu Tab Manager 是包含修改的衍生作品，并保留 Super Tab Out、Tab Out 和 QR Code generator 的版权与许可证信息。

#### Scenario: 使用者检查发布包许可证
- **WHEN** 使用者打开发布包内的 `NOTICE` 或修改清单
- **THEN** 可以识别当前维护者的修改声明
- **AND** 可以识别 Super Tab Out、Tab Out 与 QR Code generator 的来源和适用许可

#### Scenario: 用户查看 Dashboard 页脚
- **WHEN** 用户查看 Dashboard 页脚
- **THEN** 页脚主品牌链接指向当前产品仓库
- **AND** 页脚以简短文案说明项目基于 Super Tab Out 与 Tab Out

### Requirement: 升级兼容标识保持稳定
系统 SHALL 保留既有 `super-tab-out-*` storage key、DOM event、Web Lock、JavaScript 全局对象及 schema 名称，除非未来提供显式迁移方案。

#### Scenario: 已有用户升级改名版本
- **GIVEN** 用户已保存主题、工作归属、窗口组织或会话数据
- **WHEN** 用户加载改名后的扩展
- **THEN** 扩展继续从原有内部 key 读取数据
- **AND** 用户无需重新配置或重建工作分组

#### Scenario: 开发者检索旧品牌名称
- **WHEN** 旧名称出现在源码中
- **THEN** 该出现位置仅用于内部兼容标识、上游署名或历史记录
- **AND** 不被误用作当前产品的用户可见名称

### Requirement: 品牌变更不扩大权限
系统 SHALL 在改名过程中保持现有 Manifest 权限和远程通信边界不变。

#### Scenario: 比较改名前后的 Manifest
- **WHEN** 开发者检查权限列表和 host permissions
- **THEN** 不因品牌变更增加权限、远程脚本或外部服务
