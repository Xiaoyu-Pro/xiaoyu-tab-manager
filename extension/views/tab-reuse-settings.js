/* Xiaoyu Tab Manager：复用现有设置读写逻辑，管理两个独立的标签页开关。 */
(function (global) {
  'use strict';

  /** 连接标签页设置，两个开关共享保存、同步与错误反馈逻辑。 */
  function init({ translate, selectView, onDashboardCleanupChange }) {
    const api = global.chrome;
    if (!api?.storage?.local || !global.XiaoyuTabReuse || !global.SuperTabOutTabs) return;

    /** 为一个设置绑定持久化；切换只保存值，不主动关闭任何标签。 */
    function bindSetting({ id, statusId, key, on, error, supported = true, onChange }) {
      const toggle = document.getElementById(id);
      const status = document.getElementById(statusId);
      if (!toggle || !status) return;
      let saving = false;
      let refreshId = 0;
      let statusKey = 'tabReuseOff';

      /** 使用现有双语翻译机制显示当前状态及失败提示。 */
      function showStatus(key) {
        statusKey = key;
        status.dataset.i18n = key;
        status.textContent = translate(key);
      }

      /** 同步存储和反馈可用性，避免较旧的异步读取覆盖新选择。 */
      async function refresh(feedback = '') {
        if (saving) return;
        const id = ++refreshId;
        try {
          const configured = (await api.storage.local.get(key))[key] === true;
          if (id !== refreshId) return;
          toggle.checked = configured && supported;
          toggle.disabled = !supported;
          onChange?.(configured);
          showStatus(feedback || (!supported ? 'tabReuseUnsupported' : configured ? on : 'tabReuseOff'));
        } catch {
          if (id !== refreshId) return;
          toggle.disabled = true;
          showStatus(error);
        }
      }

      /** 保存用户选择，无需请求系统通知或网站权限。 */
      async function changeSetting() {
        if (saving || !supported) return;
        saving = true;
        refreshId++;
        const requested = toggle.checked;
        toggle.disabled = true;
        let feedback = '';
        try {
          await api.storage.local.set({ [key]: requested });
        } catch {
          feedback = error;
        } finally {
          saving = false;
          await refresh(feedback);
        }
      }

      toggle.addEventListener('change', changeSetting);
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && key in changes) refresh();
      });
      global.addEventListener('focus', () => refresh());
      document.addEventListener('super-tab-out-language-change', () => showStatus(statusKey));
      refresh();
    }

    bindSetting({ id: 'tabReuseEnabled', statusId: 'tabReuseStatus', key: global.XiaoyuTabReuse.ENABLED_KEY,
      supported: global.XiaoyuTabReuse.canShowReusePopup(api), on: 'tabReuseOn', error: 'tabReuseSettingsError' });
    bindSetting({ id: 'dashboardAutoCleanupEnabled', statusId: 'dashboardAutoCleanupStatus', key: global.SuperTabOutTabs.DASHBOARD_CLEANUP_KEY,
      on: 'dashboardAutoCleanupOn', error: 'dashboardAutoCleanupSettingsError', onChange: onDashboardCleanupChange });

    // 设定分区使用游走焦点，让方向键和 Home/End 可访问新增的标签页分区。
    const tabList = document.querySelector('.settings-tabs');
    tabList?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...tabList.querySelectorAll('[data-settings-view]')];
      const current = tabs.indexOf(event.target);
      if (current < 0) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectView(tabs[index].dataset.settingsView);
      tabs[index].focus();
    });
  }

  global.XiaoyuTabReuseSettings = { init };
})(globalThis);
