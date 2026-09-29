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
     topic   对象，来自 data/topics.json，用到 5 个字段：
               topicId       "T1"        主题编号，卡片角标与跳转参数都用它
               name          "项目进度…"  主题名（中文）
               role          "项目负责人" 用户在对话里扮演的职场角色（Day 10 加练新增）
               summary       "…"         英文一句话说明
               durationLabel "5 分钟"     预计时长
             role 允许缺失：缺失时不渲染角色行（老数据也能正常出卡片）。
     options 可选：
               stuck  布尔，true 时卡片上出现「上次在这里卡过」（PRD.md §6.3）
               href   字符串，覆盖跳转目标；默认 dialogue.html?topic=<topicId>
               pinned 布尔，true 时卡片带 .is-pinned（左侧主色竖条），Day 11 新增
               onPin  函数，Day 11 新增。给了就在卡片右下角渲染一枚星标按钮，
                      点击时以 (topicId, api) 调用它（api 见 interact.js 的契约）。
                      没给则完全不渲染星标按钮 —— 不需要这个交互的页面不受影响。

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
    // 被星标（置顶）的主题卡：左侧一道主色竖条，样式在 main.css 的 .is-pinned
    if (opts.pinned) a.classList.add('is-pinned');

    a.appendChild(el('div', 'no', 'TOPIC ' + topic.topicId.replace('T', '')));
    a.appendChild(el('div', 'name', topic.name));
    // 职场角色（Day 10 加练新增）：告诉用户"这一轮你扮演谁"。
    // 位置在主题名与说明之间 —— 形成「名称 → 我是谁 → 具体场景」的阅读顺序。
    // 字段口径见 PRD.md §8.4；缺失时不渲染这一行，不让卡片出现空标签。
    if (topic.role) {
      a.appendChild(el('div', 'role', '你的角色：' + topic.role));
    }
    a.appendChild(el('div', 'summary', topic.summary));

    var meta = el('div', 'meta');
    if (opts.stuck) {
      // 「上次在这里卡过」标记（PRD.md §6.3）：由该主题是否出过问题条目实时算出
      meta.appendChild(el('span', 'stuck', '上次在这里卡过'));
    }
    meta.appendChild(el('span', 'tag', topic.topicId));
    meta.appendChild(el('span', null, '预计 ' + topic.durationLabel));
    a.appendChild(meta);

    /* ---------- 星标按钮（Day 11 线 2-A） ----------
       为什么挂在卡片内部、又不让它触发跳转：
         卡片整体是 <a>（点任意处进对话页），星标按钮在它里面 ——
         浏览器里点按钮会顺着冒泡触发外层 <a> 的跳转。所以这里必须
         stopPropagation + preventDefault，否则「点星标」会变成「进对话页」。
       onPin 回调由调用方给（topics.js），卡片本身不知道存哪 ——
       组件不碰 localStorage，保持它只负责「长什么样」。 */
    if (typeof opts.onPin === 'function') {
      var pinBtn = window.Interact.button({
        label: '星标',
        doneLabel: '已星标',
        icon: '☆',
        doneIcon: '★',
        busyLabel: '置顶中…',   // 星标的动作语义是「置顶」，比默认的「处理中…」更具体
        /* pressed 传函数：本页只有一个星标按钮（重排时整张列表重渲染），
           但传函数能让它和 item-card.js 保持同一种写法，
           将来若加了「同一主题在别处也有星标」也不必改这里。 */
        pressed: function () {
          return !!(window.Storage && window.Storage.isPinned(topic.topicId));
        },
        onToggle: function (next, api) { opts.onPin(topic.topicId, next, api); }
      });
      pinBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      a.appendChild(pinBtn);
    }

    return a;
  }

  // 挂到全局命名空间下：本页面项目没有打包工具，靠 <script> 顺序串起来
  // （TECH_DESIGN.md §4.1「说明（Day 8 修订）」）
  window.Components = window.Components || {};
  window.Components.topicCard = topicCard;
})();
