/* 可复用组件：条目 + 收藏按钮（Day 11 · 线 2-B）
   -------------------------------------------------------------
   为什么单独成文件：PRD.md §6.4 定的收藏对象是「问题条目（偏题 / 逻辑错误）
   与精彩句子」两类，P3 结果页与 P4 记录页**都要渲染它们、都要能收藏**。
   条目长什么样（原句 / 类型 / 轮次 / 提醒 / 纠正）与收藏按钮的行为
   只在这里写一份，两个页面共用，改一处两页同时变。

   谁在用（Day 11 起）
     P3 会话结果页 frontend/pages/result.html   —— 本次会话的条目（含精彩句子）
     P4 错误记录页 frontend/pages/records.html  —— 历次条目 + 收藏区
   两页都是「组件脚本先加载、页面逻辑后加载」的顺序。

   怎么用（经典 script，必须先于页面逻辑加载）：
     <script src="../js/components/interact.js"></script>
     <script src="../js/components/item-card.js"></script>
     container.appendChild(Components.item({
       item: itemObject,          // 一条已映射成展示层形态的记录
       onToggle: function (next, api) { ... }   // 同 interact.js 的契约
     }));

   ★★ Day 22 新增一个**可选**回调 onDelete：
     onToggle 不传 → 只有收藏按钮（结果页走这条，PRD §7.3 的 P3）
     onToggle + onDelete 都传 → 卡片底部多一个「删除」按钮（记录页走这条，P4）
     为什么做成可选而不是页面上直接写死：结果页删掉条目代价太大
     （用户刚练完、结果看不到了），记录页才是「管理历史条目」的地方。
     onDelete(item, btn) —— item 是同 onToggle 第三个参数那一个（同一份对象，
     不重新映射，避免两处拿到不同形状）；btn 是按钮元素，调用方可在
     请求期间把它 disabled 掉防连点。

   契约（item 用到的字段，口径见 PRD.md §6.2 的表）
     itemId      "T1-S1-E1"   条目编号，收藏状态的键
     type        'offtopic' | 'logic' | 'good'
                              三条分支决定这一条显示什么：
                                offtopic 偏题      → 提醒，**没有纠正**（PRD §6.2 第 343 行）
                                logic    逻辑错误  → 提醒 + 纠正
                                good     精彩句子  → 提醒（说明它好在哪）
     typeLabel   "偏题" / "逻辑错误" / "精彩句子"   胶囊上的文字
     quote       用户说过的原话，**不修改、不精简**（PRD §6.2 第 340 行）
     turn        出现在第几轮（精彩句子也有轮次，便于回看）
     reminder    一句话提醒
     fix         纠正的话；**只有 logic 有**，偏题与精彩句子为空字符串

   为什么 fix 用「空字符串」而不是缺字段：
     PRD 第 343 行明确「偏题条目没有纠正这一格」—— 这是**设计**不是缺漏。
     用空字符串表达「这一格本该没有」，渲染时整格不出现；
     若写 JSON 时漏掉字段，则与「刻意为空」无法区分，容易掩盖问题。
   ------------------------------------------------------------- */

(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 类型胶囊：三种类型三种底色。
     good（精彩句子）用深青——它和其他两个不是一类东西：
     偏题/逻辑错误是「问题」，精彩句子是「亮点」，
     用不同色相区分比用同一套底色更能一眼分开。 */
  function typeTag(item) {
    var cls = 'tag item-tag item-tag-' + (item.type || 'offtopic');
    return el('span', cls, item.typeLabel || '');
  }

  function itemCard(opts) {
    var o = opts || {};
    var item = o.item || {};

    var box = el('div', 'item');
    box.setAttribute('data-item-id', item.itemId || '');
    box.setAttribute('data-type', item.type || '');

    // ---------- 头部：类型 + 轮次 ----------
    var head = el('div', 'item-head');
    head.appendChild(typeTag(item));
    if (item.turn) head.appendChild(el('span', 'item-turn', '第 ' + item.turn + ' 轮'));
    box.appendChild(head);

    // ---------- 原句（英文，衬线体，卡片上最醒目的一行） ----------
    box.appendChild(el('div', 'item-quote', item.quote || ''));

    // ---------- 提醒 ----------
    if (item.reminder) {
      var remind = el('div', 'item-note');
      remind.appendChild(el('b', null, item.type === 'good' ? '好在哪：' : '提醒：'));
      remind.appendChild(document.createTextNode(' ' + item.reminder));
      box.appendChild(remind);
    }

    /* ---------- 纠正（**只有逻辑错误有**） ----------
       偏题与精彩句子的 fix 是空字符串，这里整格不渲染。
       PRD §6.2 第 332 行把「偏题条目越界做了纠正」列为不合格，
       所以这个 if 是口径的落点，不是普通的可选字段处理。 */
    if (item.fix) {
      var fix = el('div', 'item-fix');
      fix.appendChild(el('b', null, '可以这样说：'));
      fix.appendChild(document.createTextNode(' ' + item.fix));
      box.appendChild(fix);
    }

    // ---------- 收藏按钮（与星标共用 interact.js 的同一套状态机） ----------
    var foot = el('div', 'item-foot');
    foot.appendChild(window.Interact.button({
      label: '收藏',
      doneLabel: '已收藏',
      icon: '☆',
      doneIcon: '★',
      busyLabel: '保存中…',   // 收藏的动作语义是「存起来」，比默认的「处理中…」更具体
      /* pressed 传**函数**而不是布尔值：本页可能有同一 itemId 的两个按钮
         （记录页的收藏区与全部条目就是），其中一个被改动后，另一个要能
         重新去存储里取真值校正过来。传死值的话两边会各说各话。 */
      pressed: function () {
        return !!(window.Storage && window.Storage.isFavorite(item.itemId));
      },
      onToggle: function (next, api) {
        if (typeof o.onToggle === 'function') o.onToggle(next, api, item);
        else api.resolve();
      }
    }));

    /* ---------- 删除按钮（Day 22）----------
       ★ **刻意不复用 interact.js**：那个组件的状态机是为「开关型」动作写的
         （未收藏 → 处理中 → 已收藏，可反复来回），它 api.resolve() 之后
         会去数据源取真值校正 pressed。
         删除是**一次性**动作 —— 删完那条数据不存在了，「再取一次真值」根本无从取起，
         而且语义上不该有「已删除」这个持久状态（页面会直接把那条重画掉）。
         硬套进来的后果是：按了之后按钮停在某个态，而数据已经没了 ——
         界面在说一件不存在的事。
         所以这里用一个普通 button，样式层复用 .ic-btn（与收藏按钮同一套外观，
         触控目标 44×44px 也自动满足），只是不走那套状态机。

       ★ **只在传了 onDelete 时才渲染**（可选能力，不是必有的）：
         结果页不该有删除 —— 那里的条目是「刚刚练出来的这一场」，
         删掉的代价（用户已经练完、结果看不到了）远大于记录页。
         记录页才是「管理历史条目」的地方，PRD §7.3 P4 就是这个定位。 */
    if (typeof o.onDelete === 'function') {
      var del = el('button', 'ic-btn item-del');
      del.type = 'button';
      del.textContent = o.deleteLabel || '删除';
      /* 用 aria-label 而不是靠文字：条目卡片里有原句（可能很长），
         屏幕阅读器读按钮时只需要知道「删哪一条」，那句话由 confirm 弹窗承担。 */
      del.setAttribute('aria-label', '删除这条记录');
      del.addEventListener('click', function () { o.onDelete(item, del); });
      foot.appendChild(del);
    }

    box.appendChild(foot);

    return box;
  }

  window.Components = window.Components || {};
  window.Components.item = itemCard;
})();
