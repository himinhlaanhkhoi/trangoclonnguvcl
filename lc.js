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
const MAX_HISTORY = 150;
const AUTO_SAVE_INTERVAL = 22000;
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
    recentAccuracy: [],
    markov: { order1: {}, order2: {}, order3: {} },
    diceStats: { faces: [0,0,0,0,0,0,0], pairs: {}, sums: {} }
  };
}

const DEFAULT_PATTERN_WEIGHTS = {
  markov_chain: 1.8, dice_hotcold: 1.55, dice_pair: 1.4, entropy: 1.35,
  sum_regression: 1.45, sequence_mine: 1.5, tong_phan_tich: 1.5,
  xu_huong_manh: 1.45, cau_rong: 1.5, break_streak: 1.4, smart_bet: 1.4,
  cau_bet: 1.25, cau_dao_11: 1.3, cau_22: 1.2, cau_33: 1.25, dao_chieu: 1.35,
  cau_tu_nhien: 0.7, distribution: 1.1, momentum: 1.2
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = { ...learningData, ...parsed };
      console.log('✅ Loaded phamkhoi.json');
    }
  } catch (e) { console.error('Load learning:', e.message); }
}

function saveLearningData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); }
  catch (e) { console.error('Save learning:', e.message); }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      ['hu', 'md5'].forEach(t => {
        const seen = new Set();
        predictionHistory[t] = predictionHistory[t].filter(r => {
          const key = r.Phien_hien_tai;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      console.log(`✅ History | HU: ${predictionHistory.hu.length} | MD5: ${predictionHistory.md5.length}`);
    }
  } catch (e) { console.error('Load history:', e.message); }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) { console.error('Save history:', e.message); }
}

function transformApiData(apiData) {
  if (!apiData?.list?.length) return null;
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
    console.error('HU fetch:', e.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const res = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transformApiData(res.data);
  } catch (e) {
    console.error('MD5 fetch:', e.message);
    return null;
  }
}

function hasPredictionForPhien(type, phien) {
  const p = phien.toString();
  return predictionHistory[type].some(r => r.Phien_hien_tai === p) ||
         learningData[type].predictions.some(r => r.phien === p);
}

function getExistingPrediction(type, phien) {
  const p = phien.toString();
  return predictionHistory[type].find(r => r.Phien_hien_tai === p) || null;
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || !Object.keys(learningData[type].patternWeights).length) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(p => {
    if (!learningData[type].patternStats[p]) {
      learningData[type].patternStats[p] = { total: 0, correct: 0, accuracy: 0.5, recentResults: [] };
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
  if (stats.recentResults.length > 30) stats.recentResults.shift();
  const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  let w = learningData[type].patternWeights[patternId];
  if (stats.recentResults.length >= 7) {
    if (recentAcc > 0.70) w = Math.min(3.5, w * 1.15);
    else if (recentAcc < 0.30) w = Math.max(0.12, w * 0.85);
  }
  learningData[type].patternWeights[patternId] = +w.toFixed(3);
}

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
  if (results.length < 5) return { detected: false };
  const markov = buildMarkov(results.slice(0, 80));
  learningData[type].markov = markov;
  const last1 = results[0];
  const last2 = results[1] + '|' + results[0];
  const last3 = results[2] + '|' + results[1] + '|' + results[0];
  let scores = { Tài: 0, Xỉu: 0 };
  let conf = 62;
  let parts = [];

  if (markov.order3[last3]) {
    const t = markov.order3[last3];
    const total = t.Tài + t.Xỉu;
    if (total >= 2) {
      scores.Tài += (t.Tài / total) * 3.5;
      scores.Xỉu += (t.Xỉu / total) * 3.5;
      conf += 14;
      parts.push('M3');
    }
  }
  if (markov.order2[last2]) {
    const t = markov.order2[last2];
    const total = t.Tài + t.Xỉu;
    if (total >= 3) {
      scores.Tài += (t.Tài / total) * 2.6;
      scores.Xỉu += (t.Xỉu / total) * 2.6;
      conf += 9;
      parts.push('M2');
    }
  }
  if (markov.order1[last1]) {
    const t = markov.order1[last1];
    const total = t.Tài + t.Xỉu;
    if (total >= 5) {
      scores.Tài += (t.Tài / total) * 1.7;
      scores.Xỉu += (t.Xỉu / total) * 1.7;
      conf += 6;
      parts.push('M1');
    }
  }
  if (scores.Tài === 0 && scores.Xỉu === 0) return { detected: false };
  const pred = scores.Tài >= scores.Xỉu ? 'Tài' : 'Xỉu';
  const weight = getPatternWeight(type, 'markov_chain');
  return {
    detected: true,
    prediction: pred,
    confidence: Math.min(94, Math.round(conf * weight)),
    name: `Markov(${parts.join('+')}) → ${pred}`,
    patternId: 'markov_chain'
  };
}

function analyzeDiceFull(data, type) {
  if (data.length < 12) return { detected: false };
  const recent = data.slice(0, 40);
  const face = [0,0,0,0,0,0,0];
  let high = 0, low = 0;
  recent.forEach(d => {
    const ds = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    ds.forEach(f => { if (f>=1&&f<=6) face[f]++; });
    high += (ds[0]>=4?1:0) + (ds[1]>=4?1:0) + (ds[2]>=4?1:0);
    low  += (ds[0]<=3?1:0) + (ds[1]<=3?1:0) + (ds[2]<=3?1:0);
  });
  learningData[type].diceStats.faces = face;
  const totalFaces = recent.length * 3;
  const highRatio = high / totalFaces;
  const lowRatio = low / totalFaces;
  const weight = getPatternWeight(type, 'dice_hotcold');
  if (Math.abs(highRatio - lowRatio) > 0.09) {
    const pred = highRatio > lowRatio ? 'Xỉu' : 'Tài';
    const conf = Math.round(70 + Math.abs(highRatio - lowRatio) * 90);
    return {
      detected: true,
      prediction: pred,
      confidence: Math.min(90, Math.round(conf * weight)),
      name: `Dice Bias H${(highRatio*100).toFixed(0)}% L${(lowRatio*100).toFixed(0)}% → ${pred}`,
      patternId: 'dice_hotcold'
    };
  }
  return { detected: false };
}

function analyzeDicePair(data, type) {
  if (data.length < 8) return { detected: false };
  const recent = data.slice(0, 15);
  let pairStreak = 0;
  for (const d of recent) {
    const ds = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    if (ds[0]===ds[1] || ds[1]===ds[2] || ds[0]===ds[2]) pairStreak++;
    else break;
  }
  if (pairStreak < 3) return { detected: false };
  const weight = getPatternWeight(type, 'dice_pair');
  const lastSum = recent[0].Tong;
  const pred = lastSum >= 11 ? 'Xỉu' : 'Tài';
  return {
    detected: true,
    prediction: pred,
    confidence: Math.min(86, Math.round((68 + pairStreak * 3) * weight)),
    name: `Dice Pair x${pairStreak} → ${pred}`,
    patternId: 'dice_pair'
  };
}

function analyzeEntropy(results, type) {
  if (results.length < 12) return { detected: false };
  const win = results.slice(0, 14);
  const tai = win.filter(r => r === 'Tài').length;
  const p = tai / win.length;
  const entropy = (p === 0 || p === 1) ? 0 : -(p * Math.log2(p) + (1-p)*Math.log2(1-p));
  if (entropy > 0.88) return { detected: false };
  const weight = getPatternWeight(type, 'entropy');
  let pred, conf;
  if (entropy < 0.35) {
    const maj = tai >= 8 ? 'Tài' : 'Xỉu';
    pred = (tai >= 11 || tai <= 3) ? (maj === 'Tài' ? 'Xỉu' : 'Tài') : maj;
    conf = Math.round(80 + (0.35 - entropy) * 50);
  } else {
    pred = tai > 7 ? 'Xỉu' : 'Tài';
    conf = 72;
  }
  return {
    detected: true,
    prediction: pred,
    confidence: Math.min(91, Math.round(conf * weight)),
    name: `Entropy ${entropy.toFixed(2)} → ${pred}`,
    patternId: 'entropy'
  };
}

function analyzeSumRegression(data, type) {
  if (data.length < 12) return { detected: false };
  const sums = data.slice(0, 16).map(d => d.Tong);
  const n = sums.length;
  let sumX=0, sumY=0, sumXY=0, sumX2=0;
  for (let i=0; i<n; i++) {
    const x = n - i;
    sumX += x; sumY += sums[i]; sumXY += x*sums[i]; sumX2 += x*x;
  }
  const slope = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX || 1);
  const avg = sumY / n;
  const weight = getPatternWeight(type, 'sum_regression');
  if (Math.abs(slope) < 0.22 && Math.abs(avg-10.5) < 1.1) return { detected: false };
  let pred, conf;
  if (slope > 0.35) { pred = 'Xỉu'; conf = Math.round(74 + slope*18); }
  else if (slope < -0.35) { pred = 'Tài'; conf = Math.round(74 + Math.abs(slope)*18); }
  else if (avg > 12.2) { pred = 'Xỉu'; conf = 76; }
  else if (avg < 8.8) { pred = 'Tài'; conf = 76; }
  else return { detected: false };
  return {
    detected: true,
    prediction: pred,
    confidence: Math.min(90, Math.round(conf * weight)),
    name: `SumReg s${slope.toFixed(2)} avg${avg.toFixed(1)} → ${pred}`,
    patternId: 'sum_regression'
  };
}

function analyzeSequenceMine(results, type) {
  if (results.length < 10) return { detected: false };
  const target = results.slice(0, 4).join('');
  let matches = { Tài: 0, Xỉu: 0 };
  for (let i = 4; i < Math.min(results.length - 4, 60); i++) {
    const seq = results.slice(i, i+4).join('');
    if (seq === target) {
      const next = results[i-1];
      if (next) matches[next]++;
    }
  }
  const total = matches.Tài + matches.Xỉu;
  if (total < 2) return { detected: false };
  const pred = matches.Tài >= matches.Xỉu ? 'Tài' : 'Xỉu';
  const weight = getPatternWeight(type, 'sequence_mine');
  const conf = Math.round(70 + Math.min(total, 8) * 2.5);
  return {
    detected: true,
    prediction: pred,
    confidence: Math.min(88, Math.round(conf * weight)),
    name: `SeqMine x${total} → ${pred}`,
    patternId: 'sequence_mine'
  };
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let len = 1;
  for (let i=1; i<results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  if (len < 3) return { detected: false };
  const weight = getPatternWeight(type, 'cau_bet');
  let shouldBreak = len >= 5;
  let conf = 67;
  if (len >= 8) { shouldBreak = true; conf = 90; }
  else if (len >= 6) { shouldBreak = true; conf = 82; }
  else if (len >= 4) { shouldBreak = true; conf = 74; }
  return {
    detected: true,
    prediction: shouldBreak ? (results[0]==='Tài'?'Xỉu':'Tài') : results[0],
    confidence: Math.round(conf * weight),
    name: `Cầu Bệt ${len} ${results[0]}`,
    patternId: 'cau_bet'
  };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let alt = 1;
  for (let i=1; i<Math.min(results.length,14); i++) {
    if (results[i] !== results[i-1]) alt++; else break;
  }
  if (alt < 4) return { detected: false };
  const weight = getPatternWeight(type, 'cau_dao_11');
  return {
    detected: true,
    prediction: results[0]==='Tài'?'Xỉu':'Tài',
    confidence: Math.min(87, Math.round((67 + alt*2.3)*weight)),
    name: `Cầu Đảo 1-1 (${alt})`,
    patternId: 'cau_dao_11'
  };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  let len = 1;
  for (let i=1; i<results.length; i++) {
    if (results[i]===results[0]) len++; else break;
  }
  if (len < 6) return { detected: false };
  const weight = getPatternWeight(type, 'cau_rong');
  return {
    detected: true,
    prediction: results[0]==='Tài'?'Xỉu':'Tài',
    confidence: Math.min(93, Math.round((80 + len)*weight)),
    name: `Cầu Rồng ${len} → Bẻ`,
    patternId: 'cau_rong'
  };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  const r = results.slice(0,9);
  const tai = r.filter(x=>x==='Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  if (tai >= 7) return { detected:true, prediction:'Xỉu', confidence:Math.round((84+tai)*weight), name:`Xu hướng ${tai}/9 Tài → Đảo`, patternId:'xu_huong_manh' };
  if (tai <= 2) return { detected:true, prediction:'Tài', confidence:Math.round((84+(9-tai))*weight), name:`Xu hướng ${9-tai}/9 Xỉu → Đảo`, patternId:'xu_huong_manh' };
  return { detected:false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected:false };
  const recent = data.slice(0,12);
  const sums = recent.map(d=>d.Tong);
  const results = recent.map(d=>d.Ket_qua);
  const avg = sums.reduce((a,b)=>a+b,0)/sums.length;
  const first = sums.slice(6).reduce((a,b)=>a+b,0)/6;
  const last = sums.slice(0,6).reduce((a,b)=>a+b,0)/6;
  const trend = last - first;
  const weight = getPatternWeight(type, 'tong_phan_tich');
  const taiC = results.filter(r=>r==='Tài').length;
  if (trend > 1.5) return { detected:true, prediction:'Xỉu', confidence:Math.round((77+Math.abs(trend)*4)*weight), name:`Tổng↑${trend.toFixed(1)} → Xỉu`, patternId:'tong_phan_tich' };
  if (trend < -1.5) return { detected:true, prediction:'Tài', confidence:Math.round((77+Math.abs(trend)*4)*weight), name:`Tổng↓${Math.abs(trend).toFixed(1)} → Tài`, patternId:'tong_phan_tich' };
  if (Math.abs(taiC - 6) >= 3) {
    const pred = taiC > 6 ? 'Xỉu' : 'Tài';
    return { detected:true, prediction:pred, confidence:Math.round((73+Math.abs(taiC-6)*3.5)*weight), name:`Lệch ${Math.abs(taiC-6)} → ${pred}`, patternId:'tong_phan_tich' };
  }
  return { detected:false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected:false };
  let len=1;
  for (let i=1;i<results.length;i++){ if(results[i]===results[0]) len++; else break; }
  if (len < 5) return { detected:false };
  const weight = getPatternWeight(type, 'break_streak');
  return {
    detected: true,
    prediction: results[0]==='Tài'?'Xỉu':'Tài',
    confidence: Math.min(91, Math.round((74 + len*1.9)*weight)),
    name: `Bẻ chuỗi ${len}`,
    patternId: 'break_streak'
  };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected:false };
  const l5 = results.slice(0,5);
  const p5 = results.slice(5,10);
  const tL = l5.filter(r=>r==='Tài').length;
  const tP = p5.filter(r=>r==='Tài').length;
  const weight = getPatternWeight(type, 'smart_bet');
  if ((tL>=4 && tP<=1) || (tL<=1 && tP>=4)) {
    const cur = tL>=4 ? 'Tài' : 'Xỉu';
    return { detected:true, prediction: cur==='Tài'?'Xỉu':'Tài', confidence:Math.round(82*weight), name:'Đảo xu hướng', patternId:'smart_bet' };
  }
  const t10 = results.slice(0,10).filter(r=>r==='Tài').length;
  if (t10>=8 || t10<=2) {
    const dom = t10>=8 ? 'Tài' : 'Xỉu';
    return { detected:true, prediction: dom==='Tài'?'Xỉu':'Tài', confidence:Math.round(85*weight), name:`Cực ${t10}T → Đảo`, patternId:'smart_bet' };
  }
  return { detected:false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected:false };
  let pairs=0, pattern=[], i=0;
  while (i < results.length-1 && pairs<5) {
    if (results[i]===results[i+1]) { pattern.push(results[i]); pairs++; i+=2; }
    else break;
  }
  if (pairs < 2) return { detected:false };
  let alt=true;
  for (let j=1;j<pattern.length;j++) if(pattern[j]===pattern[j-1]){alt=false;break;}
  if (!alt) return { detected:false };
  const weight = getPatternWeight(type, 'cau_22');
  return {
    detected: true,
    prediction: pattern[pattern.length-1]==='Tài'?'Xỉu':'Tài',
    confidence: Math.round(Math.min(84, 68+pairs*3.5)*weight),
    name: `Cầu 2-2 (${pairs})`,
    patternId: 'cau_22'
  };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected:false };
  let triples=0, pattern=[], i=0;
  while (i < results.length-2) {
    if (results[i]===results[i+1] && results[i+1]===results[i+2]) {
      pattern.push(results[i]); triples++; i+=3;
    } else break;
  }
  if (triples < 1) return { detected:false };
  const weight = getPatternWeight(type, 'cau_33');
  const pos = results.length % 3;
  const lastT = pattern[pattern.length-1];
  const pred = pos===0 ? (lastT==='Tài'?'Xỉu':'Tài') : lastT;
  return {
    detected: true,
    prediction: pred,
    confidence: Math.round(Math.min(86, 72+triples*5)*weight),
    name: `Cầu 3-3 (${triples})`,
    patternId: 'cau_33'
  };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected:false };
  const r5 = results.slice(0,5);
  let alt=true;
  for (let i=0;i<4;i++) if(r5[i]===r5[i+1]){alt=false;break;}
  if (!alt) return { detected:false };
  const weight = getPatternWeight(type, 'dao_chieu');
  return {
    detected: true,
    prediction: r5[0]==='Tài'?'Xỉu':'Tài',
    confidence: Math.round(78*weight),
    name: `Đảo chiều thuần`,
    patternId: 'dao_chieu'
  };
}

function analyzeCauTuNhien(results, type) {
  if (!results.length) return { detected:false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  return {
    detected: true,
    prediction: results[0],
    confidence: Math.round(55*weight),
    name: 'Theo ván trước',
    patternId: 'cau_tu_nhien'
  };
}

function calculateAdvancedPrediction(data, type) {
  const last80 = data.slice(0, 80);
  const results = last80.map(d => d.Ket_qua);
  initializePatternStats(type);

  const candidates = [];
  const factors = [];
  const allPatterns = [];

  const analyzers = [
    () => predictMarkov(results, type),
    () => analyzeDiceFull(last80, type),
    () => analyzeDicePair(last80, type),
    () => analyzeEntropy(results, type),
    () => analyzeSumRegression(last80, type),
    () => analyzeSequenceMine(results, type),
    () => analyzeTongPhanTich(last80, type),
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
      if (r?.detected) {
        candidates.push({ prediction: r.prediction, confidence: r.confidence, name: r.name, patternId: r.patternId });
        factors.push(r.name);
        allPatterns.push(r);
      }
    } catch(e){}
  });

  if (!candidates.length) {
    const fb = analyzeCauTuNhien(results, type);
    candidates.push({ prediction: fb.prediction, confidence: fb.confidence, name: fb.name, patternId: fb.patternId });
    factors.push(fb.name);
  }

  let taiScore = 0, xiuScore = 0;
  candidates.forEach(c => {
    const s = c.confidence * (c.confidence / 75);
    if (c.prediction === 'Tài') taiScore += s;
    else xiuScore += s;
  });

  const streak = learningData[type].streakAnalysis.currentStreak;
  if (streak <= -3) {
    if (taiScore > xiuScore) xiuScore *= 1.38;
    else taiScore *= 1.38;
  } else if (streak >= 5) {
    if (taiScore > xiuScore) taiScore *= 1.1;
    else xiuScore *= 1.1;
  }

  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartAdjustment(type, finalPrediction, allPatterns);

  let base = 65;
  const top = candidates.sort((a,b) => b.confidence - a.confidence).slice(0,4);
  top.forEach(p => { if (p.prediction === finalPrediction) base += (p.confidence - 60) * 0.26; });
  const agree = candidates.filter(c => c.prediction === finalPrediction).length / candidates.length;
  base += agree * 11;
  base += getAdaptiveBoost(type);
  const finalConf = Math.max(60, Math.min(94, Math.round(base)));

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
          ? ((learningData[type].correctPredictions / learningData[type].totalPredictions)*100).toFixed(1)+'%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak
      }
    }
  };
}

function getAdaptiveBoost(type) {
  const acc = learningData[type].recentAccuracy;
  if (acc.length < 8) return 0;
  const a = acc.reduce((x,y)=>x+y,0)/acc.length;
  if (a > 0.74) return 10;
  if (a > 0.64) return 6;
  if (a > 0.54) return 2;
  if (a < 0.26) return -10;
  if (a < 0.36) return -6;
  return 0;
}

function getSmartAdjustment(type, prediction, patterns) {
  const streak = learningData[type].streakAnalysis;
  if (streak.currentStreak <= -4) return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  let taiS=0, xiuS=0;
  patterns.forEach(p => {
    const id = p.patternId;
    if (!id) return;
    const st = learningData[type].patternStats[id];
    if (st && st.recentResults.length >= 6) {
      const ra = st.recentResults.reduce((a,b)=>a+b,0)/st.recentResults.length;
      const w = learningData[type].patternWeights[id] || 1;
      if (p.prediction === 'Tài') taiS += ra * w;
      else xiuS += ra * w;
    }
  });
  if (Math.abs(taiS - xiuS) > 0.9) return taiS > xiuS ? 'Tài' : 'Xỉu';
  return prediction;
}

function getPatternIdFromName(name) {
  const map = {
    'Markov': 'markov_chain', 'Dice Bias': 'dice_hotcold', 'Dice Pair': 'dice_pair',
    'Entropy': 'entropy', 'SumReg': 'sum_regression', 'SeqMine': 'sequence_mine',
    'Tổng': 'tong_phan_tich', 'Xu hướng': 'xu_huong_manh', 'Cầu Rồng': 'cau_rong',
    'Bẻ chuỗi': 'break_streak', 'Đảo xu hướng': 'smart_bet', 'Cực': 'smart_bet',
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Đảo chiều': 'dao_chieu', 'Theo ván': 'cau_tu_nhien'
  };
  for (const [k,v] of Object.entries(map)) if (name.includes(k)) return v;
  return null;
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const p = phien.toString();
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  const rec = {
    phien: p,
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
  if (learningData[type].predictions.length > 700) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 700);
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
      const norm = (pred.prediction === 'Tài' || pred.prediction === 'tai') ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === norm;
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        learningData[type].streakAnalysis.currentStreak =
          learningData[type].streakAnalysis.currentStreak >= 0
            ? learningData[type].streakAnalysis.currentStreak + 1 : 1;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        learningData[type].streakAnalysis.currentStreak =
          learningData[type].streakAnalysis.currentStreak <= 0
            ? learningData[type].streakAnalysis.currentStreak - 1 : -1;
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 70) learningData[type].recentAccuracy.shift();
      if (pred.patterns?.length) {
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
  const p = phien.toString();
  if (predictionHistory[type].some(r => r.Phien_hien_tai === p)) {
    return predictionHistory[type].find(r => r.Phien_hien_tai === p);
  }
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: p,
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
    if (!data?.length) return;
    let updated = false;
    for (const rec of predictionHistory[type]) {
      if (rec.ket_qua_du_doan) continue;
      const actual = data.find(d => d.Phien.toString() === rec.Phien_hien_tai);
      if (actual) {
        rec.ket_qua_du_doan = rec.Du_doan === actual.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
        updated = true;
      }
    }
    if (updated) savePredictionHistory();
  } catch (e) { console.error(`Update ${type}:`, e.message); }
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu?.length) {
      const next = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== next && !hasPredictionForPhien('hu', next)) {
        await verifyPredictions('hu', dataHu);
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', next, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', next, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = next;
        console.log(`[Auto] HU #${next}: ${result.prediction} (${result.confidence}%)`);
        savePredictionHistory();
        saveLearningData();
      }
    }
    const dataMd5 = await fetchDataMd5();
    if (dataMd5?.length) {
      const next = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== next && !hasPredictionForPhien('md5', next)) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', next, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', next, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = next;
        console.log(`[Auto] MD5 #${next}: ${result.prediction} (${result.confidence}%)`);
        savePredictionHistory();
        saveLearningData();
      }
    }
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
  } catch (e) {
    console.error('[Auto]', e.message);
  }
}

function startAutoSaveTask() {
  console.log(`🔄 Auto every ${AUTO_SAVE_INTERVAL/1000}s`);
  setTimeout(autoProcessPredictions, 3500);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

app.get('/api/hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data?.length) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    await verifyPredictions('hu', data);
    const next = data[0].Phien + 1;

    if (hasPredictionForPhien('hu', next)) {
      const exist = getExistingPrediction('hu', next);
      return res.json({
        Phien: exist.Phien,
        Xuc_xac_1: exist.Xuc_xac_1,
        Xuc_xac_2: exist.Xuc_xac_2,
        Xuc_xac_3: exist.Xuc_xac_3,
        Tong: exist.Tong,
        Ket_qua: exist.Ket_qua,
        Do_tin_cay: exist.Do_tin_cay,
        Phien_hien_tai: exist.Phien_hien_tai,
        Du_doan: exist.Du_doan,
        ket_qua_du_doan: exist.ket_qua_du_doan || '',
        factors: [],
        id: '@phamkhoi',
        cached: true
      });
    }

    const result = calculateAdvancedPrediction(data, 'hu');
    const record = savePredictionToHistory('hu', next, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', next, result.prediction, result.confidence, result.factors);
    lastProcessedPhien.hu = next;
    savePredictionHistory();
    setTimeout(() => updateHistoryStatus('hu'), 3500);
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
      ket_qua_du_doan: '',
      factors: result.factors.slice(0, 5),
      id: '@phamkhoi',
      cached: false
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/api/md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data?.length) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    await verifyPredictions('md5', data);
    const next = data[0].Phien + 1;

    if (hasPredictionForPhien('md5', next)) {
      const exist = getExistingPrediction('md5', next);
      return res.json({
        Phien: exist.Phien,
        Xuc_xac_1: exist.Xuc_xac_1,
        Xuc_xac_2: exist.Xuc_xac_2,
        Xuc_xac_3: exist.Xuc_xac_3,
        Tong: exist.Tong,
        Ket_qua: exist.Ket_qua,
        Do_tin_cay: exist.Do_tin_cay,
        Phien_hien_tai: exist.Phien_hien_tai,
        Du_doan: exist.Du_doan,
        ket_qua_du_doan: exist.ket_qua_du_doan || '',
        factors: [],
        id: '@phamkhoi',
        cached: true
      });
    }

    const result = calculateAdvancedPrediction(data, 'md5');
    const record = savePredictionToHistory('md5', next, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', next, result.prediction, result.confidence, result.factors);
    lastProcessedPhien.md5 = next;
    savePredictionHistory();
    setTimeout(() => updateHistoryStatus('md5'), 3500);
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
      ket_qua_du_doan: '',
      factors: result.factors.slice(0, 5),
      id: '@phamkhoi',
      cached: false
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
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
    if (!data?.length) return res.status(500).json({ error: 'No data' });
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data?.length) return res.status(500).json({ error: 'No data' });
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions > 0 ? ((s.correctPredictions / s.totalPredictions)*100).toFixed(2) : 0;
  res.json({
    type: 'Hũ - Phạm Khôi',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: `${acc}%`,
    streakAnalysis: s.streakAnalysis,
    topWeights: Object.entries(s.patternWeights || {}).sort((a,b)=>b[1]-a[1]).slice(0,8)
  });
});

app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions > 0 ? ((s.correctPredictions / s.totalPredictions)*100).toFixed(2) : 0;
  res.json({
    type: 'MD5 - Phạm Khôi',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: `${acc}%`,
    streakAnalysis: s.streakAnalysis,
    topWeights: Object.entries(s.patternWeights || {}).sort((a,b)=>b[1]-a[1]).slice(0,8)
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: createEmptyLearning(), md5: createEmptyLearning() };
  learningData.hu.patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  learningData.md5.patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  saveLearningData();
  res.json({ message: 'Reset OK - Phạm Khôi' });
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getUI());
});

function getUI() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Phạm Khôi</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #07070f;
    --card: rgba(255,255,255,0.03);
    --border: rgba(255,255,255,0.07);
    --accent: #f59e0b;
    --tai: #10b981;
    --xiu: #f43f5e;
  }
  * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
  body {
    background: var(--bg);
    background-image: 
      radial-gradient(ellipse 80% 50% at 20% -10%, rgba(245,158,11,0.08), transparent),
      radial-gradient(ellipse 60% 40% at 80% 110%, rgba(16,185,129,0.06), transparent);
    min-height: 100vh;
    color: #f1f5f9;
  }
  .glass {
    background: var(--card);
    border: 1px solid var(--border);
    backdrop-filter: blur(20px);
  }
  .glow-tai { box-shadow: 0 0 40px -10px rgba(16,185,129,0.35); border-color: rgba(16,185,129,0.25); }
  .glow-xiu { box-shadow: 0 0 40px -10px rgba(244,63,94,0.35); border-color: rgba(244,63,94,0.25); }
  .pred-tai { color: var(--tai); text-shadow: 0 0 30px rgba(16,185,129,0.4); }
  .pred-xiu { color: var(--xiu); text-shadow: 0 0 30px rgba(244,63,94,0.4); }
  .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.85)} }
  .fade { animation: fadeUp 0.45s ease both; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
  .chip { font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.55); }
</style>
</head>
<body>
<div class="max-w-6xl mx-auto px-4 py-8">

  <header class="flex items-center justify-between mb-10 fade">
    <div class="flex items-center gap-3.5">
      <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-lg font-black text-black shadow-lg shadow-amber-500/20">PK</div>
      <div>
        <h1 class="text-xl font-extrabold tracking-tight">Phạm Khôi</h1>
        <p class="text-xs text-white/40 font-medium">Tài Xỉu • Bắt Cầu • Xúc Xắc</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <span id="clock" class="text-xs text-white/35 font-medium tabular-nums"></span>
      <button onclick="refreshAll()" class="px-3.5 py-2 rounded-xl glass text-xs font-semibold hover:bg-white/10 transition active:scale-95">Làm mới</button>
    </div>
  </header>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
    <div id="card-hu" class="glass rounded-3xl p-6 fade">
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-2">
          <span class="dot bg-emerald-400"></span>
          <span class="text-sm font-semibold text-white/80">Hũ</span>
        </div>
        <span id="hu-phien" class="text-[11px] text-white/30 font-mono">#—</span>
      </div>
      <div class="text-center py-4">
        <div id="hu-pred" class="text-6xl font-black tracking-tighter">—</div>
        <div id="hu-conf" class="mt-2 text-2xl font-bold text-amber-400/90">—%</div>
      </div>
      <div class="flex justify-center gap-6 text-center text-white/40 text-xs mb-4">
        <div>
          <div class="mb-0.5">Xúc xắc</div>
          <div id="hu-dice" class="text-base font-mono text-white/70">— — —</div>
        </div>
        <div>
          <div class="mb-0.5">Tổng</div>
          <div id="hu-tong" class="text-base font-semibold text-white/70">—</div>
        </div>
      </div>
      <div id="hu-factors" class="flex flex-wrap gap-1.5 justify-center min-h-[26px] mb-4"></div>
      <div class="grid grid-cols-3 gap-2 pt-4 border-t border-white/5 text-center">
        <div><div class="text-[10px] text-white/30 mb-0.5">Chính xác</div><div id="hu-acc" class="text-sm font-bold text-emerald-400">—%</div></div>
        <div><div class="text-[10px] text-white/30 mb-0.5">Chuỗi</div><div id="hu-streak" class="text-sm font-bold">—</div></div>
        <div><div class="text-[10px] text-white/30 mb-0.5">Phiên DD</div><div id="hu-next" class="text-sm font-bold text-amber-400/80">#—</div></div>
      </div>
    </div>

    <div id="card-md5" class="glass rounded-3xl p-6 fade" style="animation-delay:0.08s">
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-2">
          <span class="dot bg-violet-400"></span>
          <span class="text-sm font-semibold text-white/80">MD5</span>
        </div>
        <span id="md5-phien" class="text-[11px] text-white/30 font-mono">#—</span>
      </div>
      <div class="text-center py-4">
        <div id="md5-pred" class="text-6xl font-black tracking-tighter">—</div>
        <div id="md5-conf" class="mt-2 text-2xl font-bold text-amber-400/90">—%</div>
      </div>
      <div class="flex justify-center gap-6 text-center text-white/40 text-xs mb-4">
        <div>
          <div class="mb-0.5">Xúc xắc</div>
          <div id="md5-dice" class="text-base font-mono text-white/70">— — —</div>
        </div>
        <div>
          <div class="mb-0.5">Tổng</div>
          <div id="md5-tong" class="text-base font-semibold text-white/70">—</div>
        </div>
      </div>
      <div id="md5-factors" class="flex flex-wrap gap-1.5 justify-center min-h-[26px] mb-4"></div>
      <div class="grid grid-cols-3 gap-2 pt-4 border-t border-white/5 text-center">
        <div><div class="text-[10px] text-white/30 mb-0.5">Chính xác</div><div id="md5-acc" class="text-sm font-bold text-emerald-400">—%</div></div>
        <div><div class="text-[10px] text-white/30 mb-0.5">Chuỗi</div><div id="md5-streak" class="text-sm font-bold">—</div></div>
        <div><div class="text-[10px] text-white/30 mb-0.5">Phiên DD</div><div id="md5-next" class="text-sm font-bold text-amber-400/80">#—</div></div>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
    <div class="glass rounded-3xl p-5 fade" style="animation-delay:0.12s">
      <h3 class="text-sm font-semibold text-white/70 mb-3">Lịch sử Hũ</h3>
      <div id="hu-history" class="space-y-1 max-h-64 overflow-y-auto text-sm"></div>
    </div>
    <div class="glass rounded-3xl p-5 fade" style="animation-delay:0.16s">
      <h3 class="text-sm font-semibold text-white/70 mb-3">Lịch sử MD5</h3>
      <div id="md5-history" class="space-y-1 max-h-64 overflow-y-auto text-sm"></div>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
    <div class="glass rounded-3xl p-5 fade" style="animation-delay:0.2s">
      <h3 class="text-sm font-semibold text-white/70 mb-3">Thống kê Hũ</h3>
      <div id="hu-learning" class="text-xs text-white/50 space-y-1.5"></div>
    </div>
    <div class="glass rounded-3xl p-5 fade" style="animation-delay:0.24s">
      <h3 class="text-sm font-semibold text-white/70 mb-3">Thống kê MD5</h3>
      <div id="md5-learning" class="text-xs text-white/50 space-y-1.5"></div>
    </div>
  </div>

  <footer class="text-center text-[11px] text-white/20 pb-8">
    Phạm Khôi • Một phiên – Một dự đoán
  </footer>
</div>

<script>
const $ = id => document.getElementById(id);
function updateClock() {
  $('clock').textContent = new Date().toLocaleString('vi-VN', { hour12:false });
}
setInterval(updateClock, 1000); updateClock();

function predClass(p) { return p==='Tài' ? 'pred-tai' : p==='Xỉu' ? 'pred-xiu' : ''; }
function cardGlow(p) { return p==='Tài' ? 'glow-tai' : p==='Xỉu' ? 'glow-xiu' : ''; }

async function loadSide(side) {
  try {
    const r = await fetch('/api/' + side);
    const d = await r.json();
    if (d.error) return;
    $(side+'-phien').textContent = '#' + d.Phien;
    $(side+'-next').textContent = '#' + d.Phien_hien_tai;
    $(side+'-pred').textContent = d.Du_doan;
    $(side+'-pred').className = 'text-6xl font-black tracking-tighter ' + predClass(d.Du_doan);
    $(side+'-conf').textContent = d.Do_tin_cay;
    $(side+'-dice').textContent = d.Xuc_xac_1 + '  ' + d.Xuc_xac_2 + '  ' + d.Xuc_xac_3;
    $(side+'-tong').textContent = d.Tong + ' · ' + d.Ket_qua;
    const card = $('card-' + side);
    card.className = 'glass rounded-3xl p-6 fade ' + cardGlow(d.Du_doan);
    $(side+'-factors').innerHTML = (d.factors||[]).slice(0,4).map(f =>
      '<span class="chip">' + f.split('→')[0].trim().substring(0,22) + '</span>'
    ).join('');
  } catch(e){}
}

async function loadHistory(side) {
  try {
    const r = await fetch('/api/' + side + '/lichsu');
    const d = await r.json();
    const box = $(side + '-history');
    if (!d.history?.length) {
      box.innerHTML = '<div class="text-white/20 text-center py-6 text-xs">Chưa có dữ liệu</div>';
      return;
    }
    box.innerHTML = d.history.slice(0,20).map(h => {
      const ok = h.ket_qua_du_doan || '';
      const c = ok.includes('Đúng') ? 'text-emerald-400' : ok.includes('Sai') ? 'text-rose-400' : 'text-white/25';
      return '<div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.03]">'+
        '<span class="font-mono text-[11px] text-white/30">#'+h.Phien_hien_tai+'</span>'+
        '<span class="font-semibold text-sm '+predClass(h.Du_doan)+'">'+h.Du_doan+'</span>'+
        '<span class="text-[11px] text-white/35">'+h.Do_tin_cay+'</span>'+
        '<span class="text-[11px] '+c+'">'+(ok||'…')+'</span></div>';
    }).join('');
  } catch(e){}
}

async function loadLearning(side) {
  try {
    const r = await fetch('/api/' + side + '/learning');
    const d = await r.json();
    const s = d.streakAnalysis || {};
    $(side+'-learning').innerHTML =
      '<div>Tổng dự đoán: <b class="text-white/80">'+d.totalPredictions+'</b></div>'+
      '<div>Đúng: <b class="text-emerald-400">'+d.correctPredictions+'</b> — <b class="text-amber-400">'+d.overallAccuracy+'</b></div>'+
      '<div>Chuỗi: <b class="text-white/80">'+(s.currentStreak||0)+'</b> · Best <b class="text-emerald-400">'+(s.bestStreak||0)+'</b> · Worst <b class="text-rose-400">'+(s.worstStreak||0)+'</b></div>';
    $(side+'-acc').textContent = d.overallAccuracy;
    $(side+'-streak').textContent = ((s.currentStreak||0)>=0?'+':'')+(s.currentStreak||0);
  } catch(e){}
}

async function refreshAll() {
  await Promise.all([
    loadSide('hu'), loadSide('md5'),
    loadHistory('hu'), loadHistory('md5'),
    loadLearning('hu'), loadLearning('md5')
  ]);
}
refreshAll();
setInterval(refreshAll, 16000);
</script>
</body>
</html>`;
}

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  PHẠM KHÔI TÀI XỈU');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Một phiên – Một dự đoán');
  console.log('  Markov · Dice · Entropy · SeqMine');
  console.log('════════════════════════════════════════');
  startAutoSaveTask();
});
