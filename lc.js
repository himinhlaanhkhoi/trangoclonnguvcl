const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// ==================== CONFIG ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'phamkhoi.json';
const HISTORY_FILE = 'phamkhoi1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 120;
const AUTO_SAVE_INTERVAL = 25000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: createEmptyLearning(),
  md5: createEmptyLearning()
};

function createEmptyLearning() {
  return {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    markov: { order1: {}, order2: {}, order3: {} },
    diceStats: { faces: [0,0,0,0,0,0,0], sums: {}, hot: [], cold: [] }
  };
}

const DEFAULT_PATTERN_WEIGHTS = {
  cau_bet: 1.2, cau_dao_11: 1.15, cau_22: 1.1, cau_33: 1.1, cau_121: 1.05,
  cau_123: 1.05, cau_321: 1.05, cau_nhay_coc: 1.0, cau_nhip_nghieng: 1.0,
  cau_3van1: 1.0, cau_be_cau: 1.1, cau_chu_ky: 1.0, distribution: 1.0,
  dice_pattern: 1.3, sum_trend: 1.25, edge_cases: 1.1, momentum: 1.15,
  cau_tu_nhien: 0.8, dice_trend_line: 1.2, break_pattern_hu: 1.2,
  break_pattern_md5: 1.2, fibonacci: 0.9, resistance_support: 1.0, wave: 1.0,
  golden_ratio: 0.9, day_gay: 1.25, day_gay_md5: 1.25, cau_44: 1.1,
  cau_55: 1.15, cau_212: 1.05, cau_1221: 1.05, cau_2112: 1.05, cau_gap: 1.1,
  cau_ziczac: 1.05, cau_doi: 1.1, cau_rong: 1.4, smart_bet: 1.3,
  break_pattern_advanced: 1.25, break_streak: 1.3, alternating_break: 1.2,
  double_pair_break: 1.25, triple_pattern: 1.3, tong_phan_tich: 1.5,
  xu_huong_manh: 1.4, dao_chieu: 1.35, markov_chain: 1.6, dice_hotcold: 1.45,
  entropy: 1.3, sum_regression: 1.35, sequence_mine: 1.25
};

// ==================== LOAD / SAVE ====================
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = { ...learningData, ...parsed };
      console.log('✅ Loaded learning data from phamkhoi.json');
    }
  } catch (e) { console.error('Load learning error:', e.message); }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (e) { console.error('Save learning error:', e.message); }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log(`✅ History loaded | HU: ${predictionHistory.hu.length} | MD5: ${predictionHistory.md5.length}`);
    }
  } catch (e) { console.error('Load history error:', e.message); }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) { console.error('Save history error:', e.message); }
}

// ==================== DATA FETCH ====================
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point
  }));
}

async function fetchDataHu() {
  try {
    const res = await axios.get(API_URL_HU, { timeout: 12000 });
    return transformApiData(res.data);
  } catch (e) {
    console.error('HU fetch error:', e.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const res = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transformApiData(res.data);
  } catch (e) {
    console.error('MD5 fetch error:', e.message);
    return null;
  }
}

// ==================== ADVANCED ANALYSIS ====================

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(p => {
    if (!learningData[type].patternStats[p]) {
      learningData[type].patternStats[p] = {
        total: 0, correct: 0, accuracy: 0.5, recentResults: [], lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, id) {
  initializePatternStats(type);
  return learningData[type].patternWeights[id] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  stats.total++;
  if (isCorrect) stats.correct++;
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 25) stats.recentResults.shift();
  const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  let w = learningData[type].patternWeights[patternId];
  if (stats.recentResults.length >= 6) {
    if (recentAcc > 0.68) w = Math.min(3.2, w * 1.12);
    else if (recentAcc < 0.32) w = Math.max(0.15, w * 0.88);
  }
  learningData[type].patternWeights[patternId] = w;
  stats.lastAdjustment = new Date().toISOString();
}

// --- MARKOV CHAIN (Order 1-3) ---
function buildMarkov(results) {
  const m1 = {}, m2 = {}, m3 = {};
  for (let i = 0; i < results.length - 1; i++) {
    const a = results[i], b = results[i + 1];
    if (!m1[a]) m1[a] = { Tài: 0, Xỉu: 0 };
    m1[a][b]++;
  }
  for (let i = 0; i < results.length - 2; i++) {
    const key = results[i] + '|' + results[i + 1];
    const next = results[i + 2];
    if (!m2[key]) m2[key] = { Tài: 0, Xỉu: 0 };
    m2[key][next]++;
  }
  for (let i = 0; i < results.length - 3; i++) {
    const key = results[i] + '|' + results[i + 1] + '|' + results[i + 2];
    const next = results[i + 3];
    if (!m3[key]) m3[key] = { Tài: 0, Xỉu: 0 };
    m3[key][next]++;
  }
  return { order1: m1, order2: m2, order3: m3 };
}

function predictMarkov(results, type) {
  if (results.length < 4) return { detected: false };
  const markov = buildMarkov(results.slice(0, 60));
  learningData[type].markov = markov;
  const last1 = results[0];
  const last2 = results[1] + '|' + results[0];
  const last3 = results[2] + '|' + results[1] + '|' + results[0];

  let scores = { Tài: 0, Xỉu: 0 };
  let conf = 60;
  let nameParts = [];

  // Order 3
  if (markov.order3[last3]) {
    const t = markov.order3[last3];
    const total = t.Tài + t.Xỉu;
    if (total >= 2) {
      scores.Tài += (t.Tài / total) * 3.2;
      scores.Xỉu += (t.Xỉu / total) * 3.2;
      conf += 12;
      nameParts.push('Markov-3');
    }
  }
  // Order 2
  if (markov.order2[last2]) {
    const t = markov.order2[last2];
    const total = t.Tài + t.Xỉu;
    if (total >= 3) {
      scores.Tài += (t.Tài / total) * 2.4;
      scores.Xỉu += (t.Xỉu / total) * 2.4;
      conf += 8;
      nameParts.push('Markov-2');
    }
  }
  // Order 1
  if (markov.order1[last1]) {
    const t = markov.order1[last1];
    const total = t.Tài + t.Xỉu;
    if (total >= 4) {
      scores.Tài += (t.Tài / total) * 1.6;
      scores.Xỉu += (t.Xỉu / total) * 1.6;
      conf += 5;
      nameParts.push('Markov-1');
    }
  }

  if (scores.Tài === 0 && scores.Xỉu === 0) return { detected: false };
  const prediction = scores.Tài >= scores.Xỉu ? 'Tài' : 'Xỉu';
  const weight = getPatternWeight(type, 'markov_chain');
  return {
    detected: true,
    prediction,
    confidence: Math.min(92, Math.round(conf * weight)),
    name: `Markov Chain (${nameParts.join('+')}) → ${prediction}`,
    patternId: 'markov_chain'
  };
}

// --- DICE HOT / COLD + FACE FREQUENCY ---
function analyzeDiceHotCold(data, type) {
  if (data.length < 15) return { detected: false };
  const recent = data.slice(0, 30);
  const faceCount = [0, 0, 0, 0, 0, 0, 0]; // index 1-6
  let sumTai = 0, sumXiu = 0;
  recent.forEach(d => {
    [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3].forEach(f => {
      if (f >= 1 && f <= 6) faceCount[f]++;
    });
    if (d.Ket_qua === 'Tài') sumTai += d.Tong; else sumXiu += d.Tong;
  });

  const avgFace = recent.length * 3 / 6;
  const hot = [], cold = [];
  for (let i = 1; i <= 6; i++) {
    if (faceCount[i] > avgFace * 1.35) hot.push(i);
    if (faceCount[i] < avgFace * 0.65) cold.push(i);
  }

  learningData[type].diceStats = { faces: faceCount, hot, cold };

  // High faces (4,5,6) favor Tài, low (1,2,3) favor Xỉu
  let highScore = (faceCount[4] + faceCount[5] + faceCount[6]) / (recent.length * 3);
  let lowScore = (faceCount[1] + faceCount[2] + faceCount[3]) / (recent.length * 3);

  if (Math.abs(highScore - lowScore) < 0.08) return { detected: false };

  const prediction = highScore > lowScore ? 'Xỉu' : 'Tài'; // mean reversion
  const weight = getPatternWeight(type, 'dice_hotcold');
  const conf = Math.round(68 + Math.abs(highScore - lowScore) * 80);
  return {
    detected: true,
    prediction,
    confidence: Math.min(88, Math.round(conf * weight)),
    name: `Dice Hot/Cold (Hot:[${hot}] Cold:[${cold}] → ${prediction})`,
    patternId: 'dice_hotcold'
  };
}

// --- ENTROPY (disorder of sequence) ---
function analyzeEntropy(results, type) {
  if (results.length < 12) return { detected: false };
  const win = results.slice(0, 12);
  const tai = win.filter(r => r === 'Tài').length;
  const p = tai / win.length;
  const entropy = p === 0 || p === 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  // Low entropy = strong pattern → follow majority or break if extreme
  if (entropy > 0.85) return { detected: false }; // too random

  const weight = getPatternWeight(type, 'entropy');
  let prediction, conf;
  if (entropy < 0.4) {
    // Very ordered → likely continue or strong break
    const majority = tai >= 7 ? 'Tài' : 'Xỉu';
    prediction = win.length >= 9 && (tai >= 9 || tai <= 3) ? (majority === 'Tài' ? 'Xỉu' : 'Tài') : majority;
    conf = Math.round(78 + (0.4 - entropy) * 40);
  } else {
    prediction = tai > 6 ? 'Xỉu' : 'Tài'; // mild mean reversion
    conf = 70;
  }
  return {
    detected: true,
    prediction,
    confidence: Math.min(90, Math.round(conf * weight)),
    name: `Entropy ${entropy.toFixed(2)} → ${prediction}`,
    patternId: 'entropy'
  };
}

// --- SUM REGRESSION ---
function analyzeSumRegression(data, type) {
  if (data.length < 12) return { detected: false };
  const sums = data.slice(0, 15).map(d => d.Tong);
  const n = sums.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = n - i; // recent has higher x
    sumX += x; sumY += sums[i]; sumXY += x * sums[i]; sumX2 += x * x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avg = sumY / n;
  const weight = getPatternWeight(type, 'sum_regression');

  if (Math.abs(slope) < 0.25 && Math.abs(avg - 10.5) < 1.2) return { detected: false };

  let prediction, conf;
  if (slope > 0.4) { // sums rising → expect Xỉu soon
    prediction = 'Xỉu';
    conf = Math.round(72 + slope * 15);
  } else if (slope < -0.4) {
    prediction = 'Tài';
    conf = Math.round(72 + Math.abs(slope) * 15);
  } else if (avg > 12) {
    prediction = 'Xỉu';
    conf = 74;
  } else if (avg < 9) {
    prediction = 'Tài';
    conf = 74;
  } else return { detected: false };

  return {
    detected: true,
    prediction,
    confidence: Math.min(89, Math.round(conf * weight)),
    name: `Sum Regression (slope ${slope.toFixed(2)}, avg ${avg.toFixed(1)} → ${prediction})`,
    patternId: 'sum_regression'
  };
}

// --- CLASSIC PATTERNS (improved) ---
function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  if (len < 3) return { detected: false };
  const weight = getPatternWeight(type, 'cau_bet');
  let shouldBreak = len >= 5;
  let conf = 66;
  if (len >= 8) { shouldBreak = true; conf = 88; }
  else if (len >= 6) { shouldBreak = true; conf = 80; }
  else if (len >= 4) { shouldBreak = true; conf = 72; }
  else { shouldBreak = false; conf = 68; }
  return {
    detected: true,
    prediction: shouldBreak ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
    confidence: Math.round(conf * weight),
    name: `Cầu Bệt ${len} phiên ${results[0]}`,
    patternId: 'cau_bet'
  };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let alt = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i - 1]) alt++; else break;
  }
  if (alt < 4) return { detected: false };
  const weight = getPatternWeight(type, 'cau_dao_11');
  return {
    detected: true,
    prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.min(85, Math.round((66 + alt * 2.2) * weight)),
    name: `Cầu Đảo 1-1 (${alt} nhịp)`,
    patternId: 'cau_dao_11'
  };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  if (len < 6) return { detected: false };
  const weight = getPatternWeight(type, 'cau_rong');
  return {
    detected: true,
    prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.min(92, Math.round((78 + len) * weight)),
    name: `Cầu Rồng ${len} phiên → Bẻ mạnh`,
    patternId: 'cau_rong'
  };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const r8 = results.slice(0, 8);
  const tai = r8.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  if (tai >= 6) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round((82 + tai) * weight), name: `Xu Hướng Mạnh ${tai}/8 Tài → Đảo`, patternId: 'xu_huong_manh' };
  }
  if (tai <= 2) {
    return { detected: true, prediction: 'Tài', confidence: Math.round((82 + (8 - tai)) * weight), name: `Xu Hướng Mạnh ${8 - tai}/8 Xỉu → Đảo`, patternId: 'xu_huong_manh' };
  }
  return { detected: false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  const recent = data.slice(0, 10);
  const sums = recent.map(d => d.Tong);
  const results = recent.map(d => d.Ket_qua);
  const avg = sums.reduce((a, b) => a + b, 0) / 10;
  const first5 = sums.slice(5).reduce((a, b) => a + b, 0) / 5;
  const last5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const trend = last5 - first5;
  const weight = getPatternWeight(type, 'tong_phan_tich');
  const taiC = results.filter(r => r === 'Tài').length;

  if (trend > 1.6) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round((76 + Math.abs(trend) * 4) * weight), name: `Tổng ↑ ${trend.toFixed(1)} → Xỉu`, patternId: 'tong_phan_tich' };
  }
  if (trend < -1.6) {
    return { detected: true, prediction: 'Tài', confidence: Math.round((76 + Math.abs(trend) * 4) * weight), name: `Tổng ↓ ${Math.abs(trend).toFixed(1)} → Tài`, patternId: 'tong_phan_tich' };
  }
  if (Math.abs(taiC - 5) >= 3) {
    const pred = taiC > 5 ? 'Xỉu' : 'Tài';
    return { detected: true, prediction: pred, confidence: Math.round((72 + Math.abs(taiC - 5) * 4) * weight), name: `Lệch ${Math.abs(taiC - 5)} → ${pred}`, patternId: 'tong_phan_tich' };
  }
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  if (len < 5) return { detected: false };
  const weight = getPatternWeight(type, 'break_streak');
  return {
    detected: true,
    prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.min(90, Math.round((72 + len * 1.8) * weight)),
    name: `Bẻ Chuỗi ${len} → ${results[0] === 'Tài' ? 'Xỉu' : 'Tài'}`,
    patternId: 'break_streak'
  };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const l5 = results.slice(0, 5);
  const p5 = results.slice(5, 10);
  const tL = l5.filter(r => r === 'Tài').length;
  const tP = p5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'smart_bet');
  if ((tL >= 4 && tP <= 1) || (tL <= 1 && tP >= 4)) {
    const cur = tL >= 4 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: cur === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(80 * weight), name: `Đảo Xu Hướng mạnh`, patternId: 'smart_bet' };
  }
  const t10 = results.slice(0, 10).filter(r => r === 'Tài').length;
  if (t10 >= 8 || t10 <= 2) {
    const dom = t10 >= 8 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dom === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(84 * weight), name: `Xu Hướng Cực ${t10}T → Đảo`, patternId: 'smart_bet' };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  let pairs = 0, pattern = [], i = 0;
  while (i < results.length - 1 && pairs < 5) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairs++;
      i += 2;
    } else break;
  }
  if (pairs < 2) return { detected: false };
  let alt = true;
  for (let j = 1; j < pattern.length; j++) if (pattern[j] === pattern[j - 1]) { alt = false; break; }
  if (!alt) return { detected: false };
  const weight = getPatternWeight(type, 'cau_22');
  return {
    detected: true,
    prediction: pattern[pattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.round(Math.min(82, 66 + pairs * 3.5) * weight),
    name: `Cầu 2-2 (${pairs} cặp)`,
    patternId: 'cau_22'
  };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let triples = 0, pattern = [], i = 0;
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      triples++;
      i += 3;
    } else break;
  }
  if (triples < 1) return { detected: false };
  const weight = getPatternWeight(type, 'cau_33');
  const pos = results.length % 3;
  const lastT = pattern[pattern.length - 1];
  const pred = pos === 0 ? (lastT === 'Tài' ? 'Xỉu' : 'Tài') : lastT;
  return {
    detected: true,
    prediction: pred,
    confidence: Math.round(Math.min(84, 70 + triples * 5) * weight),
    name: `Cầu 3-3 (${triples} bộ)`,
    patternId: 'cau_33'
  };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  const r5 = results.slice(0, 5);
  let alt = true;
  for (let i = 0; i < 4; i++) if (r5[i] === r5[i + 1]) { alt = false; break; }
  if (!alt) return { detected: false };
  const weight = getPatternWeight(type, 'dao_chieu');
  return {
    detected: true,
    prediction: r5[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.round(76 * weight),
    name: `Đảo Chiều thuần → ${r5[0] === 'Tài' ? 'Xỉu' : 'Tài'}`,
    patternId: 'dao_chieu'
  };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 1) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  return {
    detected: true,
    prediction: results[0],
    confidence: Math.round(58 * weight),
    name: 'Cầu Tự Nhiên (theo ván trước)',
    patternId: 'cau_tu_nhien'
  };
}

// ==================== MAIN PREDICTION ENGINE ====================
function calculateAdvancedPrediction(data, type) {
  const last60 = data.slice(0, 60);
  const results = last60.map(d => d.Ket_qua);
  initializePatternStats(type);

  const candidates = [];
  const factors = [];
  const allPatterns = [];

  const analyzers = [
    () => predictMarkov(results, type),
    () => analyzeDiceHotCold(last60, type),
    () => analyzeEntropy(results, type),
    () => analyzeSumRegression(last60, type),
    () => analyzeTongPhanTich(last60, type),
    () => analyzeXuHuongManh(results, type),
    () => analyzeCauRong(results, type),
    () => analyzeBreakStreak(results, type),
    () => analyzeSmartBet(results, type),
    () => analyzeCauBet(results, type),
    () => analyzeCauDao11(results, type),
    () => analyzeCau22(results, type),
    () => analyzeCau33(results, type),
    () => analyzeDaoChieu(results, type)
  ];

  analyzers.forEach(fn => {
    try {
      const r = fn();
      if (r && r.detected) {
        candidates.push({ prediction: r.prediction, confidence: r.confidence, priority: r.confidence, name: r.name, patternId: r.patternId });
        factors.push(r.name);
        allPatterns.push(r);
      }
    } catch (e) {}
  });

  if (candidates.length === 0) {
    const fb = analyzeCauTuNhien(results, type);
    candidates.push({ prediction: fb.prediction, confidence: fb.confidence, priority: 50, name: fb.name, patternId: fb.patternId });
    factors.push(fb.name);
  }

  // Score Tài / Xỉu
  let taiScore = 0, xiuScore = 0;
  candidates.forEach(c => {
    const score = c.confidence * (c.priority / 70);
    if (c.prediction === 'Tài') taiScore += score;
    else xiuScore += score;
  });

  // Streak penalty / boost
  const streak = learningData[type].streakAnalysis.currentStreak;
  if (streak <= -3) {
    if (taiScore > xiuScore) xiuScore *= 1.35;
    else taiScore *= 1.35;
  } else if (streak >= 4) {
    // slight follow
    if (taiScore > xiuScore) taiScore *= 1.08;
    else xiuScore *= 1.08;
  }

  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';

  // Smart adjustment from recent pattern performance
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);

  // Confidence
  let base = 64;
  const top3 = candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  top3.forEach(p => {
    if (p.prediction === finalPrediction) base += (p.confidence - 60) * 0.28;
  });
  const agree = candidates.filter(c => c.prediction === finalPrediction).length / candidates.length;
  base += agree * 12;
  base += getAdaptiveConfidenceBoost(type);
  let finalConf = Math.max(58, Math.min(93, Math.round(base)));

  return {
    prediction: finalPrediction,
    confidence: finalConf,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: candidates.length,
      taiVotes: candidates.filter(c => c.prediction === 'Tài').length,
      xiuVotes: candidates.filter(c => c.prediction === 'Xỉu').length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPattern: candidates[0]?.name || 'N/A',
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0
          ? ((learningData[type].correctPredictions / learningData[type].totalPredictions) * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak
      }
    }
  };
}

function getAdaptiveConfidenceBoost(type) {
  const acc = learningData[type].recentAccuracy;
  if (acc.length < 8) return 0;
  const a = acc.reduce((x, y) => x + y, 0) / acc.length;
  if (a > 0.72) return 9;
  if (a > 0.62) return 5;
  if (a > 0.52) return 2;
  if (a < 0.28) return -9;
  if (a < 0.38) return -5;
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streak = learningData[type].streakAnalysis;
  if (streak.currentStreak <= -4) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  let taiS = 0, xiuS = 0;
  patterns.forEach(p => {
    const id = p.patternId;
    if (!id) return;
    const st = learningData[type].patternStats[id];
    if (st && st.recentResults.length >= 5) {
      const ra = st.recentResults.reduce((a, b) => a + b, 0) / st.recentResults.length;
      const w = learningData[type].patternWeights[id] || 1;
      if (p.prediction === 'Tài') taiS += ra * w;
      else xiuS += ra * w;
    }
  });
  if (Math.abs(taiS - xiuS) > 0.85) {
    return taiS > xiuS ? 'Tài' : 'Xỉu';
  }
  return prediction;
}

function getPatternIdFromName(name) {
  const map = {
    'Markov': 'markov_chain', 'Dice Hot': 'dice_hotcold', 'Entropy': 'entropy',
    'Sum Regression': 'sum_regression', 'Tổng': 'tong_phan_tich', 'Xu Hướng Mạnh': 'xu_huong_manh',
    'Cầu Rồng': 'cau_rong', 'Bẻ Chuỗi': 'break_streak', 'Đảo Xu Hướng': 'smart_bet',
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Đảo Chiều': 'dao_chieu', 'Cầu Tự Nhiên': 'cau_tu_nhien'
  };
  for (const [k, v] of Object.entries(map)) {
    if (name.includes(k)) return v;
  }
  return null;
}

// ==================== RECORD & VERIFY ====================
function recordPrediction(type, phien, prediction, confidence, patterns) {
  const rec = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  learningData[type].predictions.unshift(rec);
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 600) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 600);
  }
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      const norm = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === norm;
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 60) learningData[type].recentAccuracy.shift();

      if (pred.patterns && pred.patterns.length) {
        pred.patterns.forEach(pn => {
          const id = getPatternIdFromName(pn);
          if (id) updatePatternPerformance(type, id, pred.isCorrect);
        });
      }
      updated = true;
    }
  }
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: '@phamkhoi',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return record;
}

async function updateHistoryStatus(type) {
  try {
    const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
    if (!data || !data.length) return;
    let updated = false;
    for (const rec of predictionHistory[type]) {
      if (rec.ket_qua_du_doan && rec.ket_qua_du_doan !== '') continue;
      const actual = data.find(d => d.Phien.toString() === rec.Phien_hien_tai);
      if (actual) {
        rec.ket_qua_du_doan = rec.Du_doan === actual.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
        updated = true;
      }
    }
    if (updated) savePredictionHistory();
  } catch (e) {
    console.error(`Update ${type} status error:`, e.message);
  }
}

// ==================== AUTO TASK ====================
async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length) {
      const next = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== next) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', next, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', next, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = next;
        console.log(`[Auto] HU #${next}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length) {
      const next = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== next) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', next, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', next, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = next;
        console.log(`[Auto] MD5 #${next}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    savePredictionHistory();
    saveLearningData();
  } catch (e) {
    console.error('[Auto] Error:', e.message);
  }
}

function startAutoSaveTask() {
  console.log(`🔄 Auto-process every ${AUTO_SAVE_INTERVAL / 1000}s`);
  setTimeout(autoProcessPredictions, 4000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== API ENDPOINTS ====================
app.get('/api/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || !data.length) return res.status(500).json({ error: 'Không lấy được dữ liệu HU' });
    await verifyPredictions('hu', data);
    const next = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', next, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', next, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('hu'), 4000);
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      factors: result.factors.slice(0, 5),
      id: '@phamkhoi'
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server HU' });
  }
});

app.get('/api/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || !data.length) return res.status(500).json({ error: 'Không lấy được dữ liệu MD5' });
    await verifyPredictions('md5', data);
    const next = data[0].Phien + 1;
    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', next, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', next, result.prediction, result.confidence, result.factors);
    setTimeout(() => updateHistoryStatus('md5'), 4000);
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      factors: result.factors.slice(0, 5),
      id: '@phamkhoi'
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server MD5' });
  }
});

app.get('/api/hu/lichsu', async (req, res) => {
  await updateHistoryStatus('hu');
  res.json({ type: 'Tài Xỉu Hũ - Phạm Khôi', history: predictionHistory.hu, total: predictionHistory.hu.length });
});

app.get('/api/md5/lichsu', async (req, res) => {
  await updateHistoryStatus('md5');
  res.json({ type: 'Tài Xỉu MD5 - Phạm Khôi', history: predictionHistory.md5, total: predictionHistory.md5.length });
});

app.get('/api/hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || !data.length) return res.status(500).json({ error: 'No data' });
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || !data.length) return res.status(500).json({ error: 'No data' });
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions > 0 ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'Hũ Learning - Phạm Khôi',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: `${acc}%`,
    streakAnalysis: s.streakAnalysis,
    topWeights: Object.entries(s.patternWeights || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  });
});

app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions > 0 ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'MD5 Learning - Phạm Khôi',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: `${acc}%`,
    streakAnalysis: s.streakAnalysis,
    topWeights: Object.entries(s.patternWeights || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: createEmptyLearning(), md5: createEmptyLearning() };
  learningData.hu.patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  learningData.md5.patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  saveLearningData();
  res.json({ message: 'Learning data reset OK - Phạm Khôi' });
});

// ==================== MODERN UI ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getDashboardHTML());
});

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Phạm Khôi | Tài Xỉu Pro v7</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { font-family: 'Be Vietnam Pro', system-ui, sans-serif; }
  body { background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); min-height: 100vh; }
  .glass { background: rgba(255,255,255,0.06); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.1); }
  .card-tai { background: linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15)); border-color: rgba(16,185,129,0.4); }
  .card-xiu { background: linear-gradient(135deg, rgba(239,68,68,0.25), rgba(220,38,38,0.15)); border-color: rgba(239,68,68,0.4); }
  .pulse { animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
  .fade-in { animation: fadeIn 0.5s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
  .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 9999px; }
</style>
</head>
<body class="text-white">
<div class="max-w-7xl mx-auto px-4 py-6">
  <!-- HEADER -->
  <header class="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
    <div class="flex items-center gap-3">
      <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-2xl font-black shadow-lg shadow-orange-500/30">PK</div>
      <div>
        <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight">Phạm Khôi <span class="text-amber-400">Tài Xỉu Pro</span></h1>
        <p class="text-sm text-white/50">Markov • Dice AI • Entropy • Ensemble Adaptive • v7.0</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <span id="clock" class="text-sm text-white/60 font-medium"></span>
      <button onclick="refreshAll()" class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition text-sm font-semibold flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        Làm mới
      </button>
    </div>
  </header>

  <!-- MAIN PREDICTION CARDS -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
    <!-- HU CARD -->
    <div id="card-hu" class="glass rounded-3xl p-6 fade-in">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-emerald-400 pulse"></span>
          <h2 class="text-lg font-bold">Tài Xỉu Hũ</h2>
        </div>
        <span id="hu-phien" class="text-xs text-white/40 font-mono">#---</span>
      </div>
      <div class="flex items-center justify-center gap-6 my-6">
        <div class="text-center">
          <div id="hu-pred" class="text-5xl font-black tracking-tight">---</div>
          <div id="hu-conf" class="mt-2 text-2xl font-bold text-amber-400">--%</div>
        </div>
        <div class="text-center text-white/40">
          <div class="text-xs mb-1">Xúc xắc gần nhất</div>
          <div id="hu-dice" class="text-xl font-mono">- - -</div>
          <div id="hu-tong" class="text-sm mt-1">Tổng: --</div>
        </div>
      </div>
      <div id="hu-factors" class="flex flex-wrap gap-1.5 justify-center min-h-[28px]"></div>
      <div class="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 gap-2 text-center text-xs">
        <div><div class="text-white/40">Độ chính xác</div><div id="hu-acc" class="font-bold text-emerald-400">--%</div></div>
        <div><div class="text-white/40">Chuỗi hiện tại</div><div id="hu-streak" class="font-bold">--</div></div>
        <div><div class="text-white/40">Phiên dự đoán</div><div id="hu-next" class="font-bold text-amber-300">#---</div></div>
      </div>
    </div>

    <!-- MD5 CARD -->
    <div id="card-md5" class="glass rounded-3xl p-6 fade-in">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-violet-400 pulse"></span>
          <h2 class="text-lg font-bold">Tài Xỉu MD5</h2>
        </div>
        <span id="md5-phien" class="text-xs text-white/40 font-mono">#---</span>
      </div>
      <div class="flex items-center justify-center gap-6 my-6">
        <div class="text-center">
          <div id="md5-pred" class="text-5xl font-black tracking-tight">---</div>
          <div id="md5-conf" class="mt-2 text-2xl font-bold text-amber-400">--%</div>
        </div>
        <div class="text-center text-white/40">
          <div class="text-xs mb-1">Xúc xắc gần nhất</div>
          <div id="md5-dice" class="text-xl font-mono">- - -</div>
          <div id="md5-tong" class="text-sm mt-1">Tổng: --</div>
        </div>
      </div>
      <div id="md5-factors" class="flex flex-wrap gap-1.5 justify-center min-h-[28px]"></div>
      <div class="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 gap-2 text-center text-xs">
        <div><div class="text-white/40">Độ chính xác</div><div id="md5-acc" class="font-bold text-emerald-400">--%</div></div>
        <div><div class="text-white/40">Chuỗi hiện tại</div><div id="md5-streak" class="font-bold">--</div></div>
        <div><div class="text-white/40">Phiên dự đoán</div><div id="md5-next" class="font-bold text-amber-300">#---</div></div>
      </div>
    </div>
  </div>

  <!-- HISTORY + STATS -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
    <div class="glass rounded-3xl p-5">
      <h3 class="font-bold mb-3 flex items-center gap-2">📜 Lịch sử Hũ (gần nhất)</h3>
      <div id="hu-history" class="space-y-1.5 max-h-72 overflow-y-auto text-sm"></div>
    </div>
    <div class="glass rounded-3xl p-5">
      <h3 class="font-bold mb-3 flex items-center gap-2">📜 Lịch sử MD5 (gần nhất)</h3>
      <div id="md5-history" class="space-y-1.5 max-h-72 overflow-y-auto text-sm"></div>
    </div>
  </div>

  <!-- LEARNING STATS -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
    <div class="glass rounded-3xl p-5">
      <h3 class="font-bold mb-3">🧠 Learning Hũ</h3>
      <div id="hu-learning" class="text-sm space-y-1 text-white/70"></div>
    </div>
    <div class="glass rounded-3xl p-5">
      <h3 class="font-bold mb-3">🧠 Learning MD5</h3>
      <div id="md5-learning" class="text-sm space-y-1 text-white/70"></div>
    </div>
  </div>

  <footer class="text-center text-white/30 text-xs py-6">
    Phạm Khôi Tài Xỉu Pro v7 • Markov Chain + Dice Hot/Cold + Entropy + Sum Regression + Adaptive Ensemble<br>
    ID: @phamkhoi • Tự động học & điều chỉnh trọng số theo độ chính xác thực tế
  </footer>
</div>

<script>
const $ = id => document.getElementById(id);

function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleString('vi-VN');
}
setInterval(updateClock, 1000);
updateClock();

function predColor(pred) {
  return pred === 'Tài' ? 'text-emerald-400' : pred === 'Xỉu' ? 'text-rose-400' : 'text-white';
}
function cardClass(pred) {
  return pred === 'Tài' ? 'card-tai' : pred === 'Xỉu' ? 'card-xiu' : '';
}

async function loadHu() {
  try {
    const r = await fetch('/api/hu');
    const d = await r.json();
    if (d.error) return;
    $('hu-phien').textContent = '#' + d.Phien;
    $('hu-next').textContent = '#' + d.Phien_hien_tai;
    $('hu-pred').textContent = d.Du_doan;
    $('hu-pred').className = 'text-5xl font-black tracking-tight ' + predColor(d.Du_doan);
    $('hu-conf').textContent = d.Do_tin_cay;
    $('hu-dice').textContent = \`\${d.Xuc_xac_1}  \${d.Xuc_xac_2}  \${d.Xuc_xac_3}\`;
    $('hu-tong').textContent = 'Tổng: ' + d.Tong + ' (' + d.Ket_qua + ')';
    $('card-hu').className = 'glass rounded-3xl p-6 fade-in ' + cardClass(d.Du_doan);
    $('hu-factors').innerHTML = (d.factors || []).slice(0,4).map(f => 
      \`<span class="badge bg-white/10 text-white/70">\${f.split('→')[0].trim().substring(0,28)}</span>\`
    ).join('');
  } catch(e) {}
}

async function loadMd5() {
  try {
    const r = await fetch('/api/md5');
    const d = await r.json();
    if (d.error) return;
    $('md5-phien').textContent = '#' + d.Phien;
    $('md5-next').textContent = '#' + d.Phien_hien_tai;
    $('md5-pred').textContent = d.Du_doan;
    $('md5-pred').className = 'text-5xl font-black tracking-tight ' + predColor(d.Du_doan);
    $('md5-conf').textContent = d.Do_tin_cay;
    $('md5-dice').textContent = \`\${d.Xuc_xac_1}  \${d.Xuc_xac_2}  \${d.Xuc_xac_3}\`;
    $('md5-tong').textContent = 'Tổng: ' + d.Tong + ' (' + d.Ket_qua + ')';
    $('card-md5').className = 'glass rounded-3xl p-6 fade-in ' + cardClass(d.Du_doan);
    $('md5-factors').innerHTML = (d.factors || []).slice(0,4).map(f => 
      \`<span class="badge bg-white/10 text-white/70">\${f.split('→')[0].trim().substring(0,28)}</span>\`
    ).join('');
  } catch(e) {}
}

async function loadHistory(type) {
  try {
    const r = await fetch(\`/api/\${type}/lichsu\`);
    const d = await r.json();
    const box = $(type + '-history');
    if (!d.history || !d.history.length) {
      box.innerHTML = '<div class="text-white/30 text-center py-4">Chưa có dữ liệu</div>';
      return;
    }
    box.innerHTML = d.history.slice(0, 25).map(h => {
      const ok = h.ket_qua_du_doan || '';
      const color = ok.includes('Đúng') ? 'text-emerald-400' : ok.includes('Sai') ? 'text-rose-400' : 'text-white/40';
      return \`<div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5">
        <span class="font-mono text-white/50">#\${h.Phien_hien_tai}</span>
        <span class="font-semibold \${predColor(h.Du_doan)}">\${h.Du_doan}</span>
        <span class="text-white/40">\${h.Do_tin_cay}</span>
        <span class="\${color} text-xs">\${ok || '...'}</span>
      </div>\`;
    }).join('');
  } catch(e) {}
}

async function loadLearning(type) {
  try {
    const r = await fetch(\`/api/\${type}/learning\`);
    const d = await r.json();
    const box = $(type + '-learning');
    const s = d.streakAnalysis || {};
    box.innerHTML = \`
      <div>Tổng dự đoán: <b class="text-white">\${d.totalPredictions}</b></div>
      <div>Đúng: <b class="text-emerald-400">\${d.correctPredictions}</b> — Accuracy: <b class="text-amber-400">\${d.overallAccuracy}</b></div>
      <div>Chuỗi hiện tại: <b>\${s.currentStreak || 0}</b> | Best: <b class="text-emerald-400">\${s.bestStreak || 0}</b> | Worst: <b class="text-rose-400">\${s.worstStreak || 0}</b></div>
      <div class="mt-2 text-xs text-white/40">Top weights: \${(d.topWeights||[]).slice(0,5).map(w => w[0]+'('+w[1].toFixed(2)+')').join(', ')}</div>
    \`;
    $(type + '-acc').textContent = d.overallAccuracy;
    $(type + '-streak').textContent = (s.currentStreak >= 0 ? '+' : '') + (s.currentStreak || 0);
  } catch(e) {}
}

async function refreshAll() {
  await Promise.all([loadHu(), loadMd5(), loadHistory('hu'), loadHistory('md5'), loadLearning('hu'), loadLearning('md5')]);
}

refreshAll();
setInterval(refreshAll, 18000);
</script>
</body>
</html>`;
}

// ==================== START ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  🔥 PHẠM KHÔI TÀI XỈU PRO v7.0');
  console.log('  Server: http://0.0.0.0:' + PORT);
  console.log('  UI Dashboard: http://localhost:' + PORT + '/');
  console.log('');
  console.log('  THUẬT TOÁN MỚI:');
  console.log('  ✓ Markov Chain Order 1-2-3');
  console.log('  ✓ Dice Hot/Cold + Face Frequency');
  console.log('  ✓ Entropy Analysis');
  console.log('  ✓ Sum Linear Regression');
  console.log('  ✓ Adaptive Ensemble + Pattern Weight Learning');
  console.log('  ✓ Smart Streak Break & Mean Reversion');
  console.log('');
  console.log('  FILE: phamkhoi.json | phamkhoi1.json');
  console.log('  ID: @phamkhoi');
  console.log('══════════════════════════════════════════════════');
  startAutoSaveTask();
});
