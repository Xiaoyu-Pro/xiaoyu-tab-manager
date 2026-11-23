/* Blue Tab Manager：标签复用开关与可选通知授权。 */
(function (global) {
  'use strict';

  /** 把开关连接到本地设置；授权请求必须直接由用户交互发起。 */
  function init({ translate, selectView }) {
    const api = global.chrome;
    const toggle = document.getElementById('tabReuseEnabled');
    const status = document.getElementById('tabReuseStatus');
    if (!toggle || !status || !api?.storage?.local || !global.BlueTabReuse) return;
    const { ENABLED_KEY, NOTIFICATION_PERMISSION, canNotify } = global.BlueTabReuse;
    let saving = false;
    let refreshId = 0;

    /** 使用现有双语翻译机制显示当前状态及失败提示。 */
    function showStatus(key) {
      status.dataset.i18n = key;
      status.textContent = translate(key);
    }

    /** 同步存储和权限状态，避免较旧的异步读取覆盖新选择。 */
    async function refresh(feedback = '') {
      if (saving) return;
      const id = ++refreshId;
      try {
        const configured = (await api.storage.local.get(ENABLED_KEY))[ENABLED_KEY] === true;
        const effective = configured && await canNotify(api);
        if (id !== refreshId) return;
        toggle.checked = effective;
        showStatus(feedback || (effective ? 'tabReuseOn' : configured ? 'tabReuseNeedsPermission' : 'tabReuseOff'));
      } catch {
        if (id !== refreshId) return;
        toggle.checked = false;
        showStatus('tabReuseSettingsError');
      } finally {
        if (id === refreshId) toggle.disabled = false;
      }
    }

    /** 授权成功才开启；关闭开关不会再次请求权限。 */
    async function changeSetting() {
      if (saving) return;
      saving = true;
      refreshId++;
      const requested = toggle.checked;
      toggle.disabled = true;
      let feedback = '';
      try {
        const enabled = requested && await api.permissions.request(NOTIFICATION_PERMISSION) && await canNotify(api);
        if (requested && !enabled) feedback = 'tabReuseNeedsPermission';
        await api.storage.local.set({ [ENABLED_KEY]: enabled });
      } catch {
        feedback = 'tabReuseSettingsError';
      } finally {
        saving = false;
        await refresh(feedback);
      }
    }

    toggle.addEventListener('change', changeSetting);
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ENABLED_KEY in changes) refresh();
    });
    api.permissions.onAdded.addListener(() => refresh());
    api.permissions.onRemoved.addListener(() => refresh());
    global.addEventListener('focus', () => refresh());

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
    refresh();
  }

  global.BlueTabReuseSettings = { init };
})(globalThis);
