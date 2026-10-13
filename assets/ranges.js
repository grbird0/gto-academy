/* =========================================================================
 *  ranges.js — 德州扑克翻前范围数据层
 *  -----------------------------------------------------------------------
 *  数据说明
 *  1. 全部范围基于 6-Max、100bb 现金局、无前注(no ante) 的常见 solver 输出
 *     整理而成，属于「教学近似值」：用于理解范围结构、频率混合与位置差异，
 *     并非某个具体解算器的精确结果。
 *  2. 真实 solver 输出带有大量细微的混合频率（例如某个手牌 37% 3-Bet），
 *     本站把混合频率简化为 25% / 50% / 75% 等整数刻度，便于学习与记忆。
 *  3. 练习与测验的答案完全由本文件的数据推导，保证「图表 = 答案」自洽。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------- 1. 基础工具 ---------------------------- */

  const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const RI = {};
  RANKS.forEach((r, i) => { RI[r] = i; });

  const PAIR_COMBOS = 6;      // 口袋对子 6 种组合
  const SUITED_COMBOS = 4;    // 同花 4 种
  const OFFSUIT_COMBOS = 12;  // 非同花 12 种
  const TOTAL_COMBOS = 1326;  // C(52,2)

  /** 网格坐标 → 手牌名，i 为行、j 为列（均 0..12，0=A） */
  function handName(i, j) {
    if (i === j) return RANKS[i] + RANKS[j];
    if (i < j) return RANKS[i] + RANKS[j] + 's';
    return RANKS[j] + RANKS[i] + 'o';
  }

  const ALL_HANDS = [];
  const GRID = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      const h = handName(i, j);
      row.push(h);
      ALL_HANDS.push(h);
    }
    GRID.push(row);
  }

  /** 解析单张手牌记号 → {hi, lo, type}   hi/lo 为 RANKS 下标，hi < lo */
  function parseHand(tok) {
    const t = tok.trim();
    if (t.length === 2) {
      const i = RI[t[0]], j = RI[t[1]];
      if (i === undefined || j === undefined || i !== j) return null;
      return { hi: i, lo: j, type: 'p' };
    }
    if (t.length === 3) {
      const i = RI[t[0]], j = RI[t[1]], s = t[2];
      if (i === undefined || j === undefined || i >= j) return null;
      if (s !== 's' && s !== 'o') return null;
      return { hi: i, lo: j, type: s };
    }
    return null;
  }

  const GLYPH = { p: '', s: 's', o: 'o' };
  function makeHand(hi, lo, type) {
    if (type === 'p') return RANKS[hi] + RANKS[lo];
    return RANKS[hi] + RANKS[lo] + GLYPH[type];
  }

  /**
   * 展开范围表达式。支持：
   *   AA            单一手牌
   *   22+, A2s+     连续到顶端
   *   AA-22         对子区间
   *   AKs-A2s       同一高张、踢脚递进
   *   KTs-KQs       同一踢脚、高张递进
   *   JTs-54s       连张阶梯（双端同时递进）
   *   每个记号可加频率： A5s:75, QQ+:50
   */
  function expandToken(raw) {
    const out = [];
    const [body, freqStr] = raw.split(':');
    const freq = freqStr === undefined ? 100 : Math.max(0, Math.min(100, parseFloat(freqStr)));
    const t = body.trim();
    if (!t) return out;

    // 形如 22+ / A2s+
    if (t.endsWith('+')) {
      const base = parseHand(t.slice(0, -1));
      if (!base) return out;
      if (base.type === 'p') {
        for (let i = base.hi; i >= 0; i--) out.push({ hand: makeHand(i, i, 'p'), freq });
      } else {
        for (let lo = base.lo; lo > base.hi; lo--) out.push({ hand: makeHand(base.hi, lo, base.type), freq });
      }
      return out;
    }

    // 形如 AA-22 / AKs-A2s / JTs-54s
    if (t.includes('-')) {
      const [aStr, bStr] = t.split('-');
      const a = parseHand(aStr), b = parseHand(bStr);
      if (!a || !b || a.type !== b.type) return out;
      const dHi = b.hi - a.hi, dLo = b.lo - a.lo;
      const n = Math.max(Math.abs(dHi), Math.abs(dLo));
      const sHi = Math.sign(dHi), sLo = Math.sign(dLo);
      if (n === 0) return out;
      if (dHi !== 0 && dLo !== 0 && Math.abs(dHi) !== Math.abs(dLo)) return out;
      for (let k = 0; k <= n; k++) {
        const hi = a.hi + sHi * k, lo = a.lo + sLo * k;
        if (hi < 0 || lo > 12 || hi >= lo) continue;
        out.push({ hand: makeHand(hi, lo, a.type), freq });
      }
      return out;
    }

    const single = parseHand(t);
    if (single) out.push({ hand: makeHand(single.hi, single.lo, single.type), freq });
    return out;
  }

  /** 把 "22+, AKs-A2s, A5s:75" 这样的字符串展开为 {hand: 频率} */
  function parseRange(str) {
    const map = {};
    if (!str) return map;
    String(str).split(/[,\n]/).forEach(chunk => {
      expandToken(chunk).forEach(({ hand, freq }) => {
        // 同一动作内重复出现时取较大值，避免同一手牌被重复累加
        map[hand] = Math.max(map[hand] || 0, freq);
      });
    });
    return map;
  }

  function combosOf(hand) {
    if (hand.length === 2) return PAIR_COMBOS;
    return hand[2] === 's' ? SUITED_COMBOS : OFFSUIT_COMBOS;
  }

  /* ------------------------- 2. 动作与配色定义 ------------------------- */

  const ACTIONS = {
    raise:    { key: 'raise',    label: '加注开局', short: 'R',  color: '#e5484d', text: '#fff' },
    threebet: { key: 'threebet', label: '3-Bet',    short: '3B', color: '#f5a524', text: '#231a04' },
    fourbet:  { key: 'fourbet',  label: '4-Bet',    short: '4B', color: '#d6409f', text: '#fff' },
    fivebet:  { key: 'fivebet',  label: '5-Bet/全下', short: 'AI', color: '#8b5cf6', text: '#fff' },
    call:     { key: 'call',     label: '跟注',     short: 'C',  color: '#30a46c', text: '#04170c' },
    fold:     { key: 'fold',     label: '弃牌',     short: 'F',  color: '#23272e', text: '#6b7280' }
  };

  /* --------------------------- 3. 范围数据表 --------------------------- *
   *  actions: { 动作key: "范围表达式" }，未列出的手牌 = 弃牌
   *  同一手牌可出现在多个动作里（混合策略），频率之和应 ≤ 100
   * ------------------------------------------------------------------- */

  const CHARTS = [
    /* ============ RFI：无人在底池中，你是第一个加注的人 ============ */
    {
      id: 'rfi-utg', group: 'rfi', name: 'UTG 开池', hero: 'UTG', villain: null,
      pot: '无人入池 · 100bb',
      note: '六人桌第一个行动的位置，身后五个人都还没说话，所以范围最紧。' +
            'UTG 的核心是「用强牌拿下底池，避免被身后 3-Bet 逼出边缘牌」。' +
            '注意所有对子都开池（22 也有隐含赔率），而 ATo/KQo 这类非同花强牌是边界。',
      actions: {
        raise: '22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s:75, 54s:50, ATo+, KQo, KJo:50'
      }
    },
    {
      id: 'rfi-hj', group: 'rfi', name: 'HJ 开池', hero: 'HJ', villain: null,
      pot: '无人入池 · 100bb',
      note: 'HJ（劫机位）身后还剩 CO / BTN / SB / BB 四家。' +
            '比 UTG 多出 K8s+、Q9s+、97s+ 以及 KJo+，因为能偷盲的机会变多，' +
            '而且被身后强牌反击的概率下降。',
      actions: {
        raise: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s, ATo+, KJo+, QJo:50, KQo'
      }
    },
    {
      id: 'rfi-co', group: 'rfi', name: 'CO 开池', hero: 'CO', villain: null,
      pot: '无人入池 · 100bb',
      note: 'CO（关位）只剩 BTN 和两个盲注在后面，是「半宽」位置。' +
            'A9o/KTo/QTo 这类非同花开始进入范围，同花连张也放宽到 86s/75s。' +
            '这里的边界手牌很多是混合频率（例如 A9o 只开 75%）。',
      actions: {
        raise: '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+:50, 75s+:50, 86s, 75s, 65s, 54s, A9o+:75, ATo+, KTo+, QTo+, JTo:75'
      }
    },
    {
      id: 'rfi-btn', group: 'rfi', name: 'BTN 开池', hero: 'BTN', villain: null,
      pot: '无人入池 · 100bb',
      note: '按钮位是全场最好的位置：翻后永远最后一个行动。' +
            '范围可以宽到 40% 以上，几乎任何同花、任何 A、绝大多数 Kx 都能开池。' +
            '宽范围能盈利，靠的不是牌力，而是位置带来的「权益实现率」优势。',
      actions: {
        raise: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T9o:75, 98o:50'
      }
    },
    {
      id: 'rfi-sb', group: 'rfi', name: 'SB 开池', hero: 'SB', villain: null,
      pot: '无人入池 · SB 需先补 0.5bb',
      note: '小盲位只付了半个大盲，但翻后永远最先行动——这是最糟糕的位置。' +
            '现代策略里 SB 用「加注 + 跛入(limp)」混合：约 45% 加注、' +
            '相当一部分手牌直接跛入（本站只展示加注部分）。' +
            '实战简化版：SB 直接用「加注或弃牌」，跛入容易在翻后被压榨。',
      actions: {
        raise: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T9o:75, 98o:50, 87o:50'
      }
    },

    /* ============ 面对开池（vs RFI）：跟注 / 3-Bet ============ */
    {
      id: 'bb-vs-utg', group: 'vsrfi', name: 'BB 面对 UTG 开池', hero: 'BB', villain: 'UTG',
      pot: 'UTG 开池 2.5bb · 你已投入 1bb',
      note: '大盲已经付了 1bb，只需要再补 1.5bb 就能看翻牌，所以防守范围非常宽' +
            '（约 1/3 的手牌）。3-Bet 部分偏极化：用 QQ+/AK 做价值，' +
            '用 A5s/A4s 这类带阻断牌的同花 A 做诈唬。' +
            '面对 UTG 这种紧范围，A5s 的诈唬效果最好——它挡住 AA、AKs。',
      actions: {
        threebet: 'QQ+, AKs, AKo, A5s:75, A4s:50, AQs:50, KQs:50, JJ:50, ATs:25, KJs:25',
        call: '22-TT, JJ:50, A2s-A3s, A4s:50, A5s:25, A6s-A9s, ATs:75, AJs, AQs:50, ' +
              'K4s-KTs, KJs:75, KQs:50, Q7s-QJs, J8s-JTs, T8s-T9s, 97s-98s, 86s-87s, ' +
              '75s-76s, 65s, 54s, A9o-AQo, KTo+, QTo+, JTo, T9o:75, A2o-A9o:75, ' +
              'K9o:75, Q9o:50, J9o:50'
      }
    },
    {
      id: 'bb-vs-btn', group: 'vsrfi', name: 'BB 面对 BTN 开池', hero: 'BB', villain: 'BTN',
      pot: 'BTN 开池 2.5bb · 你已投入 1bb',
      note: 'BTN 的范围宽达 40%+，所以你在 BB 的防守范围也要放宽到 50% 左右。' +
            '关键变化：3-Bet 里加入大量小对子（22-77 混合）和同花连张，' +
            '因为对手范围弱、弃牌率高，诈唬的收益变大。' +
            '跟注部分也从「能看翻牌就行」转向「有翻后可玩性」。',
      actions: {
        threebet: 'QQ+, AKo, AKs, A5s:75, A4s:50, A3s:25, A2s:25, KQs:75, AQs:75, ' +
                  'JJ:75, TT:50, KJs:75, KTs:50, ' +
                  'QJs:75, ATo:25, KQo:50, 65s:50, 54s:50, 76s:50, 99:50, 88:50, 77:75, ' +
                  '66:75, 55:50, A9s:50, A8s:50, K9s:50, QTs:50, JTs:50, T9s:50, AJo:25, KJo:25',
        call: '22-44, 55:50, 66:25, 77:25, 88:50, 99:50, TT:50, JJ:25, A2s:75, A3s:75, ' +
              'A4s:50, A5s:25, A6s-A7s, A8s:50, ' +
              'A9s:50, ATs-AJs, AQs:25, K2s-K8s, K9s:50, KTs:50, KJs:25, KQs:25, ' +
              'Q2s, Q3s-Q8s, Q9s, QTs:50, QJs:25, J2s-J4s, J5s-J8s, J9s, JTs:50, ' +
              'T4s-T5s, T6s-T8s, T9s:50, 94s, 95s-98s, 84s-87s, 74s-75s, 76s:50, ' +
              '63s-64s, 65s:50, 53s, 54s:50, 43s, A2o-A9o, ATo:75, AJo:75, ' +
              'K9o-KTo, KJo:75, KQo:50, Q8o-QJo, J8o-JTo, T8o-T9o, 98o, 87o:50'
      }
    },
    {
      id: 'sb-vs-btn', group: 'vsrfi', name: 'SB 面对 BTN 开池', hero: 'SB', villain: 'BTN',
      pot: 'BTN 开池 2.5bb · SB 需再投 2bb',
      note: 'SB 最经典的「3-Bet 或弃牌」场景。原因有两个：' +
            '① 你补注后翻牌永远先说话，跟注很难实现权益；' +
            '② 身后还有大盲，跟注等于邀请它一起入池。' +
            '所以策略高度极化：25% 左右直接 3-Bet（大尺度，通常 4bb），其余弃牌。' +
            '因为 BTN 只用 1bb 就能跟注，3-Bet 尺度要大一点才有威慑力。',
      actions: {
        threebet: '44+, A2s+, K6s+, Q8s+, J9s+, T9s, 98s, 87s, 76s, 65s, A8o+, KTo+, QTo+, JTo:75'
      }
    },
    {
      id: 'btn-vs-co', group: 'vsrfi', name: 'BTN 面对 CO 开池', hero: 'BTN', villain: 'CO',
      pot: 'CO 开池 2.5bb',
      note: '有位置地对抗一个中等宽度的范围。3-Bet 采用「线性 + 少量诈唬」：' +
            'TT+/AQs+/AKo 做价值，A5s-A2s 与 76s/65s/54s 做诈唬。' +
            '跟注范围重点是「有位置、能实现权益」的手牌：中小对子、同花 A、' +
            '同花连张。注意 JTo 这类「没位置也能玩，有位置反而不理想」的牌被剔除——' +
            '因为它既没有同花潜力，又容易被主导。',
      actions: {
        threebet: 'TT+, AKs, AQs:75, AKo, A5s:75, A4s:50, A3s:25, KQs:75, KJs:50, ' +
                  '76s:75, 65s:75, 54s:75, AJo:50, KQo:50, 22:25, 33:25, 44:50, 55:50, 66:50',
        call: '22:75, 33:75, 44:50, 55:50, 66:50, 77-99, A2s, A3s:75, A4s:50, A5s:25, ' +
              'A6s-AJs, AQs:25, K8s-KTs, KJs:50, KQs:25, Q9s-QJs, J9s-JTs, T8s-T9s, ' +
              '97s-98s, 86s-87s, 75s, 76s:25, 65s:25, 54s:25, ATo, AJo:50, AQo, KTo-KJo, ' +
              'KQo:50, QTo+, K9o:50'
      }
    },
    {
      id: 'co-vs-utg', group: 'vsrfi', name: 'CO 面对 UTG 开池', hero: 'CO', villain: 'UTG',
      pot: 'UTG 开池 2.5bb',
      note: '面对全场最紧的范围，你必须收紧到 13% 上下。' +
            '跟注只用「有位置 + 能跑出强牌」的手牌：77-TT、同花 A、同花连张。' +
            '3-Bet 用 JJ+/AQs+/AKo 价值加 A5s/A4s 诈唬。' +
            '注意 AJo/KQo 这类非同花牌大多要弃掉：被 UTG 的 AQ+/AK 主导的风险太高。',
      actions: {
        threebet: 'JJ+, AQs+, AKo, A5s:75, A4s:50, KQs:50, 76s:50, 65s:50, 54s:50',
        call: '77-TT, A2s-A3s, A4s:50, A5s:25, A6s-AJs, KTs-KJs, KQs:50, QTs-QJs, ' +
              'JTs, T9s, 98s, 87s, 76s:50, 65s:50, AJo-AQo, KQo, KJo:50'
      }
    },

    /* ============ 面对 3-Bet：4-Bet / 跟注 ============ */
    {
      id: 'utg-vs-bb3bet', group: 'vs3bet', name: 'UTG 开池后被 BB 3-Bet', hero: 'UTG', villain: 'BB',
      pot: 'UTG 开 2.5bb，BB 3-Bet 至 10bb',
      note: '你在全场的紧范围被大盲 3-Bet 后，需要继续用约 22% 的范围对抗。' +
            '4-Bet 用 KK+/AKs 做价值、A5s/A4s 做诈唬（因为阻断 AA/AK）。' +
            '跟注部分是 22-JJ 的小对子 + 同花 A + 同花连张：' +
            '这些牌能跑出暗三或坚果同花，即使被主导也有隐含赔率。' +
            '注意 AJo/KQo 这类牌多半要弃——面对 3-Bet 的胜率不够。',
      actions: {
        fourbet: 'KK+, AKs, AKo:75, A5s:75, A4s:50, QQ:50, JJ:25, KQs:25, ATs:25',
        call: '22-TT, JJ:75, QQ:50, A2s-A3s, A4s:50, A5s:25, A6s-A9s, ATs:75, AJs, K9s-KJs, ' +
              'KQs:75, ATs:75, Q9s-QJs, J9s-JTs, T8s-T9s, 97s-98s, 87s, 76s, 65s, 54s, ' +
              'AKo:25, AQo, AJo:75, KQo:25, KJo:50, ATo:50'
      }
    },
    {
      id: 'co-vs-bb3bet', group: 'vs3bet', name: 'CO 开池后被 BB 3-Bet', hero: 'CO', villain: 'BB',
      pot: 'CO 开 2.5bb，BB 3-Bet 至 10bb',
      note: 'CO 的范围比 UTG 宽，被 3-Bet 时需要「用更宽的范围防守，但更少 4-Bet」，' +
            '因为你原本的范围里有更多边缘牌。' +
            '4-Bet 依然极化（QQ+/AKs + A5s/A4s），但加上了 JJ:25、ATs:25 这类补充诈唬，' +
            '保证诈唬与价值比例不至于失衡（对手需要约 40% 的权益才不会亏）。',
      actions: {
        fourbet: 'QQ+, AKs, AKo:75, A5s:75, A4s:50, KQs:50, JJ:25, ATs:25, 76s:25',
        call: '22-TT, JJ:75, A2s-A3s, A4s:50, A5s:25, A6s-A9s, ATs:75, AJs, AQs, K8s-KJs, ' +
              'KQs:50, Q9s-QJs, J9s-JTs, T8s-T9s, 97s-98s, 86s-87s, 76s:75, 65s, 54s, ' +
              'AKo:25, ATo, AQo, AJo:75, KQo:75, KJo:75, QJo:50'
      }
    },
    {
      id: 'btn-vs-sb3bet', group: 'vs3bet', name: 'BTN 开池后被 SB 3-Bet', hero: 'BTN', villain: 'SB',
      pot: 'BTN 开 2.5bb，SB 3-Bet 至 10bb',
      note: 'SB 的 3-Bet 范围很宽（约 25%）且高度极化，你在按钮位有位置、' +
            '身后除了 3-Better 只剩大盲，所以能防守得非常宽（约 40%）。' +
            '策略重点：用大量同花牌跟注（有位置时同花牌权益实现率极高），' +
            '4-Bet 范围则在价值牌之外加入 22-66 这种「要么翻倍要么弃牌」的迷你诈唬。' +
            '记住：有位置 = 可以多跟注、少 4-Bet。',
      actions: {
        fourbet: 'AA, KK:50, QQ:50, JJ:50, TT:50, AQs:75, AKs, AKo, A5s:75, A4s:50, A3s:25, KQs:75, A9s:50, A8s:50, ' +
                  '22:75, 33:75, 44:50, 55:50, 66:50, 76s:50, 65s:50, 54s:50, AJo:50, KQo:50',
        call: '77-99, TT:50, JJ:50, QQ:50, KK:50, A2s, A3s:75, A4s:50, A5s:25, ' +
              'A6s-A7s, A8s:50, A9s:50, ATs-AJs, ' +
              'AQs:25, K3s-KJs, KQs:25, Q5s-QJs, QJs:50, J6s-J8s, J9s-JTs, T6s-T8s, ' +
              'T9s, 95s-98s, 84s-87s, 74s-75s, 76s:50, 63s-64s, 65s:50, 53s, 54s:50, 43s, ' +
              'A2o-A9o, ATo, AJo:50, AQo:50, K9o-KJo, KQo:50, Q9o-QJo, J9o-JTo, T9o, 98o:50'
      }
    },
    {
      id: 'btn-vs-bb3bet', group: 'vs3bet', name: 'BTN 开池后被 BB 3-Bet', hero: 'BTN', villain: 'BB',
      pot: 'BTN 开 2.5bb，BB 3-Bet 至 10bb',
      note: '大盲的 3-Bet 通常偏「两极化 + 宽」，而且它是唯一一个已经投过钱的对手。' +
            '你有位置，因此继续用约 38% 的范围对抗：4-Bet 约 15%，跟注约 23%。' +
            '和面对 SB 3-Bet 的区别是：BB 的范围里包含大量非同花强牌（AJo、KQo），' +
            '所以你更容易被「主导」，边缘牌要更谨慎。',
      actions: {
        fourbet: 'AA, KK:50, QQ:50, JJ:50, TT:50, AQs:75, AKs, AKo, A5s:75, A4s:50, A3s:25, KQs:75, A9s:50, A8s:50, ' +
                  '22:50, 33:50, 44:50, 55:50, 66:50, 77:50, 76s:50, 65s:50, 54s:50, ' +
                  'AQo:50, AJo:25',
        call: '88-99, TT:50, JJ:50, QQ:50, KK:50, 22:50, 33:50, 44:50, 55:50, 66:50, 77:50, ' +
              'A2s, A3s:75, A4s:50, A5s:25, A6s-A7s, A8s:50, A9s:50, ATs-AJs, AQs:25, ' +
              'K4s-KJs, KQs:25, Q6s-QJs, J7s-JTs, T7s-T9s, 96s-98s, 86s-87s, 75s, 76s:50, ' +
              '64s, 65s:50, 53s, 54s:50, A2o-A9o, ATo, AJo:75, AQo:50, KTo-KJo, ' +
              'KQo:50, QTo-QJo, JTo:75, T9o:75, 98o:50'
      }
    }
  ];

  /* --------------------------- 4. 图表构建器 --------------------------- */

  /** 把定义好的 chart 展开为 {hand: {action: freq, fold: freq}} 结构 + 统计信息 */
  function buildChart(def) {
    const perAction = {};
    const byHand = {};
    ALL_HANDS.forEach(h => { byHand[h] = {}; });

    Object.keys(def.actions).forEach(key => {
      perAction[key] = parseRange(def.actions[key]);
      Object.keys(perAction[key]).forEach(h => {
        if (!byHand[h]) return; // 防御：非法手牌
        byHand[h][key] = Math.max(byHand[h][key] || 0, perAction[key][h]);
      });
    });

    const stats = { combos: {}, pct: {}, total: 0, hands: {} };
    let totalCombos = 0;
    Object.keys(ACTIONS).forEach(k => { stats.combos[k] = 0; stats.pct[k] = 0; stats.hands[k] = 0; });

    ALL_HANDS.forEach(h => {
      const freq = {};
      let used = 0;
      Object.keys(def.actions).forEach(k => {
        const f = byHand[h][k] || 0;
        if (f > 0) { freq[k] = f; used += f; }
      });
      if (used > 0) {
        freq.fold = Math.max(0, 100 - used);
        byHand[h] = freq;
        const mult = combosOf(h) / 100;
        Object.keys(freq).forEach(k => {
          stats.combos[k] = (stats.combos[k] || 0) + combosOf(h) * freq[k] / 100;
          if (k !== 'fold' && freq[k] > 0) stats.hands[k] = (stats.hands[k] || 0) + 1;
        });
        totalCombos += combosOf(h) * used / 100;
      } else {
        byHand[h] = { fold: 100 };
      }
    });

    Object.keys(ACTIONS).forEach(k => {
      stats.combos[k] = Math.round((stats.combos[k] || 0) * 10) / 10;
      stats.pct[k] = Math.round((stats.combos[k] || 0) / TOTAL_COMBOS * 1000) / 10;
    });
    stats.total = Math.round(totalCombos * 10) / 10;
    stats.totalPct = Math.round(totalCombos / TOTAL_COMBOS * 1000) / 10;
    return { def, hands: byHand, stats };
  }

  const BUILT = {};
  const CHARTS_BUILT = CHARTS.map(def => {
    const c = buildChart(def);
    BUILT[def.id] = c;
    return c;
  });

  /* ---------------------------- 5. 对外接口 ---------------------------- */

  global.GTO = global.GTO || {};
  global.GTO.ranges = {
    RANKS, GRID, ALL_HANDS, ACTIONS, CHARTS, CHARTS_BUILT, BUILT,
    handName, parseHand, parseRange, expandToken, combosOf, buildChart, TOTAL_COMBOS,
    groups: [
      { key: 'rfi', label: '开池 (RFI)', hint: '无人入池，你是第一个加注的人' },
      { key: 'vsrfi', label: '面对开池', hint: '有人开池后，你的跟注 / 3-Bet 范围' },
      { key: 'vs3bet', label: '面对 3-Bet', hint: '你开池后被反击，如何 4-Bet / 跟注' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
