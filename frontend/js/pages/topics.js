/* P1 主题列表页逻辑（Day 7 骨架版）
   本步只做一件事：把 topics.json 读出来，按 group 渲染成两组卡片。
   今天不碰：昵称的存取（属 localStorage 逻辑，见 TECH_DESIGN.md §5.7）、录音、AI。 */

(async function init() {
  const list = document.getElementById('topic-list');
  const groups = document.getElementById('topic-groups');

  let topics;
  try {
    // 用相对路径读同目录结构下的 data/topics.json
    const res = await fetch('../../data/topics.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    topics = await res.json();
  } catch (err) {
    groups.innerHTML =
      '<div class="empty"><div class="big">主题数据没能加载</div>' +
      '<div class="small">' +
      '多半是直接双击打开了 HTML 文件。请按 README.md 里的命令用本地服务打开本页。' +
      '</div></div>';
    return;
  }

  // 固定组序：先「会议上」后「同事间」（PRD.md §6.3 的分组顺序）
  const order = ['会议上', '同事间'];
  const byGroup = new Map(order.map((g) => [g, []]));
  topics.forEach((t) => {
    if (!byGroup.has(t.group)) byGroup.set(t.group, []);
    byGroup.get(t.group).push(t);
  });

  const frag = document.createDocumentFragment();

  byGroup.forEach((items, group) => {
    if (items.length === 0) return;

    const title = document.createElement('h2');
    const isGroupA = group === '会议上';
    title.className = 'section-title ' + (isGroupA ? 'group-a' : 'group-b');
    title.innerHTML =
      '组 ' + (isGroupA ? 'A' : 'B') + ' · ' + group +
      ' <span class="count">（' + items.length + ' 个）</span>';
    frag.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'topic-list ' + (isGroupA ? 'group-a' : 'group-b');

    items.forEach((t) => {
      const a = document.createElement('a');
      a.className = 'topic';
      // 带上主题编号，P2 对话页据此显示主题名（PRD.md §9.2 B14）
      a.href = 'dialogue.html?topic=' + encodeURIComponent(t.topicId);

      const no = document.createElement('div');
      no.className = 'no';
      no.textContent = 'TOPIC ' + t.topicId.replace('T', '');

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = t.name;

      const summary = document.createElement('div');
      summary.className = 'summary';
      summary.textContent = t.summary;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t.topicId;
      const dur = document.createElement('span');
      dur.textContent = '预计 ' + t.durationLabel;
      meta.appendChild(tag);
      meta.appendChild(dur);

      a.appendChild(no);
      a.appendChild(name);
      a.appendChild(summary);
      a.appendChild(meta);
      grid.appendChild(a);
    });

    frag.appendChild(grid);
  });

  const total = document.createElement('p');
  total.className = 'lede';
  total.style.marginTop = '20px';
  total.style.marginBottom = '0';
  total.textContent = '共 ' + topics.length + ' 个主题，都属于「职场即兴英语对话」这一个场景。';

  groups.innerHTML = '';
  groups.appendChild(frag);
  groups.appendChild(total);
})();
