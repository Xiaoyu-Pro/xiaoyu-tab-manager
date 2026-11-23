/** 显示本地化的成功文案，并让 Chrome 工具栏弹层自动关闭。 */
function showResult() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelector('#result').textContent = chrome.i18n.getMessage('exactTabReuseComplete');
  setTimeout(window.close.bind(window), 5_000);
}

showResult();
