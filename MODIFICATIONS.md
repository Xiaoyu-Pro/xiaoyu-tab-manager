# Xiaoyu Tab Manager 修改说明

Xiaoyu Tab Manager 是 [Super Tab Out](https://github.com/SivanCola/super-tab-out) 的修改版本；Super Tab Out 采用 Apache License 2.0，并基于采用 MIT License 的 [Tab Out](https://github.com/zarazhangrui/tab-out)。完整许可与署名见 `LICENSE` 和 `NOTICE`。

## 2026 年 8 月修改范围

- 将当前产品名称改为 Xiaoyu Tab Manager，更新 Manifest、本地化、Dashboard、Side Panel、Tools、Omnibox、文档和商店资料。
- 修复标签 favicon 传递与回退逻辑，并增加在聚合界面关闭任意精确标签页的能力。
- 增加“域名 / 工作 / 窗口”组织视图、长期工作归属、拖拽编排、真实窗口重排、虚拟新窗口目标和撤销能力。
- 在问候语中增加 `xiao鱼🐟` 个性标识。
- 修复 Chrome/Edge 发布包的运行时依赖闭包，并把许可证、署名和本修改说明加入发布包。
- 更新测试、验证脚本和开发文档，以覆盖上述行为。

## 1.0.10 修改范围

- 将 Blue 已验证的精确网址复用功能移植到 Xiaoyu，默认关闭，仅在用户开启后申请可选通知权限。保留 Xiaoyu 品牌、问候语、图标和原有数据。

## 2026 年 11 月快捷搜索

- 在 Xiaoyu 仪表盘问候语右侧增加独立关键词搜索，不改变标签过滤框和 Blue 版本。
- 支持同一关键词映射多个网页、下拉单页选择、键盘操作及本地映射的增改删，沿用中英文和主题样式，不新增权限。
- 增加“快捷”分组卡片、真实标签收录、多别名与本地备份预览合并；搜索和卡片严格复用完整 URL，右键或 Shift+Enter 可显式新开副本，不改动 Blue、权限或原有自动防重规则。

## 兼容性边界

为避免已有用户数据丢失，`super-tab-out-*` 存储键、DOM 事件、Web Lock 名称和 `SuperTabOut*` JavaScript 全局对象仍保留原名称。这些名称只作为内部兼容契约，不代表当前产品品牌。

## 文件范围

修改涉及 `extension/` 下的 HTML、CSS、JavaScript、Manifest、本地化和图标相关引用，以及仓库根目录文档、测试、OpenSpec 规格与 `scripts/` 打包工具。JSON 和二进制图片无法携带源码注释，因此由本文件集中声明修改。

本说明用于满足衍生作品的来源与修改披露，不构成法律意见。
