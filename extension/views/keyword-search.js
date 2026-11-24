/* Xiaoyu Tab Manager：顶部快捷搜索与本地映射管理，不参与标签过滤。 */
(function (global) {
  'use strict';

  /** 连接搜索、管理与快捷排序；排序结束时通知仪表盘补做被延后的重绘。 */
  function init({ translate, notify, onSortEnd }) {
    const root = document.getElementById('keywordSearch');
    const input = document.getElementById('keywordSearchInput');
    const dropdown = document.getElementById('keywordSearchResults');
    const results = document.getElementById('keywordSearchList');
    const hint = document.getElementById('keywordSearchHint');
    const manage = document.getElementById('keywordManageBtn');
    const dialog = document.getElementById('keywordManager');
    const form = document.getElementById('keywordMappingForm');
    const status = document.getElementById('keywordManagerStatus');
    const mappingList = document.getElementById('keywordMappingList');
    const keywordOptions = document.getElementById('keywordMappingKeywords');
    const saveButton = document.getElementById('keywordMappingSave');
    const cancelButton = document.getElementById('keywordMappingCancel');
    const menu = document.getElementById('shortcutContextMenu');
    const newCopyButton = document.getElementById('shortcutNewCopy');
    const importFile = document.getElementById('keywordImportFile');
    const importPreview = document.getElementById('keywordImportPreview');
    const colorForm = document.getElementById('keywordGroupColorForm');
    const colorCode = document.getElementById('keywordGroupColorCode');
    const colorPicker = document.getElementById('keywordGroupColorPicker');
    const colorPreview = document.getElementById('keywordGroupColorPreview');
    const groupForm = document.getElementById('keywordGroupNameForm');
    const groupName = document.getElementById('keywordGroupName');
    const libraryRoot = document.getElementById('openTabsMissions');
    if (!root || !global.XiaoyuKeywordMappings || !global.SuperTabOutStorage) return;
    const api = global.XiaoyuKeywordMappings;
    const service = api.createService();
    const tabService = global.XiaoyuShortcutTabs.createService();
    let tabSnapshot = null;
    let menuMappingId = '';
    let menuOrigin = null;
    let pendingImport = '';
    let importSummary = null;
    let statusTimer = null;
    let rows = [];
    let groupColors = {};
    let colorLoadError = false;
    let matches = [];
    let selected = 0;
    let editingId = '';
    let editingGroup = '';
    let deletingId = '';
    let statusKey = '';
    let statusError = false;
    let loadError = false;
    let loaded = false;
    let busy = false;
    let opening = false;
    let refreshId = 0;
    const groupExpansion = new Map();
    let groupToExpand = '';
    let sortState = null;
    let sortTarget = null;
    let sortSaving = false;

    /** 拖拽及持久化期间暂停外部卡片重绘，避免替换手中的源节点。 */
    function isSorting() { return Boolean(sortState) || sortSaving; }

    /** 清除旧投放标记，不改动卡片或页面的原始顺序。 */
    function clearSortTarget() {
      if (sortTarget) {
        delete sortTarget.dataset.shortcutDropAxis;
        delete sortTarget.dataset.shortcutDropPosition;
      }
      sortTarget = null;
    }

    /** 取消本轮拖拽；已经提交的保存仍等待完成，不伪装撤销存储写入。 */
    function cancelSort() {
      sortState?.node.classList.remove('shortcut-sort-source');
      sortState = null;
      clearSortTarget();
      if (!sortSaving) onSortEnd?.();
    }

    /** 只接受同一快捷库的有效落点；多列按左右、单列及页面按上下决定前后。 */
    function resolveSortTarget(event) {
      if (!sortState) return null;
      const node = event.target.closest(sortState.kind === 'group' ? '.shortcut-library-card' : '.shortcut-library-item');
      if (!node || !libraryRoot.contains(node)) return null;
      const id = sortState.kind === 'group' ? node.dataset.shortcutGroup : node.dataset.shortcutId;
      if (id === sortState.id || (sortState.kind === 'page' && node.dataset.shortcutGroup !== sortState.group)) return null;
      const rect = node.getBoundingClientRect();
      const axis = sortState.kind === 'group' && getComputedStyle(node.parentElement).gridTemplateColumns.split(' ').length > 1 ? 'x' : 'y';
      const after = axis === 'x' ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
      return { node, id, axis, position: after ? 'after' : 'before' };
    }

    /** 用同一锁内接口保存鼠标或键盘排序，成功后才刷新；失败保留旧 DOM 顺序。 */
    async function saveOrder(kind, source, target, position) {
      if (sortSaving) return;
      sortSaving = true;
      cancelSort();
      try {
        const changed = await (kind === 'group' ? service.reorderGroups(source, target, position) : service.reorderPages(source, target, position));
        if (changed) {
          await refresh();
          notify?.(translate('shortcutSortSaved'));
        }
      } catch (error) {
        console.warn('[Xiaoyu shortcuts] Order not saved', { kind, reason: error?.message === 'keywordSortChanged' ? 'items-changed' : 'storage-or-data-error' });
        notify?.(translate('shortcutSortError'));
      }
      finally { sortSaving = false; cancelSort(); }
    }

    /** 只从独立柄启动本页排序，拖拽载荷不携带名称或内部网址。 */
    function startSort(event) {
      const handle = event.target.closest('[data-shortcut-sort]');
      if (!handle) return;
      if (busy || isSorting() || document.body.classList.contains('privacy-mode')) { event.preventDefault(); return; }
      const kind = handle.dataset.shortcutSort;
      const node = handle.closest(kind === 'group' ? '.shortcut-library-card' : '.shortcut-library-item');
      sortState = { kind, id: handle.dataset.sortId, group: node.dataset.shortcutGroup, node };
      node.classList.add('shortcut-sort-source');
      event.dataTransfer.setData('application/x-xiaoyu-shortcut-sort', '1');
      event.dataTransfer.effectAllowed = 'move';
      closeMenu();
    }

    /** 标记合法落点；外部拖入、自己和跨组页面不接管。 */
    function dragOverSort(event) {
      const target = resolveSortTarget(event);
      clearSortTarget();
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      sortTarget = target.node;
      sortTarget.dataset.shortcutDropAxis = target.axis;
      sortTarget.dataset.shortcutDropPosition = target.position;
    }

    /** 松手时重新核实落点，异步保存期间继续冻结卡片重绘。 */
    function dropSort(event) {
      const target = resolveSortTarget(event);
      if (!target) { cancelSort(); return; }
      event.preventDefault();
      saveOrder(sortState.kind, sortState.id, target.id, target.position);
    }

    /** Alt+上下键移动到相邻位置，Esc 取消未提交拖动；边界及保存中不重复写入。 */
    function keyboardSort(event) {
      if (event.key === 'Escape' && sortState) { event.stopPropagation(); cancelSort(); return; }
      const handle = event.target.closest('[data-shortcut-sort]');
      if (!handle || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy || isSorting()) return;
      const kind = handle.dataset.shortcutSort;
      const source = handle.closest(kind === 'group' ? '.shortcut-library-card' : '.shortcut-library-item');
      const items = [...(kind === 'group' ? libraryRoot.querySelectorAll('.shortcut-library-card') : source.parentElement.querySelectorAll('.shortcut-library-item'))];
      const target = items[items.indexOf(source) + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) saveOrder(kind, handle.dataset.sortId, kind === 'group' ? target.dataset.shortcutGroup : target.dataset.shortcutId,
        event.key === 'ArrowUp' ? 'before' : 'after');
    }

    /** 使用纯文本构造节点，不把用户名称或 URL 插入 HTML。 */
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    /** 关闭候选并清理辅助技术的活动选项。 */
    function closeResults() {
      dropdown.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    /** 保持组合框焦点，仅更新当前选项和可见滚动位置。 */
    function highlight(index, scroll = false) {
      selected = index;
      [...results.children].forEach((node, position) => node.setAttribute('aria-selected', String(position === selected)));
      const active = results.children[selected];
      if (active && !dropdown.hidden) {
        input.setAttribute('aria-activedescendant', active.id);
        if (scroll) active.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }

    /** 渲染已保存分组与跨组页面名的匹配，候选末尾显示所属分组。 */
    function renderResults() {
      matches = loadError ? [] : api.findMappings(rows, input.value);
      results.replaceChildren();
      hint.hidden = matches.length > 0;
      hint.textContent = translate(loadError ? 'keywordLoadError' : !loaded ? 'keywordLoading'
        : !api.normalizeKeyword(input.value) ? 'keywordSearchHint' : 'keywordNoMatch');
      matches.forEach((row, index) => {
        const button = element('button', 'keyword-search-option');
        button.type = 'button';
        button.tabIndex = -1;
        button.id = `keyword-result-${index}`;
        button.dataset.mappingId = row.id;
        button.setAttribute('role', 'option');
        button.title = row.url;
        const groupTag = element('span', 'keyword-result-tag', row.keyword);
        groupTag.title = row.keyword;
        const color = api.getGroupColor(row.keyword, groupColors);
        groupTag.style.backgroundColor = color;
        groupTag.style.color = api.getGroupTextColor(color);
        const state = global.XiaoyuShortcutLibrary.getStatus(tabSnapshot, row.url, translate);
        const meta = element('span', 'keyword-result-meta');
        meta.append(element('span', `shortcut-open-state${state.opened ? ' is-open' : ''}`, state.text), groupTag);
        button.append(element('span', 'keyword-result-title', row.title),
          element('span', 'keyword-result-url', row.url), meta);
        results.append(button);
      });
      highlight(Math.min(selected, Math.max(matches.length - 1, 0)));
    }

    /** 展开候选；上次读取失败时允许通过重新聚焦重试。 */
    function openResults() {
      dropdown.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      renderResults();
    }

    /** 所有入口共用严格打开规则；失败刷新状态，不以另开页面掩盖失败。 */
    async function openMapping(row, newCopy = false) {
      if (!row || opening) return;
      opening = true;
      try {
        // 点击前确认映射没有在其他仪表盘被删除或修改。
        const fresh = (await service.list()).find(item => item.id === row.id);
        if (!fresh) throw new Error('keywordMissing');
        await tabService.open(fresh.url, { newCopy });
        closeResults();
        input.blur();
      } catch {
        hint.hidden = false;
        hint.textContent = translate('keywordOpenError');
        notify?.(translate('keywordOpenError'));
      } finally { opening = false; refreshTabStatus(); }
    }

    /** 关闭副本菜单；只有键盘取消才主动还原焦点。 */
    function closeMenu(restoreFocus = false) {
      menu.hidden = true;
      menuMappingId = '';
      if (restoreFocus && menuOrigin?.isConnected) menuOrigin.focus();
      menuOrigin = null;
    }

    /** 在扩展页内提供可键盘访问的副本菜单，不新增浏览器权限。 */
    function showMenu(origin, x, y) {
      if (document.body.classList.contains('privacy-mode')) return;
      menuMappingId = origin.dataset.mappingId;
      menuOrigin = origin;
      menu.hidden = false;
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
      newCopyButton.focus();
    }

    /** 从搜索或卡片入口定位右键目标，管理列表不改变系统菜单。 */
    function getMenuTarget(target) {
      return target.closest?.('.keyword-search-option, [data-action="open-shortcut"]');
    }

    /** 按最新标签状态更新搜索提示，状态读取失败显示未知而非未打开。 */
    async function refreshTabStatus() {
      try { tabSnapshot = await tabService.getSnapshot(); } catch { tabSnapshot = null; }
      renderResults();
    }

    /** 合并短时间浏览器事件，避免加载网页期间重复扫描全部窗口。 */
    function scheduleTabStatus() {
      clearTimeout(statusTimer);
      statusTimer = setTimeout(refreshTabStatus, 150);
    }

    /** 独立读取映射、配色和标签状态，坏配色不能清空正常映射。 */
    async function getSnapshot() {
      const [saved, tabs, colors] = await Promise.allSettled([service.list(), tabService.getSnapshot(), service.getGroupColors()]);
      return { rows: saved.status === 'fulfilled' ? saved.value : [], loadError: saved.status !== 'fulfilled',
        groupColors: colors.status === 'fulfilled' ? colors.value : {}, colorLoadError: colors.status !== 'fulfilled',
        tabSnapshot: tabs.status === 'fulfilled' ? tabs.value : null };
    }

    /** 切换全量或单组管理标题，不覆盖用户尚未保存的表单草稿。 */
    function updateManagerContext() {
      dialog.dataset.groupMode = String(Boolean(editingGroup));
      groupForm.hidden = !editingGroup;
      form.elements.keyword.readOnly = Boolean(editingGroup);
      form.elements.keyword.closest('label').hidden = Boolean(editingGroup);
      const title = document.getElementById('keywordManagerTitle');
      const help = document.getElementById('keywordManagerHelp');
      if (editingGroup) {
        title.removeAttribute('data-i18n');
        title.textContent = translate('keywordGroupEditTitle', { group: editingGroup });
      } else {
        title.dataset.i18n = 'keywordManageTitle';
        title.textContent = translate('keywordManageTitle');
      }
      help.dataset.i18n = editingGroup ? 'keywordGroupEditHelp' : 'keywordManagerHelp';
      help.textContent = translate(help.dataset.i18n);
    }

    /** 复用管理弹层，可预填真实页面或限定分组；色块入口直接聚焦配色。 */
    async function openManager(draft, { keyword = '', editColor = false } = {}) {
      if (busy || document.body.classList.contains('privacy-mode')) return;
      closeMenu();
      closeResults();
      colorForm.hidden = true;
      showStatus();
      deletingId = '';
      editingGroup = keyword;
      resetForm(keyword);
      groupName.value = keyword;
      groupToExpand = api.normalizeKeyword(keyword);
      updateManagerContext();
      if (draft) {
        form.elements.title.value = draft.title || draft.url;
        form.elements.url.value = draft.url;
      }
      if (!dialog.open) dialog.showModal();
      document.querySelector('#keywordManager .keyword-dialog-body').scrollTop = 0;
      await refresh();
      if (!dialog.open) return;
      if (editingGroup) {
        openGroupColor(editingGroup);
        if (!editColor || colorLoadError) {
          groupName.focus();
          document.querySelector('#keywordManager .keyword-dialog-body').scrollTop = 0;
        }
      } else if (draft) form.elements.keyword.focus();
    }

    /** 给已渲染的真实网页行追加收录入口，不改变原行点击及关闭操作。 */
    function decorateTabs(tabs) {
      document.querySelectorAll('#openTabsMissions .page-chip').forEach(row => {
        if (row.querySelector('[data-action="capture-shortcut"]')) return;
        const id = Number(row.dataset.tabId || row.querySelector('[data-tab-id]')?.dataset.tabId);
        const tab = Number.isInteger(id) ? tabs.find(item => item.id === id)
          : tabs.find(item => item.url === row.dataset.tabUrl);
        if (!tab || !/^https?:\/\//.test(tab.url || '')) return;
        const actions = row.querySelector('.chip-actions');
        if (!actions) return;
        const button = element('button', 'chip-action shortcut-capture-btn', '+');
        button.type = 'button';
        button.dataset.action = 'capture-shortcut';
        button.dataset.tabId = String(tab.id);
        button.title = translate('shortcutCapture');
        button.setAttribute('aria-label', `${translate('shortcutCapture')} · ${tab.title || tab.url}`);
        // 旧域名行以 role=button 接管回车；子按钮保留原生键盘点击，不触发行跳转。
        button.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
        actions.prepend(button);
      });
    }

    /** 显示明确的保存结果，存储异常不暴露内部错误或伪装为成功。 */
    function showStatus(key = '', error = false) {
      statusKey = key;
      statusError = error;
      status.textContent = key ? translate(key) : '';
      status.classList.toggle('is-error', error);
    }

    /** 使用有限的已知验证错误文案，其余存储异常统一提示重试。 */
    function showError(error) {
      const keys = ['keywordRequired', 'keywordTitleRequired', 'keywordInvalidUrl', 'keywordInvalidAliases', 'keywordDuplicate', 'keywordMissing', 'keywordGroupExists', 'keywordGroupMissing', 'keywordDataError', 'keywordBackupInvalid', 'keywordBackupTooLarge', 'keywordInvalidGroupColor', 'keywordGroupColorLoadError'];
      showStatus(keys.includes(error?.message) ? error.message : 'keywordSaveError', true);
    }

    /** 重置编辑状态，保留刚使用的关键词便于继续添加同组页面。 */
    function resetForm(keyword = editingGroup) {
      form.reset();
      form.elements.keyword.value = keyword;
      editingId = '';
      saveButton.dataset.i18n = 'keywordAdd';
      saveButton.textContent = translate('keywordAdd');
      cancelButton.hidden = true;
    }

    /** 只预览完整有效色码，输入中的半成品留待保存时明确校验。 */
    function previewGroupColor() {
      let color;
      try { color = api.normalizeGroupColor(colorCode.value); } catch { return; }
      colorPicker.value = color;
      colorPreview.style.backgroundColor = color;
      colorPreview.style.color = api.getGroupTextColor(color);
    }

    /** 打开分组级配色表单，不清空用户正在填写的页面映射。 */
    function openGroupColor(keyword) {
      if (busy || colorLoadError) return;
      colorForm.dataset.keyword = keyword;
      colorForm.hidden = false;
      document.getElementById('keywordGroupColorTitle').textContent = `${translate('keywordGroupColor')} · ${keyword}`;
      colorCode.value = api.getGroupColor(keyword, groupColors);
      colorPreview.textContent = keyword;
      colorPreview.title = keyword;
      previewGroupColor();
      showStatus();
      colorCode.focus();
    }

    /** 保存成功才更新输入，失败保留 HEX/RGB 草稿；重置只影响本组。 */
    async function saveGroupColor(event, reset = false) {
      event.preventDefault();
      if (busy || colorLoadError) return;
      setBusy(true);
      showStatus();
      try {
        const saved = await service.setGroupColor(colorForm.dataset.keyword, reset ? null : colorCode.value);
        // 使用已确认写入的值，避免并发存储刷新尚未落到视图时读回旧颜色。
        colorCode.value = api.getGroupColor(colorForm.dataset.keyword, saved);
        previewGroupColor();
        await refresh();
        if (!colorLoadError) showStatus('keywordGroupColorSaved');
      } catch (error) { showError(error); }
      finally { setBusy(false); }
    }

    /** 单次提交整组名称及颜色，成功后更新上下文，保留正在编辑的子项和颜色草稿。 */
    async function renameGroup(event) {
      event.preventDefault();
      if (busy || !editingGroup || colorLoadError) return;
      setBusy(true);
      showStatus();
      try {
        const saved = await service.renameGroup(editingGroup, groupName.value);
        editingGroup = saved.keyword;
        groupName.value = saved.keyword;
        form.elements.keyword.value = saved.keyword;
        colorForm.dataset.keyword = saved.keyword;
        colorPreview.textContent = saved.keyword;
        colorPreview.title = saved.keyword;
        document.getElementById('keywordGroupColorTitle').textContent = `${translate('keywordGroupColor')} · ${saved.keyword}`;
        groupToExpand = api.normalizeKeyword(saved.keyword);
        updateManagerContext();
        await refresh();
        showStatus('keywordGroupRenamed');
      } catch (error) { showError(error); }
      finally { setBusy(false); }
    }

    /** 按管理上下文筛选可折叠组及颜色按钮，保留其他组的展开状态和删除确认。 */
    function renderManager() {
      mappingList.querySelectorAll('details.keyword-mapping-group').forEach(group => {
        groupExpansion.set(group.dataset.keyword, group.open);
      });
      const groups = new Map();
      rows.forEach(row => {
        if (editingGroup && api.normalizeKeyword(row.keyword) !== api.normalizeKeyword(editingGroup)) return;
        const key = api.normalizeKeyword(row.keyword);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      if (groupToExpand) {
        groupExpansion.set(groupToExpand, true);
        groupToExpand = '';
      }
      if (!loadError) {
        const existingGroups = new Set(rows.map(row => api.normalizeKeyword(row.keyword)));
        for (const key of groupExpansion.keys()) {
          if (!existingGroups.has(key)) groupExpansion.delete(key);
        }
      }
      keywordOptions.replaceChildren();
      mappingList.replaceChildren();
      if (loadError) mappingList.append(element('p', 'keyword-note is-error', translate('keywordLoadError')));
      else if (!groups.size) mappingList.append(element('p', 'keyword-note', translate('keywordEmpty')));
      groups.forEach((group, key) => {
        keywordOptions.append(element('option', '', group[0].keyword));
        const section = element('details', 'keyword-mapping-group');
        section.dataset.keyword = key;
        section.open = groupExpansion.get(key) === true;
        const summary = element('summary', 'keyword-group-summary');
        const name = element('span', 'keyword-group-name', group[0].keyword);
        name.title = group[0].keyword;
        const colorButton = element('button', 'keyword-group-color-button');
        colorButton.type = 'button';
        colorButton.dataset.groupColor = group[0].keyword;
        colorButton.title = translate('keywordGroupColorButton', { group: group[0].keyword });
        colorButton.setAttribute('aria-label', colorButton.title);
        colorButton.setAttribute('aria-controls', 'keywordGroupColorForm');
        colorButton.disabled = busy || colorLoadError;
        colorButton.style.backgroundColor = api.getGroupColor(group[0].keyword, groupColors);
        summary.append(name, colorButton, element('span', 'keyword-group-count', translate('keywordPageCount', { count: group.length })));
        const list = element('ul');
        section.append(summary, list);
        group.forEach(row => {
          const item = element('li', 'keyword-mapping-row');
          item.dataset.mappingId = row.id;
          const copy = element('div', 'keyword-mapping-copy');
          const title = element('strong', '', row.title);
          title.title = row.title;
          const url = element('small', '', row.url);
          url.title = row.url;
          copy.append(title, url);
          if (row.aliases.length) copy.append(element('small', 'keyword-aliases', row.aliases.join(' · ')));
          const actions = element('div', 'keyword-row-actions');
          ['edit', 'delete'].forEach(action => {
            const confirming = action === 'delete' && deletingId === row.id;
            const button = element('button', '', translate(action === 'edit' ? 'keywordEdit' : confirming ? 'keywordConfirmDelete' : 'keywordDelete'));
            button.type = 'button';
            button.dataset.mappingAction = action;
            button.dataset.mappingId = row.id;
            button.dataset.confirm = String(confirming);
            button.disabled = busy;
            button.setAttribute('aria-label', `${button.textContent} · ${row.title}`);
            actions.append(button);
          });
          item.append(copy, actions);
          list.append(item);
        });
        mappingList.append(section);
      });
    }

    /** 最新一次读取才更新界面，跨仪表盘变更不会清空正在编辑的表单。 */
    async function refresh() {
      const id = ++refreshId;
      try {
        const snapshot = await getSnapshot();
        if (id !== refreshId) return;
        rows = snapshot.rows;
        tabSnapshot = snapshot.tabSnapshot;
        loadError = snapshot.loadError;
        groupColors = snapshot.groupColors;
        colorLoadError = snapshot.colorLoadError;
      } catch {
        if (id !== refreshId) return;
        rows = [];
        loadError = true;
      }
      loaded = true;
      renderResults();
      renderManager();
      setBusy(busy);
      if (colorLoadError && dialog.open) showStatus('keywordGroupColorLoadError', true);
    }

    /** 管理页写入期间禁用修改入口，防止重复提交。 */
    function setBusy(value) {
      busy = value;
      [...form.elements, ...mappingList.querySelectorAll('button')].forEach(control => { control.disabled = value; });
      [...colorForm.elements, ...mappingList.querySelectorAll('[data-group-color]')].forEach(control => { control.disabled = value || colorLoadError; });
      [...groupForm.elements].forEach(control => { control.disabled = value || colorLoadError; });
      document.getElementById('keywordManagerClose').disabled = value;
      ['keywordExport', 'keywordImport', 'keywordImportConfirm', 'keywordImportCancel'].forEach(id => {
        document.getElementById(id).disabled = value;
      });
    }

    /** 保存成功后才清空名称与网址，失败保留完整输入。 */
    async function submitMapping(event) {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      showStatus();
      try {
        const saved = await service.save({ id: editingId, keyword: form.elements.keyword.value,
          title: form.elements.title.value, url: form.elements.url.value,
          aliases: form.elements.aliases.value.split(/\r?\n/) });
        groupToExpand = api.normalizeKeyword(saved.keyword);
        resetForm(saved.keyword);
        await refresh();
        showStatus('keywordSaved');
        setBusy(false);
        form.elements.title.focus();
      } catch (error) { showError(error); }
      finally { setBusy(false); }
    }

    /** 编辑单条映射或在第二次点击后删除，其他组不受影响。 */
    async function handleRowAction(event) {
      const colorButton = event.target.closest('[data-group-color]');
      if (colorButton) {
        event.preventDefault();
        event.stopPropagation();
        openGroupColor(colorButton.dataset.groupColor);
        return;
      }
      const button = event.target.closest('[data-mapping-action]');
      if (!button || busy) return;
      const row = rows.find(item => item.id === button.dataset.mappingId);
      if (!row) return;
      showStatus();
      if (button.dataset.mappingAction === 'edit') {
        editingId = row.id;
        deletingId = '';
        ['keyword', 'title', 'url'].forEach(key => { form.elements[key].value = row[key]; });
        form.elements.aliases.value = row.aliases.join('\n');
        saveButton.dataset.i18n = 'keywordSaveEdit';
        saveButton.textContent = translate('keywordSaveEdit');
        cancelButton.hidden = false;
        renderManager();
        form.elements.title.focus();
      } else if (deletingId !== row.id) {
        deletingId = row.id;
        renderManager();
        mappingList.querySelector('[data-confirm="true"]')?.focus();
      } else {
        setBusy(true);
        try {
          await service.remove(row.id);
          if (editingId === row.id) resetForm();
          deletingId = '';
          await refresh();
          showStatus('keywordDeleted');
          setBusy(false);
          form.elements.keyword.focus();
        } catch (error) { showError(error); }
        finally { setBusy(false); }
      }
    }

    /** 展示只读合并统计，取消预览不产生任何存储写入。 */
    function renderImportPreview() {
      importPreview.hidden = !pendingImport;
      document.getElementById('keywordImportSummary').textContent = importSummary
        ? translate('keywordImportSummary', importSummary) : '';
    }

    /** 仅在本地生成下载，不上传映射或申请下载权限。 */
    async function exportMappings() {
      if (busy) return;
      setBusy(true);
      showStatus();
      let url;
      try {
        const text = await service.exportBackup();
        url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = element('a');
        link.href = url;
        link.download = `xiaoyu-shortcuts-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        showStatus('keywordExported');
      } catch { showStatus('keywordExportError', true); }
      finally {
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
        setBusy(false);
      }
    }

    /** 先检查文件大小及全部内容，再展示预览，绝不在选文件时直接写入。 */
    async function previewFile() {
      const file = importFile.files[0];
      if (!file || busy) return;
      setBusy(true);
      showStatus();
      pendingImport = '';
      importSummary = null;
      renderImportPreview();
      try {
        if (file.size > api.MAX_BACKUP_BYTES) throw new Error('keywordBackupTooLarge');
        const text = await file.text();
        const summary = await service.previewImport(text);
        pendingImport = text;
        importSummary = summary;
        renderImportPreview();
      } catch (error) { showError(error); }
      finally { importFile.value = ''; setBusy(false); }
    }

    /** 确认后重新锁内合并，失败保留预览和文件内容供重试。 */
    async function confirmImport() {
      if (!pendingImport || busy) return;
      setBusy(true);
      showStatus();
      try {
        await service.importBackup(pendingImport);
        pendingImport = '';
        importSummary = null;
        renderImportPreview();
        await refresh();
        showStatus('keywordImported');
      } catch (error) { showError(error); }
      finally { setBusy(false); }
    }

    input.addEventListener('focus', () => { openResults(); if (!loaded || loadError) refresh(); });
    libraryRoot.addEventListener('dragstart', startSort);
    libraryRoot.addEventListener('dragover', dragOverSort);
    libraryRoot.addEventListener('drop', dropSort);
    libraryRoot.addEventListener('dragend', cancelSort);
    libraryRoot.addEventListener('keydown', keyboardSort);
    input.addEventListener('input', () => { selected = 0; openResults(); });
    root.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeResults();
      } else if (event.target === input && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        if (dropdown.hidden) { selected = 0; openResults(); }
        else if (matches.length) highlight((selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length, true);
      } else if (event.target === input && event.key === 'Enter') {
        event.preventDefault();
        if (!dropdown.hidden) openMapping(matches[selected], event.shiftKey);
      }
    });
    results.addEventListener('pointerdown', event => event.preventDefault());
    results.addEventListener('click', event => {
      const button = event.target.closest('[data-mapping-id]');
      if (button) openMapping(matches.find(row => row.id === button.dataset.mappingId));
    });
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget) && !menu.contains(event.relatedTarget)) closeResults(); });
    document.addEventListener('pointerdown', event => {
      if (!root.contains(event.target) && !menu.contains(event.target)) closeResults();
      if (!menu.contains(event.target)) closeMenu();
    });
    manage.addEventListener('click', () => openManager());
    document.addEventListener('contextmenu', event => {
      const target = getMenuTarget(event.target);
      if (!target) return;
      event.preventDefault();
      showMenu(target, event.clientX, event.clientY);
    });
    document.addEventListener('keydown', event => {
      const target = getMenuTarget(event.target);
      if (target && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault();
        const rect = target.getBoundingClientRect();
        showMenu(target, rect.left, rect.bottom);
      } else if (!menu.hidden && ['Escape', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (['Escape', 'Tab'].includes(event.key)) closeMenu(true);
        else newCopyButton.focus();
      }
    }, true);
    newCopyButton.addEventListener('click', async () => {
      const row = { id: menuMappingId };
      closeMenu(true);
      await openMapping(row, true);
    });
    document.addEventListener('click', async event => {
      const button = event.target.closest?.('[data-action]');
      if (!button) return;
      if (button.dataset.action === 'open-shortcut') {
        await openMapping({ id: button.dataset.mappingId });
      } else if (button.dataset.action === 'manage-shortcuts') openManager();
      else if (['edit-shortcut-group', 'color-shortcut-group'].includes(button.dataset.action)) {
        await openManager(undefined, { keyword: button.dataset.keyword, editColor: button.dataset.action === 'color-shortcut-group' });
      } else if (button.dataset.action === 'capture-shortcut') {
        event.preventDefault();
        try {
          const tab = await global.chrome.tabs.get(Number(button.dataset.tabId));
          if (!/^https?:\/\//.test(tab.url || '')) throw new Error('keywordInvalidUrl');
          openManager(tab);
        } catch { notify?.(translate('shortcutCaptureError')); }
      }
    });
    window.addEventListener('resize', () => closeMenu());
    document.addEventListener('scroll', () => closeMenu(), true);
    document.getElementById('keywordManagerClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (busy) event.preventDefault();
    });
    // 原生 dialog 已恢复入口焦点；close 事件中再次 focus 会抢走用户的新焦点。
    dialog.addEventListener('close', () => { editingGroup = ''; resetForm(); deletingId = ''; colorForm.hidden = true; updateManagerContext(); });
    groupForm.addEventListener('submit', renameGroup);
    colorForm.addEventListener('submit', saveGroupColor);
    colorCode.addEventListener('input', previewGroupColor);
    colorPicker.addEventListener('input', () => { colorCode.value = colorPicker.value.toUpperCase(); previewGroupColor(); });
    document.getElementById('keywordGroupColorReset').addEventListener('click', event => saveGroupColor(event, true));
    document.getElementById('keywordGroupColorClose').addEventListener('click', () => { colorForm.hidden = true; });
    form.addEventListener('submit', submitMapping);
    cancelButton.addEventListener('click', () => { resetForm(); showStatus(); });
    mappingList.addEventListener('click', handleRowAction);
    document.getElementById('keywordExport').addEventListener('click', exportMappings);
    document.getElementById('keywordImport').addEventListener('click', () => { if (!busy) importFile.click(); });
    importFile.addEventListener('change', previewFile);
    document.getElementById('keywordImportConfirm').addEventListener('click', confirmImport);
    document.getElementById('keywordImportCancel').addEventListener('click', () => {
      pendingImport = '';
      importSummary = null;
      renderImportPreview();
    });
    global.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (api.STORAGE_KEY in changes || api.GROUP_COLORS_KEY in changes)) {
        refresh();
        document.dispatchEvent(new Event('xiaoyu-shortcuts-changed'));
      }
    });
    ['onCreated', 'onRemoved', 'onActivated', 'onAttached', 'onDetached'].forEach(name => {
      global.chrome.tabs[name].addListener(scheduleTabStatus);
    });
    global.chrome.tabs.onUpdated.addListener((_id, changes) => {
      if ('url' in changes || 'status' in changes || 'pinned' in changes || 'discarded' in changes) scheduleTabStatus();
    });
    ['onCreated', 'onRemoved', 'onFocusChanged'].forEach(name => global.chrome.windows[name].addListener(scheduleTabStatus));
    document.addEventListener('super-tab-out-language-change', () => {
      updateManagerContext();
      renderResults();
      renderManager();
      if (!colorForm.hidden) document.getElementById('keywordGroupColorTitle').textContent = `${translate('keywordGroupColor')} · ${colorForm.dataset.keyword}`;
      showStatus(statusKey, statusError);
      renderImportPreview();
    });
    new MutationObserver(() => {
      if (!document.body.classList.contains('privacy-mode')) return;
      cancelSort();
      closeResults();
      closeMenu();
      if (dialog.open) dialog.close();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    refresh();
    return { getSnapshot, decorateTabs, openManager, isSorting, cancelSort };
  }

  global.XiaoyuKeywordSearch = { init };
})(globalThis);
