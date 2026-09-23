/* P1 主题列表页逻辑（Day 8 · 主视图）
   -------------------------------------------------------------
   今天做：把首页主视图渲染出来 —— 三个区块 + 四种状态，
           数据全部来自本地假数据（topics.json / mock-sessions.json）。
   今天不碰：真实 AI 接口（第 3 周）、录音转写、localStorage 持久化。

   本文件不负责画**卡片**：主题卡片是可复用组件（js/components/topic-card.js），
   由 pages/topics.html 先加载、本文件再调用 —— 余力加练的产物。

   四种状态怎么单独看（带地址栏参数即可，不带就是正常成功态）：
     pages/topics.html                  成功
     pages/topics.html?state=loading    加载中
     pages/topics.html?state=empty      空
     pages/topics.html?state=error      错误
   ------------------------------------------------------------- */

(function () {
  'use strict';

  /* ---------- 0. 状态开关 & 取节点 ---------- */

  var FORCED = new URLSearchParams(location.search).get('state') || 'success';

  var topicsBody = document.getElementById('topics-body');
  var overviewBody = document.getElementById('overview-body');

  // 固定组序：先「会议上」后「同事间」（PRD.md §6.3 的分组顺序）
  var GROUP_ORDER = ['会议上', '同事间'];
  var GROUP_LABEL = { '会议上': 'A', '同事间': 'B' };

  /* 建节点的小工具，省掉一堆 createElement/appendChild */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ---------- 1. 四种状态：加载中 / 空 / 错误 ---------- */

  function renderLoading() {
    var grid = el('div', 'skeleton-grid');
    for (var i = 0; i < 4; i++) {
      var card = el('div', 'skeleton-card');
      card.appendChild(el('div', 'bar w40'));
      card.appendChild(el('div', 'bar w70'));
      card.appendChild(el('div', 'bar w100'));
      card.appendChild(el('div', 'bar w100'));
      grid.appendChild(card);
    }

    var frag = document.createDocumentFragment();
    frag.appendChild(grid);
    frag.appendChild(el('p', 'state-hint', '正在读取主题数据…'));
    topicsBody.replaceChildren(frag);

    overviewBody.replaceChildren(el('p', 'hint', '正在读取练习记录…'));
  }

  function renderEmpty() {
    var box = el('div', 'empty');
    box.appendChild(el('div', 'big', '主题列表现在是空的'));
    box.appendChild(el('div', 'small',
      '数据里一条主题也没有。这不是报错——等主题配置补上之后，卡片会自动出现在这里。'));
    topicsBody.replaceChildren(box);

    overviewBody.replaceChildren(el('p', 'hint', '还没有练习记录。练过一次之后，这里会显示你被卡住的地方。'));
  }

  function renderError(detail) {
    var box = el('div', 'empty state-error');
    box.appendChild(el('div', 'big', '主题数据没能加载'));
    box.appendChild(el('div', 'small',
      '页面本身没问题，是数据没读上来。' +
      (detail ? '（' + detail + '）' : '') +
      '最常见的原因是直接双击打开了 HTML 文件——请按 README.md 里的命令用本地服务打开本页。'));

    var btn = el('button', 'primary', '重新加载');
    btn.style.marginTop = '16px';
    // 去掉地址栏上的 ?state= 再重来，避免又落回被强制出来的错误态
    btn.addEventListener('click', function () {
      location.href = location.pathname;
    });
    box.appendChild(btn);

    topicsBody.replaceChildren(box);
    overviewBody.replaceChildren(el('p', 'hint', '练习记录也没能读上来。'));
  }

  /* ---------- 2. 成功态：区块 2（主题列表） ---------- */

  /* 主题卡片由可复用组件提供：js/components/topic-card.js
     它必须先在 pages/topics.html 里加载，本文件才拿得到 —— 加载顺序见该 HTML 的注释。
     卡片长什么样（角标 / 主题名 / 英文说明 / 卡过标记 / 时长）全在组件里，
     将来改卡片样式只动组件，这里一个字不用改。 */
  var topicCard = window.Components && window.Components.topicCard;

  function renderTopics(topics, mock) {
    // 组件没加载就直说原因，别让它变成一个看不懂的 "undefined is not a function"
    if (!topicCard) throw new Error('主题卡片组件没加载（js/components/topic-card.js）');

    var stuckMap = {};
    ((mock && mock.practicedTopics) || []).forEach(function (p) {
      if (p && p.issueCount > 0) stuckMap[p.topicId] = p;
    });

    // 按分组归拢，组的先后顺序固定
    var byGroup = {};
    GROUP_ORDER.forEach(function (g) { byGroup[g] = []; });
    topics.forEach(function (t) {
      if (!byGroup[t.group]) byGroup[t.group] = [];
      byGroup[t.group].push(t);
    });

    var frag = document.createDocumentFragment();

    Object.keys(byGroup).forEach(function (group) {
      var items = byGroup[group];
      if (!items.length) return;

      var isGroupA = group === '会议上';
      var title = el('h2', 'section-title ' + (isGroupA ? 'group-a' : 'group-b'));
      title.appendChild(document.createTextNode('组 ' + GROUP_LABEL[group] + ' · ' + group + ' '));
      title.appendChild(el('span', 'count', '（' + items.length + ' 个）'));
      frag.appendChild(title);

      var grid = el('div', 'topic-list ' + (isGroupA ? 'group-a' : 'group-b'));
      items.forEach(function (t) {
        // 出过问题条目的主题，才在卡片上带「上次在这里卡过」标记（PRD.md §6.3）
        grid.appendChild(topicCard(t, { stuck: !!stuckMap[t.topicId] }));
      });
      frag.appendChild(grid);
    });

    topicsBody.replaceChildren(frag);
  }

  /* ---------- 3. 成功态：区块 3（卡点概览，mock 数据） ---------- */

  function statRow(label, value, sub) {
    var li = el('li');
    li.appendChild(el('span', 'k', label));
    var v = el('span', 'v', value);
    if (sub) v.appendChild(el('span', 'sub', sub));
    li.appendChild(v);
    return li;
  }

  function renderOverview(mock) {
    var practiced = (mock && mock.practicedTopics) || [];

    // 口径对齐 PRD.md §8.3：错误次数 = 偏题条数 + 逻辑错误条数。
    // 各项都由 practicedTopics 现场加总，不写死数字——第 3 周换成真实记录后这张表不用改。
    var sum = function (key) {
      return practiced.reduce(function (acc, p) { return acc + (p[key] || 0); }, 0);
    };
    var sessions = (mock && typeof mock.sessionCount === 'number') ? mock.sessionCount : practiced.length;
    var issues = sum('issueCount');
    var offTopic = sum('offTopicCount');
    var logicError = sum('logicErrorCount');
    var favorites = (mock && typeof mock.favoriteCount === 'number') ? mock.favoriteCount : 0;

    var frag = document.createDocumentFragment();

    var list = el('ul', 'stat-list');
    list.appendChild(statRow('练过几次', sessions + ' 次'));
    list.appendChild(statRow('累计问题条目', issues + ' 条', '偏题 ' + offTopic + ' · 逻辑错误 ' + logicError));
    list.appendChild(statRow('已收藏', favorites + ' 条'));
    frag.appendChild(list);

    var link = el('a', 'navlink block', '查看错误记录 →');
    link.href = 'records.html';
    frag.appendChild(link);

    frag.appendChild(el('p', 'hint mock-note',
      '以上是本地假数据（mock）。第 3 周接上真实记录后，这里显示你自己的卡点。'));

    overviewBody.replaceChildren(frag);
  }

  /* ---------- 4. 取数 → 按状态分发 ---------- */

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  renderLoading();

  // 要看「加载中」这一态就停在这里，不再往下走
  if (FORCED === 'loading') return;

  Promise.all([
    fetchJSON('../../data/topics.json'),
    fetchJSON('../../data/mock-sessions.json')
  ]).then(function (result) {
    var topics = result[0];
    var mock = result[1];

    if (FORCED === 'error') throw new Error('演示用：强制错误状态');
    if (!Array.isArray(topics) || topics.length === 0 || FORCED === 'empty') {
      renderEmpty();
      return;
    }

    renderTopics(topics, mock);
    renderOverview(mock);
  }).catch(function (err) {
    renderError(err && err.message ? err.message : '');
  });
})();
