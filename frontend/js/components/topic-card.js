/* 可复用组件：主题卡片（Day 8 · 余力加练）
   -------------------------------------------------------------
   为什么单独成文件：主题卡片是「主题」这一份数据的通用呈现方式 ——
   卡片长什么样只在这里改一处，用到它的页面自动跟着变。

   谁在用（目前只有 1 个调用点）
     P1 主题列表页 frontend/pages/topics.html —— 页面上那 8 张主题卡就是它渲染的。
     「可复用」是面向将来的，不是已经在两个页面跑起来了。

   将来谁能用（**尚未实现**，先记着，不要当成已有功能）
     P4 错误记录页若做「按主题归类」（把问题条目按所属主题分组），可以直接复用本组件。
     但 P4 的正式结构以 PRD.md §7.3 为准 —— 它是「时间倒序的条目列表 + 收藏区 + 空状态」，
     **PRD 目前没有给 P4 定义「按主题归类」这个区块**，要加得先改 PRD，不能只改代码。
     接缝已留在 frontend/pages/records.html 的注释里（Day 8 拍板结果：只留接缝，不造功能）。

   怎么用（经典 script，必须**先于**页面逻辑加载）：
     <script src="../js/components/topic-card.js"></script>   ← 组件
     <script src="../js/pages/topics.js"></script>            ← 页面逻辑

     var card = Components.topicCard(topic, { stuck: true });
     container.appendChild(card);

   契约（入参）
     topic   对象，来自 data/topics.json，用到 4 个字段：
               topicId       "T1"        主题编号，卡片角标与跳转参数都用它
               name          "项目进度…"  主题名（中文）
               summary       "…"         英文一句话说明
               durationLabel "5 分钟"     预计时长
     options 可选：
               stuck  布尔，true 时卡片上出现「上次在这里卡过」（PRD.md §6.3）
               href   字符串，覆盖跳转目标；默认 dialogue.html?topic=<topicId>

   返回：一个 <a class="topic"> 元素（不是 HTML 字符串），调用方直接 appendChild。

   说明（本文件的一条取舍）：这里自带一个私有的 el() —— js/pages/topics.js 里
   也有一份一模一样的 5 行。**刻意不合并**：合并就得把「建 DOM 节点」变成第三个
   全局依赖，为省 5 行不值得。
   ------------------------------------------------------------- */

(function () {
  'use strict';

  /* 建节点的小工具，省掉一堆 createElement/appendChild */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function topicCard(topic, options) {
    var opts = options || {};

    var a = el('a', 'topic');
    // 带上主题编号，P2 对话页据此显示主题名（PRD.md §9.2 B14）
    a.href = opts.href || ('dialogue.html?topic=' + encodeURIComponent(topic.topicId));

    a.appendChild(el('div', 'no', 'TOPIC ' + topic.topicId.replace('T', '')));
    a.appendChild(el('div', 'name', topic.name));
    a.appendChild(el('div', 'summary', topic.summary));

    var meta = el('div', 'meta');
    if (opts.stuck) {
      // 「上次在这里卡过」标记（PRD.md §6.3）：由该主题是否出过问题条目实时算出
      meta.appendChild(el('span', 'stuck', '上次在这里卡过'));
    }
    meta.appendChild(el('span', 'tag', topic.topicId));
    meta.appendChild(el('span', null, '预计 ' + topic.durationLabel));
    a.appendChild(meta);

    return a;
  }

  // 挂到全局命名空间下：本页面项目没有打包工具，靠 <script> 顺序串起来
  // （TECH_DESIGN.md §4.1「说明（Day 8 修订）」）
  window.Components = window.Components || {};
  window.Components.topicCard = topicCard;
})();
