# Privacy Policy for Xiaoyu Tab Manager

Last updated: November 23, 2026

Xiaoyu Tab Manager is a local-first Chromium extension that replaces the new tab page with a dashboard for organizing open browser tabs.

This policy explains what data the extension uses, where it is stored, and what external requests may occur.

## Single Purpose

Xiaoyu Tab Manager helps users organize, filter, save, restore, and close browser tabs from a local new-tab dashboard and optional side panel.

## Data the Extension Uses

Xiaoyu Tab Manager may read the following browser tab information to render the dashboard:

- tab title
- tab URL
- tab window ID
- tab active state
- tab pinned state
- Chrome Tab Group ID and group metadata
- recently closed tab/window metadata exposed by `chrome.sessions`

This information is used only to display and manage tabs inside the extension UI.

## Data Stored Locally

Xiaoyu Tab Manager stores the following data locally on the user's device:

- saved-for-later tab URLs and titles
- saved-for-later completion/archive state
- saved session URLs, titles, order, pinned state, and group labels
- user-defined keyword mappings, page names, aliases, and full HTTP(S) URLs (including query parameters and fragments), used by dashboard shortcut search and grouped Shortcuts cards; no browsing history or bookmarks are read for this feature
- lightweight local activity stats and achievement flags
- local tool favorites, recent tools, and small per-tool draft state
- privacy mode state and privacy screen settings
- selected view mode
- work names, ordering, and exact-page assignments stored as SHA-256 URL keys
- current-session tab-to-work assignments and the most recent window-operation undo snapshot
- selected language
- selected theme
- cached favicon images

Saved tabs, preferences, and settings are stored using `chrome.storage.local` and `localStorage`. Work assignments keep only a SHA-256 key for the normalized exact URL (the fragment is removed; the query remains part of the page identity), rather than a plaintext URL. This local hash reduces accidental plaintext exposure but is not claimed to be irreversible anonymization.

Current-session work assignments and the latest undo snapshot use `chrome.storage.session` when available. The undo snapshot contains tab, window, position, and group IDs plus the original group title, color, and collapsed state needed for restoration; it does not contain tab URLs and expires with the browser session. On browsers without `storage.session`, that session-only state remains in extension memory.

## Data Sharing

Xiaoyu Tab Manager does not:

- sell user data
- use user data for advertising
- transfer tab lists to a remote server
- collect analytics or telemetry
- require an account
- run a backend service

The local tools workbench runs inside the extension. Text entered into JSON, URL, encoding, timestamp, QR, UUID/password, hash, cookie, and session export tools is processed locally and is not sent to a remote service.

Shortcut backups are local JSON downloads initiated by the user. They contain mapping groups, names, aliases, and full URLs, but not internal IDs, browser window identities, or unrelated extension data. Import reads only the file selected by the user, previews the merge, and writes locally only after confirmation. Keep backups private because internal URLs may contain sensitive query parameters. The extension does not upload them. Opening a shortcut navigates the browser to the user-selected destination; open-tab status is held in memory and is not exported.

Xiaoyu Tab Manager's use of information received from Chrome extension APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## External Requests

Xiaoyu Tab Manager may request favicons from:

```text
https://icons.duckduckgo.com
```

These requests are used to display small site icons next to tab entries. Favicons are cached locally for up to 7 days to reduce repeated network requests.

Users can disable external favicon requests in the privacy settings. When disabled, cached favicons may still render, but new domains will not request icons from the external service.

Privacy mode does not provide a web search box and does not change the browser search provider.

## Permissions

Xiaoyu Tab Manager requests the following extension permissions:

| Permission | Purpose |
| --- | --- |
| `tabs` | Read open tabs, focus or close tabs, move tabs between windows, and create tab groups |
| `storage` | Store saved tabs, saved sessions, local stats, and local preferences |
| `tabGroups` | Read, create, update, collapse, and ungroup Chrome Tab Groups |
| `sidePanel` | Show the optional side panel command center |
| `sessions` | Display and restore recently closed browser tabs/windows |

**Reuse identical tabs** compares URLs locally and shows a short message in Chrome's toolbar after a successful switch. It does not request system notification or website permissions. The message contains no page titles, URLs, or query parameters, and the feature does not persist matched URLs.

The extension requests only the permissions needed for its stated tab-dashboard purpose.

## Data Retention and Deletion

Data stored by Xiaoyu Tab Manager remains on the user's device until the user removes it.

Users can delete stored data by:

- removing the extension from the browser
- clearing extension site data / browser storage
- dismissing saved-for-later items inside the extension UI

## Children

Xiaoyu Tab Manager is a general productivity tool and is not directed at children.

## Changes

If this privacy policy changes, the updated version will be published in this repository.

## Contact

For support or privacy questions, use the GitHub repository:

https://github.com/Xiaoyu-Pro/xiaoyu-tab-manager
