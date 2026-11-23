# Chrome Web Store Listing Draft

Use this document as copy-and-paste source material for the Chrome Web Store Developer Dashboard.

## Basic Information

**Name**

```text
Xiaoyu Tab Manager
```

**Short description**

```text
A local-first new tab dashboard for organizing open tabs with tab filtering, privacy mode, themes, and Chrome Tab Groups.
```

**Category**

```text
Productivity
```

**Language**

```text
English
```

The extension UI supports both English and Simplified Chinese.

## Detailed Description

```text
Xiaoyu Tab Manager replaces your new tab page with a local dashboard for open browser tabs.

It helps you understand what is open, find the right tab faster, clean up duplicates, and close groups of tabs without accidentally touching pinned tabs.

Highlights:
- Switch between Domain, persistent Work, and real Window organization views
- Open grouped Shortcuts, search custom names or aliases, and reuse exact open URLs or explicitly open a new copy
- Capture real tabs and export/import local shortcut backups with a merge preview
- Drag exact pages between workspaces or Chrome windows, with undo for real window moves
- Filter tabs instantly with the / shortcut
- Hide tab details with privacy mode before screen sharing
- Protect pinned tabs from bulk-close and duplicate-cleanup actions
- Detect duplicate pages and close extras while keeping one copy
- Save tabs for later in a local checklist
- Switch between English and Simplified Chinese
- Choose from 14 built-in visual themes
- Use a three-column local tools workbench for JSON, URLs, codecs, timestamps, real QR SVGs, hashes, cookies, and session export
- Refresh automatically when tabs open, close, or navigate
- Store preferences and saved tabs locally

Privacy:
Xiaoyu Tab Manager does not require an account, does not use analytics, does not sell data, and does not upload your tab list to a server. Saved tabs and preferences stay on your device. The extension may request favicons from DuckDuckGo's icon service and cache them locally for up to 7 days; users can disable external favicon requests in privacy settings.

The local tools workbench processes user input inside the extension. It does not call a backend service.

Attribution:
Xiaoyu Tab Manager is distributed under the Apache License 2.0. It is a modified derivative of Super Tab Out by Sivan (Apache-2.0); Super Tab Out is based on Tab Out by Zara Zhang (MIT). Required upstream notices are preserved in this project's NOTICE file. This project is not affiliated with Google, Chrome, Microsoft Edge, Brave, DuckDuckGo, or the upstream authors.
```

## Single Purpose Statement

Use this in the Privacy tab if prompted.

```text
Xiaoyu Tab Manager replaces the new tab page with a local dashboard for organizing, filtering, saving, and closing currently open browser tabs.
```

## Permission Justifications

Use these explanations in the Privacy / Permissions sections if requested.

| Permission | Justification |
| --- | --- |
| `tabs` | Required to read open tabs, display tab titles and URLs, focus selected tabs, close tabs, and create tab groups from the dashboard. |
| `storage` | Required to store saved-for-later tabs, saved sessions, local stats, privacy settings, language, theme, and view preferences locally. |
| `tabGroups` | Required to read, create, update, collapse, and ungroup Chrome Tab Groups. |
| `sidePanel` | Required to provide the optional side panel command center while the user stays on the current webpage. |
| `sessions` | Required to show and restore recently closed browser tabs/windows. |

## Privacy Practices Answers

Suggested factual answers based on the current implementation:

- The extension does not sell user data.
- The extension does not use user data for advertising.
- The extension does not transfer tab lists to a backend server.
- The extension does not collect analytics or telemetry.
- The extension stores saved tabs and preferences locally using browser storage.
- The extension stores saved sessions, lightweight stats, and achievement flags locally using browser storage.
- The extension stores local tool favorites, recent tools, and small per-tool drafts locally using browser storage.
- The extension uses tab titles and URLs only to render and manage the local dashboard.
- The extension uses `chrome.sessions` only to show and restore recently closed tabs/windows.
- The extension requests favicons from `icons.duckduckgo.com` only when external favicons are enabled, and caches them locally.

## Support / Homepage URLs

**Homepage URL**

```text
https://github.com/Xiaoyu-Pro/xiaoyu-tab-manager
```

**Support URL**

```text
https://github.com/Xiaoyu-Pro/xiaoyu-tab-manager/issues
```

**Privacy policy URL**

After pushing `PRIVACY.md` to GitHub, use the public file URL:

```text
https://github.com/Xiaoyu-Pro/xiaoyu-tab-manager/blob/main/PRIVACY.md
```

## Screenshot Checklist

Chrome Web Store screenshots should show the extension's actual UI. Recommended set:

1. **Main dashboard in domain view**
   - Upload: `store-assets/screenshot-1-dashboard.jpg`
   - Show several domain cards.
   - Include the tab filter control and compact Settings entry.
   - Demonstrates the primary new-tab value.

2. **Work layout view**
   - Upload: `store-assets/screenshot-2-groups.jpg`
   - Open Work and select the Work layout subview.
   - Show several persistent work cards and the window reassignment action.
   - Demonstrates logical work organization without hiding Domain or Window.

3. **Privacy mode**
   - Upload: `store-assets/screenshot-3-privacy.jpg`
   - Show the clock privacy screen.
   - Keep the UI free of private tab titles.
   - Demonstrates screen-sharing safety.

4. **Theme picker**
   - Upload: `store-assets/screenshot-4-themes.jpg`
   - Open Settings on the Appearance tab.
   - Show the 14 available palettes.
   - Demonstrates customization.

5. **Chinese UI**
   - Upload: `store-assets/screenshot-5-chinese.jpg`
   - Switch to `中`.
   - Show the same dashboard or privacy mode in Simplified Chinese.
   - Demonstrates bilingual support.

6. **Saved for later**
   - Save one or two tabs.
   - Show the right-side saved checklist.
   - Demonstrates local workflow beyond closing tabs.

## Screenshot Preparation Tips

- Use a clean browser profile with non-sensitive tabs.
- Avoid showing personal email addresses, account names, private docs, or internal work tabs.
- Use demo pages such as:
  - `https://github.com/Xiaoyu-Pro/xiaoyu-tab-manager`
  - `https://example.com`
  - `https://developer.chrome.com/docs/extensions/`
  - `https://news.ycombinator.com`
  - `https://www.wikipedia.org`
- Pin one tab to demonstrate pinned-tab protection if useful.
- Use the same theme across most screenshots for visual consistency, then use the theme picker screenshot to show variety.

## Generated Local Assets

These files are generated in this repository and can be uploaded directly:

| Store field | Local file |
| --- | --- |
| Store icon, 128x128 | `extension/icons/icon128.png` |
| Screenshot 1 | `store-assets/screenshot-1-dashboard.jpg` |
| Screenshot 2 | `store-assets/screenshot-2-groups.jpg` |
| Screenshot 3 | `store-assets/screenshot-3-privacy.jpg` |
| Screenshot 4 | `store-assets/screenshot-4-themes.jpg` |
| Screenshot 5 | `store-assets/screenshot-5-chinese.jpg` |
| Small promo tile, 440x280 | `store-assets/promo-small-440x280.jpg` |
| Marquee promo tile, 1400x560 | `store-assets/promo-top-1400x560.jpg` |

## Release Package Checklist

Before uploading:

- `manifest.json` is at the root of the ZIP.
- The ZIP contains `app.js`, `background.js`, `index.html`, `style.css`, `theme-init.js`, `sidepanel.html`, `sidepanel.css`, `sidepanel.js`, `tools.html`, `tools.css`, `tools.js`, `services/`, and `icons/`.
- The ZIP does not contain `.git`, `.omx`, `.DS_Store`, `__MACOSX`, or personal `config.local.js`.
- The version in `manifest.json` is correct for this release.
- The extension was loaded locally and smoke-tested after packaging.
