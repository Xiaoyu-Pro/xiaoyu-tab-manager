/* Xiaoyu Tab Manager 组织视图拖拽控制器；基于 Super Tab Out，由 Xiaoyu-Pro 修改。
   只管理 DOM 拖拽生命周期，业务移动由回调决定。 */
(function initDragController(globalScope) {
  'use strict';

  /** 创建单容器事件委托控制器，避免每次重渲染为每行重复绑定监听器。 */
  function createDragController({ root, onDrop, onDragStateChange = () => {} } = {}) {
    if (!root?.addEventListener || typeof onDrop !== 'function') throw new Error('DRAG_CONTROLLER_ARGUMENTS_INVALID');
    let payload = null;
    let attached = false;
    let highlightedTarget = null;

    /** 从事件目标读取可移动标签；保护行永远不会进入拖拽状态。 */
    function handleDragStart(event) {
      const row = event.target?.closest?.('.organization-tab-row[data-tab-id]');
      if (!row || row.dataset.protected === 'true') return;
      const tabId = Number(row.dataset.tabId);
      if (!Number.isFinite(tabId)) return;
      payload = { tabId, sourceId: row.dataset.sourceId || '' };
      event.dataTransfer?.setData('text/plain', JSON.stringify(payload));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
      onDragStateChange(true);
    }

    /** 仅允许投放到与来源不同的显式目标。 */
    function handleDragOver(event) {
      const target = event.target?.closest?.('[data-drop-target-id]');
      if (!payload || !target || target.dataset.dropTargetId === payload.sourceId) return;
      event.preventDefault();
      if (highlightedTarget !== target) {
        highlightedTarget?.classList.remove('is-drop-target');
        highlightedTarget = target;
        highlightedTarget.classList.add('is-drop-target');
      }
    }

    /** 把稳定的 tab/source/target 三元组交给业务层。 */
    function handleDrop(event) {
      const target = event.target?.closest?.('[data-drop-target-id]');
      if (!payload || !target || target.dataset.dropTargetId === payload.sourceId) return;
      event.preventDefault();
      onDrop({ ...payload, targetId: target.dataset.dropTargetId });
    }

    /** 清除拖拽状态并通知应用执行一次被合并的刷新。 */
    function handleDragEnd() {
      root.querySelector?.('.is-dragging')?.classList.remove('is-dragging');
      highlightedTarget?.classList.remove('is-drop-target');
      highlightedTarget = null;
      payload = null;
      onDragStateChange(false);
    }

    /** 绑定一次容器监听器；重复调用不会叠加。 */
    function attach() {
      if (attached) return;
      root.addEventListener('dragstart', handleDragStart);
      root.addEventListener('dragover', handleDragOver);
      root.addEventListener('drop', handleDrop);
      root.addEventListener('dragend', handleDragEnd);
      attached = true;
    }

    /** 在视图销毁或容器替换前完整解绑监听器。 */
    function detach() {
      if (!attached) return;
      root.removeEventListener('dragstart', handleDragStart);
      root.removeEventListener('dragover', handleDragOver);
      root.removeEventListener('drop', handleDrop);
      root.removeEventListener('dragend', handleDragEnd);
      handleDragEnd();
      attached = false;
    }

    return Object.freeze({ attach, detach, handleDragStart, handleDragOver, handleDrop, handleDragEnd });
  }

  const api = { createDragController };
  globalScope.SuperTabOutDragController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
