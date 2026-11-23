## Why

当前扩展仍以 “Super Tab Out” 对外展示，但维护者希望使用独立品牌 “Xiaoyu Tab Manager” 进行长期维护和可能的商业分发。改名必须同时解决用户可见品牌一致性、已有本地数据兼容、上游许可证署名和商店安装包缺文件的问题，不能只替换页面标题。

## What Changes

- 将浏览器扩展名称、页面标题、侧边栏、工具页、Omnibox 文案、页脚、README、商店文案和安装包文件名统一为 “Xiaoyu Tab Manager”。
- 保留 `super-tab-out-*` storage key、DOM event、Web Lock、开发目录和其他内部兼容标识，避免已有用户的偏好、工作归属、会话和操作状态丢失。
- 更新 `NOTICE`：增加 Xiaoyu Tab Manager 的修改声明，同时完整保留 Super Tab Out、Tab Out 和 QR Code generator 的上游署名与许可内容。
- 修复扩展打包清单：包含全部运行时脚本、视图模块、`LICENSE`、`NOTICE` 和 `MODIFICATIONS.md` 修改清单，并校验 ZIP 中引用文件闭包完整。
- 更新 Chrome/Edge 包名和相关开发文档；旧包名不作为运行时兼容契约。
- 对修改过的可注释源文件补充清晰的衍生修改声明，并通过集中清单覆盖不可注释的 JSON、图片等文件。

## Capabilities

### New Capabilities

- `product-branding`: 定义 Xiaoyu Tab Manager 的对外品牌、上游署名和内部兼容标识边界。
- `compliant-extension-packaging`: 定义可安装 ZIP 的运行时完整性、许可证内容、文件名和自动校验要求。

### Modified Capabilities

无。

## Impact

- 修改 `extension/manifest.json`、`extension/_locales/**`、Dashboard、Side Panel、Tools 和后台 Omnibox 的用户可见品牌文案。
- 修改 `README*`、`CHANGELOG*`、`STORE_LISTING.md`、`PRIVACY.md`、`NOTICE` 和相关源码头部；`LICENSE` 正文保持原样。
- 修改 `package.json`、`package-lock.json`、`scripts/package-extension.mjs` 和验证测试；不新增第三方依赖或浏览器权限。
- `chrome.storage` key、内部事件名、锁名和 schema 不迁移，不影响现有用户数据。
- 生成 `dist/xiaoyu-tab-manager-{chrome|edge}-<version>.zip`，并保证包内包含运行所需模块和许可证资料。
