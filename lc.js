/**
 * PHẠM KHÔI • ULTRA VIP ENGINE v6.0
 * Thuật toán: Recent-First + Strong Mean-Reversion + Anti-Loss Aggressive
 * UI: Premium Cyber Neon (màu cao cấp, mượt, không lỗi)
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_HU  = 'https://wtx.tele68.com/v1/tx/sessions';
const API_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

const LEARNING_FILE = 'phamkhoi.json';
const HISTORY_FILE  = 'phamkhoi1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 400;
const AUTO_INTERVAL = 11500;
let lastProcessed = { hu: null, md5: null };
let learningData = { hu: emptyL(), md5: emptyL() };

function emptyL() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    recentWrongStreak: 0,
    lastPredDirection: null,
    patternMemory: {},
    expertPerformance: {
      markov:  { correct: 0, total: 0, recent: [] },
      pattern: { correct: 0, total: 0, recent: [] },
      streak:  { correct: 0, total: 0, recent: [] },
      dice:    { correct: 0, total: 0, recent: [] },
      balance: { correct: 0, total: 0, recent: [] },
      cycle:   { correct: 0, total: 0, recent: [] },
      trend:   { correct: 0, total: 0, recent: [] }
    },
    lastDecay: Date.now()
  };
}

function loadL() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = {
        hu:  { ...emptyL(), ...(loaded.hu  || {}) },
        md5: { ...emptyL(), ...(loaded.md5 || {}) }
      };
      ['hu', 'md5'].forEach(t => {
        if (!learningData[t].patternMemory) learningData[t].patternMemory = {};
        if (!learningData[t].expertPerformance) learningData[t].expertPerformance = emptyL().expertPerformance;
        Object.keys(learningData[t].expertPerformance).forEach(k => {
          if (!Array.isArray(learningData[t].expertPerformance[k].recent)) {
            learningData[t].expertPerformance[k].recent = [];
          }
        });
      });
      console.log('[Load] Learning OK');
    }
  } catch (e) { console.error('[loadL]', e.message); }
}

function saveL() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); }
  catch (e) { console.error('[saveL]', e.message); }
}

function loadH() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const p = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = p.history || { hu: [], md5: [] };
      lastProcessed = p.lastProcessedPhien || { hu: null, md5: null };
      ['hu', 'md5'].forEach(t => {
        const seen = new Set();
        predictionHistory[t] = (predictionHistory[t] || []).filter(r => {
          if (seen.has(String(r.Phien_hien_tai))) return false;
          seen.add(String(r.Phien_hien_tai));
          return true;
        });
      });
      console.log('[Load] History HU:' + predictionHistory.hu.length + ' | MD5:' + predictionHistory.md5.length);
    }
  } catch (e) { console.error('[loadH]', e.message); }
}

function saveH() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien: lastProcessed,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) { console.error('[saveH]', e.message); }
}

function transform(api) {
  if (!api || !Array.isArray(api.list) || api.list.length === 0) return null;
  return api.list
    .filter(i => i && i.id && Array.isArray(i.dices) && i.dices.length === 3 && i.resultTruyenThong)
    .map(i => ({
      Phien: i.id,
      Ket_qua: i.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
      Xuc_xac_1: i.dices[0],
      Xuc_xac_2: i.dices[1],
      Xuc_xac_3: i.dices[2],
      Tong: i.point
    }));
}

async function fetchHu() {
  try {
    const r = await axios.get(API_HU, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    console.error('[HU]', e.message);
    return null;
  }
}

async function fetchMd5() {
  try {
    const r = await axios.get(API_MD5, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    console.error('[MD5]', e.message);
    return null;
  }
}

// ===================== CORE ANALYZE v6 – SIÊU CHUẨN =====================
function analyze(data, type) {
  if (!data || data.length < 25) {
    return {
      prediction: 'Xỉu',
      confidence: 54,
      factors: ['Thiếu dữ liệu'],
      reasons: ['Cần ≥25 phiên'],
      experts: {},
      agree: '-'
    };
  }

  // index 0 = mới nhất
  const R = data.map(d => d.Ket_qua === 'Tài' ? 1 : 0);
  const H = [...R].reverse();
  const dice = data.map(d => ({
    faces: [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3],
    sum: d.Tong,
    result: d.Ket_qua === 'Tài' ? 1 : 0
  }));

  const mem = learningData[type].patternMemory || {};
  const expPerf = learningData[type].expertPerformance || emptyL().expertPerformance;

  // Time-decay mạnh hơn
  const now = Date.now();
  if (!learningData[type].lastDecay || now - learningData[type].lastDecay > 2.5 * 3600 * 1000) {
    Object.keys(mem).forEach(k => {
      if (mem[k].hangLen > 1) mem[k].hangLen = Math.max(1, Math.floor(mem[k].hangLen * 0.75));
      if (mem[k].count > 2) mem[k].count = Math.max(1, Math.floor(mem[k].count * 0.82));
    });
    learningData[type].lastDecay = now;
  }

  // Weight dựa trên recent 18 phiên
  function dynamicWeight(base, key) {
    const p = expPerf[key] || { correct: 0, total: 0, recent: [] };
    const recent = p.recent || [];
    if (recent.length < 10) return base * 0.9;
    const recentAcc = recent.reduce((a, b) => a + b, 0) / recent.length;
    let m = 0.45 + recentAcc * 1.15;
    if (recentAcc < 0.40) m *= 0.45;
    else if (recentAcc < 0.48) m *= 0.70;
    return base * m;
  }

  // ---------- 1. STREAK (ưu tiên cao nhất – bẻ mạnh) ----------
  function expertStreak() {
    let streak = 1;
    for (let i = 1; i < R.length; i++) {
      if (R[i] === R[0]) streak++; else break;
    }
    const val = R[0];

    let alt = 1;
    for (let i = 1; i < Math.min(R.length, 18); i++) {
      if (R[i] !== R[i - 1]) alt++; else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    // Logic bẻ cực mạnh khi bệt dài
    if (streak === 1) {
      // không cộng
    } else if (streak === 2) {
      const w = 1.8; if (val === 1) scoreT += w; else scoreX += w;
      details.push('Bệt2 theo');
    } else if (streak === 3) {
      const w = 2.6; if (val === 1) scoreT += w; else scoreX += w;
      details.push('Bệt3 theo');
    } else if (streak === 4) {
      const w = 1.2; if (val === 1) scoreT += w; else scoreX += w;
      details.push('Bệt4 thận');
    } else if (streak === 5) {
      const w = 3.8; if (val === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ bệt5');
    } else if (streak >= 6) {
      const w = 4.6 + Math.min(2.5, (streak - 6) * 0.55);
      if (val === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ bệt' + streak);
    }

    // Cầu đảo
    if (alt >= 5 && alt <= 7) {
      const w = 2.7; if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Đảo' + alt);
    } else if (alt >= 8) {
      const w = 1.6; if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push('Đứt đảo');
    }

    // Cầu cố định ngắn
    const last6 = R.slice(0, 6).join('');
    if (['110011', '001100', '101010', '010101'].includes(last6)) {
      const w = 2.4; if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Cầu cố định');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.58 + Math.abs(scoreT - scoreX) / total * 0.40;
    return {
      pred, conf: Math.min(0.93, conf),
      weight: dynamicWeight(3.10, 'streak'),
      details, scoreT, scoreX
    };
  }

  // ---------- 2. DICE (ưu tiên gần) ----------
  function expertDice() {
    const recent = dice.slice(0, 30);
    if (recent.length < 18) {
      return { pred: 0, conf: 0.53, weight: dynamicWeight(1.9, 'dice'), details: ['Dice thiếu'], scoreT: 0.5, scoreX: 0.5 };
    }

    const avg = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const avg20 = avg(recent.slice(0, 20).map(d => d.sum));
    const avg12 = avg(recent.slice(0, 12).map(d => d.sum));
    const avg8  = avg(recent.slice(0, 8).map(d => d.sum));
    const avg5  = avg(recent.slice(0, 5).map(d => d.sum));

    let high = 0, low = 0, totF = 0;
    recent.slice(0, 20).forEach(d => {
      d.faces.forEach(f => {
        if (f >= 1 && f <= 6) { totF++; if (f >= 4) high++; else low++; }
      });
    });
    const highR = high / (totF || 1);

    let consecH = 0, consecL = 0;
    for (let i = 0; i < 10; i++) {
      if (recent[i].sum >= 12) consecH++; else break;
    }
    for (let i = 0; i < 10; i++) {
      if (recent[i].sum <= 9) consecL++; else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    // Mean reversion mạnh trên sum
    if (avg20 >= 12.7) { scoreX += 3.0; details.push('Sum20 cao'); }
    else if (avg20 <= 8.3) { scoreT += 3.0; details.push('Sum20 thấp'); }
    else if (avg20 >= 11.9) { scoreX += 1.5; details.push('Sum20 hơi cao'); }
    else if (avg20 <= 9.1) { scoreT += 1.5; details.push('Sum20 hơi thấp'); }

    if (avg12 >= 13.1) { scoreX += 2.1; details.push('Sum12 rất cao'); }
    else if (avg12 <= 7.9) { scoreT += 2.1; details.push('Sum12 rất thấp'); }

    if (avg8 >= 13.4) { scoreX += 1.7; details.push('Sum8 nóng'); }
    else if (avg8 <= 7.6) { scoreT += 1.7; details.push('Sum8 lạnh'); }

    if (avg5 >= 14.0) { scoreX += 1.4; details.push('Sum5 cực cao'); }
    else if (avg5 <= 7.0) { scoreT += 1.4; details.push('Sum5 cực thấp'); }

    if (highR >= 0.60) { scoreX += 2.2; details.push('Mặt cao'); }
    else if (highR <= 0.40) { scoreT += 2.2; details.push('Mặt thấp'); }

    if (consecH >= 3) {
      scoreX += 2.0 + (consecH - 3) * 0.4;
      details.push('Cao liên' + consecH);
    }
    if (consecL >= 3) {
      scoreT += 2.0 + (consecL - 3) * 0.4;
      details.push('Thấp liên' + consecL);
    }

    const last = recent[0].sum;
    if (last >= 16) { scoreX += 1.8; details.push('Cực cao'); }
    else if (last <= 5) { scoreT += 1.8; details.push('Cực thấp'); }
    else if (last >= 14) { scoreX += 1.0; details.push('Cao'); }
    else if (last <= 7) { scoreT += 1.0; details.push('Thấp'); }

    // Lệch Tài/Xỉu gần
    const last18 = recent.slice(0, 18).map(d => d.result);
    const tai18 = last18.filter(x => x === 1).length;
    if (tai18 >= 13) { scoreX += 2.5; details.push('LệchT mạnh'); }
    else if (tai18 <= 5) { scoreT += 2.5; details.push('LệchX mạnh'); }
    else if (tai18 >= 12) { scoreX += 1.4; details.push('LệchT'); }
    else if (tai18 <= 6) { scoreT += 1.4; details.push('LệchX'); }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred, conf: Math.min(0.92, 0.58 + dom * 0.40),
      weight: dynamicWeight(3.00, 'dice'),
      details: details.slice(0, 5), scoreT, scoreX
    };
  }

  // ---------- 3. TREND + MEAN REVERSION (gần) ----------
  function expertTrend() {
    const last15 = R.slice(0, 15);
    const last10 = R.slice(0, 10);
    const last6  = R.slice(0, 6);
    const last4  = R.slice(0, 4);

    const tai15 = last15.filter(x => x === 1).length;
    const tai10 = last10.filter(x => x === 1).length;
    const tai6  = last6.filter(x => x === 1).length;
    const tai4  = last4.filter(x => x === 1).length;

    let scoreT = 0, scoreX = 0;
    const details = [];

    // Mean reversion ưu tiên
    if (tai15 >= 11) { scoreX += 2.8; details.push('ReversionT15'); }
    else if (tai15 <= 4) { scoreT += 2.8; details.push('ReversionX15'); }
    else if (tai15 >= 10) { scoreX += 1.6; details.push('ReversionT'); }
    else if (tai15 <= 5) { scoreT += 1.6; details.push('ReversionX'); }

    if (tai10 >= 8) { scoreX += 2.0; details.push('ReversionT10'); }
    else if (tai10 <= 2) { scoreT += 2.0; details.push('ReversionX10'); }

    // Momentum ngắn
    if (tai4 >= 4) { scoreX += 1.9; details.push('MomentumT4'); }
    else if (tai4 <= 0) { scoreT += 1.9; details.push('MomentumX4'); }

    if (tai6 >= 5) { scoreX += 1.5; details.push('MomentumT6'); }
    else if (tai6 <= 1) { scoreT += 1.5; details.push('MomentumX6'); }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.56 + Math.abs(scoreT - scoreX) / total * 0.38;
    return {
      pred, conf,
      weight: dynamicWeight(2.70, 'trend'),
      details, scoreT, scoreX
    };
  }

  // ---------- 4. MARKOV (chỉ gần) ----------
  function expertMarkov() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    const orders = [
      { o: 1, baseW: 1.3 },
      { o: 2, baseW: 2.2 },
      { o: 3, baseW: 2.8 },
      { o: 4, baseW: 3.0 }
    ];
    for (const { o, baseW } of orders) {
      if (H.length < o + 25) continue;
      const pat = H.slice(-o).join('');
      let t = 0, x = 0;
      // chỉ 70 phiên gần nhất
      const start = Math.max(0, H.length - 70);
      for (let i = start; i <= H.length - o - 1; i++) {
        if (H.slice(i, i + o).join('') === pat) {
          if (H[i + o] === 1) t++; else x++;
        }
      }
      const tot = t + x;
      if (tot < 4) continue;
      const pT = t / tot;
      const conf = 0.55 + Math.abs(pT - 0.5) * 0.95;
      const w = baseW * conf * Math.min(1.3, tot / 7);
      if (pT >= 0.52) scoreT += w;
      else if (pT <= 0.48) scoreX += w;
      details.push('M' + o + ':' + (pT >= 0.5 ? 'T' : 'X') + '(' + Math.round(conf * 100) + '%)');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred, conf: Math.min(0.90, 0.55 + dom * 0.40),
      weight: dynamicWeight(2.60, 'markov'),
      details: details.slice(0, 3), scoreT, scoreX
    };
  }

  // ---------- 5. PATTERN ----------
  function expertPattern() {
    let bestLen = 0, next = null, matches = 0, memBoost = 0;
    for (let len = Math.min(10, H.length - 5); len >= 3; len--) {
      const suffix = H.slice(-len).join('');
      let t = 0, x = 0;
      const start = Math.max(0, H.length - 80);
      for (let i = start; i <= H.length - len - 1; i++) {
        if (H.slice(i, i + len).join('') === suffix) {
          if (H[i + len] === 1) t++; else x++;
        }
      }
      const tot = t + x;
      if (tot >= 3) {
        bestLen = len;
        next = t >= x ? 1 : 0;
        matches = tot;
        if (mem[suffix]) {
          const m = mem[suffix];
          memBoost = Math.min(1.8, (m.hangLen || 0) * 0.15 + (m.count || 0) * 0.08);
          if (m.success > m.fail) memBoost += 0.35;
        }
        break;
      }
    }
    if (bestLen === 0) {
      return { pred: R[0], conf: 0.52, weight: dynamicWeight(1.4, 'pattern'), details: ['Pattern yếu'], scoreT: 0.5, scoreX: 0.5 };
    }
    const conf = 0.57 + Math.min(0.22, bestLen * 0.015) + Math.min(0.12, matches * 0.012) + memBoost * 0.07;
    return {
      pred: next,
      conf: Math.min(0.88, conf),
      weight: dynamicWeight(2.20 + memBoost * 0.4, 'pattern'),
      details: ['Ptn' + bestLen + '→' + (next === 1 ? 'T' : 'X')],
      scoreT: next === 1 ? conf : 1 - conf,
      scoreX: next === 0 ? conf : 1 - conf
    };
  }

  // ---------- 6. BALANCE ----------
  function expertBalance() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    [12, 18, 28].forEach(w => {
      if (R.length < w) return;
      const slice = R.slice(0, w);
      const tai = slice.filter(x => x === 1).length;
      const ratio = tai / w;
      if (ratio >= 0.70) {
        scoreX += 1.9 * (w / 18);
        details.push('LệchT' + w);
      } else if (ratio <= 0.30) {
        scoreT += 1.9 * (w / 18);
        details.push('LệchX' + w);
      }
    });
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.54 + Math.abs(scoreT - scoreX) / total * 0.34;
    return {
      pred, conf,
      weight: dynamicWeight(1.80, 'balance'),
      details: details.slice(0, 3), scoreT, scoreX
    };
  }

  // ---------- 7. CYCLE ----------
  function expertCycle() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    let bestSc = 0, cyclePred = null, bestP = 0;
    for (const p of [2, 3, 4, 5, 6]) {
      if (R.length < p * 7) continue;
      let match = 0;
      const chk = p * 4;
      for (let i = 0; i < chk; i++) {
        if (R[i] === R[i + p]) match++;
      }
      const sc = match / chk;
      if (sc > 0.72 && sc > bestSc) {
        bestSc = sc;
        cyclePred = R[p - 1];
        bestP = p;
      }
    }
    if (cyclePred !== null) {
      const w = 2.3 * bestSc;
      if (cyclePred === 1) scoreT += w; else scoreX += w;
      details.push('Chu kỳ ' + bestP);
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.53 + Math.abs(scoreT - scoreX) / total * 0.35;
    return {
      pred, conf,
      weight: dynamicWeight(1.70, 'cycle'),
      details, scoreT, scoreX
    };
  }

  // ===================== TỔNG HỢP – ƯU TIÊN GẦN + BẺ THUA =====================
  const s  = expertStreak();
  const d  = expertDice();
  const tr = expertTrend();
  const m  = expertMarkov();
  const p  = expertPattern();
  const b  = expertBalance();
  const c  = expertCycle();

  let finalT = 0, finalX = 0;
  const factors = [];
  const reasons = [];

  const team = [
    { name: 'Streak',  e: s,  key: 'streak'  },
    { name: 'Dice',    e: d,  key: 'dice'    },
    { name: 'Trend',   e: tr, key: 'trend'   },
    { name: 'Markov',  e: m,  key: 'markov'  },
    { name: 'Pattern', e: p,  key: 'pattern' },
    { name: 'Balance', e: b,  key: 'balance' },
    { name: 'Cycle',   e: c,  key: 'cycle'   }
  ];

  team.forEach(({ name, e }) => {
    const w = e.weight * e.conf;
    if (e.pred === 1) finalT += w; else finalX += w;
    if (e.details && e.details.length) {
      e.details.forEach(dt => factors.push(name[0] + ':' + dt));
    }
  });

  // Anti-Loss cực mạnh
  const wrong = learningData[type].recentWrongStreak || 0;
  const lastDir = learningData[type].lastPredDirection;

  if (wrong >= 3 && lastDir !== null) {
    if (lastDir === 1) { finalX += 11.0; finalT *= 0.08; }
    else { finalT += 11.0; finalX *= 0.08; }
    factors.unshift('BẺ-' + wrong);
    reasons.push('Thua ' + wrong + ' phiên → BẺ CỰC MẠNH');
  } else if (wrong >= 2 && lastDir !== null) {
    if (lastDir === 1) finalX += 4.0; else finalT += 4.0;
    factors.unshift('Nghiêng-' + wrong);
    reasons.push('Sai ' + wrong + ' → nghiêng đảo');
  }

  // Nếu 3 expert mạnh nhất đồng thuận thì tăng tin cậy
  const top3 = [s, d, tr];
  const topAgree = top3.filter(e => e.pred === (finalT >= finalX ? 1 : 0)).length;

  const finalPred = finalT >= finalX ? 1 : 0;
  const totalScore = finalT + finalX || 1;
  const dominance = Math.abs(finalT - finalX) / totalScore;
  const agreeCount = team.filter(t => t.e.pred === finalPred).length;

  let conf = 55 + dominance * 30 + (agreeCount - 3.5) * 2.8;
  if (topAgree === 3) conf += 6.5;
  if (s.pred === finalPred && s.conf > 0.75) conf += 4.0;
  if (d.pred === finalPred && d.conf > 0.76) conf += 3.5;
  if (tr.pred === finalPred) conf += 2.8;

  if (wrong >= 2) conf -= 5.0;
  if (wrong >= 4) conf -= 8.0;

  // Soften khi recent kém
  const recentAccArr = learningData[type].recentAccuracy || [];
  if (recentAccArr.length >= 12) {
    const recentAcc = recentAccArr.slice(-12).reduce((a, b) => a + b, 0) / 12;
    if (recentAcc < 0.45) conf = Math.min(conf, 70);
  }

  conf = Math.max(55, Math.min(90, Math.round(conf)));

  // Update memory
  const currentSuffix = H.slice(-Math.min(8, H.length)).join('');
  if (!mem[currentSuffix]) {
    mem[currentSuffix] = { count: 1, hangLen: 1, success: 0, fail: 0, lastSeen: Date.now() };
  } else {
    mem[currentSuffix].count++;
    mem[currentSuffix].hangLen = (mem[currentSuffix].hangLen || 0) + 1;
    mem[currentSuffix].lastSeen = Date.now();
  }
  const keys = Object.keys(mem);
  if (keys.length > 450) {
    keys.sort((a, b) => (mem[a].lastSeen || 0) - (mem[b].lastSeen || 0));
    for (let i = 0; i < 100; i++) delete mem[keys[i]];
  }
  learningData[type].patternMemory = mem;
  learningData[type].lastPredDirection = finalPred;

  if (d.details.length) reasons.push('Xúc xắc: ' + d.details.slice(0, 2).join(', '));
  if (s.details.length) reasons.push('Cầu: ' + s.details[0]);
  if (tr.details.length) reasons.push('Trend: ' + tr.details[0]);
  if (agreeCount >= 5) reasons.push('Đồng thuận ' + agreeCount + '/7');

  return {
    prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
    confidence: conf,
    factors: [...new Set(factors)].slice(0, 7),
    reasons: reasons.slice(0, 4),
    agree: (finalT > finalX ? 'T' : 'X') + '(' + Math.round(dominance * 100) + '%)',
    experts: {
      streak:  s.pred  === 1 ? 'Tài' : 'Xỉu',
      dice:    d.pred  === 1 ? 'Tài' : 'Xỉu',
      trend:   tr.pred === 1 ? 'Tài' : 'Xỉu',
      markov:  m.pred  === 1 ? 'Tài' : 'Xỉu',
      pattern: p.pred  === 1 ? 'Tài' : 'Xỉu',
      balance: b.pred  === 1 ? 'Tài' : 'Xỉu',
      cycle:   c.pred  === 1 ? 'Tài' : 'Xỉu',
      agreement: agreeCount + '/7'
    }
  };
}

// ===================== HISTORY & LEARNING =====================
function hasPred(type, phien) {
  return predictionHistory[type].some(r => String(r.Phien_hien_tai) === String(phien));
}
function getExist(type, phien) {
  return predictionHistory[type].find(r => String(r.Phien_hien_tai) === String(phien)) || null;
}
function record(type, phien, pred, conf, factors) {
  const p = String(phien);
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  learningData[type].predictions.unshift({
    phien: p, prediction: pred, confidence: conf, patterns: factors,
    timestamp: new Date().toISOString(), verified: false
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 1000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
  }
  saveL();
}

async function verify(type, data) {
  let changed = false;
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const act = data.find(d => String(d.Phien) === pred.phien);
    if (!act) continue;
    pred.verified = true;
    pred.actual = act.Ket_qua;
    pred.isCorrect = pred.prediction === act.Ket_qua;

    const exp = learningData[type].expertPerformance;
    if (exp) {
      ['markov', 'pattern', 'streak', 'dice', 'balance', 'cycle', 'trend'].forEach(k => {
        if (!exp[k]) exp[k] = { correct: 0, total: 0, recent: [] };
        exp[k].total = (exp[k].total || 0) + 1;
        if (pred.isCorrect) exp[k].correct = (exp[k].correct || 0) + 1;
        if (!Array.isArray(exp[k].recent)) exp[k].recent = [];
        exp[k].recent.push(pred.isCorrect ? 1 : 0);
        if (exp[k].recent.length > 20) exp[k].recent.shift();
        if (exp[k].total > 90) {
          exp[k].correct = Math.round(exp[k].correct * 0.75);
          exp[k].total   = Math.round(exp[k].total   * 0.75);
        }
      });
    }

    if (pred.isCorrect) {
      learningData[type].correctPredictions++;
      learningData[type].streakAnalysis.wins++;
      learningData[type].streakAnalysis.currentStreak =
        learningData[type].streakAnalysis.currentStreak >= 0
          ? learningData[type].streakAnalysis.currentStreak + 1 : 1;
      if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
        learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
      }
      learningData[type].recentWrongStreak = 0;
    } else {
      learningData[type].streakAnalysis.losses++;
      learningData[type].streakAnalysis.currentStreak =
        learningData[type].streakAnalysis.currentStreak <= 0
          ? learningData[type].streakAnalysis.currentStreak - 1 : -1;
      if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
        learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
      }
      learningData[type].recentWrongStreak = (learningData[type].recentWrongStreak || 0) + 1;
    }
    learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
    if (learningData[type].recentAccuracy.length > 80) learningData[type].recentAccuracy.shift();
    changed = true;
  }
  if (changed) saveL();
}

function saveToHist(type, phien, pred, conf, latest) {
  const p = String(phien);
  if (predictionHistory[type].some(r => String(r.Phien_hien_tai) === p)) {
    return predictionHistory[type].find(r => String(r.Phien_hien_tai) === p);
  }
  const rec = {
    Phien: latest.Phien,
    Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3,
    Tong: latest.Tong, Ket_qua: latest.Ket_qua,
    Do_tin_cay: conf + '%',
    Phien_hien_tai: p, Du_doan: pred, ket_qua_du_doan: '',
    id: '@phamkhoi', timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(rec);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return rec;
}

async function updateStatus(type) {
  try {
    const data = type === 'hu' ? await fetchHu() : await fetchMd5();
    if (!data || !data.length) return;
    let changed = false;
    for (const r of predictionHistory[type]) {
      if (r.ket_qua_du_doan) continue;
      const a = data.find(d => String(d.Phien) === String(r.Phien_hien_tai));
      if (a) {
        r.ket_qua_du_doan = r.Du_doan === a.Ket_qua ? 'Đúng' : 'Sai';
        changed = true;
      }
    }
    if (changed) saveH();
  } catch (e) {}
}

async function autoRun() {
  try {
    for (const [type, fn] of [['hu', fetchHu], ['md5', fetchMd5]]) {
      const data = await fn();
      if (!data || !data.length) continue;
      const next = data[0].Phien + 1;
      if (lastProcessed[type] !== next && !hasPred(type, next)) {
        await verify(type, data);
        const r = analyze(data, type);
        saveToHist(type, next, r.prediction, r.confidence, data[0]);
        record(type, next, r.prediction, r.confidence, r.factors);
        lastProcessed[type] = next;
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ' → ' + r.prediction + ' (' + r.confidence + '%)');
        saveH(); saveL();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) {
    console.error('[Auto]', e.message);
  }
}

async function handle(type, fn, req, res) {
  try {
    const data = await fn();
    if (!data || !data.length) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    await verify(type, data);
    const next = data[0].Phien + 1;

    if (hasPred(type, next)) {
      const e = getExist(type, next);
      return res.json({
        Phien: e.Phien, Xuc_xac_1: e.Xuc_xac_1, Xuc_xac_2: e.Xuc_xac_2, Xuc_xac_3: e.Xuc_xac_3,
        Tong: e.Tong, Ket_qua: e.Ket_qua, Do_tin_cay: e.Do_tin_cay,
        Phien_hien_tai: e.Phien_hien_tai, Du_doan: e.Du_doan,
        ket_qua_du_doan: e.ket_qua_du_doan || '', factors: [], reasons: [],
        id: '@phamkhoi', cached: true
      });
    }

    const r = analyze(data, type);
    const rec = saveToHist(type, next, r.prediction, r.confidence, data[0]);
    record(type, next, r.prediction, r.confidence, r.factors);
    lastProcessed[type] = next;
    saveH();
    setTimeout(() => updateStatus(type), 1800);

    res.json({
      Phien: rec.Phien, Xuc_xac_1: rec.Xuc_xac_1, Xuc_xac_2: rec.Xuc_xac_2, Xuc_xac_3: rec.Xuc_xac_3,
      Tong: rec.Tong, Ket_qua: rec.Ket_qua, Do_tin_cay: rec.Do_tin_cay,
      Phien_hien_tai: rec.Phien_hien_tai, Du_doan: rec.Du_doan,
      ket_qua_du_doan: '', factors: r.factors, reasons: r.reasons,
      agree: r.agree, experts: r.experts, id: '@phamkhoi', cached: false
    });
  } catch (e) {
    console.error('[handle]', e.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
}

app.get('/api/hu',  (req, res) => handle('hu',  fetchHu,  req, res));
app.get('/api/md5', (req, res) => handle('md5', fetchMd5, req, res));

app.get('/api/hu/lichsu', async (req, res) => {
  await updateStatus('hu');
  res.json({ type: 'Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
});
app.get('/api/md5/lichsu', async (req, res) => {
  await updateStatus('md5');
  res.json({ type: 'MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
});

app.get('/api/hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(1) : '0.0';
  res.json({
    type: 'Hũ', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0,
    patternMemorySize: Object.keys(s.patternMemory || {}).length
  });
});
app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(1) : '0.0';
  res.json({
    type: 'MD5', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0,
    patternMemorySize: Object.keys(s.patternMemory || {}).length
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: emptyL(), md5: emptyL() };
  saveL();
  res.json({ message: 'Reset OK' });
});

// ===================== PREMIUM CYBER UI =====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Phạm Khôi • Ultra VIP</title>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #06060c;
    --cyan: #22d3ee;
    --pink: #f43f5e;
    --violet: #a78bfa;
    --green: #34d399;
    --card: rgba(12,14,24,0.94);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: var(--bg);
    color: #e2e8f0;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .page { display: none; min-height: 100vh; }
  .page.active { display: block; }

  /* HOME */
  .home {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; padding: 28px 20px; text-align: center;
    background:
      radial-gradient(ellipse 90% 55% at 50% -15%, rgba(34,211,238,0.14), transparent),
      radial-gradient(ellipse 60% 45% at 90% 100%, rgba(244,63,94,0.10), transparent);
  }
  .home-logo {
    width: 96px; height: 96px; border-radius: 28px;
    background: linear-gradient(145deg, #22d3ee, #6366f1, #f43f5e);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 30px; color: #0f172a;
    box-shadow: 0 0 50px rgba(34,211,238,0.35);
    margin-bottom: 22px;
  }
  .home h1 {
    font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 800;
    letter-spacing: 3px; margin-bottom: 8px;
    background: linear-gradient(90deg, #22d3ee, #e2e8f0, #f43f5e);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .home p { color: #94a3b8; font-size: 14px; margin-bottom: 42px; letter-spacing: 0.5px; }
  .mode-btn {
    width: 100%; max-width: 340px; padding: 20px 26px; margin: 11px 0;
    border-radius: 18px; border: 1px solid rgba(34,211,238,0.22);
    background: rgba(8,15,30,0.75); color: #f1f5f9;
    font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700;
    letter-spacing: 1.5px; cursor: pointer; transition: all 0.28s cubic-bezier(0.22,1,0.36,1);
    display: flex; align-items: center; justify-content: space-between;
  }
  .mode-btn:hover, .mode-btn:active {
    background: rgba(34,211,238,0.12); border-color: #22d3ee;
    box-shadow: 0 0 30px rgba(34,211,238,0.28); transform: translateY(-2px);
  }
  .mode-btn span { font-size: 12px; color: #64748b; font-weight: 500; letter-spacing: 0; }

  /* DETAIL */
  .detail {
    padding: 18px 16px 36px; max-width: 420px; margin: 0 auto;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;
  }
  .back-btn {
    width: 42px; height: 42px; border-radius: 14px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
    color: #94a3b8; font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .back-btn:active { background: rgba(255,255,255,0.08); }
  .mode-label {
    font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: 700;
    color: #22d3ee; letter-spacing: 1.5px;
  }
  .clock { font-size: 12px; color: #64748b; font-variant-numeric: tabular-nums; }

  /* AI CIRCLE */
  .ai-wrap { display: flex; justify-content: center; margin: 8px 0 24px; }
  .ai-circle {
    width: 138px; height: 138px; border-radius: 50%;
    border: 3px solid rgba(34,211,238,0.28);
    background: radial-gradient(circle at 40% 35%, rgba(20,40,70,0.95), rgba(8,10,20,0.98));
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative;
    box-shadow: 0 0 45px rgba(34,211,238,0.12);
  }
  .ai-circle::before {
    content: ''; position: absolute; inset: -10px; border-radius: 50%;
    border: 1px solid rgba(34,211,238,0.12);
    animation: spin 10s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .ai-label {
    font-family: 'Orbitron', sans-serif; font-size: 30px; font-weight: 900;
    color: #22d3ee; letter-spacing: 2px;
    text-shadow: 0 0 22px rgba(34,211,238,0.55);
  }
  .ai-sub {
    font-size: 10px; color: #64748b; margin-top: 5px; letter-spacing: 1.2px;
  }
  .ai-circle.pred-tai .ai-label { color: #f43f5e; text-shadow: 0 0 22px rgba(244,63,94,0.55); }
  .ai-circle.pred-xiu .ai-label { color: #22d3ee; text-shadow: 0 0 22px rgba(34,211,238,0.55); }
  .ai-circle.blink-tai {
    animation: blinkTai 1s ease-in-out infinite;
    border-color: #f43f5e;
  }
  .ai-circle.blink-xiu {
    animation: blinkXiu 1s ease-in-out infinite;
    border-color: #22d3ee;
  }
  @keyframes blinkTai {
    0%,100% { box-shadow: 0 0 22px rgba(244,63,94,0.25); }
    50% { box-shadow: 0 0 55px rgba(244,63,94,0.65); }
  }
  @keyframes blinkXiu {
    0%,100% { box-shadow: 0 0 22px rgba(34,211,238,0.25); }
    50% { box-shadow: 0 0 55px rgba(34,211,238,0.65); }
  }

  /* TÀI / XỈU */
  .pred-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;
  }
  .pred-card {
    border-radius: 18px; padding: 20px 14px; text-align: center;
    border: 1px solid rgba(255,255,255,0.07); background: rgba(10,12,22,0.88);
    transition: all 0.35s cubic-bezier(0.22,1,0.36,1);
  }
  .pred-card.tai { border-color: rgba(244,63,94,0.22); }
  .pred-card.xiu { border-color: rgba(34,211,238,0.22); }
  .pred-card.active-tai {
    border-color: #f43f5e;
    box-shadow: 0 0 32px rgba(244,63,94,0.32);
    background: rgba(40,8,18,0.75);
    animation: pulseTai 1.1s ease-in-out infinite;
  }
  .pred-card.active-xiu {
    border-color: #22d3ee;
    box-shadow: 0 0 32px rgba(34,211,238,0.32);
    background: rgba(6,25,40,0.75);
    animation: pulseXiu 1.1s ease-in-out infinite;
  }
  @keyframes pulseTai {
    0%,100% { box-shadow: 0 0 18px rgba(244,63,94,0.22); }
    50% { box-shadow: 0 0 42px rgba(244,63,94,0.50); }
  }
  @keyframes pulseXiu {
    0%,100% { box-shadow: 0 0 18px rgba(34,211,238,0.22); }
    50% { box-shadow: 0 0 42px rgba(34,211,238,0.50); }
  }
  .pred-title {
    font-family: 'Orbitron', sans-serif; font-size: 27px; font-weight: 800;
    letter-spacing: 2px;
  }
  .pred-card.tai .pred-title { color: #f43f5e; }
  .pred-card.xiu .pred-title { color: #22d3ee; }
  .pred-sum {
    font-size: 11px; color: #64748b; margin-top: 7px; letter-spacing: 0.6px;
  }
  .pred-conf {
    font-family: 'Orbitron', sans-serif; font-size: 19px; font-weight: 700;
    margin-top: 10px; color: #94a3b8;
  }
  .pred-card.active-tai .pred-conf,
  .pred-card.active-xiu .pred-conf { color: #f8fafc; }

  /* STATS */
  .stats-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;
  }
  .stat-box {
    border-radius: 16px; padding: 15px; text-align: center;
    background: rgba(10,12,22,0.9); border: 1px solid rgba(255,255,255,0.05);
  }
  .stat-label {
    font-size: 10px; color: #64748b; letter-spacing: 1.6px; margin-bottom: 7px;
    font-family: 'Orbitron', sans-serif;
  }
  .stat-value {
    font-family: 'Orbitron', sans-serif; font-size: 23px; font-weight: 700;
    color: #22d3ee;
  }
  .stat-bar {
    height: 3px; border-radius: 99px; background: rgba(255,255,255,0.07);
    margin-top: 11px; overflow: hidden;
  }
  .stat-bar > div {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #22d3ee, #6366f1);
    transition: width 0.7s cubic-bezier(0.22,1,0.36,1);
  }

  /* LOG */
  .log-box {
    border-radius: 18px; background: rgba(10,12,22,0.94);
    border: 1px solid rgba(34,211,238,0.12); overflow: hidden;
  }
  .log-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 13px 15px; border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .log-title {
    font-family: 'Orbitron', sans-serif; font-size: 11px; font-weight: 700;
    color: #22d3ee; letter-spacing: 1.2px;
  }
  .log-count { font-size: 11px; color: #64748b; }
  .log-table { width: 100%; font-size: 11px; border-collapse: collapse; }
  .log-table th {
    padding: 9px 5px; text-align: center; color: #64748b;
    font-weight: 600; font-size: 10px; letter-spacing: 0.5px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .log-table td {
    padding: 10px 5px; text-align: center;
    border-bottom: 1px solid rgba(255,255,255,0.025);
  }
  .log-table tr:last-child td { border-bottom: none; }
  .badge {
    display: inline-block; padding: 3px 9px; border-radius: 7px;
    font-weight: 600; font-size: 10px;
  }
  .badge-tai { background: rgba(244,63,94,0.14); color: #f43f5e; }
  .badge-xiu { background: rgba(34,211,238,0.14); color: #22d3ee; }
  .badge-win { background: rgba(52,211,153,0.14); color: #34d399; }
  .badge-lose { background: rgba(239,68,68,0.14); color: #ef4444; }
  .badge-wait { background: rgba(100,116,139,0.18); color: #94a3b8; }

  .info-line {
    text-align: center; font-size: 11px; color: #475569; margin-top: 16px;
  }
  .xx-info {
    text-align: center; font-size: 12px; color: #64748b; margin-bottom: 14px;
  }
</style>
</head>
<body>

<div id="page-home" class="page active home">
  <div class="home-logo">PK</div>
  <h1>PHẠM KHÔI</h1>
  <p>Ultra VIP Engine v6 • Recent-First</p>
  <button class="mode-btn" onclick="goMode('hu')">
    TÀI XỈU HŨ
    <span>Chọn →</span>
  </button>
  <button class="mode-btn" onclick="goMode('md5')">
    TÀI XỈU MD5
    <span>Chọn →</span>
  </button>
</div>

<div id="page-detail" class="page">
  <div class="detail">
    <div class="topbar">
      <button class="back-btn" onclick="goHome()">←</button>
      <div class="mode-label" id="modeLabel">TÀI XỈU HŨ</div>
      <div class="clock" id="clock">--:--:--</div>
    </div>

    <div class="ai-wrap">
      <div class="ai-circle" id="aiCircle">
        <div class="ai-label" id="aiPred">—</div>
        <div class="ai-sub" id="aiSub">LOADING...</div>
      </div>
    </div>

    <div class="xx-info" id="xxInfo">XX — · Tổng —</div>

    <div class="pred-row">
      <div class="pred-card tai" id="cardTai">
        <div class="pred-title">TÀI</div>
        <div class="pred-sum">SUM 11–17</div>
        <div class="pred-conf" id="confTai">—%</div>
      </div>
      <div class="pred-card xiu" id="cardXiu">
        <div class="pred-title">XỈU</div>
        <div class="pred-sum">SUM 04–10</div>
        <div class="pred-conf" id="confXiu">—%</div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-label">WIN_RATE</div>
        <div class="stat-value" id="winRate">—%</div>
        <div class="stat-bar"><div id="winBar" style="width:0%"></div></div>
      </div>
      <div class="stat-box">
        <div class="stat-label">AI_OUTPUT</div>
        <div class="stat-value" id="aiOutput" style="font-size:17px;color:#a78bfa">—</div>
      </div>
    </div>

    <div class="log-box">
      <div class="log-header">
        <div class="log-title">▣ PREDICTION_LOG</div>
        <div class="log-count" id="logCount">0 records</div>
      </div>
      <div style="max-height:290px;overflow-y:auto">
        <table class="log-table">
          <thead>
            <tr>
              <th>SESSION</th>
              <th>PRED</th>
              <th>RESULT</th>
              <th>EVAL</th>
              <th>TIME</th>
            </tr>
          </thead>
          <tbody id="logBody"></tbody>
        </table>
      </div>
    </div>

    <div class="info-line" id="phienInfo">Phiên hiện tại: #—</div>
  </div>
</div>

<script>
let currentMode = 'hu';
const $ = id => document.getElementById(id);

function tick() {
  $('clock').textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false });
}
setInterval(tick, 1000); tick();

function goHome() {
  $('page-detail').classList.remove('active');
  $('page-home').classList.add('active');
}

function goMode(mode) {
  currentMode = mode;
  $('page-home').classList.remove('active');
  $('page-detail').classList.add('active');
  $('modeLabel').textContent = mode === 'hu' ? 'TÀI XỈU HŨ' : 'TÀI XỈU MD5';
  $('aiPred').textContent = '—';
  $('aiSub').textContent = 'LOADING...';
  $('aiCircle').className = 'ai-circle';
  $('cardTai').className = 'pred-card tai';
  $('cardXiu').className = 'pred-card xiu';
  $('confTai').textContent = '—%';
  $('confXiu').textContent = '—%';
  loadData();
}

async function loadData() {
  try {
    const [predRes, histRes, learnRes] = await Promise.all([
      fetch('/api/' + currentMode),
      fetch('/api/' + currentMode + '/lichsu'),
      fetch('/api/' + currentMode + '/learning')
    ]);
    const d = await predRes.json();
    const h = await histRes.json();
    const l = await learnRes.json();

    if (d.error) {
      $('aiSub').textContent = 'ERROR';
      return;
    }

    const pred = d.Du_doan;
    const conf = parseInt(d.Do_tin_cay) || 0;

    $('aiPred').textContent = pred === 'Tài' ? 'TÀI' : pred === 'Xỉu' ? 'XỈU' : '—';
    $('aiSub').textContent = '#' + (d.Phien_hien_tai || '—');
    $('aiCircle').className = 'ai-circle ' + (pred === 'Tài' ? 'pred-tai blink-tai' : pred === 'Xỉu' ? 'pred-xiu blink-xiu' : '');

    $('cardTai').className = 'pred-card tai' + (pred === 'Tài' ? ' active-tai' : '');
    $('cardXiu').className = 'pred-card xiu' + (pred === 'Xỉu' ? ' active-xiu' : '');
    if (pred === 'Tài') {
      $('confTai').textContent = conf + '%';
      $('confXiu').textContent = (100 - conf) + '%';
    } else {
      $('confXiu').textContent = conf + '%';
      $('confTai').textContent = (100 - conf) + '%';
    }

    $('xxInfo').textContent = 'XX ' + d.Xuc_xac_1 + ' ' + d.Xuc_xac_2 + ' ' + d.Xuc_xac_3 + ' · Tổng ' + d.Tong + ' · ' + d.Ket_qua;
    $('phienInfo').textContent = 'Phiên hiện tại: #' + d.Phien + ' → Dự đoán #' + d.Phien_hien_tai;

    const acc = l.overallAccuracy || '0.0%';
    $('winRate').textContent = acc;
    $('winBar').style.width = parseFloat(acc) + '%';
    $('aiOutput').textContent = pred || 'NULL';

    const hist = (h.history || []).slice(0, 30);
    $('logCount').textContent = hist.length + ' records';
    $('logBody').innerHTML = hist.map(r => {
      const predBadge = r.Du_doan === 'Tài' ? 'badge-tai' : 'badge-xiu';
      const resultBadge = r.Ket_qua === 'Tài' ? 'badge-tai' : r.Ket_qua === 'Xỉu' ? 'badge-xiu' : 'badge-wait';
      let evalBadge = 'badge-wait', evalText = '…';
      if (r.ket_qua_du_doan === 'Đúng') { evalBadge = 'badge-win'; evalText = 'Thắng'; }
      else if (r.ket_qua_du_doan === 'Sai') { evalBadge = 'badge-lose'; evalText = 'Thua'; }
      const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString('vi-VN', { hour12: false }) : '—';
      return '<tr>' +
        '<td style="color:#64748b">#' + r.Phien_hien_tai + '</td>' +
        '<td><span class="badge ' + predBadge + '">' + (r.Du_doan || '—') + '</span></td>' +
        '<td><span class="badge ' + resultBadge + '">' + (r.Ket_qua || '—') + '</span></td>' +
        '<td><span class="badge ' + evalBadge + '">' + evalText + '</span></td>' +
        '<td style="color:#475569;font-size:10px">' + time + '</td>' +
        '</tr>';
    }).join('');
  } catch (e) {
    $('aiSub').textContent = 'ERROR';
  }
}

setInterval(() => {
  if ($('page-detail').classList.contains('active')) loadData();
}, 9500);
</script>
</body>
</html>`);
});

// ===================== BOOT =====================
loadL();
loadH();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  PHẠM KHÔI • ULTRA VIP ENGINE v6.0');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Recent-First + Strong Mean-Reversion + Anti-Loss');
  console.log('  Premium Cyber Neon UI');
  console.log('══════════════════════════════════════════════════');
  setTimeout(autoRun, 1400);
  setInterval(autoRun, AUTO_INTERVAL);
});
