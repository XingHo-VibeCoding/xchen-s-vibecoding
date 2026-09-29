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
       item: itemObject,          // 来自 data/mock-items.json 的一条
       onToggle: function (next, api) { ... }   // 同 interact.js 的契约
     }));

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
    box.appendChild(foot);

    return box;
  }

  window.Components = window.Components || {};
  window.Components.item = itemCard;
})();
