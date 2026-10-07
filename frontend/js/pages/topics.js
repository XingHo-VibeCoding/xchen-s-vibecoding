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

   Day 14（F6 自由对话 · 第 2 步）：本文件多了一件事 ——
     把 topics.json 里 group 为「自由」的那一条**从 8 个职场主题里摘出来**，
     渲染成独立入口（见下方 freeEntry）。
     8 张主题卡与两个分组一个字没动，B12「8 个主题、分两组」照旧成立。
     口径见 PRD.md §6.6、TECH_DESIGN.md §5.2.1。
   Day 14 修订（用户拍板）：这个入口由「主题列表**末尾**」搬到「主题列表**之上**」，
     成为页面上的**区块 02**（自成一节，不再是 #topics-body 里的一项）。
     渲染落点随之改为 #free-slot，四态处理见 renderLoading/Empty/Error 与 renderTopics。
   Day 20（第 3 周 · 板块 ②）：**首页概览的数据源从 mock 换成公网接口**。
    卡点概览三项（练过几次 / 累计问题条目 / 已收藏）改为现场从
    GET /api/sessions 与 GET /api/favorites 算，不再读 mock-sessions.json 的写死数字。
    ★ 但**主题卡片上的「上次在这里卡过」标记仍读 mock-sessions.json 的 practicedTopics**：
      今天只换概览三项（用户拍板的范围），stuckMap 需要的是「每个主题各错几条、
      错在偏题还是逻辑」的**分项**，而 GET /api/sessions 只给合计的 errorCount，
      拿不到分项 —— 那是 items 表全量查询的活，今天不扩到那里。
   ------------------------------------------------------------- */

(function () {
  'use strict';

  /* ---------- 0. 状态开关 & 取节点 ---------- */

  var FORCED = new URLSearchParams(location.search).get('state') || 'success';

  var topicsBody = document.getElementById('topics-body');
  var overviewBody = document.getElementById('overview-body');

  /* 自由对话那一节（区块 02，Day 14 修订）：入口从主题列表里搬出来后自成一节。
     blockFree 是整节（自带 hidden），freeSlot 是节内的渲染落点。
     两者都判空再动 —— 少一个 id 不该让整页逻辑炸掉。 */
  var blockFree = document.getElementById('block-free');
  var freeSlot = document.getElementById('free-slot');

  /* 整节的开合开关：数据没读到 / 出错 / 数据里没有自由类条目时，连小标一起收起来，
     不留下一个底下没有内容的空编号。 */
  function showFreeBlock(on) {
    if (blockFree) blockFree.hidden = !on;
    if (!on && freeSlot) freeSlot.replaceChildren();
  }

  // 固定组序：先「会议上」后「同事间」（PRD.md §6.3 的分组顺序）
  var GROUP_ORDER = ['会议上', '同事间'];
  var GROUP_LABEL = { '会议上': 'A', '同事间': 'B' };

  /* 自由对话（F6）在 topics.json 里的分组名。它**不在 GROUP_ORDER 里** ——
     这个数组是「8 个职场主题的组」，加进它等于把自由对话算成职场主题。
     渲染时按这个值把它摘出来，另行处理（TECH_DESIGN.md §5.2.1 约定 1：
     跳过按 group 而不是按 topicId，将来再加自由类条目不用改这行）。 */
  var FREE_GROUP = '自由';

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

    // 加载中不放出自由对话那一节：它是数据驱动的（group="自由" 那一条），内容还没到
    showFreeBlock(false);
  }

  function renderEmpty() {
    var box = el('div', 'empty');
    box.appendChild(el('div', 'big', '主题列表现在是空的'));
    box.appendChild(el('div', 'small',
      '数据里一条主题也没有。这不是报错——等主题配置补上之后，卡片会自动出现在这里。'));
    topicsBody.replaceChildren(box);

    overviewBody.replaceChildren(el('p', 'hint', '还没有练习记录。练过一次之后，这里会显示你被卡住的地方。'));

    // 一条主题也没有时，自由对话那一条同样读不到 —— 整节收起来
    showFreeBlock(false);
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
    showFreeBlock(false);
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

    // 按分组归拢，组的先后顺序固定。
    // 自由对话（group = "自由"）在这一步被摘出来单独存 —— 它不参与分组，
    // 也不计入任何一组的数量（B12 数的是 8 个职场主题）。
    var byGroup = {};
    GROUP_ORDER.forEach(function (g) { byGroup[g] = []; });
    var freeTopic = null;
    topics.forEach(function (t) {
      if (t.group === FREE_GROUP) {
        // 只认第一条：本期只有一条自由类条目（TECH_DESIGN.md §5.2.1 约定 2）
        if (!freeTopic) freeTopic = t;
        return;
      }
      if (!byGroup[t.group]) byGroup[t.group] = [];
      byGroup[t.group].push(t);
    });

    var frag = document.createDocumentFragment();

    Object.keys(byGroup).forEach(function (group) {
      var items = byGroup[group];
      if (!items.length) return;

      /* Day 11 线 2-A：被星标的主题排到本组最前（其余保持原顺序）。
         用 stable sort：JS 的 Array.sort 在现代浏览器里是稳定的，
         所以没被星标的那些相对顺序不变，只把星标的拎到前面。
         为什么要重排而不是只加个样式：清单要求「点击任意功能，界面发生明显变化」——
         卡片换个位置是最明显的变化，用户一眼就知道「它被标上去了」。 */
      var pinnedSet = {};
      if (window.Storage) {
        window.Storage.pinnedIds().forEach(function (id) { pinnedSet[id] = true; });
      }
      var sorted = items.slice().sort(function (x, y) {
        return (pinnedSet[y.topicId] ? 1 : 0) - (pinnedSet[x.topicId] ? 1 : 0);
      });

      var isGroupA = group === '会议上';
      var title = el('h2', 'section-title ' + (isGroupA ? 'group-a' : 'group-b'));
      title.appendChild(document.createTextNode('组 ' + GROUP_LABEL[group] + ' · ' + group + ' '));
      title.appendChild(el('span', 'count', '（' + items.length + ' 个）'));
      frag.appendChild(title);

      var grid = el('div', 'topic-list ' + (isGroupA ? 'group-a' : 'group-b'));
      sorted.forEach(function (t) {
        // 出过问题条目的主题，才在卡片上带「上次在这里卡过」标记（PRD.md §6.3）
        grid.appendChild(topicCard(t, {
          stuck: !!stuckMap[t.topicId],
          pinned: !!pinnedSet[t.topicId],
          onPin: handlePin
        }));
      });
      frag.appendChild(grid);
    });

    topicsBody.replaceChildren(frag);

    /* 自由对话入口（F6）**不在这一节里了** —— 它是页面上的区块 02，自己一节，
       位置在 8 个主题之上（Day 14 修订，用户拍板），落点是 #free-slot。
       它仍然由这份数据产出：数据里没有 group="自由" 的条目时，
       这一节连小标一起不出现，而不是留一个底下没内容的空壳。 */
    if (freeTopic) {
      if (freeSlot) freeSlot.replaceChildren(freeEntry(freeTopic));
      showFreeBlock(true);
    } else {
      showFreeBlock(false);
    }
  }

  /* ---------- 2.2 自由对话入口（Day 14 · F6；Day 14 修订：入口已搬到区块 02） ----------

     它的形状与 8 张主题卡**故意不同** —— 因为它不是「第 9 个主题」，
     而是一个去处（做成第 9 张卡会让 PRD §9.2 B12「8 个主题分两组」不成立）：
     一条**暗场横条**，配色与对话页的舞台同一套（--night 一族），
     左侧一颗缩小版光球 —— 点进去看到的就是这颗球在等他。
     文字说明由数据给（topics.json 的 name / summary / durationLabel），
     这里不写死文案，将来改说法只动数据。

     返回值就是这条横条本身（<a class="free-link">），外面不再套 .free-entry 壳：
     那层壳只为「在列表末尾拉一道分隔线 + 入场晚一拍」而存在，
     入口搬成独立一节之后，两件事都不成立了。 */
  function freeEntry(topic) {
    var a = el('a', 'free-link');
    a.href = 'dialogue.html?topic=' + encodeURIComponent(topic.topicId);

    /* 缩小版光球：与对话页 .orb 同一个组件、同样四层结构，
       尺寸与光晕由 .free-orb 收小（样式在 main.css）。
       aria-hidden —— 它只是「AI 在这儿」的视觉提示，
       正文里已经有文字说明，读屏用户不需要知道这颗球。 */
    var orb = el('span', 'orb free-orb');
    orb.setAttribute('aria-hidden', 'true');
    ['orb-halo', 'orb-ripple', 'orb-orbit', 'orb-core'].forEach(function (c) {
      orb.appendChild(el('span', c));
    });
    a.appendChild(orb);

    var body = el('span', 'free-body');
    /* 小标文案（Day 14 修订）：原「说点别的 · 不用挑主题」换成用户给的一句英语。
       逐字照抄，包括句号后**没有空格**这一处 —— 要改成「Don't be shy. Just go for it」
       就改这一行。 */
    body.appendChild(el('span', 'free-kicker', "Don't be shy.Just go for it"));
    body.appendChild(el('span', 'free-name', topic.name));
    body.appendChild(el('span', 'free-sum', topic.summary));
    a.appendChild(body);

    var meta = el('span', 'free-meta');
    // durationLabel 在 FREE 上是「不限」，读作「不限时长」
    meta.appendChild(el('span', 'free-dur', topic.durationLabel + '时长'));
    meta.appendChild(el('span', 'free-go', '开始聊 →'));
    a.appendChild(meta);

    return a;
  }

  /* ---------- 2.1 Day 11 线 2-A：星标（置顶）的回调 ----------

     这个函数是「状态机」与「存储」之间的桥：interact.js 只管按钮长什么样、
     什么时候变，能不能存下来由这里决定。
     为什么要有延时：真实场景下这里要发请求（第 3 周接库），
     先把「接口慢」这个事实摆进交互里，用户才会看到 busy 态；
     同步立刻完成的话，busy 态会一闪而过等于没有。
     时长 320ms：短到不烦人，长到能让眼睛捕捉到「它在忙」。 */
  var PIN_DELAY_MS = 320;

  function handlePin(topicId, next, api) {
    // 存储不可用（无痕模式 / 配额满）时给一条能看懂的提示，不是抛错
    if (!window.Storage) {
      api.reject('这个浏览器不允许本地保存，星标暂时用不了。');
      return;
    }

    setTimeout(function () {
      var ok = window.Storage.togglePin(topicId);

      // 写失败：E8 场景（无痕 / 配额满）。storage 层返回原状态，这里如实报错。
      if (ok !== next) {
        api.reject('没能保存星标，可能是浏览器不允许本地存储。');
        return;
      }

      api.resolve();

      /* 重排整张列表 —— 星标后立刻置顶、取消后立刻归位。
         为什么要重跑渲染而不是把卡片挪一下 DOM：重排要跨「组」考虑边界，
         直接重渲染同一份数据最不容易出错；这里数据量只有 8 张卡，代价可忽略。 */
      reorderTopics();
    }, PIN_DELAY_MS);
  }

  /* 保存住上次成功渲染的主题数据，供星标后重排用。
     为什么不在 handlePin 里重新 fetch：没必要为一次重排再打一次网络请求，
     而且重新 fetch 期间列表会闪一下骨架屏。 */
  var lastTopics = null;
  var lastMock = null;

  function reorderTopics() {
    if (!lastTopics) return;
    // 重排前记下当前滚动位置：重渲染会把视口弹回顶部，用户会以为页面跳走了
    var y = window.scrollY;
    renderTopics(lastTopics, lastMock);
    window.scrollTo(0, y);
  }

  /* ---------- 3. 成功态：区块 3（卡点概览）---------- */

  function statRow(label, value, sub) {
    var li = el('li');
    li.appendChild(el('span', 'k', label));
    var v = el('span', 'v', value);
    if (sub) v.appendChild(el('span', 'sub', sub));
    li.appendChild(v);
    return li;
  }

  /* ★★ Day 20：参数从 mock 换成 { sessions, favorites, degraded, errorCode }。
     数字的来源全在下面注释里写明，不留「这个 3 是哪来的」这种疑问：

       练过几次    = sessions.length（GET /api/sessions 的实际返回条数）
       累计问题条目 = Σ sessions[].errorCount
       已收藏      = favorites.length（GET /api/favorites 的实际返回条数）

     errorCount 这个字段名不是我起的：契约 §9.3 定的列名，
     它存的是 PRD.md §8.3 口径下的「偏题条数 + 逻辑错误条数」合计
     （CHECK 约束建表时就钉死了），所以直接加总，不用在这里再分类。 */
  function renderOverview(real) {
    var sessions = (real && real.sessions) || [];
    var favorites = (real && real.favorites) || [];

    var issues = sessions.reduce(function (acc, s) {
      return acc + (s.errorCount || 0);
    }, 0);

    var frag = document.createDocumentFragment();

    var list = el('ul', 'stat-list');
    list.appendChild(statRow('练过几次', sessions.length + ' 次'));
    list.appendChild(statRow('累计问题条目', issues + ' 条',
      '口径：偏题条数 + 逻辑错误条数'));
    list.appendChild(statRow('已收藏', favorites.length + ' 条'));
    frag.appendChild(list);

    var link = el('a', 'navlink block', '查看错误记录 →');
    link.href = 'records.html';
    frag.appendChild(link);

    /* ★ 降级时必须说出来，不能让人以为「我练过 0 次」。
       与 api.js 开头约定 ② 一致：接口失败不把页面清空，但**必须显示出来**。
       errorCode 直接摆出来，用户截图反馈时能一眼定位（TECH_DESIGN §8.2 口径）。 */
    if (real && real.degraded) {
      frag.appendChild(el('p', 'hint mock-note',
        '以上数字来自云端数据库。**本次没读到**（错误码 ' + (real.errorCode || 'UNKNOWN') +
        '），所以显示的是空值 —— 这不代表你没有练习记录。'));
    } else {
      frag.appendChild(el('p', 'hint mock-note',
        '以上数字来自云端数据库（GET /api/sessions 与 /api/favorites）。'));
    }

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

  /* ★ api.js 没加载就说清楚，而不是让 window.Api 变成 undefined 后面报
     「Cannot read properties of undefined」——那句话用户看不懂也不知道怎么办。
     判空放在最前面：它是「文件加载顺序错了」，与其他错误不是一回事。 */
  if (!window.Api) {
    renderError('接口模块没加载（js/api.js），本页拿不到云端数据。请检查 topics.html 的脚本顺序。');
    return;
  }

  /* Day 20：三份数据并着取。
     ① topics.json      —— 主题清单，仍是本地静态文件（它是内容不是记录，本该进库但没做）
     ② mock-sessions.json —— 只给主题卡片的「卡过」标记用（renderTopics 里的 stuckMap）
     ③ /api/sessions + /api/favorites —— 概览三项的真实数字

     为什么②③要分开取而不是合成一次：②要的是**分项**（某主题错几条、错在哪类），
     ③给的是**合计**（errorCount）。合成一份反而不诚实 —— 拿合计冒充分项，
     卡上的标记就会显示错的数字。分开取，各用各的，注释写清就说得清。 */
  Promise.all([
    fetchJSON('../../data/topics.json'),
    fetchJSON('../../data/mock-sessions.json'),
    window.Api.getSessionsOrLocal({ limit: 100 }, []),
    window.Api.getFavoritesOrLocal({ limit: 100 }, [])
  ]).then(function (result) {
    var topics = result[0];
    var mock = result[1];
    var sess = result[2];
    var fav = result[3];

    if (FORCED === 'error') throw new Error('演示用：强制错误状态');
    if (!Array.isArray(topics) || topics.length === 0 || FORCED === 'empty') {
      renderEmpty();
      return;
    }

    // 存住这两份数据：星标之后要重排列表，不必再 fetch 一次（见 reorderTopics）
    lastTopics = topics;
    lastMock = mock;

    renderTopics(topics, mock);

    /* 概览用真数据。两个接口**各自**判断降级：sessions 挂了但 favorites 好了，
       错误码该显示哪一个要看得见。这里合并时保留先失败的那个 code，
       因为 sessions 是三项数字里的两项，它的失败影响更大。 */
    var degraded = sess.degraded || fav.degraded;
    renderOverview({
      sessions: sess.sessions || [],
      favorites: fav.items || [],
      degraded: degraded,
      errorCode: sess.degraded ? sess.errorCode : fav.errorCode
    });
  }).catch(function (err) {
    renderError(err && err.message ? err.message : '');
  });
})();
