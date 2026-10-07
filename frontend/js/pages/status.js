/* 检查台逻辑（Day 20 · 板块 ③）
   -------------------------------------------------------------
   这个页面是什么：部署自检工具。给「把链接发给同伴之前」用，
     确认三件事——云函数活着、库里真有数据、写入链路通。

   ★ 它不属于 PRD 的任何一节，也不属于 F1–F6 任何一个功能。
     它是清单里的「检查台」要求，是一个**开发期工具页**。
     PRD.md §9 的页面清单里没有它 —— 因为它不是产品功能，是交付前的验证工具。
     口径与契约 §6.2 一致：本项目**不是打卡应用**，清单里写的
     checkins 表不存在，核心表是 sessions（契约 §9.1）。

   ★ 为什么不复用 records.html 的四态开关（?state=loading 等）：
     那一套是「数据区有四种状态」的产品页面写法（Day 13 定）。
     本页不需要 empty / error 两态——本页的「空」就是「库里没数据」，
     本身就是一条要显示的结果，不是需要单独检视的状态。
     只保留「刷新时暂时空着」这一种，占位文案与其他页一致。

   为什么三块内容都要**真的打接口**，而不是读缓存或写死：
     检查台的价值全在「它说的是真话」。任何一处写死，这页就变成装饰。

   文件位置：与 topics.js 同级（js/pages/），逻辑**不内联在 HTML 里**——
     topics.html 当初把逻辑内联了（Day 8），records.html 也内联了，
     但 pages/ 下已经有 topics.js 这个先例，且检查台逻辑有 200 行，
     内联会让 HTML 没法一眼看出结构。 */
(function () {
  'use strict';

  var healthList = document.getElementById('health-list');
  var healthNote = document.getElementById('health-note');
  var sessList = document.getElementById('sess-list');
  var sessRows = document.getElementById('sess-rows');
  var sessNote = document.getElementById('sess-note');
  var btnWrite = document.getElementById('btn-write');
  var btnReload = document.getElementById('btn-reload');
  var writeHint = document.getElementById('write-hint');
  var writeNote = document.getElementById('write-note');
  var lastUpdated = document.getElementById('last-updated');

  /* ---------- 最后更新时间（余力加练）----------
     ★ 记录的是**钟点**（HH:MM:SS），不是日期。
       为什么：本页的价值是「我刚才看的时候数据是什么」——
       同一页停留期间数据不会自己变，记日期反而稀释了信息。
       跨天再看会看到「最后更新 23:10」，配上第二块的行号仍能判断新鲜度。
     ★ 只在**成功**时调用。失败时页面显示的是上一次成功的数据，
       若失败也刷新时间戳，就等于宣称「失败的那一刻拿到了新数据」。 */
  function stampUpdated() {
    if (!lastUpdated) return;
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    lastUpdated.textContent = '最后更新：' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
      '（数据取自云端数据库）';
  }

  /* ---------- 通用小工具 ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 一行「标签 + 右侧值」。复用 .stat-list 的形状，
     与首页概览同一套排版 —— 检查台与产品页看起来才是一家的。 */
  function statRow(label, value) {
    var li = el('li');
    li.appendChild(el('span', 'k', label));
    li.appendChild(el('span', 'v', value));
    return li;
  }

  /* 把「状态说明 + 要不要珊瑚左边框」收在一处，
     免得每处都各写一遍 classList.add。 */
  function note(node, text, warn) {
    node.textContent = text;
    node.classList.toggle('mock-bar-warn', !!warn);
  }

  /* ---------- 时间：显示用本地钟点，不做时区换算 ----------
     ★ 库里是 TIMESTAMP（按 UTC+8 存，不带时区），接口补 "+08:00" 后输出 ISO 8601。
       这里**不new Date() 再格式化**——那会把 +08:00 换成本机时区，
       用户机器不在东八区时就会显示成另一个时间（契约 §9.8 第 5 条禁止这类换算）。
     ★ 只取字符串里确定存在的那一段：「2026-10-07T22:03:00+08:00」
       → 「10-07 22:03」。这个截取对任何时区的用户都给出同一个答案。 */
  function briefTime(iso) {
    if (!iso) return '—';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? (m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]) : String(iso);
  }

  /* ================= 一、健康状态 ================= */

  function renderHealthIdle() {
    healthList.replaceChildren(statRow('状态', '读取中…'));
  }

  function renderHealthOk(info) {
    var frag = document.createDocumentFragment();
    frag.appendChild(statRow('服务', info.service));
    frag.appendChild(statRow('接口基址', info.base));
    healthList.replaceChildren(frag);
    note(healthNote, '网关与云函数都在线。', false);
    /* 成功才打时间戳（理由见 stampUpdated 上方注释） */
    stampUpdated();
  }

  function renderHealthFail(code, message) {
    healthList.replaceChildren(statRow('状态', '不通'));
    note(healthNote, '健康检查失败（错误码 ' + code + '）：' + message, true);
  }

  function loadHealth() {
    if (!window.Api || !window.Api.pingHealth) {
      renderHealthFail('NO_API', '接口模块没加载（js/api.js）');
      return Promise.resolve();
    }
    renderHealthIdle();
    return window.Api.pingHealth().then(function (info) {
      renderHealthOk(info);
    }).catch(function (err) {
      renderHealthFail(err.code || 'UNKNOWN', err.message || '');
    });
  }

  /* ================= 二、核心表真实数据 ================= */

  function renderSessIdle() {
    sessList.replaceChildren(statRow('状态', '读取中…'));
    sessRows.replaceChildren();
  }

  function renderSessOk(data) {
    var sessions = data.sessions || [];

    /* 三个数字：行数、累计问题条目、条均轮次。
       条均轮次是给「库里到底有没有内容」再加一道判据——
       行数不为 0 但轮次全为 0，说明写进去的是空壳（Day 18 造过这种数据）。 */
    var totalErrors = sessions.reduce(function (a, s) { return a + (s.errorCount || 0); }, 0);
    var totalTurns = sessions.reduce(function (a, s) { return a + (s.turnCount || 0); }, 0);
    var avgTurns = sessions.length
      ? (totalTurns / sessions.length).toFixed(1)
      : '0.0';

    var frag = document.createDocumentFragment();
    frag.appendChild(statRow('sessions 行数', sessions.length + ' 行'));
    frag.appendChild(statRow('累计问题条目', totalErrors + ' 条'));
    frag.appendChild(statRow('条均轮次', avgTurns + ' 轮'));
    sessList.replaceChildren(frag);

    /* 逐行列出来 —— 只有数字看不出「读到的数据对不对」，
       得能看见具体某一行（主题、时间、轮次），才能和 SQL 编辑器里的查询对上。 */
    var rows = document.createDocumentFragment();
    if (!sessions.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('div', 'big', '库里没有记录'));
      empty.appendChild(el('div', 'small', '接口通了，但 sessions 表是空的 —— 这说明链路正常，只是还没写过数据。'));
      rows.appendChild(empty);
    } else {
      sessions.forEach(function (s) {
        var box = el('div', 'item');
        var head = el('div', 'item-head');

        head.appendChild(el('span', 'tag', s.topicId));
        head.appendChild(el('span', 'tag', briefTime(s.startedAt)));
        /* 中途退出的（B6：endedAt 为空）要标出来 —— 那一行的时长与
           错误次数都不能当完整记录看，标出来免得误读。 */
        if (s.isComplete === false) {
          head.appendChild(el('span', 'tag', '中途退出'));
        }
        box.appendChild(head);

        /* 为什么用 .spec-list 而不是 .item-foot / .item-src：
   前者是给按钮当容器的（item-card.js:96 只给了 margin-top，没给布局），
   后者自带 padding: 0 var(--space-4)，放进 .item 里会多缩进一格。
   .spec-list 本来就是「说明性条目列表」（main.css:611），语义正好对上。 */
        var meta = el('ul', 'spec-list');
        [['轮次', s.turnCount + ' 轮'],
         ['问题', (s.errorCount || 0) + ' 条'],
         ['精彩句子', (s.goodSentenceCount || 0) + ' 条']
        /* 用 <b> 而不是 <span class="k">：.k 只在 .stat-list 下有定义
   （main.css:2345），.spec-list 里挂 .k 是**无样式的空类**——
   不会报错，但也不会有任何视觉差别，留着只会让人以为有样式。 */
        ].forEach(function (pair) {
          var li = el('li');
          var b = el('b', null, pair[0] + '：');
          li.appendChild(b);
          li.appendChild(document.createTextNode(pair[1]));
          meta.appendChild(li);
        });
        box.appendChild(meta);

        /* sessionId 单独一行：它是「这一行对应库里哪条记录」的唯一凭据，
           排查时要在 SQL 编辑器里按它查，所以必须完整显示。 */
        box.appendChild(el('p', 'hint', s.sessionId));
        rows.appendChild(box);
      });
    }
    sessRows.replaceChildren(rows);

    note(sessNote, '以上是 GET /api/sessions 的真实返回。可在控制台 SQL 编辑器执行 ' +
      'select session_id, topic_id, turn_count from sessions order by started_at desc，' +
      '两边对得上就说明连的是同一个库。', false);
    stampUpdated();
  }

  function renderSessFail(code, message) {
    sessList.replaceChildren(statRow('状态', '读不到'));
    sessRows.replaceChildren();
    note(sessNote, '读取失败（错误码 ' + code + '）：' + message +
      ' —— 页面显示 0 行不代表库里没有数据。', true);
  }

  function loadSessions() {
    if (!window.Api || !window.Api.getSessions) {
      renderSessFail('NO_API', '接口模块没加载（js/api.js）');
      return Promise.resolve();
    }
    renderSessIdle();
    /* 刻意**不用** getSessionsOrLocal —— 那个函数失败时回落到本地假数据，
       而检查台要的就是「读不到就说读不到」，回落在这里等于把它变成装饰。 */
    return window.Api.getSessions({ limit: 8 }).then(function (data) {
      renderSessOk(data);
    }).catch(function (err) {
      renderSessFail(err.code || 'UNKNOWN', err.message || '');
    });
  }

  /* ================= 三、写入测试 ================= */

  /* ★ 这个 id 是**故意固定的**，不每次点都换新的。
     契约 §4之一 决定 1：传了 sessionId 就当幂等键，重复提交返回 400 DUPLICATE。
     而「连点两次被挡下」正好是这一块要演示的东西 —— 换新 id 就永远撞不上，
     那道主键约束也就验不到了。 */
  var TEST_SESSION_ID = 'S-TEST-DAY20';
  var TEST_TOPIC = 'T1';

  /* 时间戳用本地钟点拼，但**格式必须严格是 +08:00**：
     契约 §4之一 决定 3 只接受 +08:00（因为库里按 UTC+8 存且不做换算）。
     这里是检查台，写进去的是测试数据，用当前时刻即可。 */
  function nowStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '+08:00';
  }

  function setBusy(on, label) {
    /* 用 interact.js 那套data-state="busy" 的写法（main.css 2642 行）：
       按钮变淡 + 光标变progress，而不是 :disabled —— 后者灰得看不出在忙还是不能点。 */
    if (!btnWrite) return;
    if (on) {
      btnWrite.setAttribute('data-state', 'busy');
      btnWrite.textContent = '写入中…';
      btnWrite.disabled = true;
    } else {
      btnWrite.removeAttribute('data-state');
      btnWrite.textContent = label || '写一条测试数据';
      btnWrite.disabled = false;
    }
  }

  function renderWriteOk(result) {
    var s = result.session || {};
    writeHint.className = 'ic-hint';
    writeHint.textContent = '写入成功：' + s.sessionId +
      '（轮次存了 ' + result.turnsStored + ' 条、条目存了 ' + result.itemsStored +
      ' 条' + (result.itemsDropped ? '、丢弃 ' + result.itemsDropped + ' 条' : '') + '）';

    note(writeNote, '这行现在在库里。上面第二块的数字也变了 —— 点「重新读取」能看到它。' +
      ' 清理：SQL 编辑器执行 delete from sessions where session_id = \'' + s.sessionId + '\';', false);

    /* 写完立刻重读：让「写入 → 读回」在一次点击里闭环，
       不用用户手动点第二个按钮才相信这件事真的发生了。 */
    loadSessions();
  }

  /* ★ DUPLICATE 单独说，不归到「失败」里：
     它不是出错，是**约束按预期生效**的证明 —— 第二次点击本就该被挡下。
     说成失败会让人以为哪里坏了还要去修。 */
  function renderWriteDuplicate(code) {
    writeHint.className = 'ic-hint';
    writeHint.textContent = '主键冲突（' + code + '）：这一条上一轮已经写进去了，' +
      '数据库按预期挡住了重复写入 —— 这是约束生效，不是故障。';
    note(writeNote, '想再写一条新的，先把测试数据清理掉（见上方说明），' +
      '或者把 status.js 里的 TEST_SESSION_ID 改成别的值。', false);
    loadSessions();
  }

  function renderWriteFail(code, message) {
    writeHint.className = 'ic-hint';
    writeHint.textContent = '写入失败（错误码 ' + code + '）：' + message;
    note(writeNote, '接口返回了失败。没写进去 —— 库里行数不变。', true);
  }

  function doWrite() {
    if (!window.Api || !window.Api.writeSession) {
      renderWriteFail('NO_API', '接口模块没加载（js/api.js）');
      return;
    }
    setBusy(true);

    /* transcript 给一轮。**至少 1 轮是契约硬要求**（§4之一 必填），
       空数组会被判 INVALID_PARAMS —— 这个坑我第一次 curl 时就撞到过。
       这一轮的内容用中性的英文，不牵扯任何主题判断（FREE 之外的 T1 走正常校验）。 */
    var started = nowStamp();
    /* endedAt 比 startedAt 晚 3 分钟，是个「已完成」的完整记录；
       isComplete:true 与之自洽（§4之一 的 CHECK 会验这一条）。 */
    var ended = (function () {
      var d = new Date(Date.now() + 3 * 60 * 1000);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
        p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '+08:00';
    })();

    window.Api.writeSession({
      sessionId: TEST_SESSION_ID,
      topicId: TEST_TOPIC,
      nickname: '检查台',
      startedAt: started,
      endedAt: ended,
      isComplete: true,
      transcript: [
        { turn: 1, userText: 'This is a connectivity test.', aiText: 'Got it. Your link works.' }
      ],
      items: []
    }).then(function (result) {
      setBusy(false);
      renderWriteOk(result);
    }).catch(function (err) {
      setBusy(false);
      if (err.code === 'DUPLICATE') renderWriteDuplicate(err.code);
      else renderWriteFail(err.code || 'UNKNOWN', err.message || '');
    });
  }

  /* ---------- 启动 ---------- */

  if (btnWrite) btnWrite.addEventListener('click', doWrite);
  if (btnReload) {
    btnReload.addEventListener('click', function () {
      loadHealth();
      loadSessions();
      writeHint.textContent = '';
      note(writeNote, '', false);
    });
  }

  /* 三块并着发，互不依赖 —— 谁先回来谁先渲染。
     不用 Promise.all 是因为 Promise.all 会「一个失败全部不显示」，
     而这三块各自能独立说清成败（健康通了不代表库里能读到，反之亦然）。 */
  loadHealth();
  loadSessions();
})();