const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'phamkhoi.json';
const HISTORY_FILE = 'phamkhoi1.json';

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
    lastStrategy: 'hybrid',
    patternMemory: {},
    expertPerformance: {
      markov: { correct: 0, total: 0 },
      pattern: { correct: 0, total: 0 },
      streak: { correct: 0, total: 0 },
      dice: { correct: 0, total: 0 },
      balance: { correct: 0, total: 0 },
      bridge: { correct: 0, total: 0 }
    }
  };
}

function loadL() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = {
        hu: { ...emptyL(), ...(loaded.hu || {}) },
        md5: { ...emptyL(), ...(loaded.md5 || {}) }
      };
      if (!learningData.hu.patternMemory) learningData.hu.patternMemory = {};
      if (!learningData.md5.patternMemory) learningData.md5.patternMemory = {};
      if (!learningData.hu.expertPerformance.bridge) learningData.hu.expertPerformance.bridge = { correct: 0, total: 0 };
      if (!learningData.md5.expertPerformance.bridge) learningData.md5.expertPerformance.bridge = { correct: 0, total: 0 };
    }
  } catch (e) {}
}

function saveL() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (e) {}
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
    }
  } catch (e) {}
}

function saveH() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien: lastProcessed,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {}
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
    const r = await axios.get(API_URL_HU, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    return null;
  }
}

async function fetchMd5() {
  try {
    const r = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    return null;
  }
}

function analyze(data, type) {
  if (!data || data.length < 20) {
    return {
      prediction: 'Xỉu',
      confidence: 51,
      factors: ['Thiếu dữ liệu'],
      reasons: ['Cần tối thiểu 20 phiên'],
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
  const wrong = learningData[type].recentWrongStreak || 0;
  const lastDir = learningData[type].lastPredDirection;

  function dynamicWeight(base, key) {
    const p = expPerf[key] || { correct: 0, total: 0 };
    if (p.total < 10) return base;
    const acc = p.correct / p.total;
    return base * (0.70 + acc * 0.65);
  }

  function expertMarkov() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    const orders = [
      { o: 1, baseW: 1.25 },
      { o: 2, baseW: 1.95 },
      { o: 3, baseW: 2.55 },
      { o: 4, baseW: 2.85 },
      { o: 5, baseW: 2.35 }
    ];
    for (const { o, baseW } of orders) {
      if (H.length < o + 16) continue;
      const pat = H.slice(-o).join('');
      let t = 0, x = 0;
      for (let i = 0; i <= H.length - o - 1; i++) {
        if (H.slice(i, i + o).join('') === pat) {
          if (H[i + o] === 1) t++;
          else x++;
        }
      }
      const tot = t + x;
      if (tot < 4) continue;
      const pT = t / tot;
      const conf = 0.54 + Math.abs(pT - 0.5) * 0.92;
      const w = baseW * conf * Math.min(1.25, tot / 7);
      if (pT >= 0.5) scoreT += w;
      else scoreX += w;
      details.push('M' + o + ':' + (pT >= 0.5 ? 'T' : 'X') + '(' + Math.round(conf * 100) + '%)');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred,
      conf: Math.min(0.89, 0.55 + dom * 0.40),
      weight: dynamicWeight(2.80, 'markov'),
      details: details.slice(0, 3),
      scoreT, scoreX
    };
  }

  function expertPattern() {
    let bestLen = 0;
    let next = null;
    let matches = 0;
    let memBoost = 0;
    for (let len = Math.min(14, H.length - 4); len >= 3; len--) {
      const suffix = H.slice(-len).join('');
      let t = 0, x = 0;
      for (let i = 0; i <= H.length - len - 1; i++) {
        if (H.slice(i, i + len).join('') === suffix) {
          if (H[i + len] === 1) t++;
          else x++;
        }
      }
      const tot = t + x;
      if (tot >= 3) {
        bestLen = len;
        next = t >= x ? 1 : 0;
        matches = tot;
        const key = suffix;
        if (mem[key]) {
          const m = mem[key];
          memBoost = Math.min(2.0, (m.hangLen || 0) * 0.18 + (m.count || 0) * 0.09);
          if (m.success > m.fail) memBoost += 0.45;
        }
        break;
      }
    }
    if (bestLen === 0) {
      return { pred: R[0], conf: 0.53, weight: dynamicWeight(1.55, 'pattern'), details: ['Ptn yếu'], scoreT: 0.5, scoreX: 0.5 };
    }
    const conf = 0.58 + Math.min(0.28, bestLen * 0.022) + Math.min(0.12, matches * 0.018) + memBoost * 0.09;
    const details = ['Ptn' + bestLen + '→' + (next === 1 ? 'T' : 'X') + (memBoost > 0.4 ? '+Mem' : '')];
    return {
      pred: next,
      conf: Math.min(0.88, conf),
      weight: dynamicWeight(2.35 + memBoost * 0.45, 'pattern'),
      details,
      scoreT: next === 1 ? conf : 1 - conf,
      scoreX: next === 0 ? conf : 1 - conf
    };
  }

  function expertStreak() {
    let streak = 1;
    for (let i = 1; i < R.length; i++) {
      if (R[i] === R[0]) streak++;
      else break;
    }
    const streakVal = R[0];
    let alt = 1;
    for (let i = 1; i < Math.min(R.length, 18); i++) {
      if (R[i] !== R[i - 1]) alt++;
      else break;
    }
    let scoreT = 0, scoreX = 0;
    const details = [];

    if (streak === 1) {
      const w = 1.35;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Cầu1');
    } else if (streak === 2) {
      const w = 1.65;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt2 theo');
    } else if (streak === 3) {
      const w = 1.45;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt3');
    } else if (streak === 4) {
      const w = 0.85;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push('Bệt4 thận');
    } else if (streak === 5) {
      const w = 2.35;
      if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ5');
    } else if (streak >= 6) {
      const w = 2.85 + Math.min(1.5, (streak - 6) * 0.35);
      if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push('Bẻ' + streak);
    }

    if (alt >= 4 && alt <= 6) {
      const w = 1.85;
      if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push('Đảo' + alt);
    } else if (alt >= 7) {
      const w = 1.25;
      if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push('Đứt' + alt);
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.56 + Math.abs(scoreT - scoreX) / total * 0.38;
    return {
      pred,
      conf,
      weight: dynamicWeight(2.25, 'streak'),
      details,
      scoreT, scoreX
    };
  }

  function expertDice() {
    const recent = dice.slice(0, 35);
    if (recent.length < 14) {
      return { pred: 0, conf: 0.53, weight: dynamicWeight(1.85, 'dice'), details: ['Dice thiếu'], scoreT: 0.5, scoreX: 0.5 };
    }
    let high = 0, low = 0, totalF = 0;
    recent.forEach(d => {
      d.faces.forEach(f => {
        if (f >= 1 && f <= 6) {
          totalF++;
          if (f >= 4) high++;
          else low++;
        }
      });
    });
    const highRatio = high / (totalF || 1);
    const lowRatio = low / (totalF || 1);
    const sums14 = recent.slice(0, 14).map(d => d.sum);
    const avg14 = sums14.reduce((a, b) => a + b, 0) / 14;
    const sums9 = recent.slice(0, 9).map(d => d.sum);
    const avg9 = sums9.reduce((a, b) => a + b, 0) / 9;
    let consecHigh = 0, consecLow = 0;
    for (let i = 0; i < Math.min(9, recent.length); i++) {
      if (recent[i].sum >= 12) consecHigh++;
      else break;
    }
    for (let i = 0; i < Math.min(9, recent.length); i++) {
      if (recent[i].sum <= 9) consecLow++;
      else break;
    }
    let scoreT = 0, scoreX = 0;
    const details = [];
    if (avg14 >= 12.8) { scoreX += 2.45; details.push('Sum14 cao'); }
    else if (avg14 <= 8.2) { scoreT += 2.45; details.push('Sum14 thấp'); }
    else if (avg14 >= 11.9) { scoreX += 1.25; details.push('Sum14 hơi cao'); }
    else if (avg14 <= 9.1) { scoreT += 1.25; details.push('Sum14 hơi thấp'); }
    if (avg9 >= 13.4) { scoreX += 1.55; details.push('Sum9 cực cao'); }
    else if (avg9 <= 7.6) { scoreT += 1.55; details.push('Sum9 cực thấp'); }
    if (highRatio >= 0.62) { scoreX += 1.75; details.push('Mặt cao'); }
    else if (lowRatio >= 0.62) { scoreT += 1.75; details.push('Mặt thấp'); }
    if (consecHigh >= 3) {
      scoreX += 1.55 + (consecHigh - 3) * 0.28;
      details.push('Cao' + consecHigh);
    }
    if (consecLow >= 3) {
      scoreT += 1.55 + (consecLow - 3) * 0.28;
      details.push('Thấp' + consecLow);
    }
    const lastSum = recent[0].sum;
    if (lastSum >= 16) { scoreX += 1.35; details.push('Cực cao'); }
    else if (lastSum <= 5) { scoreT += 1.35; details.push('Cực thấp'); }
    const last18 = recent.slice(0, 18).map(d => d.result);
    const tai18 = last18.filter(x => x === 1).length;
    if (tai18 >= 13) { scoreX += 1.65; details.push('LệchT'); }
    else if (tai18 <= 5) { scoreT += 1.65; details.push('LệchX'); }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred,
      conf: Math.min(0.88, 0.57 + dom * 0.37),
      weight: dynamicWeight(2.65, 'dice'),
      details: details.slice(0, 4),
      scoreT, scoreX
    };
  }

  function expertBalance() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    [9, 13, 19, 28].forEach(w => {
      if (R.length < w) return;
      const slice = R.slice(0, w);
      const tai = slice.filter(x => x === 1).length;
      const ratio = tai / w;
      if (ratio >= 0.78) {
        scoreX += 1.45 * (w / 16);
        details.push('LệchT' + w);
      } else if (ratio <= 0.22) {
        scoreT += 1.45 * (w / 16);
        details.push('LệchX' + w);
      }
    });
    let bestSc = 0, cyclePred = null;
    for (const p of [2, 3, 4, 5]) {
      if (R.length < p * 6) continue;
      let match = 0;
      const chk = p * 4;
      for (let i = 0; i < chk; i++) {
        if (R[i] === R[i + p]) match++;
      }
      const sc = match / chk;
      if (sc > 0.76 && sc > bestSc) {
        bestSc = sc;
        cyclePred = R[p - 1];
      }
    }
    if (cyclePred !== null) {
      const w = 1.75 * bestSc;
      if (cyclePred === 1) scoreT += w;
      else scoreX += w;
      details.push('Chu kỳ');
    }
    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.55 + Math.abs(scoreT - scoreX) / total * 0.32;
    return {
      pred,
      conf,
      weight: dynamicWeight(1.70, 'balance'),
      details: details.slice(0, 3),
      scoreT, scoreX
    };
  }

  function expertBridge() {
    const recent = H.slice(-12);
    if (recent.length < 6) {
      return { pred: R[0], conf: 0.54, weight: dynamicWeight(1.90, 'bridge'), details: ['Bridge thiếu'], scoreT: 0.5, scoreX: 0.5 };
    }
    let changes = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] !== recent[i - 1]) changes++;
    }
    const last = recent[recent.length - 1];
    let scoreT = 0, scoreX = 0;
    const details = [];

    if (changes <= 2) {
      const w = 1.95;
      if (last === 1) scoreT += w; else scoreX += w;
      details.push('Cầu bệt');
    } else if (changes >= 5) {
      const w = 1.75;
      if (last === 1) scoreX += w; else scoreT += w;
      details.push('Chờ bệt');
    } else {
      const w = 1.35;
      if (last === 1) scoreT += w; else scoreX += w;
      details.push('Cầu ngắn');
    }

    let shortToLong = 0;
    for (let i = recent.length - 1; i >= 1; i--) {
      if (recent[i] === recent[i - 1]) shortToLong++;
      else break;
    }
    if (shortToLong >= 2 && shortToLong <= 3) {
      const w = 1.55;
      if (last === 1) scoreT += w; else scoreX += w;
      details.push('Ngắn→Bệt');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.57 + Math.abs(scoreT - scoreX) / total * 0.34;
    return {
      pred,
      conf,
      weight: dynamicWeight(2.15, 'bridge'),
      details,
      scoreT, scoreX
    };
  }

  const m = expertMarkov();
  const p = expertPattern();
  const s = expertStreak();
  const d = expertDice();
  const b = expertBalance();
  const br = expertBridge();

  let finalT = 0, finalX = 0;
  const factors = [];
  const reasons = [];

  const team = [
    { name: 'Markov', e: m, key: 'markov' },
    { name: 'Pattern', e: p, key: 'pattern' },
    { name: 'Streak', e: s, key: 'streak' },
    { name: 'Dice', e: d, key: 'dice' },
    { name: 'Balance', e: b, key: 'balance' },
    { name: 'Bridge', e: br, key: 'bridge' }
  ];

  team.forEach(({ name, e }) => {
    const w = e.weight * e.conf;
    if (e.pred === 1) finalT += w;
    else finalX += w;
    if (e.details && e.details.length) {
      e.details.forEach(dt => factors.push(name[0] + dt));
    }
  });

  if (wrong >= 3 && lastDir !== null) {
    if (lastDir === 1) {
      finalX += 6.2;
      finalT *= 0.22;
    } else {
      finalT += 6.2;
      finalX *= 0.22;
    }
    factors.unshift('Đảo' + wrong);
    reasons.push('Sai liên tiếp ' + wrong + ' → đảo mạnh');
  } else if (wrong >= 2 && lastDir !== null) {
    if (lastDir === 1) finalX += 2.35;
    else finalT += 2.35;
    factors.unshift('Nghiêng' + wrong);
  }

  if (wrong === 0 && learningData[type].streakAnalysis.currentStreak >= 3) {
    const boost = 1.45;
    if (lastDir === 1) finalT += boost;
    else finalX += boost;
    reasons.push('Thắng chuỗi → giữ chiến lược');
  }

  const finalPred = finalT >= finalX ? 1 : 0;
  const totalScore = finalT + finalX || 1;
  const dominance = Math.abs(finalT - finalX) / totalScore;
  const agreeCount = team.filter(t => t.e.pred === finalPred).length;

  let conf = 56 + dominance * 26 + (agreeCount - 3) * 3.2;
  if (m.pred === finalPred && d.pred === finalPred) conf += 6.0;
  if (m.pred === finalPred && p.pred === finalPred) conf += 4.2;
  if (br.pred === finalPred && s.pred === finalPred) conf += 3.5;
  if (wrong >= 2) conf -= 4.0;
  if (wrong >= 4) conf -= 5.5;
  if (data.length < 30) conf -= 3.0;
  conf = Math.max(52, Math.min(91, Math.round(conf)));

  const currentSuffix = H.slice(-Math.min(9, H.length)).join('');
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
    for (let i = 0; i < 90; i++) delete mem[keys[i]];
  }
  learningData[type].patternMemory = mem;
  learningData[type].lastPredDirection = finalPred;
  learningData[type].lastStrategy = agreeCount >= 4 ? 'consensus' : (wrong >= 3 ? 'reverse' : 'hybrid');

  if (d.details.length) reasons.push('Xúc xắc: ' + d.details.slice(0, 2).join(', '));
  if (s.details.length) reasons.push('Cầu: ' + s.details[0]);
  if (br.details.length) reasons.push('Bridge: ' + br.details[0]);
  if (agreeCount >= 5) reasons.push('Đồng thuận ' + agreeCount + '/6');

  return {
    prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
    confidence: conf,
    factors: [...new Set(factors)].slice(0, 7),
    reasons: reasons.slice(0, 4),
    agree: (finalT > finalX ? 'T' : 'X') + '(' + Math.round(dominance * 100) + '%)',
    experts: {
      markov: m.pred === 1 ? 'Tài' : 'Xỉu',
      pattern: p.pred === 1 ? 'Tài' : 'Xỉu',
      streak: s.pred === 1 ? 'Tài' : 'Xỉu',
      dice: d.pred === 1 ? 'Tài' : 'Xỉu',
      balance: b.pred === 1 ? 'Tài' : 'Xỉu',
      bridge: br.pred === 1 ? 'Tài' : 'Xỉu',
      agreement: agreeCount + '/6'
    }
  };
}

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
      ['markov', 'pattern', 'streak', 'dice', 'balance', 'bridge'].forEach(k => {
        if (!exp[k]) exp[k] = { correct: 0, total: 0 };
        exp[k].total = (exp[k].total || 0) + 1;
        if (pred.isCorrect) exp[k].correct = (exp[k].correct || 0) + 1;
        if (exp[k].total > 70) {
          exp[k].correct = Math.round(exp[k].correct * 0.82);
          exp[k].total = Math.round(exp[k].total * 0.82);
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
        saveH();
        saveL();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) {}
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
    res.status(500).json({ error: 'Lỗi server' });
  }
}

app.get('/api/hu', (req, res) => handle('hu', fetchHu, req, res));
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
  res.json({ message: 'Reset OK' });
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Phạm Khôi • VIP BlueBlack</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<style>
*{font-family:Inter,system-ui,sans-serif;box-sizing:border-box;margin:0;padding:0}
body{background:#020617;color:#e2e8f0;min-height:100vh;background-image:radial-gradient(ellipse 90% 60% at 50% -30%,rgba(14,165,233,.12),transparent),radial-gradient(ellipse 60% 50% at 100% 100%,rgba(6,182,212,.08),transparent),radial-gradient(ellipse 50% 40% at 0% 80%,rgba(59,130,246,.06),transparent)}
.glass{background:rgba(15,23,42,.82);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(56,189,248,.12);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.tai{color:#22d3ee}.xiu{color:#38bdf8}
.glow-t{box-shadow:0 0 40px -6px rgba(34,211,238,.35),inset 0 1px 0 rgba(34,211,238,.15)}
.glow-x{box-shadow:0 0 40px -6px rgba(56,189,248,.35),inset 0 1px 0 rgba(56,189,248,.15)}
.dot{width:8px;height:8px;border-radius:50%;animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}
.chip{font-size:10px;padding:3px 9px;border-radius:999px;background:rgba(14,165,233,.08);border:1px solid rgba(56,189,248,.15);color:rgba(186,230,253,.55)}
.mono{font-family:'JetBrains Mono',monospace}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(56,189,248,.15);border-radius:4px}
.bar{height:4px;border-radius:99px;background:rgba(15,23,42,.9);overflow:hidden;border:1px solid rgba(56,189,248,.1)}
.bar>div{height:100%;border-radius:99px;transition:width .6s cubic-bezier(.22,1,.36,1)}
.card-enter{animation:fadeUp .5s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.btn{transition:all .2s ease}
.btn:active{transform:scale(.96)}
.header-glow{background:linear-gradient(135deg,#0ea5e9,#06b6d4,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
</style>
</head>
<body class="px-3 py-5 max-w-md mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-400 via-cyan-500 to-blue-600 flex items-center justify-center text-[12px] font-black text-slate-950 shadow-lg shadow-cyan-500/25">PK</div>
      <div>
        <div class="font-extrabold text-[16px] leading-none tracking-tight header-glow">Phạm Khôi</div>
        <div class="text-[10px] text-sky-300/40 mt-1 font-medium tracking-wide">VIP BlueBlack Engine</div>
      </div>
    </div>
    <div class="flex items-center gap-2.5">
      <span id="clock" class="text-[10px] text-sky-200/25 mono tabular-nums"></span>
      <button onclick="go()" class="btn text-[11px] px-3.5 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300/80 font-semibold border border-sky-400/15">Làm mới</button>
    </div>
  </div>

  <div class="space-y-3.5 mb-6">
    <div id="c-hu" class="glass p-4 card-enter transition-all duration-500">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2"><span class="dot bg-cyan-400"></span><span class="text-[12px] font-semibold text-sky-200/60">Hũ</span></div>
        <span id="hu-p" class="text-[10px] text-sky-300/30 mono">#—</span>
      </div>
      <div class="text-center py-1.5">
        <div id="hu-d" class="text-[36px] font-black tracking-tight leading-none">—</div>
        <div id="hu-c" class="text-[18px] font-bold text-cyan-400/90 mt-2">—%</div>
        <div class="bar mt-3 mx-auto max-w-[140px]"><div id="hu-bar" class="bg-gradient-to-r from-cyan-400 to-sky-500" style="width:0%"></div></div>
      </div>
      <div class="flex justify-center gap-6 text-[11px] text-sky-200/35 mt-2.5 mb-2">
        <span>XX <b id="hu-x" class="text-sky-100/70 mono font-medium">—</b></span>
        <span>Tổng <b id="hu-t" class="text-sky-100/70 font-medium">—</b></span>
      </div>
      <div id="hu-f" class="flex flex-wrap gap-1.5 justify-center min-h-[22px] mb-1.5"></div>
      <div id="hu-r" class="text-[10px] text-sky-200/35 text-center mb-1.5 leading-snug px-1"></div>
      <div id="hu-e" class="text-[10px] text-sky-300/25 text-center mb-2 mono"></div>
      <div class="grid grid-cols-3 gap-1.5 pt-3 border-t border-sky-400/10 text-center text-[10px]">
        <div><div class="text-sky-300/30 mb-0.5">Đúng</div><div id="hu-a" class="font-bold text-cyan-400 text-[13px]">—</div></div>
        <div><div class="text-sky-300/30 mb-0.5">Chuỗi</div><div id="hu-s" class="font-bold text-[13px] text-sky-100/80">—</div></div>
        <div><div class="text-sky-300/30 mb-0.5">Phiên</div><div id="hu-n" class="font-bold text-sky-400/70 text-[13px]">#—</div></div>
      </div>
    </div>

    <div id="c-md5" class="glass p-4 card-enter transition-all duration-500" style="animation-delay:.08s">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2"><span class="dot bg-blue-400"></span><span class="text-[12px] font-semibold text-sky-200/60">MD5</span></div>
        <span id="md5-p" class="text-[10px] text-sky-300/30 mono">#—</span>
      </div>
      <div class="text-center py-1.5">
        <div id="md5-d" class="text-[36px] font-black tracking-tight leading-none">—</div>
        <div id="md5-c" class="text-[18px] font-bold text-blue-400/90 mt-2">—%</div>
        <div class="bar mt-3 mx-auto max-w-[140px]"><div id="md5-bar" class="bg-gradient-to-r from-blue-400 to-indigo-500" style="width:0%"></div></div>
      </div>
      <div class="flex justify-center gap-6 text-[11px] text-sky-200/35 mt-2.5 mb-2">
        <span>XX <b id="md5-x" class="text-sky-100/70 mono font-medium">—</b></span>
        <span>Tổng <b id="md5-t" class="text-sky-100/70 font-medium">—</b></span>
      </div>
      <div id="md5-f" class="flex flex-wrap gap-1.5 justify-center min-h-[22px] mb-1.5"></div>
      <div id="md5-r" class="text-[10px] text-sky-200/35 text-center mb-1.5 leading-snug px-1"></div>
      <div id="md5-e" class="text-[10px] text-sky-300/25 text-center mb-2 mono"></div>
      <div class="grid grid-cols-3 gap-1.5 pt-3 border-t border-sky-400/10 text-center text-[10px]">
        <div><div class="text-sky-300/30 mb-0.5">Đúng</div><div id="md5-a" class="font-bold text-cyan-400 text-[13px]">—</div></div>
        <div><div class="text-sky-300/30 mb-0.5">Chuỗi</div><div id="md5-s" class="font-bold text-[13px] text-sky-100/80">—</div></div>
        <div><div class="text-sky-300/30 mb-0.5">Phiên</div><div id="md5-n" class="font-bold text-sky-400/70 text-[13px]">#—</div></div>
      </div>
    </div>
  </div>

  <div class="space-y-3.5 mb-6">
    <div class="glass p-3.5 card-enter" style="animation-delay:.12s">
      <div class="text-[11px] font-semibold text-sky-300/45 mb-2.5 flex items-center gap-1.5"><span class="w-1 h-3.5 rounded-full bg-cyan-400/70"></span>Lịch sử Hũ</div>
      <div id="hu-h" class="space-y-0 max-h-48 overflow-y-auto text-[11px]"></div>
    </div>
    <div class="glass p-3.5 card-enter" style="animation-delay:.16s">
      <div class="text-[11px] font-semibold text-sky-300/45 mb-2.5 flex items-center gap-1.5"><span class="w-1 h-3.5 rounded-full bg-blue-400/70"></span>Lịch sử MD5</div>
      <div id="md5-h" class="space-y-0 max-h-48 overflow-y-auto text-[11px]"></div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-3 mb-6">
    <div class="glass p-3.5 card-enter" style="animation-delay:.2s">
      <div class="text-[10px] font-semibold text-sky-300/40 mb-2">Thống kê Hũ</div>
      <div id="hu-l" class="text-[11px] text-sky-200/40 space-y-1 leading-relaxed"></div>
    </div>
    <div class="glass p-3.5 card-enter" style="animation-delay:.24s">
      <div class="text-[10px] font-semibold text-sky-300/40 mb-2">Thống kê MD5</div>
      <div id="md5-l" class="text-[11px] text-sky-200/40 space-y-1 leading-relaxed"></div>
    </div>
  </div>

  <div class="text-center text-[10px] text-sky-400/20 pb-5 tracking-widest uppercase">Phạm Khôi • VIP BlueBlack Adaptive</div>

<script>
const $=id=>document.getElementById(id);
const tick=()=>$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false});
setInterval(tick,1000);tick();
const pc=p=>p==='Tài'?'tai':p==='Xỉu'?'xiu':'';
const gc=p=>p==='Tài'?'glow-t':p==='Xỉu'?'glow-x':'';
async function side(s){
  try{
    const r=await fetch('/api/'+s);const d=await r.json();if(d.error)return;
    $(s+'-p').textContent='#'+d.Phien;
    $(s+'-n').textContent='#'+d.Phien_hien_tai;
    $(s+'-d').textContent=d.Du_doan;
    $(s+'-d').className='text-[36px] font-black tracking-tight leading-none '+pc(d.Du_doan);
    $(s+'-c').textContent=d.Do_tin_cay;
    const confNum=parseInt(d.Do_tin_cay)||0;
    $(s+'-bar').style.width=confNum+'%';
    $(s+'-x').textContent=d.Xuc_xac_1+' '+d.Xuc_xac_2+' '+d.Xuc_xac_3;
    $(s+'-t').textContent=d.Tong+' · '+d.Ket_qua;
    $('c-'+s).className='glass p-4 card-enter transition-all duration-500 '+gc(d.Du_doan);
    $(s+'-f').innerHTML=(d.factors||[]).slice(0,6).map(f=>'<span class="chip">'+f+'</span>').join('');
    $(s+'-r').textContent=(d.reasons||[]).slice(0,2).join(' • ')||'';
    if(d.experts){
      const e=d.experts;
      $(s+'-e').textContent='M:'+e.markov+' P:'+e.pattern+' S:'+e.streak+' D:'+e.dice+' B:'+e.balance+' Br:'+e.bridge+' · '+e.agreement;
    }else $(s+'-e').textContent='';
  }catch(e){}
}
async function hist(s){
  try{
    const r=await fetch('/api/'+s+'/lichsu');const d=await r.json();
    const b=$(s+'-h');
    if(!d.history||!d.history.length){b.innerHTML='<div class="text-sky-400/20 text-center py-5 text-[11px]">Chưa có dữ liệu</div>';return}
    b.innerHTML=d.history.slice(0,18).map(h=>{
      const ok=h.ket_qua_du_doan||'';
      const c=ok.includes('Đúng')?'text-cyan-400':ok.includes('Sai')?'text-rose-400':'text-sky-300/25';
      return '<div class="flex items-center justify-between py-[6px] border-b border-sky-400/5 last:border-0">'+
        '<span class="mono text-[10px] text-sky-300/30 w-14">#'+h.Phien_hien_tai+'</span>'+
        '<span class="font-semibold '+pc(h.Du_doan)+' w-10 text-center">'+h.Du_doan+'</span>'+
        '<span class="text-[10px] text-sky-300/35 w-10 text-center">'+h.Do_tin_cay+'</span>'+
        '<span class="text-[10px] '+c+' w-10 text-right">'+(ok||'…')+'</span></div>';
    }).join('');
  }catch(e){}
}
async function learn(s){
  try{
    const r=await fetch('/api/'+s+'/learning');const d=await r.json();
    const st=d.streakAnalysis||{};
    $(s+'-l').innerHTML='Tổng <b class="text-sky-100/70">'+d.totalPredictions+'</b><br>Đúng <b class="text-cyan-400">'+d.correctPredictions+'</b> · <b class="text-sky-300/80">'+d.overallAccuracy+'</b><br>Chuỗi <b class="text-sky-100/70">'+(st.currentStreak||0)+'</b>'+(d.recentWrongStreak?'<br><span class="text-rose-400/90">Sai liên tục '+d.recentWrongStreak+'</span>':'')+(d.patternMemorySize?'<br>Memory <b class="text-sky-200/50">'+d.patternMemorySize+'</b>':'');
    $(s+'-a').textContent=d.overallAccuracy;
    $(s+'-s').textContent=((st.currentStreak||0)>=0?'+':'')+(st.currentStreak||0);
  }catch(e){}
}
async function go(){await Promise.all([side('hu'),side('md5'),hist('hu'),hist('md5'),learn('hu'),learn('md5')])}
go();setInterval(go,11000);
</script>
</body>
</html>`);
});

loadL();
loadH();

app.listen(PORT, '0.0.0.0', () => {
  console.log('PHẠM KHÔI VIP BlueBlack Engine → http://0.0.0.0:' + PORT);
  setTimeout(autoRun, 1800);
  setInterval(autoRun, AUTO_INTERVAL);
});
