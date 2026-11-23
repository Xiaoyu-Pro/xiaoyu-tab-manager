# compliant-extension-packaging 规格

## Purpose

定义 Chrome 与 Edge 发布包的运行时文件闭包、法律文件、产物命名、共享清单和安全临时组装要求。

## Requirements

### Requirement: 发布包包含完整运行时闭包
打包系统 SHALL 将 Manifest、页面、样式、图标、本地化文件，以及这些入口引用的全部本地脚本和模块放在 ZIP 根目录对应路径中。

#### Scenario: 打包新增工作与窗口视图
- **WHEN** 运行 Chrome 或 Edge 打包命令
- **THEN** ZIP 包含工作服务、窗口操作、拖拽控制器和组织视图模块
- **AND** 解压后的所有本地 HTML、Manifest 与后台脚本引用都能解析到实际文件

#### Scenario: 引用文件未加入清单
- **GIVEN** 某个 HTML 或后台入口新增了本地运行时引用
- **WHEN** 运行扩展验证
- **THEN** 验证以非零状态失败
- **AND** 错误信息指出缺失或未打包的引用路径

### Requirement: 发布包携带再分发所需法律文件
打包系统 SHALL 在每个 Chrome 和 Edge ZIP 根目录包含 `LICENSE`、`NOTICE` 与集中修改清单。

#### Scenario: 检查发布包根目录
- **WHEN** 开发者列出 ZIP 内容
- **THEN** 根目录存在 `manifest.json`、`LICENSE`、`NOTICE` 和修改清单
- **AND** 文件不带多余的 `extension/` 或父目录前缀

### Requirement: 发布产物使用新品牌文件名
打包系统 SHALL 生成 `xiaoyu-tab-manager-{target}-{version}.zip`，其中 target 为 `chrome` 或 `edge`，version 来自 Manifest。

#### Scenario: 为两个浏览器构建发布包
- **WHEN** 依次运行 Chrome 和 Edge 打包命令
- **THEN** `dist` 中生成两个带新品牌、目标和版本的 ZIP 文件
- **AND** 每个 ZIP 的 Manifest 目标配置通过验证

### Requirement: 打包清单由单一模块维护
打包系统 SHALL 让打包脚本和验证脚本读取同一份发布文件清单，不维护相互独立的重复列表。

#### Scenario: 开发者增加运行时模块
- **WHEN** 开发者把模块加入共享发布清单
- **THEN** 打包命令复制该模块
- **AND** 验证命令同时检查该模块存在且被归档

### Requirement: 打包过程不污染源码目录
打包系统 SHALL 在受约束的临时目录中组装文件，并在成功或失败后安全清理该临时目录。

#### Scenario: ZIP 命令执行失败
- **WHEN** 打包过程中发生异常
- **THEN** 脚本以非零状态退出
- **AND** 不修改或删除源码目录中的文件
- **AND** 只尝试清理本次创建且通过路径边界校验的临时目录
