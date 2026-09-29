/* localStorage 读写（Day 10 新建）
   -------------------------------------------------------------
   为什么单独成文件：TECH_DESIGN.md §4.2 规矩 2 ——
   **storage.js 是 localStorage 的唯一出口**。将来若升级到云端数据库（路线丙），
   只需改这一个文件，4 个页面不用动（§10.3 第 649 行）。

   为什么是现在建：Day 10 要做「某主题练过几次」的跨页面记忆 ——
   对话页点「结束对话」离开，回到主题页再进来，轮次不能丢。
   页面跳转之间没有别的载体，只能落在 localStorage。

   键名口径（以 TECH_DESIGN.md §5.7 为准，本文件不自行发明）
     vibecoding.practiceCount   新增键：某主题练过几次，形如 { "T1": 2, "T3": 1 }
     vibecoding.schemaVersion   数字，当前 1（§5.7 表格最后一行）
   §5.7 原有键（nickname / sessions / issues / goodSentences）本文件暂不涉及 ——
   它们要等会话真正落库时才写（属后续步骤），不要提前造。

   ---- Day 11 新增两个键（**临时，第 3 周会改**）----
   vibecoding.pinnedTopics   { "T1": true }  被星标（置顶）的主题（Day 11 线 2-A）
   vibecoding.favoriteItems  { "<itemId>": { type, at } }  收藏的条目（Day 11 线 2-B）
   为什么先放 localStorage 而不等数据库：Day 11 的清单要求「先使用前端临时状态，
   不接数据库」，但 PRD 的 A3（关掉页面再打开数据还在）要求收藏不能一刷新就没，
   两者只能用本文件兜住。**第 3 周接上 /api 后，这两个键整体迁走**，
   届时删掉本节内容即可 —— 这是把它们集中放在这里、而不是写进页面的原因。

   怎么用（经典 script，必须先于页面逻辑加载）：
     <script src="../js/storage.js"></script>                ← 本文件
     <script src="../js/pages/dialogue.js"></script>         ← 页面逻辑
     var n = Storage.practiceCount('T1');   // 读过几次，没记录返回 0

   契约
     Storage.practiceCount(topicId)         → number，该主题已完成的对次数（无记录为 0）
     Storage.bumpPracticeCount(topicId)     → number，本次完成 +1 后的新值；写失败返回原值
     Storage.schemaVersion()                → number，当前版本号

     ---- Day 11 新增（星标与收藏，临时接口）----
     Storage.isPinned(topicId)              → boolean，该主题是否被星标
     Storage.pinnedIds()                    → string[]，被星标的主题编号（写入顺序）
     Storage.togglePin(topicId)             → boolean，切换后的新状态；写失败返回原状态
     Storage.isFavorite(itemId)             → boolean，该条目是否已收藏
     Storage.toggleFavorite(itemId, meta)   → boolean，切换后的新状态；meta 存 { type } 等
     Storage.favoriteIds()                  → string[]，已收藏条目编号（最近收藏的在前）

   容错（照 TECH_DESIGN.md E8 / E9 的要求）
     E9 读损坏：JSON 解析失败时**按空数据返回**，不抛错、不覆盖原数据
     E8 写失败：无痕模式 / 配额满时**不阻断功能**，返回原值让页面继续跑
   ------------------------------------------------------------- */

(function () {
  var NS = 'vibecoding';
  var KEY_PRACTICE = NS + '.practiceCount';
  var KEY_SCHEMA = NS + '.schemaVersion';
  var KEY_PINNED = NS + '.pinnedTopics';       // Day 11 新增（临时）
  var KEY_FAVORITE = NS + '.favoriteItems';    // Day 11 新增（临时）
  var SCHEMA_VERSION = 1;

  /* localStorage 在某些环境会直接抛错（Safari 无痕模式访问 setItem），
     所以连「拿到 localStorage 对象」本身都要包一层。 */
  function store() {
    try {
      var ls = window.localStorage;
      if (!ls) return null;
      return ls;
    } catch (e) {
      return null;
    }
  }

  // 首次运行时写入版本号（§5.7：首次运行时写入）
  function ensureSchema() {
    var ls = store();
    if (!ls) return;
    try {
      if (!ls.getItem(KEY_SCHEMA)) ls.setItem(KEY_SCHEMA, String(SCHEMA_VERSION));
    } catch (e) { /* E8：写不进去就算了，不阻断 */ }
  }

  function schemaVersion() {
    var ls = store();
    if (!ls) return SCHEMA_VERSION;
    try {
      var v = parseInt(ls.getItem(KEY_SCHEMA), 10);
      return isNaN(v) ? SCHEMA_VERSION : v;
    } catch (e) {
      return SCHEMA_VERSION;
    }
  }

  /* 读出整张 practiceCount 表。
     E9：解析失败或结构不对 → 返回空对象（不 delete 原数据，保留现场以便排查）。 */
  function readAll() {
    var ls = store();
    if (!ls) return {};
    var raw = null;
    try { raw = ls.getItem(KEY_PRACTICE); } catch (e) { return {}; }
    if (!raw) return {};
    try {
      var obj = JSON.parse(raw);
      // 必须是个普通对象；数组或 null 都视为损坏
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
      return obj;
    } catch (e) {
      return {};
    }
  }

  function writeAll(obj) {
    var ls = store();
    if (!ls) return false;
    try {
      ls.setItem(KEY_PRACTICE, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;   // E8：配额满 / 无痕模式
    }
  }

  // 某主题已完成的对次数（无记录为 0；值非法也归 0）
  function practiceCount(topicId) {
    if (!topicId) return 0;
    var all = readAll();
    var n = parseInt(all[topicId], 10);
    return (isNaN(n) || n < 0) ? 0 : n;
  }

  /* 本次完成 +1 并写回。
     写失败时返回「原值」而不是「原值+1」—— 不能让界面显示一个没存下来的数字。 */
  function bumpPracticeCount(topicId) {
    if (!topicId) return 0;
    var all = readAll();
    var cur = practiceCount(topicId);
    var next = cur + 1;
    all[topicId] = next;
    var ok = writeAll(all);
    return ok ? next : cur;
  }

  ensureSchema();

  /* ============================================================
     Day 11：星标与收藏（临时接口，第 3 周接库后整体迁走）
     读写模式与上面的 practiceCount 完全一致：
       E9 读损坏 → 按空数据返回，不抛错、不覆盖原数据
       E8 写失败 → 返回原状态，让界面不要显示一个没存下来的值
     ============================================================ */

  /* 通用的「读一张对象表」。三个键（practiceCount / pinned / favorite）
     的结构判别规则一模一样，抽出来避免写三遍 —— 这里不像 el() 那样
     只有 5 行，重复三遍是真浪费。 */
  function readObject(key) {
    var ls = store();
    if (!ls) return {};
    var raw = null;
    try { raw = ls.getItem(key); } catch (e) { return {}; }
    if (!raw) return {};
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
      return obj;
    } catch (e) {
      return {};
    }
  }

  function writeObject(key, obj) {
    var ls = store();
    if (!ls) return false;
    try {
      ls.setItem(key, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- 星标（线 2-A：主题卡上的星标 = 该主题在列表里置顶） ----------

  function isPinned(topicId) {
    if (!topicId) return false;
    return readObject(KEY_PINNED)[topicId] === true;
  }

  // 被星标的编号。**没有排序语义** —— 列表的先后由 topics.js 按原顺序重排，
  // 这里只回答「哪些被标了」，不回答「哪个排前面」，避免两处各排一次。
  function pinnedIds() {
    var all = readObject(KEY_PINNED);
    return Object.keys(all).filter(function (k) { return all[k] === true; });
  }

  function togglePin(topicId) {
    if (!topicId) return false;
    var all = readObject(KEY_PINNED);
    var next = all[topicId] !== true;
    if (next) all[topicId] = true; else delete all[topicId];
    var ok = writeObject(KEY_PINNED, all);
    return ok ? next : !next;   // 写失败时返回原状态，不谎报
  }

  // ---------- 收藏（线 2-B：问题条目 / 精彩句子） ----------

  function isFavorite(itemId) {
    if (!itemId) return false;
    var v = readObject(KEY_FAVORITE)[itemId];
    return !!v;
  }

  /* 已收藏的编号，**最近收藏的在前**（PRD.md §6.4 第 468 行：
     收藏区按收藏时间倒序排列）。靠 at 字段排序，不靠插入顺序 ——
     取消再收藏时插入顺序会乱，时间戳不会。 */
  function favoriteIds() {
    var all = readObject(KEY_FAVORITE);
    return Object.keys(all)
      .filter(function (k) { return all[k] && typeof all[k] === 'object'; })
      .sort(function (a, b) {
        var ta = all[a].at || 0, tb = all[b].at || 0;
        if (tb !== ta) return tb - ta;
        return a < b ? -1 : (a > b ? 1 : 0);   // 时间戳相同时按编号稳定排序
      });
  }

  function toggleFavorite(itemId, meta) {
    if (!itemId) return false;
    var all = readObject(KEY_FAVORITE);
    var next = !all[itemId];
    if (next) {
      var m = meta || {};
      all[itemId] = {
        type: m.type || '',                 // 'offtopic' | 'logic' | 'good'
        topicId: m.topicId || '',
        at: Date.now()                      // 收藏时间，供收藏区倒序
      };
    } else {
      delete all[itemId];
    }
    var ok = writeObject(KEY_FAVORITE, all);
    return ok ? next : !next;
  }

  window.Storage = {
    practiceCount: practiceCount,
    bumpPracticeCount: bumpPracticeCount,
    schemaVersion: schemaVersion,
    // Day 11 新增（临时）
    isPinned: isPinned,
    pinnedIds: pinnedIds,
    togglePin: togglePin,
    isFavorite: isFavorite,
    favoriteIds: favoriteIds,
    toggleFavorite: toggleFavorite
  };
})();
