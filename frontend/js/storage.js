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

   怎么用（经典 script，必须先于页面逻辑加载）：
     <script src="../js/storage.js"></script>                ← 本文件
     <script src="../js/pages/dialogue.js"></script>         ← 页面逻辑
     var n = Storage.practiceCount('T1');   // 读过几次，没记录返回 0

   契约
     Storage.practiceCount(topicId)         → number，该主题已完成的对次数（无记录为 0）
     Storage.bumpPracticeCount(topicId)     → number，本次完成 +1 后的新值；写失败返回原值
     Storage.schemaVersion()                → number，当前版本号

   容错（照 TECH_DESIGN.md E8 / E9 的要求）
     E9 读损坏：JSON 解析失败时**按空数据返回**，不抛错、不覆盖原数据
     E8 写失败：无痕模式 / 配额满时**不阻断功能**，返回原值让页面继续跑
   ------------------------------------------------------------- */

(function () {
  var NS = 'vibecoding';
  var KEY_PRACTICE = NS + '.practiceCount';
  var KEY_SCHEMA = NS + '.schemaVersion';
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

  window.Storage = {
    practiceCount: practiceCount,
    bumpPracticeCount: bumpPracticeCount,
    schemaVersion: schemaVersion
  };
})();
