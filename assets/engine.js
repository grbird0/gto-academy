/* =========================================================================
 *  engine.js — 牌力评估 / 权益计算 / 赔率与 EV / 牌面质感
 *  纯函数模块，不依赖 DOM，可直接在 Node 中做单元测试。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ----------------------------- 1. 牌的表示 ----------------------------- */
  // 0..51 ：rank = c>>2（0='2' … 12='A'），suit = c&3（0=s 1=h 2=d 3=c）
  const RANK_CHARS = '23456789TJQKA';
  const SUIT_CHARS = 'shdc';
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAME = { s: '黑桃', h: '红心', d: '方块', c: '梅花' };

  function cardId(card) {
    if (typeof card === 'number') return card;
    const r = RANK_CHARS.indexOf(String(card[0]).toUpperCase());
    const s = SUIT_CHARS.indexOf(String(card[1]).toLowerCase());
    if (r < 0 || s < 0) return -1;
    return r * 4 + s;
  }
  function cardText(id) { return (id >= 0 && id <= 51) ? RANK_CHARS[id >> 2] + SUIT_CHARS[id & 3] : '--'; }
  function cardPretty(id) {
    if (id < 0 || id > 51) return '--';
    const r = RANK_CHARS[id >> 2] === 'T' ? '10' : RANK_CHARS[id >> 2];
    return r + SUIT_SYMBOL[SUIT_CHARS[id & 3]];
  }
  function rankText(r) { return RANK_CHARS[r] === 'T' ? '10' : RANK_CHARS[r]; }

  /** "AsKh" / "As,Kh" / ["As","Kh"] → {cards:[id...], error} */
  function parseCards(input) {
    const s = Array.isArray(input) ? input.join(' ') : String(input || '');
    const tokens = s.replace(/[,，]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
      if (t.length > 2 && t.length % 2 === 0) {
        for (let i = 0; i < t.length; i += 2) {
          const id = cardId(t.slice(i, i + 2));
          if (id < 0) return { cards: out, error: '无法识别：' + t.slice(i, i + 2) };
          out.push(id);
        }
      } else {
        const id = cardId(t);
        if (id < 0) return { cards: out, error: '无法识别：' + t };
        out.push(id);
      }
    }
    const seen = new Set();
    for (const c of out) {
      if (seen.has(c)) return { cards: out, error: '重复的牌：' + cardPretty(c) };
      seen.add(c);
    }
    return { cards: out, error: null };
  }

  /** 手牌记号 → 具体两张牌，例如 AKs → ♠A ♠K */
  function handNotationToCards(notation) {
    const n = String(notation || '').trim();
    if (n.length < 2) return null;
    const r1 = RANK_CHARS.indexOf(n[0].toUpperCase());
    const r2 = RANK_CHARS.indexOf(n[1].toUpperCase());
    if (r1 < 0 || r2 < 0) return null;
    const type = n.length > 2 ? n[2].toLowerCase() : 'p';
    if (type === 'p' || r1 === r2) return [r1 * 4, r2 * 4 + 1];
    if (type === 's') return [r1 * 4, r2 * 4];
    return [r1 * 4, r2 * 4 + 1];
  }

  /** 某手牌记号的全部花色组合 */
  function allCombos(hand, dead) {
    const r1 = RANK_CHARS.indexOf(hand[0].toUpperCase());
    const r2 = RANK_CHARS.indexOf(hand[1].toUpperCase());
    if (r1 < 0 || r2 < 0) return [];
    const type = hand.length > 2 ? hand[2].toLowerCase() : 'p';
    const out = [];
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        if (type === 'p') { if (s1 >= s2) continue; }
        else if (type === 's') { if (s1 !== s2) continue; }
        else { if (s1 === s2) continue; }
        const a = r1 * 4 + s1, b = r2 * 4 + s2;
        if (dead && (dead.has(a) || dead.has(b))) continue;
        out.push([a, b]);
      }
    }
    return out;
  }

  /* --------------------------- 2. 牌力评估核心 --------------------------- */

  const CATEGORY = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
  const B5 = 371293;                       // 13^5
  const P4 = 28561, P3 = 2197, P2 = 169;   // 13^4, 13^3, 13^2

  const STRAIGHT_HIGH = new Int8Array(1 << 13).fill(-1);
  (function buildStraightTable() {
    const wheel = (1 << 12) | 0b1111;      // A 2 3 4 5
    for (let mask = 0; mask < (1 << 13); mask++) {
      let high = -1;
      for (let top = 12; top >= 4; top--) {
        const need = 0b11111 << (top - 4);
        if ((mask & need) === need) { high = top; break; }
      }
      if (high < 0 && (mask & wheel) === wheel) high = 3; // 最大牌是 5
      STRAIGHT_HIGH[mask] = high;
    }
  })();

  const _rc = new Int32Array(13);
  const _sc = new Int32Array(4);
  const _srb = new Int32Array(4);

  /** 5~7 张牌的最佳牌型分数，越大越强 */
  function score(cards, n) {
    n = n || cards.length;
    _rc.fill(0); _sc[0] = _sc[1] = _sc[2] = _sc[3] = 0;
    _srb[0] = _srb[1] = _srb[2] = _srb[3] = 0;
    let rankMask = 0;
    for (let k = 0; k < n; k++) {
      const c = cards[k], r = c >> 2, s = c & 3;
      _rc[r]++; _sc[s]++; _srb[s] |= 1 << r; rankMask |= 1 << r;
    }
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (_sc[s] >= 5) { flushSuit = s; break; }
    if (flushSuit >= 0) {
      const fm = _srb[flushSuit];
      const sf = STRAIGHT_HIGH[fm];
      if (sf >= 0) return 8 * B5 + sf;
      const d = [];
      for (let r = 12; r >= 0; r--) if (fm & (1 << r)) d.push(r);
      return 5 * B5 + d[0] * P4 + d[1] * P3 + d[2] * P2 + d[3] * 13 + d[4];
    }
    let quad = -1; const trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      const c = _rc[r];
      if (c === 4) quad = r;
      else if (c === 3) trips.push(r);
      else if (c === 2) pairs.push(r);
    }
    if (quad >= 0) {
      let kick = 0;
      for (let r = 12; r >= 0; r--) if (r !== quad && _rc[r] > 0) { kick = r; break; }
      return 7 * B5 + quad * P4 + kick * P3;
    }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const t = trips[0];
      const p = trips.length > 1 ? trips[1] : pairs[0];
      return 6 * B5 + t * P4 + p * P3;
    }
    const st = STRAIGHT_HIGH[rankMask];
    if (st >= 0) return 4 * B5 + st;
    if (trips.length) {
      const t = trips[0]; let k1 = -1, k2 = -1;
      for (let r = 12; r >= 0; r--) {
        if (r !== t && _rc[r] > 0) { if (k1 < 0) k1 = r; else { k2 = r; break; } }
      }
      return 3 * B5 + t * P4 + k1 * P3 + k2 * P2;
    }
    if (pairs.length >= 2) {
      const p1 = pairs[0], p2 = pairs[1]; let k = -1;
      for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && _rc[r] > 0) { k = r; break; }
      return 2 * B5 + p1 * P4 + p2 * P3 + k * P2;
    }
    if (pairs.length === 1) {
      const p = pairs[0]; const ks = [];
      for (let r = 12; r >= 0 && ks.length < 3; r--) if (r !== p && _rc[r] > 0) ks.push(r);
      return 1 * B5 + p * P4 + ks[0] * P3 + ks[1] * P2 + ks[2] * 13;
    }
    const top = [];
    for (let r = 12; r >= 0 && top.length < 5; r--) if (_rc[r] > 0) top.push(r);
    return top[0] * P4 + top[1] * P3 + top[2] * P2 + top[3] * 13 + top[4];
  }

  function describeScore(sc) {
    const cat = Math.floor(sc / B5);
    const rest = sc - cat * B5;
    if (cat === 8) return '同花顺（' + rankText(rest) + ' 高）';
    if (cat === 4) return '顺子（' + rankText(rest) + ' 高）';
    const d = [];
    for (let i = 0; i < 5; i++) d.push(Math.floor(rest / Math.pow(13, 4 - i)) % 13);
    const R = rankText;
    switch (cat) {
      case 7: return '四条（' + R(d[0]) + '）带 ' + R(d[1]);
      case 6: return '葫芦（' + R(d[0]) + ' 满 ' + R(d[1]) + '）';
      case 5: return '同花（' + R(d[0]) + ' 高）';
      case 3: return '三条（' + R(d[0]) + '）';
      case 2: return '两对（' + R(d[0]) + ' 与 ' + R(d[1]) + '）';
      case 1: return '一对（' + R(d[0]) + '）';
      default: return '高牌（' + R(d[0]) + '）';
    }
  }
  function categoryName(sc) { return CATEGORY[Math.floor(sc / B5)]; }

  /* ----------------------------- 3. 随机源 ----------------------------- */
  /** 可复现的伪随机数（xorshift32）：相同种子得到相同结果，便于教学复现 */
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* --------------------------- 4. 权益计算 --------------------------- */
  function buildRangeSampler(freqMap, dead) {
    const hands = [], cum = [];
    let total = 0;
    Object.keys(freqMap).forEach(h => {
      const f = freqMap[h];
      if (f <= 0) return;
      const combos = allCombos(h, dead);
      if (!combos.length) return;
      const w = combos.length * f / 100;
      hands.push({ hand: h, combos });
      total += w; cum.push(total);
    });
    return { hands, cum, total };
  }

  function sampleSampler(sampler, used, rng) {
    if (!sampler.total) return null;
    for (let att = 0; att < 80; att++) {
      const x = rng() * sampler.total;
      let lo = 0, hi = sampler.cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sampler.cum[mid] < x) lo = mid + 1; else hi = mid; }
      const set = sampler.hands[lo].combos;
      const c = set[Math.floor(rng() * set.length)];
      if (!used.has(c[0]) && !used.has(c[1])) {
        used.add(c[0]); used.add(c[1]);
        return { hand: sampler.hands[lo].hand, cards: c };
      }
    }
    return null;
  }

  /**
   * Monte Carlo 权益模拟
   * players: [{ cards:[id,id] | null, range:{hand:freq} | null, name }]
   * board:   已知公共牌 id 数组（0/3/4/5 张）
   * 返回权益、胜率、平局率与若干示例牌局
   */
  function simulate(players, board, iterations, seed) {
    const rng = makeRng(seed || 20261013);
    board = board || [];
    const n = players.length;
    const need = 5 - board.length;
    const baseDead = new Set(board);
    players.forEach(p => { if (p.cards) p.cards.forEach(c => baseDead.add(c)); });

    const pool = [];
    for (let i = 0; i < 52; i++) if (!baseDead.has(i)) pool.push(i);
    const work = pool.slice();
    const runout = new Array(need);

    const samplers = players.map(p => p.cards ? null : buildRangeSampler(p.range || {}, baseDead));
    players.forEach((p, i) => {
      if (!p.cards && (!samplers[i] || !samplers[i].total)) {
        return { error: '第 ' + (i + 1) + ' 位玩家的范围为空' };
      }
    });

    const win = new Array(n).fill(0), tie = new Array(n).fill(0), eq = new Array(n).fill(0);
    const hole = new Array(n), full = new Array(n);
    const samples = [];
    let used = 0;

    for (let it = 0; it < iterations; it++) {
      for (let k = 0; k < pool.length; k++) work[k] = pool[k];
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(rng() * (pool.length - k));
        const tmp = work[k]; work[k] = work[j]; work[j] = tmp;
        runout[k] = work[k];
      }
      const boardFull = board.concat(runout);
      const usedNow = new Set(boardFull);
      let ok = true;
      for (let i = 0; i < n; i++) {
        const p = players[i];
        if (p.cards) {
          hole[i] = p.cards;
          p.cards.forEach(c => usedNow.add(c));
        } else {
          const got = sampleSampler(samplers[i], usedNow, rng);
          if (!got) { ok = false; break; }
          hole[i] = got.cards;
        }
      }
      if (!ok) continue;
      used++;
      let best = -1;
      const sc = new Array(n);
      for (let i = 0; i < n; i++) {
        full[i] = hole[i].concat(boardFull);
        sc[i] = score(full[i], full[i].length);
        if (sc[i] > best) best = sc[i];
      }
      const winners = [];
      for (let i = 0; i < n; i++) if (sc[i] === best) winners.push(i);
      if (winners.length === 1) { win[winners[0]]++; eq[winners[0]]++; }
      else winners.forEach(i => { tie[i]++; eq[i] += 1 / winners.length; });

      if (samples.length < 3 && it % 41 === 0) {
        samples.push({
          holes: hole.map(h => h.slice()),
          board: boardFull.slice(),
          winners: winners.slice(),
          desc: winners.map(i => describeScore(sc[i])).join(' / ')
        });
      }
    }

    const d = used || 1;
    return {
      iterations: used,
      requested: iterations,
      equity: eq.map(v => v / d),
      win: win.map(v => v / d),
      tie: tie.map(v => v / d),
      samples,
      error: null
    };
  }

  /**
   * 两手已知牌 + 已知公共牌的精确枚举（不抽样，结果 100% 准确）
   * 通过 onProgress/onDone 分片执行，避免阻塞界面。
   */
  function exactEquity(h1, h2, board, onProgress, onDone, chunk) {
    const dead = new Set(board);
    h1.forEach(c => dead.add(c));
    h2.forEach(c => dead.add(c));
    const avail = [];
    for (let i = 0; i < 52; i++) if (!dead.has(i)) avail.push(i);
    const need = 5 - board.length;
    const size = avail.length;
    let combosTotal = 1;
    for (let k = 0; k < need; k++) combosTotal = combosTotal * (size - k) / (k + 1);
    combosTotal = Math.round(combosTotal);

    let done = 0, win1 = 0, win2 = 0, tie = 0;
    const idx = [];
    for (let k = 0; k < need; k++) idx.push(k);
    let finished = need === 0;
    const b = board.slice();
    const per = chunk || 40000;

    function processBatch() {
      let count = 0;
      while (count < per) {
        if (finished) break;
        const runout = idx.map(i => avail[i]);
        const boardFull = b.concat(runout);
        const s1 = score(h1.concat(boardFull), 7);
        const s2 = score(h2.concat(boardFull), 7);
        if (s1 > s2) win1++;
        else if (s2 > s1) win2++;
        else tie++;
        done++;
        count++;
        // 推进组合
        let k = need - 1;
        while (k >= 0 && idx[k] === size - (need - k)) k--;
        if (k < 0) { finished = true; break; }
        idx[k]++;
        for (let j = k + 1; j < need; j++) idx[j] = idx[j - 1] + 1;
      }
      if (onProgress) onProgress(done / combosTotal);
      if (!finished) setTimeout(processBatch, 0);
      else {
        const d = done || 1;
        onDone({ iterations: done, exact: true, win: [win1 / d, win2 / d], tie: [tie / d, tie / d], equity: [(win1 + tie / 2) / d, (win2 + tie / 2) / d] });
      }
    }
    if (need === 0) {
      const s1 = score(h1.concat(board), 7), s2 = score(h2.concat(board), 7);
      const w1 = s1 > s2 ? 1 : 0, w2 = s2 > s1 ? 1 : 0, t = s1 === s2 ? 1 : 0;
      onDone({ iterations: 1, exact: true, win: [w1, w2], tie: [t, t], equity: [w1 + t / 2, w2 + t / 2] });
      return;
    }
    setTimeout(processBatch, 0);
  }

  /* ------------------ 5. 底池赔率 / MDF / EV 计算 ------------------ */
  const potOdds = (pot, bet, call) => { const c = call === undefined ? bet : call; return c / (pot + bet + c); };
  const mdf = (pot, bet) => pot / (pot + bet);
  const alpha = (pot, bet) => bet / (pot + bet);
  const callEV = (pot, bet, equity) => equity * (pot + bet) - (1 - equity) * bet;
  const shoveEV = (pot, bet, eqCalled, fe) => fe * pot + (1 - fe) * (eqCalled * (pot + bet) - (1 - eqCalled) * bet);
  /** 补牌 → 成牌概率（streets=1 只发一张，=2 发两张） */
  function outsToEquity(outs, streets) {
    if (streets === 1) return outs / 47;
    return 1 - ((47 - outs) / 47) * ((46 - outs) / 46);
  }

  /* --------------------------- 6. 牌面质感分析 --------------------------- */
  function analyzeBoard(boardIds) {
    const ids = boardIds.slice();
    const rankIdx = ids.map(c => c >> 2).sort((a, b) => b - a);
    const suitCount = [0, 0, 0, 0];
    ids.forEach(c => suitCount[c & 3]++);
    const maxSuit = Math.max.apply(null, suitCount);
    const counts = {};
    rankIdx.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const repeats = Object.values(counts).filter(v => v > 1);
    const paired = repeats.length > 0;
    const trips = Object.values(counts).some(v => v >= 3);
    const twoPair = repeats.length >= 2;

    const gaps = [];
    for (let i = 1; i < rankIdx.length; i++) gaps.push(rankIdx[i - 1] - rankIdx[i]);
    const span = rankIdx[0] - rankIdx[rankIdx.length - 1];
    const maxGap = gaps.length ? Math.max.apply(null, gaps) : 0;
    const adjacentPairs = gaps.filter(g => g === 1).length;
    const hasAce = rankIdx[0] === 12;
    const wheelAce = hasAce && rankIdx[1] <= 3;   // 例如 A 4 5
    let connected;
    if (maxGap <= 2) connected = { label: '高度连接', desc: '三张牌挤在很小的区间里，两头顺、卡顺、暗三听牌同时存在，翻后波动最大。' };
    else if (adjacentPairs >= 1) connected = { label: '中等连接', desc: '至少有一对相邻的牌，会出现卡顺或双头听牌（例如 QJ2、AK7 这类结构）。' };
    else connected = { label: '分散', desc: '三张牌彼此都不相邻，很难同时成顺，顺子听牌基本不存在。' };
    if (wheelAce) connected.desc += ' A 能与 2/3/4/5 组成轮子顺（A2345）。';

    let flushDesc;
    if (maxSuit >= 3 && ids.length === 3) flushDesc = { label: '天花面', desc: '三张同花色：已经成同花，同花听牌也大量存在。' };
    else if (maxSuit === 2) flushDesc = { label: '两同花', desc: '两张同花色：有同花听牌，需要留意转牌花色。' };
    else flushDesc = { label: '彩虹面', desc: '三张不同花色：没有同花听牌，是最干的牌面之一。' };

    let pairedDesc;
    if (trips) pairedDesc = { label: '三条面', desc: '牌面出现三条，只有口袋对子能成葫芦，下注频率会显著降低。' };
    else if (twoPair) pairedDesc = { label: '两对', desc: '两张成对（如 AAKK），范围优势会向跟注方倾斜。' };
    else if (paired) pairedDesc = { label: '对子面', desc: '有一对：整体命中率提高，但强牌组合变少，适合高频小尺度下注。' };
    else pairedDesc = { label: '无对子', desc: '没有对子：牌面最「干净」，下注方可以主导。' };

    const high = rankIdx[0];
    const highDesc = high === 12
      ? { label: 'A 高', desc: 'A 高的牌面：开池方的范围里有更多强 A，通常拥有明显的范围优势。' }
      : (high <= 7
        ? { label: rankText(high) + ' 高', desc: '低牌面：跟注方（尤其大盲）命中更多两对与暗三，开池方的 c-bet 频率需要下降。' }
        : { label: rankText(high) + ' 高', desc: '中等高张牌面，双方范围都有命中，属于比较中性的一类。' });

    // 湿润度评分：同花潜力 + 顺子潜力 - 对子扣分
    const flushScore = (maxSuit >= 3 && ids.length === 3) ? 2 : (maxSuit === 2 ? 1 : 0);
    const straightScore = maxGap <= 2 ? 2 : (adjacentPairs >= 1 ? 1 : 0);
    const wet = flushScore + straightScore - (paired ? 1 : 0);
    const texture = wet >= 3 ? '湿润' : (wet <= 0 ? '干燥' : '中等');

    const cbetHint = texture === '湿润'
      ? '湿润面建议提高过牌比例、使用较大尺度（66%~100% 底池），因为对手的听牌权益很高，需要让他们为看牌付出代价。'
      : texture === '干燥'
        ? '干燥面适合高频小尺度（25%~33% 底池）下注，用整个范围施压，对手很难找到足够的防守牌。'
        : '中等湿润面通常用混合尺度：强牌用大尺度拿价值，边缘牌用小尺度保持范围平衡。';

    return {
      ids, rankIdx, suitCount, paired, trips, twoPair, span, maxGap, wet,
      high, connected, flushDesc, pairedDesc, highDesc, texture, cbetHint,
      labels: [pairedDesc.label, flushDesc.label, connected.label, highDesc.label]
    };
  }

  global.GTO = global.GTO || {};
  global.GTO.engine = {
    RANK_CHARS, SUIT_CHARS, SUIT_SYMBOL, SUIT_NAME, CATEGORY,
    cardId, cardText, cardPretty, rankText, parseCards, handNotationToCards, allCombos,
    score, describeScore, categoryName, makeRng,
    buildRangeSampler, sampleSampler, simulate, exactEquity,
    potOdds, mdf, alpha, callEV, shoveEV, outsToEquity, analyzeBoard
  };
})(typeof window !== 'undefined' ? window : globalThis);
