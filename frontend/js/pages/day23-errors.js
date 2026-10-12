/* Day 23 · 三类错误提示演示脚本
   -------------------------------------------------------------
   这是**截图辅助页**的脚本，不是产品页面。
   用途只有一个：让「输入错 / 网络错 / 服务端错」三类中文提示
   能并排出现在一张图里（真实场景下三类错误很难同时发生）。

   ★ 它调用的是真正的 frontend/js/api.js 的 friendlyOf()——
     不是另写一份文案。改 api.js 的映射表，这个页面自动跟着变，
     不会变成「截图好看但线上不是这样」的假证据。

   ★★ 教训（Day 23 自己踩的）：这页最初是把 .html 复制成 .js，
     结果脚本里塞满了 HTML，浏览器报 SyntaxError: Unexpected token '<'，
     页面停在「加载中…」。
     —— 而 `--screenshot` 只截**视口**，那个「加载中…」看起来
     像一张排版正常的页面，不细看发现不了内容是空的。
     ★★ 「截图成功」不等于「页面有内容」。必须读那张图。
*/

(function () {
  'use strict';

  /* 一行 = 一类错误。左右对照「改前（裸报错）/ 改后（中文人话）」。 */
  function row(title, sub, err, hint) {
    var box = document.createElement('div');
    box.className = 'demo-row';

    var h = document.createElement('div');
    h.className = 'demo-t';
    h.textContent = title;
    box.appendChild(h);

    var s = document.createElement('div');
    s.className = 'demo-s';
    s.textContent = sub;
    box.appendChild(s);

    var grid = document.createElement('div');
    grid.className = 'demo-grid';

    /* 左：改前。err.message 就是接口层真实的原始文案，
       取自云函数 sendError 的第四个参数，不是编的。 */
    var before = document.createElement('div');
    before.className = 'demo-cell before';
    var oldCap = document.createElement('div');
    oldCap.className = 'demo-cap';
    oldCap.textContent = '改前（裸报错）';
    var oldMsg = document.createElement('div');
    oldMsg.className = 'demo-old';
    oldMsg.textContent = (err && err.message) || '（无 message）';
    var oldCode = document.createElement('div');
    oldCode.className = 'demo-code';
    oldCode.textContent = (err && err.code) || '';
    before.appendChild(oldCap);
    before.appendChild(oldMsg);
    before.appendChild(oldCode);
    grid.appendChild(before);

    /* 右：改后。走真实的 friendlyOf()。 */
    var after = document.createElement('div');
    after.className = 'demo-cell after';
    var newCap = document.createElement('div');
    newCap.className = 'demo-cap';
    newCap.textContent = '改后（中文提示）';
    var newMsg = document.createElement('div');
    newMsg.className = 'demo-new';
    newMsg.textContent = (window.Api && window.Api.friendlyOf)
      ? window.Api.friendlyOf(err)
      : '（api.js 未加载）';
    after.appendChild(newCap);
    after.appendChild(newMsg);
    grid.appendChild(after);

    box.appendChild(grid);

    if (hint) {
      var hh = document.createElement('div');
      hh.className = 'demo-hint';
      hh.textContent = '→ 用户能做什么：' + hint;
      box.appendChild(hh);
    }
    return box;
  }

  function build() {
    var wrap = document.getElementById('rows');
    wrap.replaceChildren();

    wrap.appendChild(row(
      '输入错 · 你自己说的内容不对',
      '例如：内容太长、请求体格式不对',
      { code: 'PAYLOAD_TOO_LARGE', message: '请求体超出限制' },
      '把句子说短一点'));

    wrap.appendChild(row(
      '网络错 · 连不上，可以重试',
      '例如：网络抖动、AI 等太久没回应',
      { code: 'LLM_TIMEOUT', message: 'LLM_TIMEOUT' },
      '等一会儿再说一次'));

    wrap.appendChild(row(
      '服务端错 · 重试没用，只能等',
      '例如：数据库读不到、模型服务没配好',
      { code: 'DB_QUERY_FAILED', message: 'DB_QUERY_FAILED' },
      '稍后再试；页面仍可用本地数据'));

    wrap.appendChild(row(
      '兜底 · 没见过的错误码',
      '例如：后端新增了一个码，映射表还没跟上',
      { code: 'SOME_NEW_CODE_2027', message: 'SOME_NEW_CODE_2027' },
      '不会出现 undefined 或英文码'));

    document.getElementById('verdict').textContent =
      (window.Api && window.Api.friendlyOf)
        ? '已加载真实 api.js —— 下面每一句都与线上页面逐字相同'
        : '★ api.js 没加载成功（不能用 file:// 打开，必须走本地服务）';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();