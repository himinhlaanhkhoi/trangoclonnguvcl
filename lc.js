/**
 * PHẠM KHÔI • ULTRA VIP ENGINE v3.1
 * API MD5 = CŨ (tele68) | Thuật toán Bắt Cầu + Xúc Xắc siêu mạnh
 * Anti-Loss-3 | Multi-Expert | Modern Dashboard
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

// ===================== API (MD5 = CŨ) =====================
const API_HU  = 'https://wtx.tele68.com/v1/tx/sessions';
const API_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

const LEARNING_FILE = 'phamkhoi.json';
const HISTORY_FILE  = 'phamkhoi1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 300;
const AUTO_INTERVAL = 13000;
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
      markov:  { correct: 0, total: 0 },
      pattern: { correct: 0, total: 0 },
      streak:  { correct: 0, total: 0 },
      dice:    { correct: 0, total: 0 },
      balance: { correct: 0, total: 0 },
      cycle:   { correct: 0, total: 0 },
      chaos:   { correct: 0, total: 0 }
    }
  };
}

// ===================== LOAD / SAVE =====================
function loadL() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = {
        hu:  { ...emptyL(), ...(loaded.hu  || {}) },
        md5: { ...emptyL(), ...(loaded.md5 || {}) }
      };
      if (!learningData.hu.patternMemory)  learningData.hu.patternMemory  = {};
      if (!learningData.md5.patternMemory) learningData.md5.patternMemory = {};
      console.log('[Load] Learning + Pattern Memory OK');
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

// ===================== TRANSFORM (API CŨ) =====================
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

// ===================== CORE ANALYZE v3.1 (Bắt Cầu + Xúc Xắc siêu mạnh) =====================
function analyze(data, type) {
  if (!data || data.length < 20) {
    return {
      prediction: 'Xỉu',
      confidence: 52,
      factors: ['Thiếu dữ liệu'],
      reasons: ['Cần ≥20 phiên đã hoàn thành'],
      experts: {},
      agree: '-'
    };
  }

  // R: 1 = Tài, 0 = Xỉu (index 0 = mới nhất)
  const R = data.map(d => d.Ket_qua === 'Tài' ? 1 : 0);
  const H = [...R].reverse(); // cũ → mới
  const dice = data.map(d => ({
    faces: [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3],
    sum: d.Tong,
    result: d.Ket_qua === 'Tài' ? 1 : 0
  }));

  const mem = learningData[type].patternMemory || {};
  const expPerf = learningData[type].expertPerformance || emptyL().expertPerformance;

  function dynamicWeight(base, key) {
    const p = expPerf[key] || { correct: 0, total: 0 };
    if (p.total < 12) return base;
    const acc = p.correct / p.total;
    return base * (0.68 + acc * 0.70);
  }

  // ---------- 1. MARKOV BẬC CAO ----------
  function expertMarkov() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    const orders = [
      { o: 1, baseW: 1.10 },
      { o: 2, baseW: 1.80 },
      { o: 3, baseW: 2.40 },
      { o: 4, baseW: 2.70 },
      { o: 5, baseW: 2.95 }
    ];
    for (const { o, baseW } of orders) {
      if (H.length < o + 20) continue;
      const pat = H.slice(-o).join('');
      let t = 0, x = 0;
      for (let i = 0; i <= H.length - o - 1; i++) {
        if (H.slice(i, i + o).join('') === pat) {
          if (H[i + o] === 1) t++; else x++;
        }
      }
      const tot = t + x;
      if (tot < 3) continue;
      const pT = t / tot;
      const conf = 0.53 + Math.abs(pT - 0.5) * 0.94;
      const w = baseW * conf * Math.min(1.30, tot / 7.5);
      if (pT >= 0.5) scoreT += w; else scoreX += w;
      details.push('M' + o + ':' + (pT >= 0.5 ? 'T' : 'X') + '(' + Math.round(conf * 100) + '%)');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred,
      conf: Math.min(0.90, 0.54 + dom * 0.41),
      weight: dynamicWeight(2.75, 'markov'),
      details: details.slice(0, 3),
      scoreT, scoreX
    };
  }

  // ---------- 2. PATTERN + MEMORY (bắt cầu cố định / ngắn) ----------
  function expertPattern() {
    let bestLen = 0, next = null, matches = 0, memBoost = 0;
    for (let len = Math.min(15, H.length - 4); len >= 3; len--) {
      const suffix = H.slice(-len).join('');
      let t = 0, x = 0;
      for (let i = 0; i <= H.length - len - 1; i++) {
        if (H.slice(i, i + len).join('') === suffix) {
          if (H[i + len] === 1) t++; else x++;
        }
      }
      const tot = t + x;
      if (tot >= 2) {
        bestLen = len;
        next = t >= x ? 1 : 0;
        matches = tot;
        if (mem[suffix]) {
          const m = mem[suffix];
          memBoost = Math.min(2.1, (m.hangLen || 0) * 0.17 + (m.count || 0) * 0.10);
          if (m.success > m.fail) memBoost += 0.45;
        }
        break;
      }
    }
    if (bestLen === 0) {
      return { pred: R[0], conf: 0.51, weight: dynamicWeight(1.40, 'pattern'), details: ['Pattern yếu'], scoreT: 0.5, scoreX: 0.5 };
    }
    const conf = 0.57 + Math.min(0.30, bestLen * 0.019) + Math.min(0.13, matches * 0.017) + memBoost * 0.09;
    const details = ['Ptn' + bestLen + '→' + (next === 1 ? 'T' : 'X') + (memBoost > 0.4 ? '+Mem' : '')];
    return {
      pred: next,
      conf: Math.min(0.89, conf),
      weight: dynamicWeight(2.30 + memBoost * 0.50, 'pattern'),
      details,
      scoreT: next === 1 ? conf : 1 - conf,
      scoreX: next === 0 ? conf : 1 - conf
    };
  }

  // ---------- 3. STREAK / BỆT (siêu mạnh) ----------
  function expertStreak() {
    let streak = 1;
    for (let i = 1; i < R.length; i++) {
      if (R[i] === R[0]) streak++; else break;
    }
    const streakVal = R[0];

    let alt = 1;
    for (let i = 1; i < Math.min(R.length, 20); i++) {
      if (R[i] !== R[i - 1]) alt++; else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    // Bệt logic nâng cấp sâu
    if (streak === 2) {
      const w = 1.45;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt2 theo');
    } else if (streak === 3) {
      const w = 2.05;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt3 theo');
    } else if (streak === 4) {
      const w = 0.95;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt4 thận');
    } else if (streak === 5) {
      const w = 2.85;
      if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ bệt5');
    } else if (streak >= 6) {
      const w = 3.40 + Math.min(1.8, (streak - 6) * 0.40);
      if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ bệt' + streak + ' mạnh');
    }

    // Cầu đảo
    if (alt >= 5 && alt <= 8) {
      const w = 2.15;
      if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Đảo' + alt);
    } else if (alt >= 9) {
      const w = 1.35;
      if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push('Đứt đảo' + alt);
    }

    // Cầu ngắn cố định phổ biến
    const last8 = R.slice(0, 8).join('');
    if (['11001100', '00110011', '10101010', '01010101'].includes(last8)) {
      const w = 1.90;
      if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Cầu cố định ngắn');
    }

    // Cầu 3-1 / 2-2
    const last4 = R.slice(0, 4).join('');
    if (last4 === '1110' || last4 === '0001') {
      const w = 1.55;
      if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Cầu 3-1');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.55 + Math.abs(scoreT - scoreX) / total * 0.40;
    return {
      pred,
      conf: Math.min(0.91, conf),
      weight: dynamicWeight(2.45, 'streak'),
      details,
      scoreT, scoreX
    };
  }

  // ---------- 4. DICE + SUM (siêu chính xác) ----------
  function expertDice() {
    const recent = dice.slice(0, 40);
    if (recent.length < 18) {
      return { pred: 0, conf: 0.51, weight: dynamicWeight(1.70, 'dice'), details: ['Dice thiếu'], scoreT: 0.5, scoreX: 0.5 };
    }

    // Phân tích mặt xúc xắc
    let high = 0, low = 0, totalF = 0;
    recent.forEach(d => {
      d.faces.forEach(f => {
        if (f >= 1 && f <= 6) {
          totalF++;
          if (f >= 4) high++; else low++;
        }
      });
    });
    const highRatio = high / (totalF || 1);
    const lowRatio  = low  / (totalF || 1);

    // Trung bình tổng theo nhiều cửa sổ
    const sums25 = recent.slice(0, 25).map(d => d.sum);
    const avg25  = sums25.reduce((a, b) => a + b, 0) / 25;
    const sums16 = recent.slice(0, 16).map(d => d.sum);
    const avg16  = sums16.reduce((a, b) => a + b, 0) / 16;
    const sums10 = recent.slice(0, 10).map(d => d.sum);
    const avg10  = sums10.reduce((a, b) => a + b, 0) / 10;
    const sums6  = recent.slice(0, 6).map(d => d.sum);
    const avg6   = sums6.reduce((a, b) => a + b, 0) / 6;

    // Chuỗi cao / thấp liên tiếp
    let consecHigh = 0, consecLow = 0;
    for (let i = 0; i < Math.min(12, recent.length); i++) {
      if (recent[i].sum >= 12) consecHigh++; else break;
    }
    for (let i = 0; i < Math.min(12, recent.length); i++) {
      if (recent[i].sum <= 9) consecLow++; else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    // Sum dài hạn
    if (avg25 >= 12.5) { scoreX += 2.55; details.push('Sum25 cao'); }
    else if (avg25 <= 8.5) { scoreT += 2.55; details.push('Sum25 thấp'); }
    else if (avg25 >= 11.7) { scoreX += 1.35; details.push('Sum25 hơi cao'); }
    else if (avg25 <= 9.3) { scoreT += 1.35; details.push('Sum25 hơi thấp'); }

    // Sum trung hạn
    if (avg16 >= 12.9) { scoreX += 1.70; details.push('Sum16 rất cao'); }
    else if (avg16 <= 8.1) { scoreT += 1.70; details.push('Sum16 rất thấp'); }

    // Sum ngắn
    if (avg10 >= 13.2) { scoreX += 1.50; details.push('Sum10 cực cao'); }
    else if (avg10 <= 7.8) { scoreT += 1.50; details.push('Sum10 cực thấp'); }

    if (avg6 >= 13.5) { scoreX += 1.25; details.push('Sum6 nóng'); }
    else if (avg6 <= 7.5) { scoreT += 1.25; details.push('Sum6 lạnh'); }

    // Tỷ lệ mặt
    if (highRatio >= 0.59) { scoreX += 1.85; details.push('Mặt cao'); }
    else if (lowRatio >= 0.59) { scoreT += 1.85; details.push('Mặt thấp'); }

    // Chuỗi liên tiếp
    if (consecHigh >= 3) {
      scoreX += 1.70 + (consecHigh - 3) * 0.30;
      details.push('Cao liên' + consecHigh);
    }
    if (consecLow >= 3) {
      scoreT += 1.70 + (consecLow - 3) * 0.30;
      details.push('Thấp liên' + consecLow);
    }

    // Phiên vừa rồi
    const lastSum = recent[0].sum;
    if (lastSum >= 16) { scoreX += 1.45; details.push('Cực cao'); }
    else if (lastSum <= 5) { scoreT += 1.45; details.push('Cực thấp'); }
    else if (lastSum >= 14) { scoreX += 0.85; details.push('Cao'); }
    else if (lastSum <= 7) { scoreT += 0.85; details.push('Thấp'); }

    // Lệch Tài/Xỉu trong 20 phiên gần
    const last20 = recent.slice(0, 20).map(d => d.result);
    const tai20 = last20.filter(x => x === 1).length;
    if (tai20 >= 14) { scoreX += 2.00; details.push('LệchT mạnh'); }
    else if (tai20 <= 6) { scoreT += 2.00; details.push('LệchX mạnh'); }
    else if (tai20 >= 13) { scoreX += 1.15; details.push('LệchT'); }
    else if (tai20 <= 7) { scoreT += 1.15; details.push('LệchX'); }

    // Phân tích mặt 1-3 vs 4-6 trong 12 phiên gần
    let faceHigh12 = 0, faceLow12 = 0;
    recent.slice(0, 12).forEach(d => {
      d.faces.forEach(f => {
        if (f >= 4) faceHigh12++; else faceLow12++;
      });
    });
    const faceRatio12 = faceHigh12 / (faceHigh12 + faceLow12 || 1);
    if (faceRatio12 >= 0.62) { scoreX += 1.30; details.push('Mặt12 cao'); }
    else if (faceRatio12 <= 0.38) { scoreT += 1.30; details.push('Mặt12 thấp'); }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred,
      conf: Math.min(0.90, 0.56 + dom * 0.39),
      weight: dynamicWeight(2.70, 'dice'),
      details: details.slice(0, 5),
      scoreT, scoreX
    };
  }

  // ---------- 5. BALANCE ----------
  function expertBalance() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    [12, 18, 28, 40].forEach(w => {
      if (R.length < w) return;
      const slice = R.slice(0, w);
      const tai = slice.filter(x => x === 1).length;
      const ratio = tai / w;
      if (ratio >= 0.70) {
        scoreX += 1.50 * (w / 20);
        details.push('LệchT' + w);
      } else if (ratio <= 0.30) {
        scoreT += 1.50 * (w / 20);
        details.push('LệchX' + w);
      }
    });
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.53 + Math.abs(scoreT - scoreX) / total * 0.33;
    return {
      pred,
      conf,
      weight: dynamicWeight(1.65, 'balance'),
      details: details.slice(0, 3),
      scoreT, scoreX
    };
  }

  // ---------- 6. CYCLE ----------
  function expertCycle() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    let bestSc = 0, cyclePred = null, bestP = 0;

    for (const p of [2, 3, 4, 5, 6, 7]) {
      if (R.length < p * 7) continue;
      let match = 0;
      const chk = p * 5;
      for (let i = 0; i < chk; i++) {
        if (R[i] === R[i + p]) match++;
      }
      const sc = match / chk;
      if (sc > 0.70 && sc > bestSc) {
        bestSc = sc;
        cyclePred = R[p - 1];
        bestP = p;
      }
    }

    if (cyclePred !== null) {
      const w = 2.00 * bestSc;
      if (cyclePred === 1) scoreT += w; else scoreX += w;
      details.push('Chu kỳ ' + bestP + ' (' + Math.round(bestSc * 100) + '%)');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.52 + Math.abs(scoreT - scoreX) / total * 0.36;
    return {
      pred,
      conf,
      weight: dynamicWeight(1.80, 'cycle'),
      details,
      scoreT, scoreX
    };
  }

  // ---------- 7. CHAOS ----------
  function expertChaos() {
    const last18 = R.slice(0, 18);
    let changes = 0;
    for (let i = 1; i < last18.length; i++) {
      if (last18[i] !== last18[i - 1]) changes++;
    }
    const volatility = changes / (last18.length - 1);

    let scoreT = 0, scoreX = 0;
    const details = [];

    if (volatility >= 0.70) {
      const w = 1.70;
      if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Hỗn loạn cao');
    } else if (volatility <= 0.30) {
      const w = 1.50;
      if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push('Ổn định');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.51 + Math.abs(scoreT - scoreX) / total * 0.30;
    return {
      pred,
      conf,
      weight: dynamicWeight(1.30, 'chaos'),
      details,
      scoreT, scoreX
    };
  }

  // ===================== TỔNG HỢP =====================
  const m  = expertMarkov();
  const p  = expertPattern();
  const s  = expertStreak();
  const d  = expertDice();
  const b  = expertBalance();
  const c  = expertCycle();
  const ch = expertChaos();

  let finalT = 0, finalX = 0;
  const factors = [];
  const reasons = [];

  const team = [
    { name: 'Markov',  e: m,  key: 'markov'  },
    { name: 'Pattern', e: p,  key: 'pattern' },
    { name: 'Streak',  e: s,  key: 'streak'  },
    { name: 'Dice',    e: d,  key: 'dice'    },
    { name: 'Balance', e: b,  key: 'balance' },
    { name: 'Cycle',   e: c,  key: 'cycle'   },
    { name: 'Chaos',   e: ch, key: 'chaos'   }
  ];

  team.forEach(({ name, e }) => {
    const w = e.weight * e.conf;
    if (e.pred === 1) finalT += w; else finalX += w;
    if (e.details && e.details.length) {
      e.details.forEach(dt => factors.push(name[0] + ':' + dt));
    }
  });

  // ========== ANTI-LOSS 3 (BẺ MẠNH) ==========
  const wrong = learningData[type].recentWrongStreak || 0;
  const lastDir = learningData[type].lastPredDirection;

  if (wrong >= 3 && lastDir !== null) {
    if (lastDir === 1) {
      finalX += 7.2;
      finalT *= 0.15;
    } else {
      finalT += 7.2;
      finalX *= 0.15;
    }
    factors.unshift('BẺ-' + wrong + 'SAI');
    reasons.push('Thua liên tiếp ' + wrong + ' phiên → BẺ CHIỀU MẠNH');
  } else if (wrong >= 2 && lastDir !== null) {
    if (lastDir === 1) finalX += 2.6; else finalT += 2.6;
    factors.unshift('Nghiêng-' + wrong);
    reasons.push('Sai ' + wrong + ' phiên → nghiêng đảo');
  }

  const finalPred = finalT >= finalX ? 1 : 0;
  const totalScore = finalT + finalX || 1;
  const dominance = Math.abs(finalT - finalX) / totalScore;
  const agreeCount = team.filter(t => t.e.pred === finalPred).length;

  let conf = 56 + dominance * 27 + (agreeCount - 3.5) * 2.9;
  if (m.pred === finalPred && d.pred === finalPred) conf += 5.5;
  if (m.pred === finalPred && p.pred === finalPred) conf += 3.8;
  if (s.pred === finalPred && s.conf > 0.72) conf += 3.2;
  if (d.pred === finalPred && d.conf > 0.75) conf += 2.8;
  if (wrong >= 2) conf -= 4.2;
  if (wrong >= 4) conf -= 6.0;
  conf = Math.max(53, Math.min(92, Math.round(conf)));

  // Cập nhật pattern memory
  const currentSuffix = H.slice(-Math.min(10, H.length)).join('');
  if (!mem[currentSuffix]) {
    mem[currentSuffix] = { count: 1, hangLen: 1, success: 0, fail: 0, lastSeen: Date.now() };
  } else {
    mem[currentSuffix].count++;
    mem[currentSuffix].hangLen = (mem[currentSuffix].hangLen || 0) + 1;
    mem[currentSuffix].lastSeen = Date.now();
  }
  const keys = Object.keys(mem);
  if (keys.length > 480) {
    keys.sort((a, b) => (mem[a].lastSeen || 0) - (mem[b].lastSeen || 0));
    for (let i = 0; i < 100; i++) delete mem[keys[i]];
  }
  learningData[type].patternMemory = mem;
  learningData[type].lastPredDirection = finalPred;

  if (d.details.length) reasons.push('Xúc xắc: ' + d.details.slice(0, 2).join(', '));
  if (s.details.length) reasons.push('Cầu: ' + s.details[0]);
  if (p.details.length) reasons.push('Pattern: ' + p.details[0]);
  if (c.details.length) reasons.push(c.details[0]);
  if (agreeCount >= 5) reasons.push('Đồng thuận ' + agreeCount + '/7 chuyên gia');

  return {
    prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
    confidence: conf,
    factors: [...new Set(factors)].slice(0, 7),
    reasons: reasons.slice(0, 4),
    agree: (finalT > finalX ? 'T' : 'X') + '(' + Math.round(dominance * 100) + '%)',
    experts: {
      markov:  m.pred  === 1 ? 'Tài' : 'Xỉu',
      pattern: p.pred  === 1 ? 'Tài' : 'Xỉu',
      streak:  s.pred  === 1 ? 'Tài' : 'Xỉu',
      dice:    d.pred  === 1 ? 'Tài' : 'Xỉu',
      balance: b.pred  === 1 ? 'Tài' : 'Xỉu',
      cycle:   c.pred  === 1 ? 'Tài' : 'Xỉu',
      chaos:   ch.pred === 1 ? 'Tài' : 'Xỉu',
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
    phien: p,
    prediction: pred,
    confidence: conf,
    patterns: factors,
    timestamp: new Date().toISOString(),
    verified: false
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 800) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 800);
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
      ['markov', 'pattern', 'streak', 'dice', 'balance', 'cycle', 'chaos'].forEach(k => {
        if (!exp[k]) exp[k] = { correct: 0, total: 0 };
        exp[k].total = (exp[k].total || 0) + 1;
        if (pred.isCorrect) exp[k].correct = (exp[k].correct || 0) + 1;
        if (exp[k].total > 75) {
          exp[k].correct = Math.round(exp[k].correct * 0.80);
          exp[k].total   = Math.round(exp[k].total   * 0.80);
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
    if (learningData[type].recentAccuracy.length > 60) learningData[type].recentAccuracy.shift();
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
    Xuc_xac_1: latest.Xuc_xac_1,
    Xuc_xac_2: latest.Xuc_xac_2,
    Xuc_xac_3: latest.Xuc_xac_3,
    Tong: latest.Tong,
    Ket_qua: latest.Ket_qua,
    Do_tin_cay: conf + '%',
    Phien_hien_tai: p,
    Du_doan: pred,
    ket_qua_du_doan: '',
    id: '@phamkhoi',
    timestamp: new Date().toISOString()
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

// ===================== AUTO + HANDLE =====================
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
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ' → ' + r.prediction + ' (' + r.confidence + '%) | ' + (r.experts ? r.experts.agreement : ''));
        saveH();
        saveL();
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
    setTimeout(() => updateStatus(type), 2200);

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

// ===================== ROUTES =====================
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
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : '0.00';
  res.json({
    type: 'Hũ', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0,
    patternMemorySize: Object.keys(s.patternMemory || {}).length
  });
});
app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : '0.00';
  res.json({
    type: 'MD5', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0,
    patternMemorySize: Object.keys(s.patternMemory || {}).length
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: emptyL(), md5: emptyL() };
  saveL();
  res.json({ message: 'Reset Learning OK' });
});

// ===================== GIAO DIỆN MỚI NÂNG CẤP =====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Phạm Khôi • Ultra VIP Engine</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root {
    --bg: #030305;
    --card: rgba(14,14,20,0.88);
    --border: rgba(255,255,255,0.055);
    --accent: #f59e0b;
    --tai: #34d399;
    --xiu: #f472b6;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: #f4f4f5;
    min-height: 100vh;
    background-image:
      radial-gradient(ellipse 100% 70% at 50% -30%, rgba(245,158,11,0.11), transparent),
      radial-gradient(ellipse 70% 50% at 100% 100%, rgba(139,92,246,0.07), transparent),
      radial-gradient(ellipse 50% 40% at 0% 90%, rgba(52,211,153,0.05), transparent);
  }
  .glass {
    background: var(--card);
    backdrop-filter: blur(22px);
    -webkit-backdrop-filter: blur(22px);
    border: 1px solid var(--border);
    border-radius: 22px;
  }
  .tai { color: var(--tai); }
  .xiu { color: var(--xiu); }
  .glow-t { box-shadow: 0 0 45px -12px rgba(52,211,153,0.40); border-color: rgba(52,211,153,0.28); }
  .glow-x { box-shadow: 0 0 45px -12px rgba(244,114,182,0.40); border-color: rgba(244,114,182,0.28); }
  .pulse-dot {
    width: 8px; height: 8px; border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.7); }
  }
  .chip {
    font-size: 10px; padding: 3px 9px; border-radius: 999px;
    background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.48); letter-spacing: 0.01em;
  }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .bar {
    height: 4px; border-radius: 99px; background: rgba(255,255,255,0.055); overflow: hidden;
  }
  .bar > div {
    height: 100%; border-radius: 99px;
    transition: width 0.65s cubic-bezier(0.22,1,0.36,1);
  }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
  .fade-in { animation: fadeIn 0.4s ease-out; }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .expert-pill {
    font-size: 10px; padding: 2px 7px; border-radius: 6px;
    background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.05);
  }
</style>
</head>
<body class="px-3 py-5 max-w-lg mx-auto">

  <!-- HEADER -->
  <header class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 flex items-center justify-center text-sm font-black text-black shadow-xl shadow-amber-500/25">
        PK
      </div>
      <div>
        <div class="font-extrabold text-[17px] tracking-tight leading-none">Phạm Khôi</div>
        <div class="text-[11px] text-white/30 mt-1 font-medium tracking-wide">Ultra VIP • Bắt Cầu + Xúc Xắc</div>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <span id="clock" class="text-[11px] text-white/20 mono tabular-nums"></span>
      <button onclick="refreshAll()" class="text-[12px] px-3.5 py-2 rounded-xl bg-white/[0.045] hover:bg-white/[0.09] active:scale-95 transition font-semibold border border-white/[0.07]">
        Làm mới
      </button>
    </div>
  </header>

  <!-- PREDICTION CARDS -->
  <div class="space-y-4 mb-6">

    <!-- HŨ -->
    <div id="card-hu" class="glass p-5 transition-all duration-500 fade-in">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <span class="pulse-dot bg-emerald-400"></span>
          <span class="text-[13px] font-semibold text-white/60">Hũ</span>
        </div>
        <span id="hu-phien" class="text-[11px] text-white/25 mono">#—</span>
      </div>
      <div class="text-center py-2">
        <div id="hu-du-doan" class="text-[42px] font-black tracking-tight leading-none">—</div>
        <div id="hu-conf" class="text-[20px] font-bold text-amber-400/90 mt-2">—%</div>
        <div class="bar mt-3 mx-auto max-w-[160px]">
          <div id="hu-bar" class="bg-gradient-to-r from-amber-500 to-orange-400" style="width:0%"></div>
        </div>
      </div>
      <div class="flex justify-center gap-6 text-[12px] text-white/30 mt-3 mb-2">
        <span>XX <b id="hu-xx" class="text-white/60 mono font-medium">—</b></span>
        <span>Tổng <b id="hu-tong" class="text-white/60 font-medium">—</b></span>
      </div>
      <div id="hu-factors" class="flex flex-wrap gap-1.5 justify-center min-h-[22px] mb-2"></div>
      <div id="hu-reasons" class="text-[11px] text-white/35 text-center mb-2 leading-relaxed px-1"></div>
      <div id="hu-experts" class="flex flex-wrap gap-1.5 justify-center mb-3"></div>
      <div class="grid grid-cols-3 gap-2 pt-3 border-t border-white/[0.05] text-center text-[11px]">
        <div>
          <div class="text-white/25 mb-0.5">Đúng</div>
          <div id="hu-acc" class="font-bold text-emerald-400 text-[13px]">—</div>
        </div>
        <div>
          <div class="text-white/25 mb-0.5">Chuỗi</div>
          <div id="hu-streak" class="font-bold text-[13px]">—</div>
        </div>
        <div>
          <div class="text-white/25 mb-0.5">Phiên</div>
          <div id="hu-next" class="font-bold text-amber-400/80 text-[13px]">#—</div>
        </div>
      </div>
    </div>

    <!-- MD5 -->
    <div id="card-md5" class="glass p-5 transition-all duration-500 fade-in">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <span class="pulse-dot bg-violet-400"></span>
          <span class="text-[13px] font-semibold text-white/60">MD5</span>
        </div>
        <span id="md5-phien" class="text-[11px] text-white/25 mono">#—</span>
      </div>
      <div class="text-center py-2">
        <div id="md5-du-doan" class="text-[42px] font-black tracking-tight leading-none">—</div>
        <div id="md5-conf" class="text-[20px] font-bold text-amber-400/90 mt-2">—%</div>
        <div class="bar mt-3 mx-auto max-w-[160px]">
          <div id="md5-bar" class="bg-gradient-to-r from-violet-500 to-fuchsia-400" style="width:0%"></div>
        </div>
      </div>
      <div class="flex justify-center gap-6 text-[12px] text-white/30 mt-3 mb-2">
        <span>XX <b id="md5-xx" class="text-white/60 mono font-medium">—</b></span>
        <span>Tổng <b id="md5-tong" class="text-white/60 font-medium">—</b></span>
      </div>
      <div id="md5-factors" class="flex flex-wrap gap-1.5 justify-center min-h-[22px] mb-2"></div>
      <div id="md5-reasons" class="text-[11px] text-white/35 text-center mb-2 leading-relaxed px-1"></div>
      <div id="md5-experts" class="flex flex-wrap gap-1.5 justify-center mb-3"></div>
      <div class="grid grid-cols-3 gap-2 pt-3 border-t border-white/[0.05] text-center text-[11px]">
        <div>
          <div class="text-white/25 mb-0.5">Đúng</div>
          <div id="md5-acc" class="font-bold text-emerald-400 text-[13px]">—</div>
        </div>
        <div>
          <div class="text-white/25 mb-0.5">Chuỗi</div>
          <div id="md5-streak" class="font-bold text-[13px]">—</div>
        </div>
        <div>
          <div class="text-white/25 mb-0.5">Phiên</div>
          <div id="md5-next" class="font-bold text-amber-400/80 text-[13px]">#—</div>
        </div>
      </div>
    </div>
  </div>

  <!-- HISTORY -->
  <div class="space-y-4 mb-6">
    <div class="glass p-4">
      <div class="text-[12px] font-semibold text-white/40 mb-3 flex items-center gap-2">
        <span class="w-1.5 h-3.5 rounded-full bg-emerald-400/60"></span>
        Lịch sử Hũ
      </div>
      <div id="hu-hist" class="space-y-0 max-h-52 overflow-y-auto text-[12px]"></div>
    </div>
    <div class="glass p-4">
      <div class="text-[12px] font-semibold text-white/40 mb-3 flex items-center gap-2">
        <span class="w-1.5 h-3.5 rounded-full bg-violet-400/60"></span>
        Lịch sử MD5
      </div>
      <div id="md5-hist" class="space-y-0 max-h-52 overflow-y-auto text-[12px]"></div>
    </div>
  </div>

  <!-- STATS -->
  <div class="grid grid-cols-2 gap-3 mb-6">
    <div class="glass p-3.5">
      <div class="text-[11px] font-semibold text-white/35 mb-2">Thống kê Hũ</div>
      <div id="hu-stats" class="text-[12px] text-white/40 space-y-1 leading-relaxed"></div>
    </div>
    <div class="glass p-3.5">
      <div class="text-[11px] font-semibold text-white/35 mb-2">Thống kê MD5</div>
      <div id="md5-stats" class="text-[12px] text-white/40 space-y-1 leading-relaxed"></div>
    </div>
  </div>

  <footer class="text-center text-[11px] text-white/15 pb-6 tracking-wide">
    Phạm Khôi • Ultra VIP Engine v3.1 • API Cũ + Thuật toán Mới
  </footer>

<script>
const $ = id => document.getElementById(id);
const tick = () => { $('clock').textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false }); };
setInterval(tick, 1000); tick();

const pc = p => p === 'Tài' ? 'tai' : p === 'Xỉu' ? 'xiu' : '';
const gc = p => p === 'Tài' ? 'glow-t' : p === 'Xỉu' ? 'glow-x' : '';

async function loadSide(s) {
  try {
    const r = await fetch('/api/' + s);
    const d = await r.json();
    if (d.error) return;

    $(s + '-phien').textContent = '#' + d.Phien;
    $(s + '-next').textContent = '#' + d.Phien_hien_tai;
    $(s + '-du-doan').textContent = d.Du_doan;
    $(s + '-du-doan').className = 'text-[42px] font-black tracking-tight leading-none ' + pc(d.Du_doan);
    $(s + '-conf').textContent = d.Do_tin_cay;
    const confNum = parseInt(d.Do_tin_cay) || 0;
    $(s + '-bar').style.width = confNum + '%';
    $(s + '-xx').textContent = d.Xuc_xac_1 + ' ' + d.Xuc_xac_2 + ' ' + d.Xuc_xac_3;
    $(s + '-tong').textContent = d.Tong + ' · ' + d.Ket_qua;
    $('card-' + s).className = 'glass p-5 transition-all duration-500 fade-in ' + gc(d.Du_doan);

    $(s + '-factors').innerHTML = (d.factors || []).slice(0, 6).map(f => '<span class="chip">' + f + '</span>').join('');
    $(s + '-reasons').textContent = (d.reasons || []).slice(0, 2).join(' • ') || '';

    if (d.experts) {
      const e = d.experts;
      const pills = [
        ['M', e.markov], ['P', e.pattern], ['S', e.streak],
        ['D', e.dice], ['B', e.balance], ['C', e.cycle], ['H', e.chaos]
      ];
      $(s + '-experts').innerHTML = pills.map(([k, v]) =>
        '<span class="expert-pill ' + pc(v) + '">' + k + ':' + (v === 'Tài' ? 'T' : 'X') + '</span>'
      ).join('') + '<span class="expert-pill text-white/50">' + e.agreement + '</span>';
    } else {
      $(s + '-experts').innerHTML = '';
    }
  } catch (e) {}
}

async function loadHist(s) {
  try {
    const r = await fetch('/api/' + s + '/lichsu');
    const d = await r.json();
    const box = $(s + '-hist');
    if (!d.history || !d.history.length) {
      box.innerHTML = '<div class="text-white/15 text-center py-5 text-[12px]">Chưa có dữ liệu</div>';
      return;
    }
    box.innerHTML = d.history.slice(0, 20).map(h => {
      const ok = h.ket_qua_du_doan || '';
      const c = ok.includes('Đúng') ? 'text-emerald-400' : ok.includes('Sai') ? 'text-rose-400' : 'text-white/20';
      return '<div class="flex items-center justify-between py-[6px] border-b border-white/[0.03] last:border-0">' +
        '<span class="mono text-[11px] text-white/25 w-16">#' + h.Phien_hien_tai + '</span>' +
        '<span class="font-semibold ' + pc(h.Du_doan) + ' w-12 text-center">' + h.Du_doan + '</span>' +
        '<span class="text-[11px] text-white/30 w-12 text-center">' + h.Do_tin_cay + '</span>' +
        '<span class="text-[11px] ' + c + ' w-12 text-right">' + (ok || '…') + '</span></div>';
    }).join('');
  } catch (e) {}
}

async function loadLearn(s) {
  try {
    const r = await fetch('/api/' + s + '/learning');
    const d = await r.json();
    const st = d.streakAnalysis || {};
    $(s + '-stats').innerHTML =
      'Tổng <b class="text-white/60">' + d.totalPredictions + '</b><br>' +
      'Đúng <b class="text-emerald-400">' + d.correctPredictions + '</b> · <b class="text-amber-400/90">' + d.overallAccuracy + '</b><br>' +
      'Chuỗi <b class="text-white/60">' + (st.currentStreak || 0) + '</b>' +
      (d.recentWrongStreak ? '<br><span class="text-rose-400">Sai liên tục ' + d.recentWrongStreak + '</span>' : '') +
      (d.patternMemorySize ? '<br>Memory <b class="text-white/50">' + d.patternMemorySize + '</b>' : '');
    $(s + '-acc').textContent = d.overallAccuracy;
    $(s + '-streak').textContent = ((st.currentStreak || 0) >= 0 ? '+' : '') + (st.currentStreak || 0);
  } catch (e) {}
}

async function refreshAll() {
  await Promise.all([
    loadSide('hu'), loadSide('md5'),
    loadHist('hu'), loadHist('md5'),
    loadLearn('hu'), loadLearn('md5')
  ]);
}

refreshAll();
setInterval(refreshAll, 11000);
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
  console.log('  PHẠM KHÔI • ULTRA VIP ENGINE v3.1');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  API MD5 = CŨ (tele68)');
  console.log('  Thuật toán Bắt Cầu + Xúc Xắc siêu mạnh');
  console.log('  Anti-Loss-3 + Multi-Expert + Modern UI');
  console.log('══════════════════════════════════════════════════');
  setTimeout(autoRun, 1800);
  setInterval(autoRun, AUTO_INTERVAL);
});
