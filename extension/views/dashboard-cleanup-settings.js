/* 仪表盘自动合并开关，沿用既有设置布局与本地存储。 */
(function (global) {
  'use strict';

  /** 连接独立开关，读取失败可重试，保存失败恢复真实状态。 */
  function init({ translate, onEnabledChange }) {
    const toggle = document.getElementById('dashboardAutoCleanupEnabled');
    const status = document.getElementById('dashboardAutoCleanupStatus');
    if (!toggle || !status || !global.XiaoyuDashboardCleanup) return;
    const { ENABLED_KEY } = global.XiaoyuDashboardCleanup;
    let busy = false;
    let revision = 0;
    let statusKey = 'tabReuseOff';

    /** 用现有翻译机制显示关闭、开启和读写失败结果。 */
    function showStatus(key) {
      statusKey = key;
      status.textContent = translate(key);
      status.dataset.i18n = key;
    }

    /** 只应用最新读取结果，错误时禁用开关并保留最后确认的状态。 */
    async function refresh(feedback = '') {
      if (busy) return;
      const id = ++revision;
      try {
        const value = (await global.chrome.storage.local.get(ENABLED_KEY))[ENABLED_KEY] === true;
        if (id !== revision) return;
        toggle.checked = value;
        toggle.disabled = false;
        onEnabledChange(value);
        showStatus(feedback || (value ? 'dashboardAutoCleanupOn' : 'tabReuseOff'));
      } catch {
        if (id !== revision) return;
        toggle.disabled = true;
        showStatus('dashboardAutoCleanupSettingsError');
      }
    }

    /** 只保存设置，不因当前点击立即关闭其他仪表盘。 */
    async function change() {
      if (busy) return;
      busy = true;
      revision++;
      toggle.disabled = true;
      let feedback = '';
      try { await global.chrome.storage.local.set({ [ENABLED_KEY]: toggle.checked }); }
      catch { feedback = 'dashboardAutoCleanupSettingsError'; }
      finally { busy = false; await refresh(feedback); }
    }

    toggle.addEventListener('change', change);
    global.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ENABLED_KEY in changes) refresh();
    });
    global.addEventListener('focus', () => refresh());
    document.addEventListener('super-tab-out-language-change', () => showStatus(statusKey));
    refresh();
  }

  global.XiaoyuDashboardCleanupSettings = { init };
})(globalThis);
