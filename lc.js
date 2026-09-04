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
const MAX_HISTORY = 350;
const AUTO_INTERVAL = 12000;
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
      chaos:   { correct: 0, total: 0, recent: [] },
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

// ===================== CORE ANALYZE v5 (Siêu VIP) =====================
function analyze(data, type) {
  if (!data || data.length < 22) {
    return {
      prediction: 'Xỉu',
      confidence: 53,
      factors: ['Thiếu dữ liệu'],
      reasons: ['Cần ≥22 phiên'],
      experts: {},
      agree: '-'
    };
  }

  const R = data.map(d => d.Ket_qua === 'Tài' ? 1 : 0);
  const H = [...R].reverse();
  const dice = data.map(d => ({
    faces: [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3],
    sum: d.Tong,
    result: d.Ket_qua === 'Tài' ? 1 : 0
  }));

  const mem = learningData[type].patternMemory || {};
  const expPerf = learningData[type].expertPerformance || emptyL().expertPerformance;

  // Time-decay memory
  const now = Date.now();
  if (!learningData[type].lastDecay || now - learningData[type].lastDecay > 3.5 * 3600 * 1000) {
    Object.keys(mem).forEach(k => {
      if (mem[k].hangLen > 1) mem[k].hangLen = Math.max(1, Math.floor(mem[k].hangLen * 0.82));
      if (mem[k].count > 2) mem[k].count = Math.max(1, Math.floor(mem[k].count * 0.88));
    });
    learningData[type].lastDecay = now;
  }

  function dynamicWeight(base, key) {
    const p = expPerf[key] || { correct: 0, total: 0, recent: [] };
    const recent = p.recent || [];
    if (recent.length < 8) return base;
    const recentAcc = recent.reduce((a, b) => a + b, 0) / recent.length;
    let multiplier = 0.52 + recentAcc * 1.05;
    if (recentAcc < 0.38) multiplier *= 0.50;
    else if (recentAcc < 0.46) multiplier *= 0.72;
    return base * multiplier;
  }

  function expertMarkov() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    const orders = [
      { o: 1, baseW: 1.20 },
      { o: 2, baseW: 2.05 },
      { o: 3, baseW: 2.65 },
      { o: 4, baseW: 2.95 },
      { o: 5, baseW: 3.15 }
    ];
    for (const { o, baseW } of orders) {
      if (H.length < o + 22) continue;
      const pat = H.slice(-o).join('');
      let t = 0, x = 0;
      const start = Math.max(0, H.length - 85);
      for (let i = start; i <= H.length - o - 1; i++) {
        if (H.slice(i, i + o).join('') === pat) {
          if (H[i + o] === 1) t++; else x++;
        }
      }
      const tot = t + x;
      if (tot < 3) continue;
      const pT = t / tot;
      const conf = 0.55 + Math.abs(pT - 0.5) * 0.96;
      const w = baseW * conf * Math.min(1.38, tot / 8);
      if (pT >= 0.5) scoreT += w; else scoreX += w;
      details.push('M' + o + ':' + (pT >= 0.5 ? 'T' : 'X') + '(' + Math.round(conf * 100) + '%)');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred, conf: Math.min(0.92, 0.56 + dom * 0.43),
      weight: dynamicWeight(2.95, 'markov'),
      details: details.slice(0, 3), scoreT, scoreX
    };
  }

  function expertPattern() {
    let bestLen = 0, next = null, matches = 0, memBoost = 0;
    for (let len = Math.min(13, H.length - 5); len >= 3; len--) {
      const suffix = H.slice(-len).join('');
      let t = 0, x = 0;
      const start = Math.max(0, H.length - 95);
      for (let i = start; i <= H.length - len - 1; i++) {
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
          memBoost = Math.min(2.3, (m.hangLen || 0) * 0.19 + (m.count || 0) * 0.12);
          if (m.success > m.fail) memBoost += 0.50;
        }
        break;
      }
    }
    if (bestLen === 0) {
      return { pred: R[0], conf: 0.52, weight: dynamicWeight(1.50, 'pattern'), details: ['Pattern yếu'], scoreT: 0.5, scoreX: 0.5 };
    }
    const conf = 0.59 + Math.min(0.27, bestLen * 0.017) + Math.min(0.14, matches * 0.015) + memBoost * 0.09;
    return {
      pred: next,
      conf: Math.min(0.91, conf),
      weight: dynamicWeight(2.50 + memBoost * 0.55, 'pattern'),
      details: ['Ptn' + bestLen + '→' + (next === 1 ? 'T' : 'X') + (memBoost > 0.4 ? '+Mem' : '')],
      scoreT: next === 1 ? conf : 1 - conf,
      scoreX: next === 0 ? conf : 1 - conf
    };
  }

  function expertStreak() {
    let streak = 1;
    for (let i = 1; i < R.length; i++) {
      if (R[i] === R[0]) streak++; else break;
    }
    const streakVal = R[0];
    let alt = 1;
    for (let i = 1; i < Math.min(R.length, 22); i++) {
      if (R[i] !== R[i - 1]) alt++; else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    if (streak === 2) {
      const w = 1.65; if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt2 theo');
    } else if (streak === 3) {
      const w = 2.40; if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt3 theo');
    } else if (streak === 4) {
      const w = 1.10; if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt4 thận');
    } else if (streak === 5) {
      const w = 3.35; if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ bệt5');
    } else if (streak >= 6) {
      const w = 4.00 + Math.min(2.1, (streak - 6) * 0.48);
      if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ bệt' + streak);
    }

    if (alt >= 5 && alt <= 8) {
      const w = 2.50; if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Đảo' + alt);
    } else if (alt >= 9) {
      const w = 1.55; if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push('Đứt đảo' + alt);
    }

    const last8 = R.slice(0, 8).join('');
    if (['11001100', '00110011', '10101010', '01010101', '11100011', '00011100'].includes(last8)) {
      const w = 2.25; if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Cầu cố định');
    }

    const last4 = R.slice(0, 4).join('');
    if (last4 === '1110' || last4 === '0001') {
      const w = 1.85; if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Cầu 3-1');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.57 + Math.abs(scoreT - scoreX) / total * 0.42;
    return {
      pred, conf: Math.min(0.93, conf),
      weight: dynamicWeight(2.65, 'streak'),
      details, scoreT, scoreX
    };
  }

  function expertDice() {
    const recent = dice.slice(0, 45);
    if (recent.length < 20) {
      return { pred: 0, conf: 0.52, weight: dynamicWeight(1.80, 'dice'), details: ['Dice thiếu'], scoreT: 0.5, scoreX: 0.5 };
    }

    let high = 0, low = 0, totalF = 0;
    recent.forEach(d => {
      d.faces.forEach(f => {
        if (f >= 1 && f <= 6) { totalF++; if (f >= 4) high++; else low++; }
      });
    });
    const highRatio = high / (totalF || 1);
    const lowRatio  = low  / (totalF || 1);

    const avg = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const avg25 = avg(recent.slice(0, 25).map(d => d.sum));
    const avg16 = avg(recent.slice(0, 16).map(d => d.sum));
    const avg10 = avg(recent.slice(0, 10).map(d => d.sum));
    const avg6  = avg(recent.slice(0, 6).map(d => d.sum));

    let consecHigh = 0, consecLow = 0;
    for (let i = 0; i < Math.min(12, recent.length); i++) {
      if (recent[i].sum >= 12) consecHigh++; else break;
    }
    for (let i = 0; i < Math.min(12, recent.length); i++) {
      if (recent[i].sum <= 9) consecLow++; else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    if (avg25 >= 12.6) { scoreX += 2.80; details.push('Sum25 cao'); }
    else if (avg25 <= 8.4) { scoreT += 2.80; details.push('Sum25 thấp'); }
    else if (avg25 >= 11.8) { scoreX += 1.45; details.push('Sum25 hơi cao'); }
    else if (avg25 <= 9.2) { scoreT += 1.45; details.push('Sum25 hơi thấp'); }

    if (avg16 >= 13.0) { scoreX += 1.90; details.push('Sum16 rất cao'); }
    else if (avg16 <= 8.0) { scoreT += 1.90; details.push('Sum16 rất thấp'); }

    if (avg10 >= 13.3) { scoreX += 1.70; details.push('Sum10 cực cao'); }
    else if (avg10 <= 7.7) { scoreT += 1.70; details.push('Sum10 cực thấp'); }

    if (avg6 >= 13.7) { scoreX += 1.40; details.push('Sum6 nóng'); }
    else if (avg6 <= 7.3) { scoreT += 1.40; details.push('Sum6 lạnh'); }

    if (highRatio >= 0.58) { scoreX += 2.05; details.push('Mặt cao'); }
    else if (lowRatio >= 0.58) { scoreT += 2.05; details.push('Mặt thấp'); }

    if (consecHigh >= 3) {
      scoreX += 1.90 + (consecHigh - 3) * 0.35;
      details.push('Cao liên' + consecHigh);
    }
    if (consecLow >= 3) {
      scoreT += 1.90 + (consecLow - 3) * 0.35;
      details.push('Thấp liên' + consecLow);
    }

    const lastSum = recent[0].sum;
    if (lastSum >= 16) { scoreX += 1.65; details.push('Cực cao'); }
    else if (lastSum <= 5) { scoreT += 1.65; details.push('Cực thấp'); }
    else if (lastSum >= 14) { scoreX += 0.95; details.push('Cao'); }
    else if (lastSum <= 7) { scoreT += 0.95; details.push('Thấp'); }

    const last22 = recent.slice(0, 22).map(d => d.result);
    const tai22 = last22.filter(x => x === 1).length;
    if (tai22 >= 15) { scoreX += 2.25; details.push('LệchT mạnh'); }
    else if (tai22 <= 7) { scoreT += 2.25; details.push('LệchX mạnh'); }
    else if (tai22 >= 14) { scoreX += 1.30; details.push('LệchT'); }
    else if (tai22 <= 8) { scoreT += 1.30; details.push('LệchX'); }

    let faceHigh12 = 0, faceLow12 = 0;
    recent.slice(0, 12).forEach(d => {
      d.faces.forEach(f => { if (f >= 4) faceHigh12++; else faceLow12++; });
    });
    const faceRatio12 = faceHigh12 / (faceHigh12 + faceLow12 || 1);
    if (faceRatio12 >= 0.64) { scoreX += 1.50; details.push('Mặt12 cao'); }
    else if (faceRatio12 <= 0.36) { scoreT += 1.50; details.push('Mặt12 thấp'); }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred, conf: Math.min(0.92, 0.58 + dom * 0.41),
      weight: dynamicWeight(2.90, 'dice'),
      details: details.slice(0, 5), scoreT, scoreX
    };
  }

  function expertBalance() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    [14, 20, 32, 48].forEach(w => {
      if (R.length < w) return;
      const slice = R.slice(0, w);
      const tai = slice.filter(x => x === 1).length;
      const ratio = tai / w;
      if (ratio >= 0.67) {
        scoreX += 1.70 * (w / 24);
        details.push('LệchT' + w);
      } else if (ratio <= 0.33) {
        scoreT += 1.70 * (w / 24);
        details.push('LệchX' + w);
      }
    });
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.54 + Math.abs(scoreT - scoreX) / total * 0.35;
    return {
      pred, conf,
      weight: dynamicWeight(1.75, 'balance'),
      details: details.slice(0, 3), scoreT, scoreX
    };
  }

  function expertCycle() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    let bestSc = 0, cyclePred = null, bestP = 0;
    for (const p of [2, 3, 4, 5, 6, 7, 8]) {
      if (R.length < p * 8) continue;
      let match = 0;
      const chk = p * 5;
      for (let i = 0; i < chk; i++) {
        if (R[i] === R[i + p]) match++;
      }
      const sc = match / chk;
      if (sc > 0.67 && sc > bestSc) {
        bestSc = sc;
        cyclePred = R[p - 1];
        bestP = p;
      }
    }
    if (cyclePred !== null) {
      const w = 2.25 * bestSc;
      if (cyclePred === 1) scoreT += w; else scoreX += w;
      details.push('Chu kỳ ' + bestP + ' (' + Math.round(bestSc * 100) + '%)');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.53 + Math.abs(scoreT - scoreX) / total * 0.38;
    return {
      pred, conf,
      weight: dynamicWeight(1.90, 'cycle'),
      details, scoreT, scoreX
    };
  }

  function expertChaos() {
    const last20 = R.slice(0, 20);
    let changes = 0;
    for (let i = 1; i < last20.length; i++) {
      if (last20[i] !== last20[i - 1]) changes++;
    }
    const volatility = changes / (last20.length - 1);
    let scoreT = 0, scoreX = 0;
    const details = [];
    if (volatility >= 0.67) {
      const w = 1.95; if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Hỗn loạn cao');
    } else if (volatility <= 0.33) {
      const w = 1.70; if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push('Ổn định');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.52 + Math.abs(scoreT - scoreX) / total * 0.32;
    return {
      pred, conf,
      weight: dynamicWeight(1.40, 'chaos'),
      details, scoreT, scoreX
    };
  }

  function expertTrend() {
    const last12 = R.slice(0, 12);
    const last8  = R.slice(0, 8);
    const last5  = R.slice(0, 5);
    const tai12 = last12.filter(x => x === 1).length;
    const tai8  = last8.filter(x => x === 1).length;
    const tai5  = last5.filter(x => x === 1).length;

    let scoreT = 0, scoreX = 0;
    const details = [];

    if (tai5 >= 4) { scoreX += 2.05; details.push('MomentumT5'); }
    else if (tai5 <= 1) { scoreT += 2.05; details.push('MomentumX5'); }

    if (tai8 >= 6) { scoreX += 1.65; details.push('MomentumT8'); }
    else if (tai8 <= 2) { scoreT += 1.65; details.push('MomentumX8'); }

    if (tai12 >= 9) { scoreX += 1.80; details.push('ReversionT12'); }
    else if (tai12 <= 3) { scoreT += 1.80; details.push('ReversionX12'); }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.55 + Math.abs(scoreT - scoreX) / total * 0.37;
    return {
      pred, conf,
      weight: dynamicWeight(2.20, 'trend'),
      details, scoreT, scoreX
    };
  }

  // Tổng hợp
  const m  = expertMarkov();
  const p  = expertPattern();
  const s  = expertStreak();
  const d  = expertDice();
  const b  = expertBalance();
  const c  = expertCycle();
  const ch = expertChaos();
  const tr = expertTrend();

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
    { name: 'Chaos',   e: ch, key: 'chaos'   },
    { name: 'Trend',   e: tr, key: 'trend'   }
  ];

  team.forEach(({ name, e }) => {
    const w = e.weight * e.conf;
    if (e.pred === 1) finalT += w; else finalX += w;
    if (e.details && e.details.length) {
      e.details.forEach(dt => factors.push(name[0] + ':' + dt));
    }
  });

  // Anti-Loss mạnh
  const wrong = learningData[type].recentWrongStreak || 0;
  const lastDir = learningData[type].lastPredDirection;

  if (wrong >= 3 && lastDir !== null) {
    if (lastDir === 1) { finalX += 9.0; finalT *= 0.10; }
    else { finalT += 9.0; finalX *= 0.10; }
    factors.unshift('BẺ-' + wrong + 'SAI');
    reasons.push('Thua ' + wrong + ' phiên → BẺ CỰC MẠNH');
  } else if (wrong >= 2 && lastDir !== null) {
    if (lastDir === 1) finalX += 3.2; else finalT += 3.2;
    factors.unshift('Nghiêng-' + wrong);
    reasons.push('Sai ' + wrong + ' phiên → nghiêng đảo');
  }

  const finalPred = finalT >= finalX ? 1 : 0;
  const totalScore = finalT + finalX || 1;
  const dominance = Math.abs(finalT - finalX) / totalScore;
  const agreeCount = team.filter(t => t.e.pred === finalPred).length;

  let conf = 56 + dominance * 29 + (agreeCount - 4) * 2.7;
  if (m.pred === finalPred && d.pred === finalPred) conf += 6.0;
  if (m.pred === finalPred && p.pred === finalPred) conf += 4.2;
  if (s.pred === finalPred && s.conf > 0.75) conf += 3.6;
  if (d.pred === finalPred && d.conf > 0.77) conf += 3.2;
  if (tr.pred === finalPred) conf += 2.4;

  if (wrong >= 2) conf -= 4.8;
  if (wrong >= 4) conf -= 7.0;

  const recentAccArr = learningData[type].recentAccuracy || [];
  if (recentAccArr.length >= 15) {
    const recentAcc = recentAccArr.slice(-15).reduce((a, b) => a + b, 0) / 15;
    if (recentAcc < 0.47) conf = Math.min(conf, 73);
  }

  conf = Math.max(54, Math.min(92, Math.round(conf)));

  // Update memory
  const currentSuffix = H.slice(-Math.min(10, H.length)).join('');
  if (!mem[currentSuffix]) {
    mem[currentSuffix] = { count: 1, hangLen: 1, success: 0, fail: 0, lastSeen: Date.now() };
  } else {
    mem[currentSuffix].count++;
    mem[currentSuffix].hangLen = (mem[currentSuffix].hangLen || 0) + 1;
    mem[currentSuffix].lastSeen = Date.now();
  }
  const keys = Object.keys(mem);
  if (keys.length > 520) {
    keys.sort((a, b) => (mem[a].lastSeen || 0) - (mem[b].lastSeen || 0));
    for (let i = 0; i < 130; i++) delete mem[keys[i]];
  }
  learningData[type].patternMemory = mem;
  learningData[type].lastPredDirection = finalPred;

  if (d.details.length) reasons.push('Xúc xắc: ' + d.details.slice(0, 2).join(', '));
  if (s.details.length) reasons.push('Cầu: ' + s.details[0]);
  if (p.details.length) reasons.push('Pattern: ' + p.details[0]);
  if (tr.details.length) reasons.push('Trend: ' + tr.details[0]);
  if (agreeCount >= 6) reasons.push('Đồng thuận ' + agreeCount + '/8');

  return {
    prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
    confidence: conf,
    factors: [...new Set(factors)].slice(0, 8),
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
      trend:   tr.pred === 1 ? 'Tài' : 'Xỉu',
      agreement: agreeCount + '/8'
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
  if (learningData[type].predictions.length > 900) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 900);
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
      ['markov', 'pattern', 'streak', 'dice', 'balance', 'cycle', 'chaos', 'trend'].forEach(k => {
        if (!exp[k]) exp[k] = { correct: 0, total: 0, recent: [] };
        exp[k].total = (exp[k].total || 0) + 1;
        if (pred.isCorrect) exp[k].correct = (exp[k].correct || 0) + 1;
        if (!Array.isArray(exp[k].recent)) exp[k].recent = [];
        exp[k].recent.push(pred.isCorrect ? 1 : 0);
        if (exp[k].recent.length > 22) exp[k].recent.shift();
        if (exp[k].total > 85) {
          exp[k].correct = Math.round(exp[k].correct * 0.76);
          exp[k].total   = Math.round(exp[k].total   * 0.76);
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
    if (learningData[type].recentAccuracy.length > 75) learningData[type].recentAccuracy.shift();
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
    setTimeout(() => updateStatus(type), 2000);

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

// ===================== CYBER NEON UI =====================
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
    --bg: #05050a;
    --cyan: #00f0ff;
    --pink: #ff2d6a;
    --blue: #3b82f6;
    --green: #22c55e;
    --card: rgba(10,12,22,0.92);
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
    min-height: 100vh; padding: 24px; text-align: center;
    background:
      radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,240,255,0.12), transparent),
      radial-gradient(ellipse 60% 40% at 80% 100%, rgba(255,45,106,0.08), transparent);
  }
  .home-logo {
    width: 90px; height: 90px; border-radius: 50%;
    background: linear-gradient(135deg, #00f0ff, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 28px; color: #000;
    box-shadow: 0 0 40px rgba(0,240,255,0.4);
    margin-bottom: 20px;
  }
  .home h1 {
    font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 800;
    letter-spacing: 2px; margin-bottom: 8px;
    background: linear-gradient(90deg, #00f0ff, #fff, #ff2d6a);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .home p { color: #94a3b8; font-size: 14px; margin-bottom: 40px; }
  .mode-btn {
    width: 100%; max-width: 320px; padding: 18px 24px; margin: 10px 0;
    border-radius: 16px; border: 1px solid rgba(0,240,255,0.25);
    background: rgba(0,20,40,0.6); color: #fff;
    font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700;
    letter-spacing: 1px; cursor: pointer; transition: all 0.25s;
    display: flex; align-items: center; justify-content: space-between;
  }
  .mode-btn:hover, .mode-btn:active {
    background: rgba(0,240,255,0.12); border-color: #00f0ff;
    box-shadow: 0 0 25px rgba(0,240,255,0.25); transform: scale(1.02);
  }
  .mode-btn span { font-size: 12px; color: #64748b; font-weight: 500; }

  /* DETAIL */
  .detail {
    padding: 16px 14px 30px; max-width: 420px; margin: 0 auto;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;
  }
  .back-btn {
    width: 40px; height: 40px; border-radius: 12px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    color: #94a3b8; font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .mode-label {
    font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: 700;
    color: #00f0ff; letter-spacing: 1px;
  }
  .clock { font-size: 12px; color: #64748b; font-variant-numeric: tabular-nums; }

  /* AI CIRCLE */
  .ai-wrap {
    display: flex; justify-content: center; margin: 10px 0 22px;
  }
  .ai-circle {
    width: 130px; height: 130px; border-radius: 50%;
    border: 3px solid rgba(0,240,255,0.3);
    background: radial-gradient(circle, rgba(0,30,50,0.9), rgba(5,5,15,0.95));
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative; box-shadow: 0 0 40px rgba(0,240,255,0.15);
  }
  .ai-circle::before {
    content: ''; position: absolute; inset: -8px; border-radius: 50%;
    border: 1px solid rgba(0,240,255,0.15);
    animation: spin 8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .ai-label {
    font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 900;
    color: #00f0ff; letter-spacing: 2px; text-shadow: 0 0 20px rgba(0,240,255,0.6);
  }
  .ai-sub {
    font-size: 10px; color: #64748b; margin-top: 4px; letter-spacing: 1px;
  }
  .ai-circle.pred-tai .ai-label { color: #ff2d6a; text-shadow: 0 0 20px rgba(255,45,106,0.6); }
  .ai-circle.pred-xiu .ai-label { color: #00f0ff; text-shadow: 0 0 20px rgba(0,240,255,0.6); }
  .ai-circle.blink-tai {
    animation: blinkTai 0.9s ease-in-out infinite;
    border-color: #ff2d6a;
  }
  .ai-circle.blink-xiu {
    animation: blinkXiu 0.9s ease-in-out infinite;
    border-color: #00f0ff;
  }
  @keyframes blinkTai {
    0%,100% { box-shadow: 0 0 20px rgba(255,45,106,0.3); }
    50% { box-shadow: 0 0 50px rgba(255,45,106,0.7); }
  }
  @keyframes blinkXiu {
    0%,100% { box-shadow: 0 0 20px rgba(0,240,255,0.3); }
    50% { box-shadow: 0 0 50px rgba(0,240,255,0.7); }
  }

  /* TÀI / XỈU CARDS */
  .pred-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;
  }
  .pred-card {
    border-radius: 16px; padding: 18px 12px; text-align: center;
    border: 1px solid rgba(255,255,255,0.08); background: rgba(8,10,20,0.8);
    transition: all 0.3s;
  }
  .pred-card.tai {
    border-color: rgba(255,45,106,0.25);
  }
  .pred-card.xiu {
    border-color: rgba(0,240,255,0.25);
  }
  .pred-card.active-tai {
    border-color: #ff2d6a;
    box-shadow: 0 0 30px rgba(255,45,106,0.35);
    background: rgba(40,5,20,0.7);
    animation: pulseTai 1s ease-in-out infinite;
  }
  .pred-card.active-xiu {
    border-color: #00f0ff;
    box-shadow: 0 0 30px rgba(0,240,255,0.35);
    background: rgba(5,20,35,0.7);
    animation: pulseXiu 1s ease-in-out infinite;
  }
  @keyframes pulseTai {
    0%,100% { box-shadow: 0 0 20px rgba(255,45,106,0.25); }
    50% { box-shadow: 0 0 40px rgba(255,45,106,0.55); }
  }
  @keyframes pulseXiu {
    0%,100% { box-shadow: 0 0 20px rgba(0,240,255,0.25); }
    50% { box-shadow: 0 0 40px rgba(0,240,255,0.55); }
  }
  .pred-title {
    font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 800;
    letter-spacing: 2px;
  }
  .pred-card.tai .pred-title { color: #ff2d6a; }
  .pred-card.xiu .pred-title { color: #00f0ff; }
  .pred-sum {
    font-size: 11px; color: #64748b; margin-top: 6px; letter-spacing: 0.5px;
  }
  .pred-conf {
    font-family: 'Orbitron', sans-serif; font-size: 18px; font-weight: 700;
    margin-top: 8px; color: #94a3b8;
  }
  .pred-card.active-tai .pred-conf,
  .pred-card.active-xiu .pred-conf { color: #fff; }

  /* STATS ROW */
  .stats-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;
  }
  .stat-box {
    border-radius: 14px; padding: 14px; text-align: center;
    background: rgba(8,10,20,0.85); border: 1px solid rgba(255,255,255,0.06);
  }
  .stat-label {
    font-size: 10px; color: #64748b; letter-spacing: 1.5px; margin-bottom: 6px;
    font-family: 'Orbitron', sans-serif;
  }
  .stat-value {
    font-family: 'Orbitron', sans-serif; font-size: 22px; font-weight: 700;
    color: #00f0ff;
  }
  .stat-bar {
    height: 3px; border-radius: 99px; background: rgba(255,255,255,0.08);
    margin-top: 10px; overflow: hidden;
  }
  .stat-bar > div {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #00f0ff, #3b82f6);
    transition: width 0.6s ease;
  }

  /* LOG */
  .log-box {
    border-radius: 16px; background: rgba(8,10,20,0.9);
    border: 1px solid rgba(0,240,255,0.12); overflow: hidden;
  }
  .log-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .log-title {
    font-family: 'Orbitron', sans-serif; font-size: 11px; font-weight: 700;
    color: #00f0ff; letter-spacing: 1px;
  }
  .log-count { font-size: 11px; color: #64748b; }
  .log-table {
    width: 100%; font-size: 11px; border-collapse: collapse;
  }
  .log-table th {
    padding: 8px 6px; text-align: center; color: #64748b;
    font-weight: 600; font-size: 10px; letter-spacing: 0.5px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .log-table td {
    padding: 9px 6px; text-align: center;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .log-table tr:last-child td { border-bottom: none; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 6px;
    font-weight: 600; font-size: 10px;
  }
  .badge-tai { background: rgba(255,45,106,0.15); color: #ff2d6a; }
  .badge-xiu { background: rgba(0,240,255,0.15); color: #00f0ff; }
  .badge-win { background: rgba(34,197,94,0.15); color: #22c55e; }
  .badge-lose { background: rgba(239,68,68,0.15); color: #ef4444; }
  .badge-wait { background: rgba(100,116,139,0.2); color: #94a3b8; }

  .info-line {
    text-align: center; font-size: 11px; color: #475569; margin-top: 14px;
  }
  .xx-info {
    text-align: center; font-size: 12px; color: #64748b; margin-bottom: 12px;
  }
</style>
</head>
<body>

<!-- ==================== HOME ==================== -->
<div id="page-home" class="page active home">
  <div class="home-logo">PK</div>
  <h1>PHẠM KHÔI</h1>
  <p>Ultra VIP Adaptive Engine v5</p>
  <button class="mode-btn" onclick="goMode('hu')">
    TÀI XỈU HŨ
    <span>Chọn →</span>
  </button>
  <button class="mode-btn" onclick="goMode('md5')">
    TÀI XỈU MD5
    <span>Chọn →</span>
  </button>
</div>

<!-- ==================== DETAIL ==================== -->
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
        <div class="stat-value" id="aiOutput" style="font-size:16px;color:#a78bfa">—</div>
      </div>
    </div>

    <div class="log-box">
      <div class="log-header">
        <div class="log-title">▣ PREDICTION_LOG</div>
        <div class="log-count" id="logCount">0 records</div>
      </div>
      <div style="max-height:280px;overflow-y:auto">
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
  // reset UI
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

    // AI Circle
    $('aiPred').textContent = pred === 'Tài' ? 'TÀI' : pred === 'Xỉu' ? 'XỈU' : '—';
    $('aiSub').textContent = '#' + (d.Phien_hien_tai || '—');
    $('aiCircle').className = 'ai-circle ' + (pred === 'Tài' ? 'pred-tai blink-tai' : pred === 'Xỉu' ? 'pred-xiu blink-xiu' : '');

    // Cards
    $('cardTai').className = 'pred-card tai' + (pred === 'Tài' ? ' active-tai' : '');
    $('cardXiu').className = 'pred-card xiu' + (pred === 'Xỉu' ? ' active-xiu' : '');
    if (pred === 'Tài') {
      $('confTai').textContent = conf + '%';
      $('confXiu').textContent = (100 - conf) + '%';
    } else {
      $('confXiu').textContent = conf + '%';
      $('confTai').textContent = (100 - conf) + '%';
    }

    // XX info
    $('xxInfo').textContent = 'XX ' + d.Xuc_xac_1 + ' ' + d.Xuc_xac_2 + ' ' + d.Xuc_xac_3 + ' · Tổng ' + d.Tong + ' · ' + d.Ket_qua;
    $('phienInfo').textContent = 'Phiên hiện tại: #' + d.Phien + ' → Dự đoán #' + d.Phien_hien_tai;

    // Stats
    const acc = l.overallAccuracy || '0.0%';
    $('winRate').textContent = acc;
    $('winBar').style.width = parseFloat(acc) + '%';
    $('aiOutput').textContent = pred || 'NULL';

    // Log
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

// Auto refresh khi đang ở detail
setInterval(() => {
  if ($('page-detail').classList.contains('active')) loadData();
}, 10000);
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
  console.log('  PHẠM KHÔI • ULTRA VIP ENGINE v5.0');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Cyber Neon UI + Dual Mode (Hũ / MD5)');
  console.log('  8 Experts + Anti-Decay + Recent Dominance');
  console.log('══════════════════════════════════════════════════');
  setTimeout(autoRun, 1500);
  setInterval(autoRun, AUTO_INTERVAL);
});
