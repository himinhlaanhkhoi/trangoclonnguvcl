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
const MAX_HISTORY = 160;
const AUTO_SAVE_INTERVAL = 18000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = { hu: createEmpty(), md5: createEmpty() };

function createEmpty() {
  return {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    recentWrongStreak: 0,
    markov: {}
  };
}

const DEFAULT_W = {
  markov: 1.85, cau_bet: 1.6, cau_dao: 1.45, cau_rong: 1.7,
  dice: 1.5, trend: 1.4, seq: 1.55, pair: 1.3, follow: 1.15,
  decay: 1.5, consensus: 1.9, anti_loss: 2.0
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const p = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = { ...learningData, ...p };
      console.log('✅ Loaded phamkhoi.json');
    }
  } catch (e) { console.error('Load learning:', e.message); }
}

function saveLearningData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); }
  catch (e) {}
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const p = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = p.history || { hu: [], md5: [] };
      lastProcessedPhien = p.lastProcessedPhien || { hu: null, md5: null };
      ['hu', 'md5'].forEach(t => {
        const seen = new Set();
        predictionHistory[t] = (predictionHistory[t] || []).filter(r => {
          if (seen.has(r.Phien_hien_tai)) return false;
          seen.add(r.Phien_hien_tai);
          return true;
        });
      });
      console.log('✅ History HU:' + predictionHistory.hu.length + ' MD5:' + predictionHistory.md5.length);
    }
  } catch (e) {}
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {}
}

function transform(apiData) {
  if (!apiData?.list?.length) return null;
  return apiData.list.map(i => ({
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
  } catch (e) { console.error('HU:', e.message); return null; }
}

async function fetchMd5() {
  try {
    const r = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transform(r.data);
  } catch (e) { console.error('MD5:', e.message); return null; }
}

function hasPred(type, phien) {
  const p = String(phien);
  return predictionHistory[type].some(r => r.Phien_hien_tai === p) ||
         learningData[type].predictions.some(r => r.phien === p);
}

function getExist(type, phien) {
  return predictionHistory[type].find(r => r.Phien_hien_tai === String(phien)) || null;
}

function initW(type) {
  if (!learningData[type].patternWeights || !Object.keys(learningData[type].patternWeights).length) {
    learningData[type].patternWeights = { ...DEFAULT_W };
  }
  Object.keys(DEFAULT_W).forEach(k => {
    if (!learningData[type].patternStats[k]) {
      learningData[type].patternStats[k] = { total: 0, correct: 0, recent: [] };
    }
  });
}

function W(type, id) {
  initW(type);
  return learningData[type].patternWeights[id] || 1;
}

function updateW(type, id, ok) {
  initW(type);
  const s = learningData[type].patternStats[id];
  if (!s) return;
  s.total++;
  if (ok) s.correct++;
  s.recent.push(ok ? 1 : 0);
  if (s.recent.length > 28) s.recent.shift();
  if (s.recent.length >= 7) {
    const ra = s.recent.reduce((a, b) => a + b, 0) / s.recent.length;
    let w = learningData[type].patternWeights[id];
    if (ra > 0.70) w = Math.min(3.4, w * 1.13);
    else if (ra < 0.30) w = Math.max(0.12, w * 0.86);
    learningData[type].patternWeights[id] = +w.toFixed(3);
  }
}

// ==================== ANALYZERS ====================

function streakInfo(results) {
  if (!results.length) return { type: null, len: 0 };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  return { type: results[0], len };
}

function altLen(results) {
  let n = 1;
  for (let i = 1; i < Math.min(results.length, 16); i++) {
    if (results[i] !== results[i - 1]) n++; else break;
  }
  return n;
}

// 1. Markov 1-2-3 + Laplace
function aMarkov(results, type) {
  if (results.length < 7) return null;
  const d = results.slice(0, 75);
  const m1 = {}, m2 = {}, m3 = {};
  for (let i = 0; i < d.length - 1; i++) {
    const a = d[i], b = d[i + 1];
    if (!m1[a]) m1[a] = { Tài: 1, Xỉu: 1 };
    m1[a][b]++;
  }
  for (let i = 0; i < d.length - 2; i++) {
    const k = d[i] + '|' + d[i + 1];
    if (!m2[k]) m2[k] = { Tài: 1, Xỉu: 1 };
    m2[k][d[i + 2]]++;
  }
  for (let i = 0; i < d.length - 3; i++) {
    const k = d[i] + '|' + d[i + 1] + '|' + d[i + 2];
    if (!m3[k]) m3[k] = { Tài: 1, Xỉu: 1 };
    m3[k][d[i + 3]]++;
  }
  const l1 = results[0], l2 = results[1] + '|' + results[0], l3 = results[2] + '|' + results[1] + '|' + results[0];
  let sT = 0, sX = 0, c = 58, tag = [];
  if (m3[l3]) {
    const t = m3[l3], tot = t.Tài + t.Xỉu;
    sT += (t.Tài / tot) * 3.4; sX += (t.Xỉu / tot) * 3.4; c += 13; tag.push('3');
  }
  if (m2[l2]) {
    const t = m2[l2], tot = t.Tài + t.Xỉu;
    sT += (t.Tài / tot) * 2.4; sX += (t.Xỉu / tot) * 2.4; c += 9; tag.push('2');
  }
  if (m1[l1]) {
    const t = m1[l1], tot = t.Tài + t.Xỉu;
    sT += (t.Tài / tot) * 1.5; sX += (t.Xỉu / tot) * 1.5; c += 5; tag.push('1');
  }
  if (sT === 0 && sX === 0) return null;
  return {
    pred: sT >= sX ? 'Tài' : 'Xỉu',
    conf: Math.min(91, Math.round(c * W(type, 'markov'))),
    name: 'Markov' + (tag.length ? '-' + tag.join('') : ''),
    id: 'markov',
    power: Math.abs(sT - sX)
  };
}

// 2. Smart Bệt (ưu tiên theo, bẻ có xác nhận)
function aBet(results, type) {
  const st = streakInfo(results);
  if (st.len < 2) return null;
  const w = W(type, 'cau_bet');
  let pred, conf, name, id = 'cau_bet';
  if (st.len <= 4) {
    pred = st.type;
    conf = 70 + st.len * 2.5;
    name = 'Theo bệt ' + st.len;
  } else if (st.len <= 6) {
    // cần tín hiệu yếu mới bẻ
    const opp = results.slice(st.len, st.len + 4).filter(r => r !== st.type).length;
    if (opp >= 2) {
      pred = st.type === 'Tài' ? 'Xỉu' : 'Tài';
      conf = 77;
      name = 'Bẻ ' + st.len + ' (xác nhận)';
    } else {
      pred = st.type;
      conf = 71;
      name = 'Theo bệt ' + st.len;
    }
  } else {
    pred = st.type === 'Tài' ? 'Xỉu' : 'Tài';
    conf = 84 + Math.min(6, st.len - 7);
    name = 'Bẻ rồng ' + st.len;
    id = 'cau_rong';
  }
  return { pred, conf: Math.round(conf * w), name, id, power: st.len };
}

// 3. Đảo 1-1
function aDao(results, type) {
  const n = altLen(results);
  if (n < 4) return null;
  return {
    pred: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    conf: Math.min(87, Math.round((67 + n * 2.1) * W(type, 'cau_dao'))),
    name: 'Đảo ' + n,
    id: 'cau_dao',
    power: n
  };
}

// 4. Dice + Sum (mean reversion nhẹ)
function aDice(data, type) {
  if (data.length < 14) return null;
  const recent = data.slice(0, 28);
  let high = 0, low = 0, sum = 0;
  recent.forEach(d => {
    [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3].forEach(f => f >= 4 ? high++ : low++);
    sum += d.Tong;
  });
  const avg = sum / recent.length;
  const bias = (high - low) / (high + low || 1);
  if (Math.abs(bias) < 0.11 && Math.abs(avg - 10.5) < 1.2) return null;
  let pred;
  if (avg > 12.1 || bias > 0.16) pred = 'Xỉu';
  else if (avg < 8.9 || bias < -0.16) pred = 'Tài';
  else return null;
  return {
    pred,
    conf: Math.min(85, Math.round((69 + Math.abs(bias) * 55 + Math.abs(avg - 10.5) * 3.5) * W(type, 'dice'))),
    name: 'Dice ' + avg.toFixed(1),
    id: 'dice',
    power: Math.abs(bias) + Math.abs(avg - 10.5) / 3
  };
}

// 5. Trend / Lệch cửa
function aTrend(results, type) {
  if (results.length < 11) return null;
  const win = results.slice(0, 12);
  const tai = win.filter(r => r === 'Tài').length;
  if (tai >= 9) return { pred: 'Xỉu', conf: Math.round(81 * W(type, 'trend')), name: 'Lệch ' + tai + 'T', id: 'trend', power: tai - 6 };
  if (tai <= 3) return { pred: 'Tài', conf: Math.round(81 * W(type, 'trend')), name: 'Lệch ' + (12 - tai) + 'X', id: 'trend', power: 6 - tai };
  if (tai >= 8) return { pred: 'Xỉu', conf: Math.round(74 * W(type, 'trend')), name: 'Xu hướng T', id: 'trend', power: 2 };
  if (tai <= 4) return { pred: 'Tài', conf: Math.round(74 * W(type, 'trend')), name: 'Xu hướng X', id: 'trend', power: 2 };
  return null;
}

// 6. Sequence match
function aSeq(results, type) {
  if (results.length < 14) return null;
  const key = results.slice(0, 3).join('|');
  let t = 0, x = 0;
  for (let i = 3; i < Math.min(results.length - 1, 60); i++) {
    if (results.slice(i, i + 3).join('|') === key) {
      if (results[i - 1] === 'Tài') t++; else x++;
    }
  }
  const tot = t + x;
  if (tot < 2) return null;
  return {
    pred: t >= x ? 'Tài' : 'Xỉu',
    conf: Math.min(86, Math.round((69 + tot * 2.8) * W(type, 'seq'))),
    name: 'Seq×' + tot,
    id: 'seq',
    power: tot
  };
}

// 7. Pair / Triple pattern
function aPair(results, type) {
  if (results.length < 6) return null;
  // 2-2
  let pairs = 0, types = [], i = 0;
  while (i < results.length - 1 && pairs < 4) {
    if (results[i] === results[i + 1]) { types.push(results[i]); pairs++; i += 2; }
    else break;
  }
  if (pairs >= 2) {
    let alt = true;
    for (let j = 1; j < types.length; j++) if (types[j] === types[j - 1]) alt = false;
    if (alt) {
      return {
        pred: types[types.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
        conf: Math.round(Math.min(83, 67 + pairs * 3.8) * W(type, 'pair')),
        name: '2-2×' + pairs,
        id: 'pair',
        power: pairs
      };
    }
  }
  // 3-3
  let trip = 0, tt = [];
  i = 0;
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      tt.push(results[i]); trip++; i += 3;
    } else break;
  }
  if (trip >= 1) {
    const pos = results.length % 3;
    const last = tt[tt.length - 1];
    const pred = pos === 0 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last;
    return {
      pred,
      conf: Math.round(Math.min(85, 71 + trip * 4.5) * W(type, 'pair')),
      name: '3-3×' + trip,
      id: 'pair',
      power: trip
    };
  }
  return null;
}

// 8. Exponential decay recent bias
function aDecay(results, type) {
  if (results.length < 8) return null;
  let sT = 0, sX = 0, wsum = 0;
  for (let i = 0; i < Math.min(20, results.length); i++) {
    const w = Math.exp(-i * 0.18);
    if (results[i] === 'Tài') sT += w; else sX += w;
    wsum += w;
  }
  const pT = sT / wsum;
  if (pT > 0.68) return { pred: 'Xỉu', conf: Math.round(76 * W(type, 'decay')), name: 'Decay T→X', id: 'decay', power: pT };
  if (pT < 0.32) return { pred: 'Tài', conf: Math.round(76 * W(type, 'decay')), name: 'Decay X→T', id: 'decay', power: 1 - pT };
  return null;
}

// 9. Safe follow
function aFollow(results) {
  if (!results.length) return null;
  return { pred: results[0], conf: 57, name: 'Theo gần', id: 'follow', power: 1 };
}

// ==================== ENGINE ====================
function predict(data, type) {
  const results = data.slice(0, 80).map(d => d.Ket_qua);
  initW(type);

  const sigs = [];
  const push = r => { if (r) sigs.push(r); };

  push(aMarkov(results, type));
  push(aBet(results, type));
  push(aDao(results, type));
  push(aDice(data, type));
  push(aTrend(results, type));
  push(aSeq(results, type));
  push(aPair(results, type));
  push(aDecay(results, type));

  if (!sigs.length) push(aFollow(results));

  let scT = 0, scX = 0;
  const factors = [];
  sigs.forEach(s => {
    const pts = s.conf * (0.75 + (s.power || 1) * 0.07);
    if (s.pred === 'Tài') scT += pts; else scX += pts;
    factors.push(s.name);
  });

  // Anti-loss mạnh
  const wrong = learningData[type].recentWrongStreak || 0;
  if (wrong >= 3) {
    const tmp = scT;
    scT = scX * 1.45;
    scX = tmp * 1.45;
    factors.unshift('Đảo sau ' + wrong + ' sai');
  }

  const curSt = learningData[type].streakAnalysis.currentStreak;
  if (curSt <= -2) {
    if (scT > scX) scX *= 1.22; else scT *= 1.22;
  }

  let final = scT >= scX ? 'Tài' : 'Xỉu';

  const aT = sigs.filter(s => s.pred === 'Tài').length;
  const aX = sigs.filter(s => s.pred === 'Xỉu').length;
  const total = sigs.length || 1;
  const ratio = Math.max(aT, aX) / total;

  let conf = 61;
  conf += ratio * 17;
  conf += Math.min(11, Math.abs(scT - scX) / 45);

  if (wrong >= 2) conf -= 7;
  if (wrong >= 4) conf -= 5;

  const ra = learningData[type].recentAccuracy;
  if (ra.length >= 8) {
    const acc = ra.reduce((a, b) => a + b, 0) / ra.length;
    if (acc > 0.66) conf += 5;
    else if (acc < 0.38) conf -= 7;
  }

  conf = Math.max(54, Math.min(90, Math.round(conf)));

  // Khi conf thấp + ít đồng thuận → ưu tiên theo bệt ngắn
  if (conf < 67 && ratio < 0.58) {
    const st = streakInfo(results);
    if (st.len >= 2 && st.len <= 4) {
      final = st.type;
      conf = Math.max(conf, 65);
      factors.unshift('An toàn bệt ngắn');
    }
  }

  return {
    prediction: final,
    confidence: conf,
    factors: factors.slice(0, 5),
    analysis: {
      signals: total,
      tai: aT,
      xiu: aX,
      wrongStreak: wrong,
      stats: {
        total: learningData[type].totalPredictions,
        correct: learningData[type].correctPredictions,
        acc: learningData[type].totalPredictions
          ? ((learningData[type].correctPredictions / learningData[type].totalPredictions) * 100).toFixed(1) + '%'
          : 'N/A',
        streak: learningData[type].streakAnalysis.currentStreak,
        best: learningData[type].streakAnalysis.bestStreak
      }
    }
  };
}

// ==================== RECORD / VERIFY ====================
function record(type, phien, pred, conf, factors) {
  const p = String(phien);
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  learningData[type].predictions.unshift({
    phien: p, prediction: pred, confidence: conf, patterns: factors,
    timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 650) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 650);
  }
  saveLearningData();
}

async function verify(type, data) {
  let up = false;
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const act = data.find(d => String(d.Phien) === pred.phien);
    if (!act) continue;
    pred.verified = true;
    pred.actual = act.Ket_qua;
    pred.isCorrect = pred.prediction === act.Ket_qua;

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
    if (learningData[type].recentAccuracy.length > 55) learningData[type].recentAccuracy.shift();

    if (pred.patterns?.length) {
      pred.patterns.forEach(n => {
        let id = null;
        if (n.includes('Markov')) id = 'markov';
        else if (n.includes('bệt') || n.includes('rồng') || n.includes('Bẻ') || n.includes('Theo bệt')) id = 'cau_bet';
        else if (n.includes('Đảo')) id = 'cau_dao';
        else if (n.includes('Dice')) id = 'dice';
        else if (n.includes('Seq')) id = 'seq';
        else if (n.includes('2-2') || n.includes('3-3')) id = 'pair';
        else if (n.includes('Lệch') || n.includes('Xu hướng')) id = 'trend';
        else if (n.includes('Decay')) id = 'decay';
        if (id) updateW(type, id, pred.isCorrect);
      });
    }
    up = true;
  }
  if (up) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function saveHist(type, phien, pred, conf, latest) {
  const p = String(phien);
  if (predictionHistory[type].some(r => r.Phien_hien_tai === p)) {
    return predictionHistory[type].find(r => r.Phien_hien_tai === p);
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
    if (!data?.length) return;
    let up = false;
    for (const r of predictionHistory[type]) {
      if (r.ket_qua_du_doan) continue;
      const a = data.find(d => String(d.Phien) === r.Phien_hien_tai);
      if (a) {
        r.ket_qua_du_doan = r.Du_doan === a.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
        up = true;
      }
    }
    if (up) savePredictionHistory();
  } catch (e) {}
}

async function auto() {
  try {
    for (const [type, fn] of [['hu', fetchHu], ['md5', fetchMd5]]) {
      const data = await fn();
      if (!data?.length) continue;
      const next = data[0].Phien + 1;
      if (lastProcessedPhien[type] !== next && !hasPred(type, next)) {
        await verify(type, data);
        const r = predict(data, type);
        saveHist(type, next, r.prediction, r.confidence, data[0]);
        record(type, next, r.prediction, r.confidence, r.factors);
        lastProcessedPhien[type] = next;
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ': ' + r.prediction + ' (' + r.confidence + '%)');
        savePredictionHistory();
        saveLearningData();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) { console.error('[Auto]', e.message); }
}

function startAuto() {
  console.log('🔄 Auto ' + (AUTO_SAVE_INTERVAL / 1000) + 's');
  setTimeout(auto, 2500);
  setInterval(auto, AUTO_SAVE_INTERVAL);
}

async function handle(type, fn, req, res) {
  try {
    const data = await fn();
    if (!data?.length) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    await verify(type, data);
    const next = data[0].Phien + 1;

    if (hasPred(type, next)) {
      const e = getExist(type, next);
      return res.json({
        Phien: e.Phien, Xuc_xac_1: e.Xuc_xac_1, Xuc_xac_2: e.Xuc_xac_2, Xuc_xac_3: e.Xuc_xac_3,
        Tong: e.Tong, Ket_qua: e.Ket_qua, Do_tin_cay: e.Do_tin_cay,
        Phien_hien_tai: e.Phien_hien_tai, Du_doan: e.Du_doan,
        ket_qua_du_doan: e.ket_qua_du_doan || '', factors: [], id: '@phamkhoi', cached: true
      });
    }

    const r = predict(data, type);
    const rec = saveHist(type, next, r.prediction, r.confidence, data[0]);
    record(type, next, r.prediction, r.confidence, r.factors);
    lastProcessedPhien[type] = next;
    savePredictionHistory();
    setTimeout(() => updateStatus(type), 2500);
    res.json({
      Phien: rec.Phien, Xuc_xac_1: rec.Xuc_xac_1, Xuc_xac_2: rec.Xuc_xac_2, Xuc_xac_3: rec.Xuc_xac_3,
      Tong: rec.Tong, Ket_qua: rec.Ket_qua, Do_tin_cay: rec.Do_tin_cay,
      Phien_hien_tai: rec.Phien_hien_tai, Du_doan: rec.Du_doan,
      ket_qua_du_doan: '', factors: r.factors, id: '@phamkhoi', cached: false
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

app.get('/api/hu/analysis', async (req, res) => {
  try {
    const data = await fetchHu();
    if (!data?.length) return res.status(500).json({ error: 'No data' });
    await verify('hu', data);
    const r = predict(data, 'hu');
    res.json({ prediction: r.prediction, confidence: r.confidence, factors: r.factors, analysis: r.analysis });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});
app.get('/api/md5/analysis', async (req, res) => {
  try {
    const data = await fetchMd5();
    if (!data?.length) return res.status(500).json({ error: 'No data' });
    await verify('md5', data);
    const r = predict(data, 'md5');
    res.json({ prediction: r.prediction, confidence: r.confidence, factors: r.factors, analysis: r.analysis });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'Hũ', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0
  });
});
app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'MD5', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: createEmpty(), md5: createEmpty() };
  learningData.hu.patternWeights = { ...DEFAULT_W };
  learningData.md5.patternWeights = { ...DEFAULT_W };
  saveLearningData();
  res.json({ message: 'Reset OK' });
});

// ==================== UI ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Phạm Khôi</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{font-family:Inter,system-ui,sans-serif;box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#fafafa;min-height:100vh}
.card{background:#111114;border:1px solid rgba(255,255,255,.06);border-radius:18px}
.tai{color:#4ade80}.xiu{color:#fb7185}
.gt{box-shadow:0 0 28px -6px rgba(74,222,128,.28)}
.gx{box-shadow:0 0 28px -6px rgba(251,113,133,.28)}
.dot{width:6px;height:6px;border-radius:50%;animation:blink 1.6s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
.chip{font-size:10px;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.4)}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
</style>
</head>
<body class="px-3 py-4 max-w-md mx-auto">
<div class="flex items-center justify-between mb-5">
  <div class="flex items-center gap-2">
    <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xs font-black text-black">PK</div>
    <div>
      <div class="font-bold text-sm leading-none">Phạm Khôi</div>
      <div class="text-[9px] text-white/30 mt-0.5">Tài Xỉu • Bắt Cầu</div>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <span id="clock" class="text-[9px] text-white/20 tabular-nums"></span>
    <button onclick="go()" class="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 active:bg-white/10 font-medium">Làm mới</button>
  </div>
</div>

<div class="space-y-2.5 mb-4">
  <div id="c-hu" class="card p-3.5">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5"><span class="dot bg-emerald-400"></span><span class="text-[11px] font-semibold text-white/60">Hũ</span></div>
      <span id="hu-p" class="text-[9px] text-white/20 font-mono">#—</span>
    </div>
    <div class="text-center py-1.5">
      <div id="hu-d" class="text-3xl font-extrabold tracking-tight">—</div>
      <div id="hu-c" class="text-base font-bold text-amber-400/85 mt-0.5">—%</div>
    </div>
    <div class="flex justify-center gap-4 text-[10px] text-white/30 mt-0.5 mb-1.5">
      <span>XX <b id="hu-x" class="text-white/55 font-mono">—</b></span>
      <span>Tổng <b id="hu-t" class="text-white/55">—</b></span>
    </div>
    <div id="hu-f" class="flex flex-wrap gap-1 justify-center min-h-[18px] mb-1.5"></div>
    <div class="grid grid-cols-3 gap-1 pt-1.5 border-t border-white/5 text-center text-[9px]">
      <div><div class="text-white/20">Đúng</div><div id="hu-a" class="font-bold text-emerald-400">—</div></div>
      <div><div class="text-white/20">Chuỗi</div><div id="hu-s" class="font-bold">—</div></div>
      <div><div class="text-white/20">Phiên</div><div id="hu-n" class="font-bold text-amber-400/70">#—</div></div>
    </div>
  </div>

  <div id="c-md5" class="card p-3.5">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5"><span class="dot bg-violet-400"></span><span class="text-[11px] font-semibold text-white/60">MD5</span></div>
      <span id="md5-p" class="text-[9px] text-white/20 font-mono">#—</span>
    </div>
    <div class="text-center py-1.5">
      <div id="md5-d" class="text-3xl font-extrabold tracking-tight">—</div>
      <div id="md5-c" class="text-base font-bold text-amber-400/85 mt-0.5">—%</div>
    </div>
    <div class="flex justify-center gap-4 text-[10px] text-white/30 mt-0.5 mb-1.5">
      <span>XX <b id="md5-x" class="text-white/55 font-mono">—</b></span>
      <span>Tổng <b id="md5-t" class="text-white/55">—</b></span>
    </div>
    <div id="md5-f" class="flex flex-wrap gap-1 justify-center min-h-[18px] mb-1.5"></div>
    <div class="grid grid-cols-3 gap-1 pt-1.5 border-t border-white/5 text-center text-[9px]">
      <div><div class="text-white/20">Đúng</div><div id="md5-a" class="font-bold text-emerald-400">—</div></div>
      <div><div class="text-white/20">Chuỗi</div><div id="md5-s" class="font-bold">—</div></div>
      <div><div class="text-white/20">Phiên</div><div id="md5-n" class="font-bold text-amber-400/70">#—</div></div>
    </div>
  </div>
</div>

<div class="space-y-2.5 mb-4">
  <div class="card p-3">
    <div class="text-[10px] font-semibold text-white/40 mb-1.5">Lịch sử Hũ</div>
    <div id="hu-h" class="space-y-0 max-h-44 overflow-y-auto text-[11px]"></div>
  </div>
  <div class="card p-3">
    <div class="text-[10px] font-semibold text-white/40 mb-1.5">Lịch sử MD5</div>
    <div id="md5-h" class="space-y-0 max-h-44 overflow-y-auto text-[11px]"></div>
  </div>
</div>

<div class="grid grid-cols-2 gap-2 mb-5">
  <div class="card p-2.5">
    <div class="text-[9px] font-semibold text-white/35 mb-1">Thống kê Hũ</div>
    <div id="hu-l" class="text-[10px] text-white/35 space-y-0.5 leading-relaxed"></div>
  </div>
  <div class="card p-2.5">
    <div class="text-[9px] font-semibold text-white/35 mb-1">Thống kê MD5</div>
    <div id="md5-l" class="text-[10px] text-white/35 space-y-0.5 leading-relaxed"></div>
  </div>
</div>

<div class="text-center text-[9px] text-white/12 pb-3">Phạm Khôi • Một phiên – Một dự đoán</div>

<script>
const $=id=>document.getElementById(id);
const tick=()=>$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false});
setInterval(tick,1000);tick();
const pc=p=>p==='Tài'?'tai':p==='Xỉu'?'xiu':'';
const gc=p=>p==='Tài'?'gt':p==='Xỉu'?'gx':'';

async function side(s){
  try{
    const r=await fetch('/api/'+s);const d=await r.json();if(d.error)return;
    $(s+'-p').textContent='#'+d.Phien;
    $(s+'-n').textContent='#'+d.Phien_hien_tai;
    $(s+'-d').textContent=d.Du_doan;
    $(s+'-d').className='text-3xl font-extrabold tracking-tight '+pc(d.Du_doan);
    $(s+'-c').textContent=d.Do_tin_cay;
    $(s+'-x').textContent=d.Xuc_xac_1+' '+d.Xuc_xac_2+' '+d.Xuc_xac_3;
    $(s+'-t').textContent=d.Tong+' · '+d.Ket_qua;
    $('c-'+s).className='card p-3.5 '+gc(d.Du_doan);
    $(s+'-f').innerHTML=(d.factors||[]).slice(0,3).map(f=>'<span class="chip">'+f.substring(0,16)+'</span>').join('');
  }catch(e){}
}
async function hist(s){
  try{
    const r=await fetch('/api/'+s+'/lichsu');const d=await r.json();
    const b=$(s+'-h');
    if(!d.history?.length){b.innerHTML='<div class="text-white/12 text-center py-3 text-[10px]">Chưa có dữ liệu</div>';return}
    b.innerHTML=d.history.slice(0,16).map(h=>{
      const ok=h.ket_qua_du_doan||'';
      const c=ok.includes('Đúng')?'text-emerald-400':ok.includes('Sai')?'text-rose-400':'text-white/15';
      return '<div class="flex items-center justify-between py-0.5 px-0.5"><span class="font-mono text-[9px] text-white/20">#'+h.Phien_hien_tai+'</span><span class="font-semibold '+pc(h.Du_doan)+'">'+h.Du_doan+'</span><span class="text-[9px] text-white/25">'+h.Do_tin_cay+'</span><span class="text-[9px] '+c+'">'+(ok||'…')+'</span></div>';
    }).join('');
  }catch(e){}
}
async function learn(s){
  try{
    const r=await fetch('/api/'+s+'/learning');const d=await r.json();
    const st=d.streakAnalysis||{};
    $(s+'-l').innerHTML='Tổng <b class="text-white/60">'+d.totalPredictions+'</b><br>Đúng <b class="text-emerald-400">'+d.correctPredictions+'</b> · <b class="text-amber-400">'+d.overallAccuracy+'</b><br>Chuỗi <b class="text-white/60">'+(st.currentStreak||0)+'</b> · Best '+(st.bestStreak||0)+(d.recentWrongStreak?'<br><span class="text-rose-400">Sai liên tục '+d.recentWrongStreak+'</span>':'');
    $(s+'-a').textContent=d.overallAccuracy;
    $(s+'-s').textContent=((st.currentStreak||0)>=0?'+':'')+(st.currentStreak||0);
  }catch(e){}
}
async function go(){await Promise.all([side('hu'),side('md5'),hist('hu'),hist('md5'),learn('hu'),learn('md5')])}
go();setInterval(go,14000);
</script>
</body>
</html>`);
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  PHẠM KHÔI TÀI XỈU');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Super Ensemble · Anti-loss · Smart Bet');
  console.log('══════════════════════════════════════');
  startAuto();
});
