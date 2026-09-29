/* 可复用组件：会反馈的按钮（Day 11 · 交互反馈）
   -------------------------------------------------------------
   为什么单独成文件：Day 11 要做两处「点一下要看得见反应」的交互 ——
     线 2-A  主题卡上的星标（置顶该主题）
     线 2-B  结果页/记录页上问题条目与精彩句子的「收藏」
   这两处的状态流转完全一样（未收藏 → 处理中 → 已收藏 → 可撤销，失败了要提示），
   所以状态机只写这一份，两处共用。将来再加任何「点了要有反馈」的按钮，
   也直接复用本文件，不要在页面里重写一遍。

   ============================================================
   两层分离（Day 11 的一条硬约定）
   ------------------------------------------------------------
   state 层（本文件）  只决定「存什么、什么时候变」
   表现层（main.css）  只决定「长什么样、怎么动」
   两层之间只通过 3 个 class 名 + 2 个 data 属性连接，不互相穿透：
     .ic-btn           按钮本体
     .ic-hint          失败提示行
     .is-fav           已收藏（同时是「可撤销」的判据）
     data-state        idle | busy | done | error
     aria-pressed      true / false（屏幕阅读器与测试都读它）
   这样将来只想换一套动效风格（板块 ④ 搜技能之后可能要换），
   只改 main.css 里那一段，本文件一个字不用动。

   ============================================================
   谁在用（Day 11 起）
     P1 主题列表页  frontend/pages/topics.html   线 2-A 星标（置顶）
     P3 会话结果页  frontend/pages/result.html   线 2-B 收藏（mock 条目）
     P4 错误记录页  frontend/pages/records.html  线 2-B 收藏（复用同一组件）
   三个页面都是「组件脚本先加载、页面逻辑后加载」的顺序（TECH_DESIGN.md §4.1）。

   怎么用：
     <script src="../js/components/interact.js"></script>
     var btn = Interact.button({
       label: '收藏',          // 未选中时的文字
       doneLabel: '已收藏',     // 选中后的文字
       icon: '☆', doneIcon: '★',
       pressed: false,         // 初始是否已选中
       busyLabel: '保存中…',    // 可选：处理中显示的字（默认「处理中…」）
       onToggle: function (next, api) { ... }   // next=目标状态 true/false
     });
     container.appendChild(btn);

   onToggle 的约定（**很重要**）：它**不返回值，也不能自己不调 api** ——
   由回调里主动调用 api.resolve() / api.reject(原因) 来结束 busy 态。
   为什么这样设计：真实场景里这里要发请求（第 3 周），请求是异步的；
   回调同步返回一个布尔值就表达不了「正在处理」。写成显式 resolve/reject 后，
   第 3 周把 mock 的 setTimeout 换成 fetch 即可，调用方式一个字都不用改。

   契约（onToggle 拿到的 api）
     api.resolve()        成功：进入 done（或未选中态），按钮恢复可点
     api.reject(msg)      失败：进入 error，显示 msg，约 3 秒后自动回到可点状态
     api.el               按钮元素本身（需要时读 data-state 用）

   契约（opts.pressed 也接受函数）
     pressed 传布尔值      按钮的初始状态（多数情况够用）
     pressed 传函数         每次需要校正时调用它去数据里取真值（无参，返回布尔）——
                            跨页面回来的那一页要用这种，否则会显示旧状态。
                            见下方 sync() 的说明。

   返回：一层 <span class="ic-wrap">，里面是按钮 + 失败提示行。
     额外挂了两个属性供调用方使用（不改动「返回 wrap」这个契约）：
       wrap.icButton   按钮元素本身
       wrap.icSync()   手动触发一次「照存储校正」

   页面侧要配合做的一件事：任何一次成功写入收藏状态之后，
   派发一次 document 上的 'ic-sync' 事件，让同页的其他按钮跟着更新：
     document.dispatchEvent(new CustomEvent('ic-sync'));
   （为什么不做成组件自己去翻遍页面：组件不该知道别的按钮在哪，
     这件事由「谁改了数据谁负责通知」更清楚。）

   说明（本文件的一条取舍）：这里自带私有的 el()，与 topic-card.js / topics.js
   各有一份。**刻意不合并** —— 合并就得把「建 DOM 节点」提成第三个全局依赖，
   为省 5 行不值得（同 topic-card.js 的取舍理由）。
   ------------------------------------------------------------- */

(function () {
  'use strict';

  /* 失败提示停留多久后自动消失。
     3000ms 的选择：短于只读一行中文提示的时间，长了会一直压在卡片上。
     与 main.css 里 .ic-hint 的过渡时长对应（表现层换风格时若改了这里，
     记得同步改 CSS 的过渡时长，否则提示会「还没消失就先变透明」。） */
  var ERROR_HOLD_MS = 3000;

  /* 处理中锁定的时长下限。
     为什么需要它：Day 11 实测发现，把按钮设成 disabled 之后，浏览器**根本不会
     把后续点击派发过来** —— 埋点显示连点 6 次只收到 1 个 click 事件，
     其余 5 次在浏览器层面就被吞掉了。也就是说「连点」这件事组件是感知不到的，
     想靠收下被吞的点击再补跑一次（早先的写法）根本无法实现。
     所以改成：**用时间保证确定性**。处理中锁至少持续这么久，
     在这个窗口内的点击由浏览器吞掉（用户看到按钮是灰的、也点不动），
     窗口结束后按钮恢复可点，用户想撤销就再点一次 ——
     结果不再随点击时机漂移：连点 N 次（N×间隔 < 窗口）＝ 只有第一次生效。
     350ms 的选择：长于普通双击间隔（约 250ms），短到用户不会觉得"点了没反应"。 */
  var MIN_BUSY_MS = 350;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 主函数：造一个带四态反馈的按钮。
     返回的是一层 <span class="ic-wrap">，里面装着按钮 + 提示行 ——
     为什么不是直接返回按钮：失败提示要出现在按钮下方，而按钮本身
     是被 disabled 的，不能承载兄弟节点。包装一层后调用方只 appendChild 一次。 */
  function button(opts) {
    var o = opts || {};
    /* ★ initial 必须走和 wantPressed() 一样的口径（Day 11 实测抓到的 bug）：
       早先写的是 var pressed = !!o.pressed —— 当 o.pressed 是**函数**时，
       !!函数 恒等于 true（函数对象本身是 truthy），于是**每个按钮
       一诞生就显示成「已收藏」**，与数据里到底存没存过完全无关。
       实测表现：记录页「全部条目」里 4 条都没收藏，按钮却全是
       「★ 已收藏 / aria-pressed=true」；而 Storage.isFavorite 逐条问
       明明返回 [true,false,false,false]。根因就是这里没有对函数求值。
       改成调用一次（函数形态）后，初始态才真正等于「数据里的真值」。 */
    var pressed = false;
    if (typeof o.pressed === 'function') {
      // 函数形态：当场求值取真值（调用方可能还没建好数据，失败就退回 false）
      try { pressed = !!o.pressed(); } catch (e) { pressed = false; }
    } else {
      pressed = !!o.pressed;
    }
    var busy = false;          // 处理中锁：这是「不可重复点击」的唯一判据
    var showingError = false;  // 失败提示是否正在显示
    var holdTimer = null;      // 失败提示的自动消失计时器
    var busyTimer = null;      // 处理中锁的最短持续时间计时器（见 MIN_BUSY_MS）

    var wrap = el('span', 'ic-wrap');
    var btn = el('button', 'ic-btn');
    var hint = el('span', 'ic-hint');
    hint.hidden = true;

    // aria-pressed 让屏幕阅读器念出「已按下 / 未按下」，
    // 也是自动化测试判断状态最可靠的依据（比读文字稳）。
    btn.setAttribute('type', 'button');

    // ---------- 渲染（表现层唯一的入口） ----------
    /* state 与 pressed 必须分开传：
       state 决定「按钮是不是禁用」，pressed 决定「文字与是不是已选」。
       失败时 state 是 error 但 pressed 不变 —— 之前把两者混在一个参数里传
       （render('done') 且没有 pressed 的概念），结果失败后按钮会显示成
       「★ 已收藏」，等于骗用户说操作成功了。 */
    function render(state) {
      btn.setAttribute('data-state', state);
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      btn.classList.toggle('is-fav', pressed);
      btn.disabled = (state === 'busy');

      /* 繁忙态：默认一律显示「处理中…」，不随选中与否变。
         为什么不做成 (已收藏 + 中…) 这种自动拼接：中文里「已收藏中…」
         是不通顺的（「已」和「中」语义打架），而取消收藏时又会说成
         「收藏中…」，同一个按钮两种写法容易看岔。用中性的「处理中…」
         既覆盖两个方向，也不泄露「这次是收藏还是取消」——用户看到的
         是他刚点的那一下正在生效。若某个调用方想要更贴合业务的字眼，
         可以显式传 busyLabel（如「保存中…」）。 */
      if (state === 'busy') {
        btn.textContent = o.busyLabel || '处理中…';
        return;
      }
      var icon = pressed ? (o.doneIcon || '') : (o.icon || '');
      var text = pressed ? (o.doneLabel || o.label) : o.label;
      btn.textContent = icon ? icon + ' ' + text : text;
    }

    /* 从数据源取「当前应该是选中还是未选中」。
       为什么要有这个函数、而不是直接用 pressed：
         pressed 是组件内部的乐观值 —— 点击后**先**改成新状态让界面有反馈，
         再等存储那边的结果。它和真实数据可能不一致（失败时就不一致），
         所以任何「照着数据校正界面」的场合都必须重新问一次数据源，
         不能拿 pressed 当答案。 */
    function wantPressed() {
      if (typeof o.pressed === 'function') {
        try { return !!o.pressed(); } catch (e) { return pressed; }
      }
      return pressed;
    }

    function showError(msg) {
      hint.textContent = msg || '操作没能完成，请再试一次。';
      hint.hidden = false;
      showingError = true;
      render('error');
      // 到点自动收回：不清掉的话下一条提示会叠在旧提示上
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        holdTimer = null;
        showingError = false;
        hint.hidden = true;
        hint.textContent = '';
        render('idle');
      }, ERROR_HOLD_MS);
    }

    function hideError() {
      showingError = false;
      hint.hidden = true;
      hint.textContent = '';
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    }

    // ---------- 点击：状态机在这里，别处不得改 pressed ----------
    function startToggle() {
      /* ★ 这里必须用 wantPressed() 而不是 !pressed（Day 11 实测抓到的 bug）：
         当 opts.pressed 传的是**函数**时（topic-card 就是这么传的，
         为的是每次都能从存储取真值），第 109 行的 var pressed = !!o.pressed
         会把「函数对象」本身折成 true —— 于是 !pressed 恒等于 false，
         也就是每次点击都算成「取消」，永远点不亮星标。
         实测表现：存储明明写进去了（ls 里能看到 T3:true），
         但回调收到的 next 是 false，判定 ok(true) !== next(false) 后
         走了 reject 分支，界面报「没能保存星标」且不重排。
         改成 wantPressed() 后，negation 作用在「函数调用的结果」上，才是真的取反。 */
      var next = !wantPressed();
      busy = true;
      var startedAt = Date.now();
      hideError();          // 上一次的失败提示立刻收掉，不和新动作并存
      render('busy');

      var finished = false;

      /* 结束这一轮。把「解锁」统一放到这里，是为了让成功与失败两条路径
         都遵守同一条规则：**处理中锁至少持续 MIN_BUSY_MS**。
         真实回调比这快（mock 是 320ms，第 3 周的网络请求可能更快或更慢），
         快的时候就把解锁往后延一点，保证那个窗口里的连点一定被吞掉。

         ★ 这里有个 Day 11 实测抓到的坑，必须和 render 一起做：
           busy 不能只改 JS 变量，必须**同时**把按钮的 disabled 去掉。
           早先的写法只写 busy = false，按钮的 disabled 要等下一次 render()
           才更新 —— 中间这段时间里「JS 认为空闲了、按钮还是灰的」，
           浏览器会把用户的点击吞掉，于是出现「点了没反应」的假象
           （实测慢速点击的返回是 true,true,false,true：第 2 次就被这样吞掉了）。
           所以解锁时顺手 render 一次，让 JS 状态和 DOM 状态永远同步。 */
      function unlock() {
        var release = function () {
          busyTimer = null;
          busy = false;
          /* 解锁时必须同步 DOM：失败态要保住 error 样式与提示，
             成功态（或撤销）才回到 idle/done。 */
          if (showingError) {
            btn.disabled = false;    // 只解锁，不动 error 提示
          } else {
            render('idle');          // idle 与 done 的差别由 pressed 决定，样式走 .is-fav
          }
        };
        var rest = MIN_BUSY_MS - (Date.now() - startedAt);
        if (rest <= 0) { release(); return; }
        if (busyTimer) clearTimeout(busyTimer);
        busyTimer = setTimeout(release, rest);
      }

      var api = {
        el: btn,
        resolve: function () {
          if (finished) return;      // 防止回调里连调两次把状态搞乱
          finished = true;
          /* 关键：成功后**不直接把 pressed 设成 next**，而是回数据源取真值。
             为什么：真实存储可能拒绝了这次写入（配额满、无痕模式），
             回调那层会把这种情况转成 reject —— 但即便走了 resolve，
             「成功」也该以**数据里真的写进去了**为准，而不是以我们发起的意图为准。
             回数据源取真值后：
               · 写进去了  → 取到 next，界面显示已收藏（正确）
               · 没写进去  → 取到旧值，界面回到未收藏（不再骗用户）
             这正是 Day 11 实测抓到的那个 bug：早先直接 pressed = next，
             结果 ?favfail=1 演示失败时，按钮仍显示「★ 已收藏」。 */
          pressed = wantPressed();
          render('done');
          unlock();
        },
        reject: function (msg) {
          if (finished) return;
          finished = true;
          // 失败：同样回数据源校正一次，把可能残留的乐观值清掉
          pressed = wantPressed();
          unlock();
          showError(msg);
        }
      };

      if (typeof o.onToggle === 'function') {
        try {
          o.onToggle(next, api);
        } catch (e) {
          // 回调自身抛错也要落到 error 态，不能让按钮永远卡在「处理中」
          api.reject('交互出错：' + (e && e.message ? e.message : e));
        }
      } else {
        // 没给回调就当场完成（纯演示用）
        api.resolve();
      }
    }

    btn.addEventListener('click', function () {
      /* busy 期间不需要特判：按钮此时是 disabled 的，浏览器压根不会把 click
         派发过来（Day 11 埋点实测：连点 6 次只收到 1 个事件）。这里的 return
         只是为了兜住「程序化调用 .click()」这种绕过 disabled 的极端情况。 */
      if (busy) return;
      if (showingError) {
        // 失败提示还挂在屏幕上：这次点击的含义是「我知道了，继续操作」，
        // 所以先收掉提示、再当作一次新点击处理（而不是要求用户等 3 秒）。
        hideError();
        render('idle');
      }
      startToggle();
    });

    wrap.appendChild(btn);
    wrap.appendChild(hint);
    render('idle');

    /* ---------- 外部同步（Day 11 第 2 轮补的） ----------
       为什么必须有：收藏状态存在 localStorage 里，是**唯一的一份**；
       而每个页面渲染时会把它读进各自的按钮。结果是「在结果页收藏 → 回记录页
       能看见；再从记录页取消 → 回结果页，那个按钮还停在已收藏」——
       因为结果页的按钮没重新读盘，界面就和数据不一致了。

       两个触发点，缺一不可：
         ① 切回本页（pageshow）—— bfcache（往返缓存）下浏览器会把整个页面
            原样恢复，DOM 不会被重建，脚本也不会重跑。所以必须在 pageshow
            里重新对照存储校正一遍，光靠「每次加载都重新渲染」是不够的。
         ② 同页里别处改了状态（sync 事件）—— 记录页的收藏区和全部条目
            是两份独立的按钮，取消其中一处时另一处也要跟着变。
       两者都走 sync()：它只负责「照存储校正自己」，不写盘。 */
    function sync() {
      if (busy) return;          // 正在处理时不要打断，等它自己落定
      var want = wantPressed();
      if (want === pressed) return;
      pressed = want;
      if (showingError) hideError();
      render('idle');
    }

    document.addEventListener('ic-sync', sync);
    window.addEventListener('pageshow', function (e) {
      // e.persisted === true 表示这一页是从 bfcache 恢复的，DOM 没重建；
      // 为 false 时说明是全新加载，本来就会重新渲染，不必再校正一次。
      if (e.persisted) sync();
    });

    /* 让调用方能主动取按钮元素做别的检查（比如 aria-pressed）。
       用 api 形式而不是直接返回两样东西，是为了不改动「返回 wrap」这个契约。 */
    wrap.icButton = btn;
    wrap.icSync = sync;
    return wrap;
  }

  // 挂到全局命名空间（同 Components.topicCard 的做法）
  window.Interact = window.Interact || {};
  window.Interact.button = button;
})();
