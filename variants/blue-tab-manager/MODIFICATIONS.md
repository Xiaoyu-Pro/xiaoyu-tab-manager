# Blue Tab Manager 个性化副本修改说明

## 1.1.0 · 2026 年 11 月 9 日

- 新增默认关闭的「自动复用相同网址」：仅处理从占位页开始的首次前台加载，在确认切回已有标签后关闭新页。
- 新增可选 `notifications` 权限，由用户开启功能时授权；不增加必需权限或网站访问权限。
- 保留原有手动查重、会话恢复行为及 Xiaoyu 原版文件。

## 2026 年 10 月 26 日

- 复制 Xiaoyu Tab Manager 的完整运行时文件，作为可单独加载的扩展副本。
- 当前产品名改为 `Blue Tab Manager`，中英文固定署名改为 `南瓜公主🎃`。
- 工具导出文件名前缀改为 `blue-tab-manager`，地址栏关键词改为 `btm`。
- 保留原有功能、浏览器权限、内部存储键、原始许可证与全部上游署名。

以下为复制时保留的原项目修改记录。

# Xiaoyu Tab Manager 修改说明

Xiaoyu Tab Manager 是 [Super Tab Out](https://github.com/SivanCola/super-tab-out) 的修改版本；Super Tab Out 采用 Apache License 2.0，并基于采用 MIT License 的 [Tab Out](https://github.com/zarazhangrui/tab-out)。完整许可与署名见 `LICENSE` 和 `NOTICE`。

## 2026 年 8 月修改范围

- 将当前产品名称改为 Xiaoyu Tab Manager，更新 Manifest、本地化、Dashboard、Side Panel、Tools、Omnibox、文档和商店资料。
- 修复标签 favicon 传递与回退逻辑，并增加在聚合界面关闭任意精确标签页的能力。
- 增加“域名 / 工作 / 窗口”组织视图、长期工作归属、拖拽编排、真实窗口重排、虚拟新窗口目标和撤销能力。
- 在问候语中增加 `xiao鱼🐟` 个性标识。
- 修复 Chrome/Edge 发布包的运行时依赖闭包，并把许可证、署名和本修改说明加入发布包。
- 更新测试、验证脚本和开发文档，以覆盖上述行为。

## 兼容性边界

为避免已有用户数据丢失，`super-tab-out-*` 存储键、DOM 事件、Web Lock 名称和 `SuperTabOut*` JavaScript 全局对象仍保留原名称。这些名称只作为内部兼容契约，不代表当前产品品牌。

## 文件范围

修改涉及 `extension/` 下的 HTML、CSS、JavaScript、Manifest、本地化和图标相关引用，以及仓库根目录文档、测试、OpenSpec 规格与 `scripts/` 打包工具。JSON 和二进制图片无法携带源码注释，因此由本文件集中声明修改。

本说明用于满足衍生作品的来源与修改披露，不构成法律意见。
