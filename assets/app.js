/* =========================================================================
 *  app.js — 界面逻辑
 *  范围矩阵 / 权益计算器 / 赔率与 EV / 训练 / 牌面分析器 / 术语表
 * ========================================================================= */
(function () {
  'use strict';

  const R = window.GTO.ranges;
  const E = window.GTO.engine;
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => Array.prototype.slice.call((root || document).querySelectorAll(s));
  const PLAYER_COLORS = ['#e5484d', '#3b82f6', '#30a46c', '#e9b949'];

  /* ------------------------------ 本地存储 ------------------------------ */
  const STORE_KEY = 'gto-academy-v1';
  let state = { done: {}, quiz: { correct: 0, total: 0, streak: 0, best: 0 }, wrong: [] };
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        state = Object.assign(state, s);
        state.quiz = Object.assign({ correct: 0, total: 0, streak: 0, best: 0 }, s.quiz || {});
        state.wrong = s.wrong || [];
      }
    } catch (e) { /* 隐私模式下 localStorage 不可用，忽略即可 */ }
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { }
  }

  /* -------------------------------- 小工具 -------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function pick(arr, rng) { return arr[Math.floor((rng ? rng() : Math.random()) * arr.length)]; }
  function pct(v, digits) { return (v * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  /* ------------------------------ 卡牌组件 ------------------------------ */
  function cardChip(id, opts) {
    opts = opts || {};
    const suit = E.SUIT_CHARS[id & 3];
    const cls = 'card-chip' + (suit === 'h' || suit === 'd' ? ' red' : '');
    const chip = el('span', cls, E.cardPretty(id) + (opts.removable ? ' <i class="x">✕</i>' : ''));
    if (opts.onClick) chip.addEventListener('click', () => opts.onClick(id));
    return chip;
  }

  let pickerCb = null, pickerUsed = [];
  function openPicker(used, onPick) {
    pickerUsed = used.slice();
    pickerCb = onPick;
    const grid = $('#picker-grid');
    grid.innerHTML = '';
    ['s', 'h', 'd', 'c'].forEach(suit => {
      const sIdx = E.SUIT_CHARS.indexOf(suit);
      for (let r = 12; r >= 0; r--) {
        const id = r * 4 + sIdx;
        const c = el('div', 'pick-card' + (suit === 'h' || suit === 'd' ? ' red' : '') +
          (pickerUsed.indexOf(id) >= 0 ? ' used' : ''),
          (E.RANK_CHARS[r] === 'T' ? '10' : E.RANK_CHARS[r]) + E.SUIT_SYMBOL[suit]);
        if (pickerUsed.indexOf(id) < 0) {
          c.addEventListener('click', () => {
            closePicker();
            if (pickerCb) pickerCb(id);
          });
        }
        grid.appendChild(c);
      }
    });
    $('#picker').hidden = false;
  }
  function closePicker() { $('#picker').hidden = true; }

  /** 渲染一组牌槽：cards 为 id 数组，max 为上限，allow 为「合法张数」数组 */
  function renderCardslot(container, opts) {
    container.innerHTML = '';
    const used = (opts.used || []).concat(opts.cards);
    opts.cards.forEach(id => {
      container.appendChild(cardChip(id, {
        removable: true,
        onClick: () => {
          const i = opts.cards.indexOf(id);
          opts.cards.splice(i, 1);
          opts.onChange();
        }
      }));
    });
    const full = opts.max !== undefined && opts.cards.length >= opts.max;
    if (!full && !opts.readonly) {
      const add = el('span', 'card-chip empty board-slot-empty', opts.placeholder || '+ 选牌');
      add.addEventListener('click', () => {
        openPicker(used.slice(), id => {
          opts.cards.push(id);
          opts.onChange();
        });
      });
      container.appendChild(add);
    }
  }

  /* ------------------------------ 滑块组件 ------------------------------ */
  function makeSlider(parent, cfg) {
    const wrap = el('label');
    const out = el('b', null, cfg.value);
    const unit = cfg.unit || '';
    wrap.appendChild(el('span', null, cfg.label + ' '));
    wrap.appendChild(out);
    wrap.appendChild(document.createTextNode(' ' + unit));
    const input = el('input');
    input.type = 'range';
    input.min = cfg.min; input.max = cfg.max; input.value = cfg.value;
    if (cfg.step) input.step = cfg.step;
    input.style.width = '100%';
    input.style.display = 'block';
    wrap.appendChild(input);
    parent.appendChild(wrap);
    const handler = () => {
      out.textContent = input.value;
      cfg.onInput(parseFloat(input.value));
    };
    input.addEventListener('input', handler);
    return { input, out, trigger: handler };
  }

  /* ================================ 路由 ================================ */
  const VIEWS = ['home', 'basics', 'preflop', 'calc', 'train', 'postflop', 'glossary'];
  let currentView = 'home';
  function route() {
    let h = (location.hash || '').replace('#', '').split('/')[0] || 'home';
    if (VIEWS.indexOf(h) < 0) h = 'home';
    currentView = h;
    VIEWS.forEach(v => {
      const node = $('#view-' + v);
      if (node) node.classList.toggle('active', v === h);
    });
    $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-nav') === h));
    try { window.scrollTo(0, 0); } catch (e) { }
  }
  window.addEventListener('hashchange', route);

  /* ============================== 基础理论 ============================== */
  const LESSONS = [
    {
      id: 'ev', title: '期望值（EV）：扑克唯一的记分板', tag: '10 分钟',
      html: `
        <p>扑克里的每一个决定都可以写成一个数字：<b>期望值（Expected Value）</b>。
        它等于「每种结果 × 它的发生概率」之和。EV 为正的动作长期赚钱，EV 为负的长期亏钱，
        和这一手牌的结果无关。</p>
        <div class="formula">EV = Σ ( 结果收益 × 发生概率 )</div>
        <p>举例：底池 100，对手下注 50，你跟注 50 就能争夺一个 200 的底池。
        假设你有 25% 的胜率：</p>
        <div class="formula">EV(跟注) = 25% × 150 - 75% × 50 = 37.5 - 37.5 = 0</div>
        <p>正好等于零。这不是巧合：<b>25% 就是这手牌的价格</b>（跟注 50 去赢 200）。
        这正是下一节课要讲的底池赔率。请记住一个反直觉但极其重要的事实：
        一手「跟注是 0 EV」的牌，长期既不会让你赚钱也不会让你亏钱——
        而高手在意的是，这个 0 能不能被推到正数。</p>
        <div class="lesson-tool" id="tool-ev"></div>`,
      tool(root) {
        const box = $('#tool-ev', root);
        box.appendChild(el('h4', null, '试试看：跟注的 EV'));
        const grid = el('div', 'slider-row');
        box.appendChild(grid);
        const out = el('div', 'result-grid');
        box.appendChild(out);
        const st = { pot: 100, bet: 50, eq: 35 };
        const draw = () => {
          const need = E.potOdds(st.pot, st.bet);
          const ev = E.callEV(st.pot, st.bet, st.eq / 100);
          const cls = ev > 0.01 ? 'ok' : (ev < -0.01 ? 'bad' : '');
          out.innerHTML =
            '<div class="stat"><span>所需权益（价格）</span><b>' + pct(need) + '</b></div>' +
            '<div class="stat"><span>你的权益</span><b>' + st.eq + '%</b></div>' +
            '<div class="stat ' + cls + '"><span>跟注 EV</span><b>' +
              (ev >= 0 ? '+' : '') + ev.toFixed(1) + ' bb</b></div>';
        };
        makeSlider(grid, { label: '底池', value: 100, min: 1, max: 400, unit: 'bb', onInput: v => { st.pot = v; draw(); } });
        makeSlider(grid, { label: '对手下注', value: 50, min: 1, max: 400, unit: 'bb', onInput: v => { st.bet = v; draw(); } });
        makeSlider(grid, { label: '你的胜率', value: 35, min: 0, max: 100, unit: '%', onInput: v => { st.eq = v; draw(); } });
        draw();
      }
    },
    {
      id: 'potodds', title: '底池赔率：你要为这张牌付多少钱', tag: '10 分钟',
      html: `
        <p>底池赔率回答的是一个纯数学问题：<b>跟注额占「跟注后总底池」的多少比例？</b>
        这个比例就是你要跟注所需的最低胜率。</p>
        <div class="formula">需要权益 = 跟注额 ÷ ( 底池 + 对手下注 + 你的跟注额 )</div>
        <p>注意公式的分母包含了你自己的跟注额——很多人在这里出错。真正的记法是更简单的版本：
        <b>你需要赢下的事 / (现在的底池 + 你要付出的钱)</b>。</p>
        <div class="lesson-tool" id="tool-odds"></div>
        <p>把这张表背下来，比背范围表更划算：</p>
        <div class="table-wrap"><table class="data-table" id="odds-table"></table></div>
        <p>实战里最常用的一句口诀是：<b>半池下注 → 你需要 25% 的胜率；满池下注 → 33%</b>。
        九张补牌的同花听牌两张牌内成牌约 35%，所以对手半池下注时，跟注几乎总是成立的。</p>`,
      tool(root) {
        const box = $('#tool-odds', root);
        box.appendChild(el('h4', null, '拖动看看：不同尺度下的价格'));
        const grid = el('div', 'slider-row');
        box.appendChild(grid);
        const out = el('div', 'result-grid');
        box.appendChild(out);
        const st = { pot: 100, sizes: [0.33, 0.5, 0.66, 0.75, 1, 1.5] };
        const draw = () => {
          const rows = st.sizes.map(s => {
            const bet = st.pot * s;
            return '<tr><td>' + (s <= 1 ? Math.round(s * 100) + '% 池' : s + '× 池') +
              '</td><td class="mono">' + bet.toFixed(1) +
              '</td><td class="mono">' + pct(E.potOdds(st.pot, bet)) +
              '</td><td class="mono">' + pct(E.mdf(st.pot, bet)) + '</td></tr>';
          }).join('');
          out.innerHTML = '<div style="grid-column:1/-1"><div class="table-wrap"><table><thead><tr>' +
            '<th>下注尺度</th><th>下注额</th><th>你的最低跟注胜率</th><th>你的最低防守频率(MDF)</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
        };
        makeSlider(grid, { label: '底池', value: 100, min: 10, max: 400, unit: 'bb', onInput: v => { st.pot = v; draw(); } });
        draw();
      }
    },
    {
      id: 'realization', title: '权益实现率：为什么位置比牌力更值钱', tag: '12 分钟',
      html: `
        <p>你可能算过：A5s 对上 AKo 的胜率大约是 30%。那为什么在按钮位可以放心地用它 3-Bet？</p>
        <p>因为 <b>raw equity（原始胜率）</b>不是你能拿到的钱。你真正拿到的是
        <b>realized equity（实现权益）</b>——考虑到翻后位置、可玩性、有人弃牌之后的实际收益。</p>
        <div class="formula">实现权益 = 原始权益 × 权益实现率（Equity Realization）</div>
        <ul>
          <li><b>有位置</b>：实现率常常超过 100%。你可以用更差的价格继续玩，因为你能在对手过牌时下注、
            在对手下注弱时放弃。</li>
          <li><b>没位置</b>：实现率可能只有 60%~80%，尤其是那些「不中牌就毫无摊牌价值」的手牌
            （A5o、K9o 这类非同花边缘牌）。</li>
          <li><b>有可玩性</b>：同花连张（8♠7♠）即使错过翻牌也有顺子 / 同花听牌，
            所以实现率高；而 A♠5♦ 错过翻牌后基本只能过牌弃牌。</li>
        </ul>
        <p>这就是为什么按钮位能用 43% 的范围开池而 UTG 只能开 18%：
        按钮位的每一手牌都多出一次「最后说话」的权利，收益来自这里，而不是牌力本身。</p>
        <p class="hint">一个实用的自检问题：<b>这手牌如果翻牌没中，我还能做什么？</b>
        如果你回答不出来，它的权益实现率一定很低，即使它的原始胜率看起来还行。</p>`
    },
    {
      id: 'mdf', title: 'MDF 与 alpha：防守的频率下限', tag: '12 分钟',
      html: `
        <p>假设对手在河牌用「任意两张牌」下注半池。他需要成功多少次才划算？
        他冒 50 的风险去赢 100，所以只要你在 1/3 的情况下弃牌，他就不用看牌直接盈利。
        这个 33% 就是 <b>alpha</b>。</p>
        <div class="formula">alpha（对手的自动盈利线）= 下注额 ÷ ( 底池 + 下注额 )
MDF（你的最小防守频率）= 1 - alpha = 底池 ÷ ( 底池 + 下注额 )</div>
        <p>反过来说：为了不让他用任意两张牌白赚，你必须至少防守 MDF 这么多。</p>
        <div class="lesson-tool" id="tool-mdf"></div>
        <p><b>但请小心三个例外</b>，这三点比公式本身更重要：</p>
        <ul>
          <li>MDF 假设对手的范围完全两极化（要么坚果要么空气）。如果他下注范围里全是强牌，
            你的防守频率应该低于 MDF——这时「过度防守」只是给他送钱。</li>
          <li>MDF 不考虑你的位置与后续街。多人底池里每个人都不需要单独满足 MDF。</li>
          <li>MDF 给出的是<b>下限</b>：让对手的诈唬不赚钱。它不代表你要用哪些牌防守——
            那取决于阻断牌与摊牌价值。</li>
        </ul>`
      ,
      tool(root) {
        const box = $('#tool-mdf', root);
        box.appendChild(el('h4', null, '拖动看看：防守下限如何变化'));
        const grid = el('div', 'slider-row');
        box.appendChild(grid);
        const out = el('div', 'result-grid');
        box.appendChild(out);
        const st = { pot: 100, bet: 50 };
        const draw = () => {
          out.innerHTML =
            '<div class="stat"><span>对手的自动盈利线 alpha</span><b>' + pct(E.alpha(st.pot, st.bet)) + '</b></div>' +
            '<div class="stat"><span>你的最小防守频率 MDF</span><b>' + pct(E.mdf(st.pot, st.bet)) + '</b></div>' +
            '<div class="stat"><span>若对手下注额</span><b>' + Math.round(st.bet / st.pot * 100) + '% 池</b></div>';
        };
        makeSlider(grid, { label: '底池', value: 100, min: 1, max: 400, unit: 'bb', onInput: v => { st.pot = v; draw(); } });
        makeSlider(grid, { label: '对手下注', value: 50, min: 1, max: 400, unit: 'bb', onInput: v => { st.bet = v; draw(); } });
        draw();
      }
    },
    {
      id: 'combos', title: '组合数与阻断牌：范围到底有多少手牌', tag: '14 分钟',
      html: `
        <p>翻前一共有 <b>1326</b> 种起手组合。它们不是平均分布的：</p>
        <ul>
          <li><b>口袋对子</b>（如 AA）= <b>6</b> 种组合</li>
          <li><b>同花牌</b>（如 AKs）= <b>4</b> 种组合</li>
          <li><b>非同花牌</b>（如 AKo）= <b>12</b> 种组合</li>
        </ul>
        <p>这解释了一个关键事实：AKo 的 12 组合比 AKs 的 4 组合多三倍，
        所以「AK」这个说法在范围思考里几乎没用——你必须区分 s 和 o。</p>
        <p><b>阻断牌（Blockers）</b>是组合数学的应用。你手里有一张 A♠，
        对手手里 AA 的组合就从 6 降到 3，AKs 从 4 降到 3，AKo 从 12 降到 9。
        所以在对手的强牌范围里，「A 开头」的牌被大幅削减——这就是为什么诈唬时首选 A5s 这类牌。</p>
        <div class="lesson-tool" id="tool-blocker"></div>`,
      tool(root) {
        const box = $('#tool-blocker', root);
        box.appendChild(el('h4', null, '点选你手里的牌，看看它挡住了对手多少组合'));
        const chip = el('div', 'cardslot', '');
        chip.style.marginBottom = '14px';
        box.appendChild(chip);
        const grid = el('div');
        box.appendChild(grid);
        const out = el('div', null, '');
        box.appendChild(out);
        let picked = [];
        const baseTotal = {};
        R.ALL_HANDS.forEach(h => { baseTotal[h] = R.combosOf(h); });
        function draw() {
          const dead = picked.slice();
          const cellHtml = R.GRID.map(row => row.map(h => {
            const left = E.allCombos(h, new Set(dead)).length;
            const base = baseTotal[h];
            const hit = left < base;
            return '<div class="cell' + (hit ? ' hit' : '') + '" title="' + h + '">' +
              '<b>' + (hit ? left : '') + '</b></div>';
          }).join('')).join('');
          grid.className = 'matrix';
          grid.innerHTML = cellHtml;
          renderCardslot(chip, {
            cards: picked, max: 4, placeholder: '+ 选一张牌',
            onChange: draw
          });
          if (!picked.length) {
            out.innerHTML = '<p class="hint">还没有选牌。选择 1~4 张牌，矩阵里被阻挡的组合会高亮显示剩余数量。</p>';
          } else {
            const samples = ['AA', 'AKs', 'AKo', 'A5s', 'KQs', 'QJs', '22'].map(h => {
              const left = E.allCombos(h, new Set(dead)).length;
              const base = baseTotal[h];
              return '<tr><td class="mono">' + h + '</td><td class="mono">' + base +
                '</td><td class="mono">' + left + '</td><td>' + (base - left ? '−' + (base - left) : '—') + '</td></tr>';
            }).join('');
            out.innerHTML = '<div class="table-wrap"><table><thead><tr><th>手牌</th><th>原本组合数</th>' +
              '<th>被阻断后</th><th>减少</th></tr></thead><tbody>' + samples + '</tbody></table></div>';
          }
        }
        draw();
      }
    },
    {
      id: 'gto', title: 'GTO 与剥削：什么时候该偏离', tag: '12 分钟',
      html: `
        <p><b>GTO（Game Theory Optimal）</b>指的是这样一个策略：在任何对手面前都不会被剥削。
        从博弈论上讲，它是这个游戏的纳什均衡——如果双方都打 GTO，谁改变策略谁吃亏。</p>
        <p>它有个非常实用的性质：<b>GTO 里必然存在混合频率</b>。
        如果某个局面下某一手牌总是加注，对手就能通过「只跟注不放牌」来获利。
        所以求解器会给出 70% 加注 / 30% 弃牌这样的答案——这不是随机，而是让对手无利可图。</p>
        <p>但真实对手不是 GTO 机器。对抗人类时，<b>最大收益来自偏离</b>（这就是剥削 / EXPLOITATIVE 打法）：</p>
        <div class="table-wrap"><table><thead><tr><th>你观察到的漏洞</th><th>正确调整</th></tr></thead>
        <tbody>
        <tr><td>对手弃牌太多</td><td>增加诈唬频率，放宽下注范围（他的 alpha 太高，你可以从空气里赚钱）</td></tr>
        <tr><td>对手跟注太松</td><td>减少诈唬、增加价值下注，用更薄的强牌打价值</td></tr>
        <tr><td>对手翻前 3-Bet 太少</td><td>放宽开池范围，尤其是边缘位置</td></tr>
        <tr><td>对手从不诈唬河牌</td><td>面对他河牌的下注直接弃掉所有「抓诈牌」，不要用 MDF 防守</td></tr>
        <tr><td>对手在有位置时下注过多</td><td>提高过牌-加注频率，用强牌做陷阱</td></tr>
        </tbody></table></div>
        <p><b>正确的使用顺序</b>：先用 GTO 建立不可被剥削的基线，
        再用对手的漏洞做有根据的偏离。反过来（先乱偏离，再学 GTO）会让你长期停留在负期望值。</p>`
    }
  ];

  function renderLessons() {
    const box = $('#lessons');
    box.innerHTML = '';
    LESSONS.forEach((L, i) => {
      const node = el('div', 'lesson' + (state.done[L.id] ? ' done' : ''));
      node.appendChild(el('div', 'lesson-head',
        '<span class="lesson-idx">0' + (i + 1) + '</span><h3>' + L.title + '</h3>' +
        '<span class="tag">' + L.tag + '</span>'));
      const body = el('div', 'lesson-body', L.html);
      const foot = el('div', 'lesson-foot');
      const mark = el('button', 'btn small', state.done[L.id] ? '✓ 已掌握（点击取消）' : '标记为已掌握');
      mark.addEventListener('click', () => {
        state.done[L.id] = !state.done[L.id];
        saveState();
        mark.textContent = state.done[L.id] ? '✓ 已掌握（点击取消）' : '标记为已掌握';
        node.classList.toggle('done', !!state.done[L.id]);
        renderProgress();
      });
      foot.appendChild(el('span', 'muted small', '读完这节，试着自己复述一遍再往下走。'));
      foot.appendChild(mark);
      body.appendChild(foot);
      node.appendChild(body);
      $('#lessons').appendChild(node);
      node.querySelector('.lesson-head').addEventListener('click', () => {
        const isOpen = node.classList.contains('open');
        $$('.lesson').forEach(l => l.classList.remove('open'));
        if (!isOpen) {
          node.classList.add('open');
          if (L.tool && !node.getAttribute('data-tool-init')) {
            node.setAttribute('data-tool-init', '1');
            L.tool(body);
          }
        }
      });
    });
  }

  function renderProgress() {
    const total = LESSONS.length;
    const done = LESSONS.filter(l => state.done[l.id]).length;
    $('#basic-bar').style.width = (done / total * 100) + '%';
    $('#basic-progress-text').textContent = done + ' / ' + total + ' 已完成';
    const p = Math.round(done / total * 100);
    $('#home-ring').style.background =
      'conic-gradient(var(--gold) ' + (p / 100) + 'turn, #1d2733 0turn)';
    $('#home-ring-text').textContent = p + '%';
    $('#home-progress-text').textContent = done === 0 ? '还没有完成任何课程'
      : (done === total ? '全部 6 节课程已完成，去训练里检验一下 🎉' : '已完成 ' + done + ' 节课程');
    $('#home-quiz-total').textContent = state.quiz.total;
    $('#home-quiz-rate').textContent = state.quiz.total
      ? pct(state.quiz.correct / state.quiz.total, 0) : '—';
    renderPath();
  }

  function renderPath() {
    const steps = [
      { n: '01', t: '建立概念', d: '期望值、底池赔率、MDF。先理解「价格」这件事。', href: '#basics', key: 'ev' },
      { n: '02', t: '读懂范围表', d: '学会读 13×13 矩阵与混合频率切片，理解范围而非单牌。', href: '#preflop', key: null },
      { n: '03', t: '按位置记忆', d: '从 UTG 的 18% 到 BTN 的 43%，理解位置带来的收益来源。', href: '#preflop', key: null },
      { n: '04', t: '会算自己的胜率', d: '用权益计算器验证你的直觉：AA 对上开池范围到底赢多少。', href: '#calc', key: null },
      { n: '05', t: '在训练里暴露弱点', d: '连续答 30 题，错题会被记录，那些才是你真正要练的。', href: '#train', key: null },
      { n: '06', t: '进入翻后思维', d: '用牌面分析器建立「范围优势决定频率、坚果优势决定尺度」的判断。', href: '#postflop', key: null }
    ];
    const box = $('#home-path');
    box.innerHTML = '';
    steps.forEach(s => {
      const c = el('a', 'path-card' + (s.key && state.done[s.key] ? ' done' : ''));
      c.href = s.href;
      c.innerHTML = '<span class="num">' + s.n + '</span><h3>' + s.t + '</h3><p>' + s.d + '</p>';
      box.appendChild(c);
    });
  }

  /* ============================== 范围矩阵 ============================== */
  const rangeState = { chart: null, mode: 'action', showCombos: false };
  let tooltip = null;

  function initRange() {
    const sel = $('#range-chart');
    R.groups.forEach(g => {
      const og = document.createElement('optgroup');
      og.label = g.label + ' · ' + g.hint;
      R.CHARTS.filter(c => c.group === g.key).forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        const built = R.BUILT[c.id];
        const main = Object.keys(c.actions)[0];
        o.textContent = c.name + '（' + built.stats.pct[main] + '%）';
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = R.CHARTS[0].id;
    sel.addEventListener('change', () => { rangeState.chart = sel.value; renderRange(); });
    $('#range-mode').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      $$('#range-mode button').forEach(x => x.classList.toggle('active', x === b));
      rangeState.mode = b.getAttribute('data-mode');
      renderRange();
    });
    $('#range-showcombos').addEventListener('change', ev => {
      rangeState.showCombos = ev.target.checked;
      renderRange();
    });
    rangeState.chart = sel.value;
    renderRange();

    tooltip = el('div', 'tooltip');
    document.body.appendChild(tooltip);
  }

  function mixGradient(cell) {
    const stops = [];
    let acc = 0;
    const order = ['raise', 'threebet', 'fourbet', 'fivebet', 'call', 'fold'];
    order.forEach(k => {
      const f = cell[k];
      if (!f) return;
      const color = R.ACTIONS[k].color;
      stops.push(color + ' ' + acc.toFixed(2) + '% ' + (acc + f).toFixed(2) + '%');
      acc += f;
    });
    return stops.length ? 'linear-gradient(135deg, ' + stops.join(', ') + ')' : '#1a2029';
  }

  function dominant(cell) {
    let best = 'fold', bf = cell.fold || 0;
    Object.keys(cell).forEach(k => { if (cell[k] > bf) { bf = cell[k]; best = k; } });
    return { key: best, freq: bf };
  }

  function renderRange() {
    const built = R.BUILT[rangeState.chart];
    if (!built) return;
    const def = built.def;
    const matrix = $('#range-matrix');
    matrix.innerHTML = '';
    const frag = document.createDocumentFragment();

    R.GRID.forEach((row, i) => row.forEach((h, j) => {
      const cell = built.hands[h];
      const dom = dominant(cell);
      const node = el('div', 'cell' + (dom.key === 'fold' ? ' fold-cell' : ''));
      node.style.background = mixGradient(cell);
      let label;
      if (rangeState.showCombos) {
        const c = R.combosOf(h) * (100 - (cell.fold || 0)) / 100;
        label = c ? (Math.round(c * 10) / 10) : '';
      } else if (rangeState.mode === 'freq') {
        label = dom.key === 'fold' ? '' : Math.round(dom.freq) + '';
      } else {
        label = dom.key === 'fold' ? '' : R.ACTIONS[dom.key].short;
      }
      node.innerHTML = '<b>' + label + '</b>';
      node.addEventListener('mouseenter', ev => showCellTip(ev, h, cell, built));
      node.addEventListener('mousemove', ev => moveTip(ev));
      node.addEventListener('mouseleave', hideTip);
      frag.appendChild(node);
    }));
    matrix.appendChild(frag);

    // 标题与统计
    $('#range-head').innerHTML = '<h3>' + def.name + '</h3>' +
      '<div class="meta">' + (def.hero ? '英雄位置：' + def.hero : '') +
      (def.villain ? ' · 对手：' + def.villain : '') + (def.pot ? ' · ' + def.pot : '') + '</div>';
    const stats = $('#range-stats');
    stats.innerHTML = '<h4>范围构成</h4>';
    Object.keys(def.actions).forEach(k => {
      const a = R.ACTIONS[k];
      const row = el('div', 'stat-row');
      row.innerHTML = '<span class="swatch" style="background:' + a.color + '"></span>' +
        '<span class="name">' + a.label + '</span>' +
        '<span class="val">' + built.stats.pct[k] + '% · ' + Math.round(built.stats.combos[k]) + ' 组</span>';
      stats.appendChild(row);
    });
    const foldRow = el('div', 'stat-row');
    foldRow.innerHTML = '<span class="swatch" style="background:' + R.ACTIONS.fold.color + '"></span>' +
      '<span class="name">弃牌</span><span class="val">' +
      (Math.round((R.TOTAL_COMBOS - built.stats.total) / 13.26) / 100).toFixed(1) + '% 之外</span>';
    stats.appendChild(foldRow);
    stats.appendChild(el('div', 'stat-total',
      '继续游戏的范围总量：<b>' + built.stats.totalPct + '%</b>（' +
      Math.round(built.stats.total) + ' / 1326 组合）<br>共涉及 ' +
      Object.keys(def.actions).reduce((m, k) => m + (built.stats.hands[k] || 0), 0) + ' 类手牌'));

    const legend = $('#range-legend');
    legend.innerHTML = Object.keys(def.actions).map(k => {
      const a = R.ACTIONS[k];
      return '<span class="item"><span class="swatch" style="background:' + a.color + '"></span>' + a.label + '</span>';
    }).join('') + '<span class="item"><span class="swatch" style="background:' + R.ACTIONS.fold.color +
      '"></span>弃牌（含混合后不行动的部分）</span>';

    $('#range-note').innerHTML = '<b>策略要点：</b>' + def.note;
  }

  function showCellTip(ev, hand, cell, built) {
    const rows = ['raise', 'threebet', 'fourbet', 'fivebet', 'call', 'fold']
      .filter(k => cell[k])
      .map(k => {
        const combos = R.combosOf(hand) * cell[k] / 100;
        return '<div class="tt-row"><span><span class="swatch" style="background:' +
          R.ACTIONS[k].color + ';display:inline-block;vertical-align:-2px;margin-right:6px"></span>' +
          R.ACTIONS[k].label + '</span><b>' + cell[k] + '% · ' + (Math.round(combos * 10) / 10) + '</b></div>';
      }).join('');
    const used = Object.keys(cell).filter(k => k !== 'fold').reduce((m, k) => m + cell[k], 0);
    tooltip.innerHTML = '<h5>' + hand + '</h5>' + rows +
      '<div class="tt-row" style="margin-top:6px;border-top:1px solid #26313d;padding-top:6px">' +
      '<span>参与范围</span><b>' + used + '%</b></div>';
    tooltip.style.display = 'block';
    moveTip(ev);
  }
  function moveTip(ev) {
    if (!tooltip) return;
    const pad = 16;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const r = tooltip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tooltip.style.left = Math.max(6, x) + 'px';
    tooltip.style.top = Math.max(6, y) + 'px';
  }
  function hideTip() { if (tooltip) tooltip.style.display = 'none'; }

  /* ============================ 权益计算器 ============================ */
  const eqState = {
    players: [
      { mode: 'hand', cards: [], preset: 'rfi-btn', custom: '', name: '玩家 1' },
      { mode: 'hand', cards: [], preset: 'rfi-utg', custom: '', name: '玩家 2' }
    ],
    board: [],
    busy: false
  };

  function presetOptions(sel) {
    R.CHARTS_BUILT.forEach(c => {
      const o = document.createElement('option');
      o.value = c.def.id;
      const main = Object.keys(c.def.actions)[0];
      o.textContent = c.def.name + '（' + c.stats.pct[main] + '%）';
      sel.appendChild(o);
    });
    const o2 = document.createElement('option');
    o2.value = '__custom';
    o2.textContent = '自定义范围表达式…';
    sel.appendChild(o2);
  }

  function renderEqPlayers() {
    const box = $('#eq-players');
    box.innerHTML = '';
    eqState.players.forEach((p, idx) => {
      const card = el('div', 'player');
      const head = el('div', 'player-head');
      head.innerHTML = '<span class="dot" style="background:' + PLAYER_COLORS[idx % 4] + '"></span>' +
        '<span class="name">' + p.name + '</span>';
      if (eqState.players.length > 2) {
        const rm = el('button', 'remove-player', '✕');
        rm.title = '移除该玩家';
        rm.addEventListener('click', () => {
          eqState.players.splice(idx, 1);
          renderEqPlayers();
        });
        head.appendChild(rm);
      }
      card.appendChild(head);

      const body = el('div', 'player-body');
      const modeSel = document.createElement('select');
      modeSel.innerHTML = '<option value="hand">具体手牌</option><option value="range">范围</option>';
      modeSel.value = p.mode;
      modeSel.addEventListener('change', () => {
        p.mode = modeSel.value;
        renderEqPlayers();
      });
      body.appendChild(modeSel);

      if (p.mode === 'hand') {
        const slot = el('div', 'cardslot');
        renderCardslot(slot, {
          cards: p.cards, max: 2, placeholder: '+ 选两张牌',
          used: eqState.board.concat(...eqState.players.filter((_, i) => i !== idx)
            .map(o => o.mode === 'hand' ? o.cards : [])),
          onChange: renderEqPlayers
        });
        body.appendChild(slot);
      } else {
        const sel = document.createElement('select');
        presetOptions(sel);
        sel.value = p.preset;
        sel.addEventListener('change', () => { p.preset = sel.value; renderEqPlayers(); });
        body.appendChild(sel);
        if (p.preset === '__custom') {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.placeholder = '例如：22+, A2s+, K9s+, ATo+, KQo';
          inp.value = p.custom;
          inp.addEventListener('input', () => { p.custom = inp.value; });
          inp.style.flex = '1';
          inp.style.minWidth = '220px';
          body.appendChild(inp);
        }
      }
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  function resolveRange(p) {
    if (p.preset === '__custom') {
      const m = R.parseRange(p.custom);
      return { map: m, label: '自定义范围 ' + Object.keys(m).length + ' 手牌' };
    }
    const built = R.BUILT[p.preset];
    if (!built) return null;
    // 只取有实际动作的手牌（弃牌的频率为 0，不进入抽样池）
    const map = {};
    Object.keys(built.hands).forEach(h => {
      const used = Object.keys(built.hands[h]).filter(k => k !== 'fold').reduce((m, k) => m + built.hands[h][k], 0);
      if (used > 0) map[h] = used;
    });
    return { map, label: built.def.name };
  }

  function validateEq() {
    if (eqState.board.length === 1 || eqState.board.length === 2) {
      return '公共牌要么不填，要么填 3 张、4 张或 5 张。';
    }
    for (let i = 0; i < eqState.players.length; i++) {
      const p = eqState.players[i];
      if (p.mode === 'hand' && p.cards.length !== 2) return '请把每位「具体手牌」的玩家都选满两张牌。';
      if (p.mode === 'range') {
        const r = resolveRange(p);
        if (!r || !Object.keys(r.map).length) return '第 ' + (i + 1) + ' 位玩家的范围是空的，检查一下表达式。';
      }
    }
    const all = eqState.board.concat(...eqState.players.map(p => p.mode === 'hand' ? p.cards : []));
    if (new Set(all).size !== all.length) return '有重复的牌，请检查。';
    return null;
  }

  function runEquity(exact) {
    if (eqState.busy) return;
    const err = validateEq();
    if (err) { toast(err); return; }
    const players = eqState.players.map((p, i) => {
      if (p.mode === 'hand') return { cards: p.cards.slice(), name: p.name };
      const r = resolveRange(p);
      return { range: r.map, name: r.label };
    });
    const allHands = eqState.players.every(p => p.mode === 'hand');
    eqState.busy = true;
    $('#eq-run').disabled = true;
    $('#eq-exact').disabled = true;
    $('#eq-result').innerHTML = '<div class="card"><p class="muted">正在计算…</p></div>';

    if (exact) {
      if (!allHands || players.length !== 2) {
        toast('精确枚举只在「两位玩家都填了具体手牌」时可用。');
        eqState.busy = false;
        $('#eq-run').disabled = false;
        $('#eq-exact').disabled = false;
        return;
      }
      const t0 = Date.now();
      E.exactEquity(players[0].cards, players[1].cards, eqState.board, prog => {
        $('#eq-result').innerHTML = '<div class="card"><p class="muted">精确枚举中… ' +
          Math.round(prog * 100) + '%</p><div class="bar"><i style="width:' +
          (prog * 100) + '%"></i></div></div>';
      }, res => {
        renderEqResult({
          iterations: res.iterations, exact: true,
          equity: res.equity, win: res.win, tie: res.tie,
          samples: [], ms: Date.now() - t0
        }, players);
        eqState.busy = false;
        $('#eq-run').disabled = false;
        $('#eq-exact').disabled = false;
      });
      return;
    }

    const iters = parseInt($('#eq-iters').value, 10);
    setTimeout(() => {
      const t0 = Date.now();
      const r = E.simulate(players, eqState.board, iters, (Date.now() % 100000) | 1);
      r.ms = Date.now() - t0;
      renderEqResult(r, players);
      eqState.busy = false;
      $('#eq-run').disabled = false;
      $('#eq-exact').disabled = false;
    }, 30);
  }

  function renderEqResult(r, players) {
    const bar = players.map((p, i) =>
      '<div style="width:' + (r.equity[i] * 100) + '%;background:' + PLAYER_COLORS[i % 4] + '">' +
      '<span>' + (r.equity[i] * 100).toFixed(1) + '%</span></div>').join('');
    const rows = players.map((p, i) => {
      const label = p.cards ? p.cards.map(E.cardText).join(' ') : (p.range ? '范围' : '');
      const detail = p.cards
        ? p.cards.map(id => cardChipHTML(id)).join('')
        : '<span class="muted small">' + p.name + '</span>';
      return '<div class="eq-row"><span class="hand">' + label + '</span>' +
        '<span style="flex:1">' + detail + '</span>' +
        '<span class="muted small">胜 ' + (r.win[i] * 100).toFixed(1) + '% · 平 ' +
        (r.tie[i] * 100).toFixed(1) + '%</span>' +
        '<span class="eq">' + (r.equity[i] * 100).toFixed(2) + '%</span></div>';
    }).join('');
    const boardTxt = eqState.board.length
      ? '<div class="line"><span class="label">公共牌</span>' +
        eqState.board.slice().sort((a, b) => (b >> 2) - (a >> 2)).map(id => cardChipHTML(id)).join('') + '</div>'
      : '';
    const samples = (r.samples || []).map(s => {
      const winNames = s.winners.map(i => players[i].cards ? players[i].cards.map(E.cardText).join('')
        : ('玩家' + (i + 1))).join('、');
      return '<div class="sample">' +
        '<div class="line"><span class="label">公共牌</span>' +
        s.board.map(id => cardChipHTML(id)).join('') + '</div>' +
        '<div class="line"><span class="label">手牌</span>' +
        s.holes.map((h, i) => '<span style="margin-right:10px">' +
          h.map(id => cardChipHTML(id)).join('') + '</span>').join('') + '</div>' +
        '<div class="line"><span class="label">结果</span><b>' + winNames + '</b> 胜 · ' + s.desc + '</div>' +
        '</div>';
    }).join('');
    const src = r.exact
      ? '精确枚举 ' + r.iterations.toLocaleString('en-US') + ' 种公共牌（结果 100% 准确）'
      : '蒙特卡洛 ' + r.iterations.toLocaleString('en-US') + ' 次模拟，标准误差约 ±' +
        (Math.sqrt(0.25 / r.iterations) * 100 * 1.96).toFixed(2) + '%（95% 置信）';
    $('#eq-result').innerHTML = '<div class="card">' +
      '<div class="eq-bar">' + bar + '</div>' + rows +
      '<p class="hint">' + src + ' · 用时 ' + r.ms + ' ms</p>' +
      boardTxt +
      (samples ? '<h3 style="margin-top:18px">随机回放</h3><div class="samples">' + samples + '</div>' : '') +
      '<p class="hint">平局按平均分配底池计入权益。' +
      (r.exact ? '' : '提高精度可以减少误差，但不会改变期望值。') + '</p>' +
      '</div>';
  }

  function cardChipHTML(id) {
    const suit = E.SUIT_CHARS[id & 3];
    const red = (suit === 'h' || suit === 'd');
    return '<span class="card-chip' + (red ? ' red' : '') + '">' + E.cardPretty(id) + '</span>';
  }

  function initCalc() {
    $('#calc-tabs').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      const tab = b.getAttribute('data-tab');
      $$('#calc-tabs button').forEach(x => x.classList.toggle('active', x === b));
      $$('.tabpanel').forEach(p => p.classList.toggle('active', p.getAttribute('data-panel') === tab));
    });
    $('#eq-add').addEventListener('click', () => {
      if (eqState.players.length >= 4) { toast('最多 4 位玩家。'); return; }
      eqState.players.push({
        mode: 'hand', cards: [], preset: 'rfi-btn', custom: '',
        name: '玩家 ' + (eqState.players.length + 1)
      });
      renderEqPlayers();
    });
    $('#eq-run').addEventListener('click', () => runEquity(false));
    $('#eq-exact').addEventListener('click', () => runEquity(true));
    renderEqPlayers();
    renderBoardSlot();
    // 赔率面板
    const odds = { pot: 100, bet: 50 };
    const drawOdds = () => {
      $('#odds-pot-out').textContent = odds.pot;
      $('#odds-bet-out').textContent = odds.bet;
      const need = E.potOdds(odds.pot, odds.bet);
      $('#odds-out').innerHTML =
        '<div class="stat"><span>你需要的最低胜率</span><b>' + pct(need) + '</b></div>' +
        '<div class="stat"><span>最小防守频率 MDF</span><b>' + pct(E.mdf(odds.pot, odds.bet)) + '</b></div>' +
        '<div class="stat"><span>对手的自动盈利线</span><b>' + pct(E.alpha(odds.pot, odds.bet)) + '</b></div>' +
        '<div class="stat"><span>跟注额 / 最终底池</span><b class="small">' + odds.bet + ' / ' +
          (odds.pot + odds.bet * 2) + '</b></div>';
    };
    $('#odds-pot').addEventListener('input', e => { odds.pot = +e.target.value; drawOdds(); });
    $('#odds-bet').addEventListener('input', e => { odds.bet = +e.target.value; drawOdds(); });
    drawOdds();
    // EV 面板
    const ev = { pot: 100, bet: 75, eq: 35, fe: 45 };
    const drawEv = () => {
      $('#ev-pot-out').textContent = ev.pot;
      $('#ev-bet-out').textContent = ev.bet;
      $('#ev-eq-out').textContent = ev.eq;
      $('#ev-fe-out').textContent = ev.fe;
      const call = E.callEV(ev.pot, ev.bet, ev.eq / 100);
      const shove = E.shoveEV(ev.pot, ev.bet, ev.eq / 100, ev.fe / 100);
      const needEq = E.potOdds(ev.pot, ev.bet);
      const needFe = (ev.pot * (1 - ev.eq / 100) + ev.bet * (1 - ev.eq / 100) - ev.eq / 100 * ev.pot) /
        (ev.pot + ev.bet * (1 - ev.eq / 100) + ev.pot); // 简化近似
      $('#ev-out').innerHTML =
        '<div class="stat ' + (call > 0 ? 'ok' : (call < 0 ? 'bad' : '')) + '"><span>跟注 EV</span><b>' +
          (call >= 0 ? '+' : '') + call.toFixed(1) + '</b></div>' +
        '<div class="stat ' + (shove > 0 ? 'ok' : (shove < 0 ? 'bad' : '')) + '"><span>全下 EV（含弃牌率）</span><b>' +
          (shove >= 0 ? '+' : '') + shove.toFixed(1) + '</b></div>' +
        '<div class="stat"><span>跟注盈亏平衡胜率</span><b>' + pct(needEq) + '</b></div>' +
        '<div class="stat"><span>你的权益</span><b>' + ev.eq + '%</b></div>';
      const parts = [];
      parts.push(call > 0.01
        ? '只考虑跟注：你的 ' + ev.eq + '% 权益高于所需的 ' + pct(needEq) + '，跟注是正期望值。'
        : (call < -0.01
          ? '只考虑跟注：你的 ' + ev.eq + '% 权益低于所需的 ' + pct(needEq) +
            '，纯跟注是负期望值——除非你有隐含赔率或能用加注夺回主动权。'
          : '你正好处于盈亏平衡点：这个胜率下跟注长期不赚不亏。'));
      parts.push(shove > 0.01
        ? '加上弃牌率后全下是 +EV：' + ev.fe + '% 的弃牌率足以弥补被跟注时的劣势。'
        : (shove < -0.01 ? '加上弃牌率后全下仍是 −EV：对手需要更多弃牌，或者你的权益需要更高。'
          : '全下接近盈亏平衡。'));
      $('#ev-note').textContent = parts.join(' ');
    };
    ['pot', 'bet', 'eq', 'fe'].forEach(k => {
      $('#ev-' + k).addEventListener('input', e => { ev[k] = +e.target.value; drawEv(); });
    });
    drawEv();
  }

  function renderBoardSlot() {
    const slot = $('#eq-board');
    renderCardslot(slot, {
      cards: eqState.board, max: 5, placeholder: '+ 加公共牌',
      used: eqState.players.filter(p => p.mode === 'hand').reduce((m, p) => m.concat(p.cards), []),
      onChange: renderBoardSlot
    });
    const n = eqState.board.length;
    $('#eq-hint').textContent = (n === 1 || n === 2)
      ? '⚠️ 公共牌只能填 0、3、4 或 5 张。'
      : '提示：一方填具体手牌、另一方选范围，是最常用的用法（例如「我的 AA 对上 BTN 的开池范围」）。';
  }

  /* ================================ 训练 ================================ */
  const trainState = { mode: 'preflop', current: null, answered: false };

  function updateScore() {
    $('#t-correct').textContent = state.quiz.correct;
    $('#t-total').textContent = state.quiz.total;
    $('#t-streak').textContent = state.quiz.streak;
    $('#t-best').textContent = state.quiz.best;
    $('#t-rate').textContent = state.quiz.total ? pct(state.quiz.correct / state.quiz.total, 0) : '—';
  }

  function newQuestion() {
    trainState.current = trainState.mode === 'preflop' ? makePreflopQ()
      : (trainState.mode === 'odds' ? makeOddsQ() : makeEquityQ());
    trainState.answered = false;
    renderQuestion();
  }

  function makePreflopQ() {
    const built = pick(R.CHARTS_BUILT);
    const def = built.def;
    // 60% 从「有动作」的手牌里选，40% 从全部手牌里选（保证会出现弃牌题）
    const active = R.ALL_HANDS.filter(h => Object.keys(built.hands[h]).some(k => k !== 'fold' && built.hands[h][k] > 0));
    const from = Math.random() < 0.6 && active.length ? active : R.ALL_HANDS;
    const hand = pick(from);
    const cell = built.hands[hand];
    const options = Object.keys(def.actions).concat('fold');
    const opts = options.map(k => {
      const f = cell[k] || 0;
      return { key: k, label: R.ACTIONS[k].label, freq: f };
    }).sort((a, b) => b.freq - a.freq);
    // 打乱顺序：否则正确答案永远排在第一个
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    return {
      type: 'preflop', chart: def, built, hand, cell,
      question: '在这个场景下，' + hand + ' 应该怎么处理？',
      situation: def.name + (def.pot ? ' · ' + def.pot : ''),
      options: opts
    };
  }

  function makeOddsQ() {
    const pot = [40, 60, 80, 100, 120, 150][Math.floor(Math.random() * 6)];
    const ratios = [1 / 3, 0.5, 2 / 3, 0.75];
    const r = ratios[Math.floor(Math.random() * ratios.length)];
    const bet = Math.round(pot * r);
    const need = E.potOdds(pot, bet);
    const kind = Math.random() < 0.7 ? 'you' : 'mdf';
    const trueVal = kind === 'you' ? need : E.mdf(pot, bet);
    const correct = Math.round(trueVal * 100);
    const pool = [15, 20, 25, 29, 33, 40, 50, 57, 60, 67, 75];
    const opts = [correct];
    while (opts.length < 4) {
      const cand = pool[Math.floor(Math.random() * pool.length)];
      if (opts.indexOf(cand) < 0 && Math.abs(cand - correct) >= 5) opts.push(cand);
    }
    return {
      type: 'odds',
      question: kind === 'you'
        ? '底池 ' + pot + 'bb，对手下注 ' + bet + 'bb。你跟注需要多少胜率才是盈亏平衡？'
        : '底池 ' + pot + 'bb，对手下注 ' + bet + 'bb。为了让他用任意两张牌下注都不划算，你的最小防守频率（MDF）是多少？',
      situation: '底池 ' + pot + 'bb · 下注 ' + bet + 'bb（' + Math.round(r * 100) + '% 池）',
      detail: '需要的胜率 = 跟注额 ÷ (底池 + 下注 + 跟注额)；MDF = 底池 ÷ (底池 + 下注)。',
      answerValue: trueVal,
      options: opts.sort(() => Math.random() - 0.5).map(v => ({ key: String(v), label: v + '%', freq: null, correct: v === correct }))
    };
  }

  function makeEquityQ() {
    const hands = [['AsAh', 'AA'], ['KsKh', 'KK'], ['AsKs', 'AKs'], ['QhQd', 'QQ'],
      ['7s7h', '77'], ['2s2h', '22'], ['AsKd', 'AKo'], ['JsTh', 'JTo'],
      ['9s9h', '99'], ['AsQs', 'AQs'], ['6c5c', '65s'], ['AdJh', 'AJo']];
    const pair = [];
    while (pair.length < 2) {
      const c = pick(hands);
      if (pair.indexOf(c) < 0 && (!pair.length || pair[0][1] !== c[1])) pair.push(c);
    }
    const h1 = E.parseCards(pair[0][0]).cards;
    const h2 = E.parseCards(pair[1][0]).cards;
    if (h1.some(c => h2.indexOf(c) >= 0)) return makeEquityQ();
    const r = E.simulate([{ cards: h1 }, { cards: h2 }], [], 60000, Math.floor(Math.random() * 1e6) + 1);
    const trueVal = r.equity[0] * 100;
    const correct = Math.round(trueVal / 5) * 5;
    const opts = [correct];
    const ladder = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    while (opts.length < 4) {
      const cand = ladder[Math.floor(Math.random() * ladder.length)];
      if (opts.indexOf(cand) < 0 && Math.abs(cand - correct) >= 10) opts.push(cand);
    }
    return {
      type: 'equity',
      question: '翻牌前全下，' + pair[0][1] + ' 对上 ' + pair[1][1] + '，胜率大约是多少？',
      situation: pair[0][1] + ' vs ' + pair[1][1] + ' · 各投 100bb 全下',
      detail: '正确答案是 ' + trueVal.toFixed(1) + '%（本次由引擎模拟 ' +
        r.iterations.toLocaleString('en-US') + ' 次得出）。',
      answerValue: trueVal / 100,
      holeCards: [h1, h2],
      options: opts.sort(() => Math.random() - 0.5).map(v => ({
        key: String(v), label: '约 ' + v + '%', freq: null, correct: v === correct
      }))
    };
  }

  function renderQuestion() {
    const q = trainState.current;
    const box = $('#train-body');
    let extra = '';
    if (q.type === 'preflop') {
      extra = '<div class="hand-big">' + q.hand + '</div>';
    } else if (q.type === 'equity') {
      extra = '<div class="hand-big" style="font-size:22px">' +
        q.holeCards.map(h => h.map(id => cardChipHTML(id)).join('')).join(
          ' <span class="muted" style="font-size:14px">vs</span> ') + '</div>';
    }
    box.innerHTML = '<div class="quiz">' +
      '<div class="situation">' + q.situation + '</div>' +
      '<div class="question">' + q.question + '</div>' + extra +
      '<div class="options" id="q-options"></div>' +
      '<div id="q-feedback"></div>' +
      '</div>';
    const opts = $('#q-options');
    q.options.forEach(o => {
      const b = el('button', 'option', o.label +
        (o.freq !== null && o.freq > 0 ? '<span class="freq">' + q.built.stats.pct[o.key] + '% 的范围</span>' : ''));
      b.addEventListener('click', () => answer(o, b));
      opts.appendChild(b);
    });
  }

  function answer(opt, btn) {
    if (trainState.answered) return;
    trainState.answered = true;
    const q = trainState.current;
    let correct = false;

    if (q.type === 'preflop') {
      const best = q.options.reduce((m, o) => (o.freq > m.freq ? o : m), q.options[0]);
      // 频率相同（例如 50/50）时两个答案都算对
      correct = Math.abs((opt.freq || 0) - best.freq) < 0.001;
      $$('#q-options .option').forEach((b, i) => {
        const o = q.options[i];
        if (Math.abs((o.freq || 0) - best.freq) < 0.001) b.classList.add('correct');
        else if (o === opt) b.classList.add('wrong');
      });
      const detail = q.options.slice().sort((a, b) => b.freq - a.freq).map(o =>
        '<div class="review-item"><span class="h">' + o.label + '</span>' +
        '<span>' + o.freq + '% 的频率' +
        ((o.freq && o.key !== 'fold') ? ' · ' + Math.round(R.combosOf(q.hand) * o.freq / 100) + ' 组合' : '') +
        '</span></div>').join('');
      $('#q-feedback').innerHTML = '<div class="feedback ' + (correct ? 'good' : 'bad') + '">' +
        '<h3>' + (correct ? '✅ 正确' : '❌ 不对') + '</h3>' +
        '<p>' + q.chart.note + '</p>' + detail + '</div>';
    } else {
      correct = !!opt.correct;
      $$('#q-options .option').forEach((b, i) => {
        if (q.options[i].correct) b.classList.add('correct');
        else if (q.options[i] === opt) b.classList.add('wrong');
      });
      $('#q-feedback').innerHTML = '<div class="feedback ' + (correct ? 'good' : 'bad') + '">' +
        '<h3>' + (correct ? '✅ 正确' : '❌ 算错了') + '</h3>' +
        '<p>' + q.detail + '</p>' +
        '<p class="muted">' + (q.type === 'odds' ? '公式：需要胜率 = 跟注额 ÷ (底池 + 下注 + 跟注额)。' :
          '翻前对局的结果几乎完全由「谁是被主导的一方」决定：口袋里的小对子最容易变成大冷门。') +
        '</p></div>';
    }

    state.quiz.total++;
    if (correct) {
      state.quiz.correct++;
      state.quiz.streak++;
      state.quiz.best = Math.max(state.quiz.best, state.quiz.streak);
    } else {
      state.quiz.streak = 0;
      const label = q.type === 'preflop' ? (q.hand + ' · ' + q.chart.name)
        : q.question.replace(/。$/, '');
      state.wrong.unshift({ label, correct: q.type === 'preflop'
        ? q.options.reduce((m, o) => (o.freq > m.freq ? o : m), q.options[0]).label
        : q.options.filter(o => o.correct)[0].label });
      state.wrong = state.wrong.slice(0, 10);
    }
    saveState();
    updateScore();
    renderReview();
    const next = el('button', 'btn primary', '下一题 →');
    next.style.marginTop = '14px';
    next.addEventListener('click', newQuestion);
    $('#q-feedback').appendChild(next);
    next.focus();
  }

  function renderReview() {
    const box = $('#train-review');
    if (!state.wrong.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h3>最近答错（共 ' + state.wrong.length + ' 条）</h3>' +
      state.wrong.map(w => '<div class="review-item"><span class="h">' + w.label +
        '</span><span>正确做法：<b>' + w.correct + '</b></span></div>').join('');
  }

  function initTrain() {
    $('#train-mode').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      $$('#train-mode button').forEach(x => x.classList.toggle('active', x === b));
      trainState.mode = b.getAttribute('data-mode');
      newQuestion();
    });
    $('#t-reset').addEventListener('click', () => {
      state.quiz = { correct: 0, total: 0, streak: 0, best: 0 };
      state.wrong = [];
      saveState();
      updateScore();
      renderReview();
      renderProgress();
      toast('记录已清空。');
    });
    updateScore();
    renderReview();
    newQuestion();
  }

  /* ============================== 牌面分析 ============================== */
  const pfState = { board: [] };
  const PF_PRESETS = [
    ['Ts9s8h', 'T♠9♠8♥ 连张双同花'], ['AsAh2d', 'A♠A♥2♦ 对子面'],
    ['Kd7c2s', 'K♦7♣2♠ 干燥面'], ['QsJs2h', 'Q♠J♠2♥ 高张同花'],
    ['8s7s6s', '8♠7♠6♠ 天花面'], ['AcKd7h', 'A♣K♦7♥ 大牌彩虹'],
    ['5h5d5c', '5♥5♦5♣ 三条面'], ['JcTd9s', 'J♣T♦9♠ 顺面']
  ];

  function initPostflop() {
    const chipRow = $('#pf-presets');
    PF_PRESETS.forEach(([cards, label]) => {
      const c = el('button', 'chip', label);
      c.addEventListener('click', () => {
        pfState.board = E.parseCards(cards).cards.slice(0, 3);
        renderPostflop();
      });
      chipRow.appendChild(c);
    });
    $('#pf-clear').addEventListener('click', () => { pfState.board = []; renderPostflop(); });
    renderPostflop();
  }

  function renderPostflop() {
    renderCardslot($('#pf-board'), {
      cards: pfState.board, max: 3, placeholder: '+ 选翻牌',
      onChange: renderPostflop
    });
    const out = $('#pf-output');
    if (pfState.board.length < 3) {
      out.innerHTML = '<p class="hint">选出三张翻牌，或者直接点上面的示例。</p>';
      return;
    }
    const a = E.analyzeBoard(pfState.board);
    const verdict = [
      ['牌面结构', a.pairedDesc.label], ['同花', a.flushDesc.label],
      ['连接度', a.connected.label], ['高张', a.highDesc.label]
    ].map(([k, v]) => '<span class="pill">' + k + '：' + v + '</span>').join('');
    out.innerHTML = '<div class="pf-verdict">' + verdict +
      '<span class="pill" style="border-color:var(--gold);color:var(--gold)">整体质感：' + a.texture + '</span></div>' +
      '<div class="grid-2">' +
      '<div class="card" style="margin:0"><h3>对子结构</h3><p>' + a.pairedDesc.desc + '</p></div>' +
      '<div class="card" style="margin:0"><h3>同花结构</h3><p>' + a.flushDesc.desc + '</p></div>' +
      '<div class="card" style="margin:0"><h3>顺子连接</h3><p>' + a.connected.desc + '</p></div>' +
      '<div class="card" style="margin:0"><h3>高张与范围优势</h3><p>' + a.highDesc.desc + '</p></div>' +
      '</div>' +
      '<div class="note"><b>持续下注建议：</b>' + a.cbetHint + '</div>';
  }

  /* =============================== 术语表 =============================== */
  const GLOSSARY = [
    ['GTO', 'Game Theory Optimal', '博弈论最优策略。在任何对手面前都不会被长期剥削，是纳什均衡在该局面下的解。'],
    ['EV', 'Expected Value', '期望值：每种结果乘以概率之和。判断一个动作值不值得做，只看 EV。'],
    ['RFI', 'Raise First In', '开池：前面无人入池时你第一个加注。'],
    ['3-Bet', 'Three Bet', '面对一个加注再加注。开池是 1-bet，3-bet 是第二次加注（因为有盲注这个「第 1 个下注」）。'],
    ['4-Bet', 'Four Bet', '面对 3-Bet 的再加注。通常是强价值牌与阻断牌的组合。'],
    ['底池赔率', 'Pot Odds', '跟注额 ÷ 跟注后的总底池，等于你继续游戏所需的最低胜率。'],
    ['隐含赔率', 'Implied Odds', '除了当前底池，未来几条街还能从对手那里赢到的钱。听牌时的主要依据。'],
    ['MDF', 'Minimum Defense Frequency', '最小防守频率 = 底池 ÷ (底池 + 下注)。你至少要防守的比例，让对手的诈唬无法自动盈利。'],
    ['alpha', 'Alpha', '下注额 ÷ (底池 + 下注额)：对手的诈唬在不被跟注时自动盈利所需的最低弃牌率。'],
    ['权益', 'Equity', '你当前赢下这个底池的概率，平局按分摊计算。'],
    ['权益实现率', 'Equity Realization', '实际拿到的权益 ÷ 原始权益。位置好、可玩性高的手牌实现率更高。'],
    ['范围', 'Range', '一个玩家在某个位置上所有可能手牌的集合及其频率，而不是某一手具体牌。'],
    ['组合数', 'Combos', '对子 6 种、同花 4 种、非同花 12 种。总共有 1326 种起手组合。'],
    ['阻断牌', 'Blockers', '你手里的牌减少了对手持有某些组合的数量。诈唬时优先选择阻断对手强牌的牌。'],
    ['极化范围', 'Polarized Range', '范围由「最强牌」和「纯诈唬」组成，缺少中间地带。河牌圈下注的典型形态。'],
    ['线性范围', 'Linear / Merged Range', '从强到中等连续排列，用于价值下注与跟注。'],
    ['坚果优势', 'Nut Advantage', '谁手里握着最多的最强牌，决定了谁可以用更大的下注尺度。'],
    ['范围优势', 'Range Advantage', '谁的整个范围在这个牌面上平均更强，决定了谁应该更频繁地下注。'],
    ['持续下注', 'C-Bet', '翻前加注者在翻牌圈继续下注。频率与尺度取决于牌面质感。'],
    ['过牌-加注', 'Check-Raise', '先过牌、面对下注再加注。通常用于保护范围与榨取对手的持续下注。'],
    ['semi-bluff', '半诈唬', '用听牌下注：被跟注时仍有补牌可以反超，比纯诈唬多一条赢钱的路径。'],
    ['摊牌价值', 'Showdown Value', '你不下注也有可能赢的牌力。有摊牌价值的牌通常倾向于过牌跟注而不是诈唬。'],
    ['实现权益', 'Realize Equity', '把算出来的胜率真正变成筹码。'],
    ['ICM', 'Independent Chip Model', '锦标赛中筹码的价值模型。泡沫期与决赛桌的决策会被 ICM 显著改变。'],
    ['范围优势/劣势', 'Range Advantage', '同一个概念的另一处写法，强调牌面对双方范围的不同影响。'],
    ['TX/RX 尺寸记法', 'Bet Sizing', '常说的 1/3 池、1/2 池、2/3 池、满池等，决定对手需要的防守频率。']
  ];

  function renderGlossary(filter) {
    const q = (filter || '').trim().toLowerCase();
    const list = GLOSSARY.filter(g => !q ||
      (g[0] + g[1] + g[2]).toLowerCase().indexOf(q) >= 0);
    $('#glossary-list').innerHTML = list.length ? list.map(g =>
      '<div class="term"><h4>' + g[0] + '</h4><div class="en">' + g[1] + '</div><p>' + g[2] + '</p></div>'
    ).join('') : '<p class="muted">没有找到相关术语。</p>';
  }

  /* =============================== 首页 =============================== */
  function initHome() {
    const rows = [
      ['AA', 'AsAh', 'KK', 'KsKh', '最强对子对上次强对子'],
      ['AKs', 'AsKs', 'QQ', 'QhQd', '同花高牌对上大对子'],
      ['22', '2s2h', 'AKs', 'AsKs', '小对子对两张大牌——经典硬币局'],
      ['77', '7s7h', 'AKs', 'AsKs', '中低对子仍然只是轻微领先'],
      ['AKo', 'AsKd', '22', '2s2h', '非同花大牌对最小对子'],
      ['QQ', 'QsQh', 'AsKs', 'AsKs', '大对子对两张高牌']
    ];
    const tbody = $('#home-matchups tbody');
    tbody.innerHTML = '';
    const rng = E.makeRng(20261013);
    rows.forEach(row => {
      const [n1, c1, n2, c2, note] = row;
      const r = E.simulate([{ cards: E.parseCards(c1).cards }, { cards: E.parseCards(c2).cards }],
        [], 30000, Math.floor(rng() * 1e9) + 1);
      const tr = el('tr');
      tr.innerHTML = '<td>' + cardChipHTML(E.parseCards(c1).cards[0]) + cardChipHTML(E.parseCards(c1).cards[1]) +
        ' <b>' + n1 + '</b> <span class="muted">vs</span> ' +
        cardChipHTML(E.parseCards(c2).cards[0]) + cardChipHTML(E.parseCards(c2).cards[1]) +
        ' <b>' + n2 + '</b></td>' +
        '<td class="mono"><b>' + (r.equity[0] * 100).toFixed(1) + '%</b></td>' +
        '<td class="mono">' + (r.equity[1] * 100).toFixed(1) + '%</td>' +
        '<td class="mono muted">' + (r.tie[0] * 100).toFixed(1) + '%</td>' +
        '<td class="muted">' + note + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* =============================== 初始化 =============================== */
  function init() {
    loadState();
    renderLessons();
    renderProgress();
    initRange();
    initCalc();
    initTrain();
    initPostflop();
    renderGlossary('');
    $('#glossary-filter').addEventListener('input', e => renderGlossary(e.target.value));
    $('#picker-close').addEventListener('click', closePicker);
    $('#picker').addEventListener('click', ev => { if (ev.target.id === 'picker') closePicker(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePicker(); });
    window.addEventListener('scroll', hideTip);
    route();
    // 首页表格在首帧之后再算，避免阻塞渲染
    setTimeout(initHome, 60);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
