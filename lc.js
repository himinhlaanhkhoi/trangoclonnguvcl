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
const AUTO_SAVE_INTERVAL = 20000;
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
    recentWrongStreak: 0,
    markov: { order1: {}, order2: {}, order3: {} },
    diceStats: { faces: [0,0,0,0,0,0,0] }
  };
}

const DEFAULT_PATTERN_WEIGHTS = {
  markov: 1.7, dice_bias: 1.4, entropy: 1.3, sum_trend: 1.4,
  seq_mine: 1.45, cau_bet: 1.5, cau_dao: 1.4, cau_rong: 1.6,
  break_safe: 1.55, xu_huong: 1.4, cau_22: 1.25, cau_33: 1.3,
  follow: 1.2, mean_rev: 1.1, consensus: 1.8
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
        predictionHistory[t] = (predictionHistory[t] || []).filter(r => {
          if (seen.has(r.Phien_hien_tai)) return false;
          seen.add(r.Phien_hien_tai);
          return true;
        });
      });
      console.log('✅ History HU:' + predictionHistory.hu.length + ' MD5:' + predictionHistory.md5.length);
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
  if (!apiData || !apiData.list || !apiData.list.length) return null;
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
  return predictionHistory[type].find(r => r.Phien_hien_tai === phien.toString()) || null;
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

function getW(type, id) {
  initializePatternStats(type);
  return learningData[type].patternWeights[id] || 1.0;
}

function updatePatternPerf(type, id, isCorrect) {
  initializePatternStats(type);
  const s = learningData[type].patternStats[id];
  if (!s) return;
  s.total++;
  if (isCorrect) s.correct++;
  s.recentResults.push(isCorrect ? 1 : 0);
  if (s.recentResults.length > 25) s.recentResults.shift();
  s.accuracy = s.total > 0 ? s.correct / s.total : 0.5;
  const ra = s.recentResults.reduce((a,b)=>a+b,0) / s.recentResults.length;
  let w = learningData[type].patternWeights[id];
  if (s.recentResults.length >= 6) {
    if (ra > 0.68) w = Math.min(3.2, w * 1.12);
    else if (ra < 0.32) w = Math.max(0.15, w * 0.87);
  }
  learningData[type].patternWeights[id] = +w.toFixed(3);
}

function getStreak(results) {
  if (!results.length) return { type: null, len: 0 };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++;
    else break;
  }
  return { type: results[0], len };
}

function getAltLen(results) {
  let len = 1;
  for (let i = 1; i < Math.min(results.length, 15); i++) {
    if (results[i] !== results[i-1]) len++;
    else break;
  }
  return len;
}

function analyzeMarkov(results, type) {
  if (results.length < 6) return null;
  const m1 = {}, m2 = {}, m3 = {};
  const data = results.slice(0, 70);
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i], b = data[i+1];
    if (!m1[a]) m1[a] = { Tài: 1, Xỉu: 1 };
    m1[a][b]++;
  }
  for (let i = 0; i < data.length - 2; i++) {
    const k = data[i] + '|' + data[i+1];
    if (!m2[k]) m2[k] = { Tài: 1, Xỉu: 1 };
    m2[k][data[i+2]]++;
  }
  for (let i = 0; i < data.length - 3; i++) {
    const k = data[i] + '|' + data[i+1] + '|' + data[i+2];
    if (!m3[k]) m3[k] = { Tài: 1, Xỉu: 1 };
    m3[k][data[i+3]]++;
  }
  learningData[type].markov = { order1: m1, order2: m2, order3: m3 };

  const l1 = results[0];
  const l2 = results[1] + '|' + results[0];
  const l3 = results[2] + '|' + results[1] + '|' + results[0];
  let sT = 0, sX = 0, conf = 60, tags = [];

  if (m3[l3]) {
    const t = m3[l3]; const tot = t.Tài + t.Xỉu;
    sT += (t.Tài / tot) * 3.2; sX += (t.Xỉu / tot) * 3.2; conf += 12; tags.push('M3');
  }
  if (m2[l2]) {
    const t = m2[l2]; const tot = t.Tài + t.Xỉu;
    sT += (t.Tài / tot) * 2.3; sX += (t.Xỉu / tot) * 2.3; conf += 8; tags.push('M2');
  }
  if (m1[l1]) {
    const t = m1[l1]; const tot = t.Tài + t.Xỉu;
    sT += (t.Tài / tot) * 1.5; sX += (t.Xỉu / tot) * 1.5; conf += 5; tags.push('M1');
  }
  if (sT === 0 && sX === 0) return null;
  const pred = sT >= sX ? 'Tài' : 'Xỉu';
  return {
    prediction: pred,
    confidence: Math.min(90, Math.round(conf * getW(type, 'markov'))),
    name: 'Markov ' + tags.join('+'),
    id: 'markov',
    score: Math.abs(sT - sX)
  };
}

function analyzeCauBetSmart(results, type) {
  const st = getStreak(results);
  if (st.len < 2) return null;
  const w = getW(type, 'cau_bet');
  let pred, conf, name;
  if (st.len <= 3) {
    pred = st.type;
    conf = 68 + st.len * 3;
    name = 'Theo bệt ' + st.len;
  } else if (st.len === 4) {
    pred = st.type;
    conf = 72;
    name = 'Theo bệt 4';
  } else if (st.len === 5 || st.len === 6) {
    const recentOpp = results.slice(st.len, st.len + 3).filter(r => r !== st.type).length;
    if (recentOpp >= 2) {
      pred = st.type === 'Tài' ? 'Xỉu' : 'Tài';
      conf = 76;
      name = 'Bẻ bệt ' + st.len + ' (xác nhận)';
    } else {
      pred = st.type;
      conf = 70;
      name = 'Theo bệt ' + st.len;
    }
  } else {
    pred = st.type === 'Tài' ? 'Xỉu' : 'Tài';
    conf = 82 + Math.min(st.len - 7, 5);
    name = 'Bẻ rồng ' + st.len;
  }
  return {
    prediction: pred,
    confidence: Math.round(conf * w),
    name,
    id: st.len >= 7 ? 'cau_rong' : 'cau_bet',
    score: st.len
  };
}

function analyzeCauDao(results, type) {
  const alt = getAltLen(results);
  if (alt < 4) return null;
  const w = getW(type, 'cau_dao');
  return {
    prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.min(86, Math.round((66 + alt * 2.2) * w)),
    name: 'Đảo 1-1 (' + alt + ')',
    id: 'cau_dao',
    score: alt
  };
}

function analyzeDice(data, type) {
  if (data.length < 12) return null;
  const recent = data.slice(0, 30);
  let high = 0, low = 0, sumAll = 0;
  recent.forEach(d => {
    [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3].forEach(f => {
      if (f >= 4) high++; else low++;
    });
    sumAll += d.Tong;
  });
  const avg = sumAll / recent.length;
  const bias = (high - low) / (high + low || 1);
  const w = getW(type, 'dice_bias');
  if (Math.abs(bias) > 0.12 || Math.abs(avg - 10.5) > 1.3) {
    let pred;
    if (avg > 12 || bias > 0.15) pred = 'Xỉu';
    else if (avg < 9 || bias < -0.15) pred = 'Tài';
    else return null;
    return {
      prediction: pred,
      confidence: Math.min(84, Math.round((68 + Math.abs(bias) * 60 + Math.abs(avg - 10.5) * 4) * w)),
      name: 'Dice/Sum ' + avg.toFixed(1),
      id: 'dice_bias',
      score: Math.abs(bias)
    };
  }
  return null;
}

function analyzeTrendEntropy(results, type) {
  if (results.length < 10) return null;
  const win = results.slice(0, 12);
  const tai = win.filter(r => r === 'Tài').length;
  const p = tai / win.length;
  const ent = (p === 0 || p === 1) ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  const w = getW(type, 'entropy');
  if (ent > 0.9) return null;
  let pred, conf, name;
  if (tai >= 9) {
    pred = 'Xỉu'; conf = 80; name = 'Lệch nặng ' + tai + 'T → đảo';
  } else if (tai <= 3) {
    pred = 'Tài'; conf = 80; name = 'Lệch nặng ' + (12-tai) + 'X → đảo';
  } else if (tai >= 8) {
    pred = 'Xỉu'; conf = 74; name = 'Xu hướng ' + tai + 'T';
  } else if (tai <= 4) {
    pred = 'Tài'; conf = 74; name = 'Xu hướng ' + (12-tai) + 'X';
  } else return null;
  return {
    prediction: pred,
    confidence: Math.round(conf * w),
    name,
    id: 'xu_huong',
    score: Math.abs(tai - 6)
  };
}

function analyzeSeq(results, type) {
  if (results.length < 12) return null;
  const target = results.slice(0, 3).join('|');
  let mT = 0, mX = 0;
  for (let i = 3; i < Math.min(results.length - 1, 55); i++) {
    if (results.slice(i, i + 3).join('|') === target) {
      const next = results[i - 1];
      if (next === 'Tài') mT++; else mX++;
    }
  }
  const tot = mT + mX;
  if (tot < 2) return null;
  const pred = mT >= mX ? 'Tài' : 'Xỉu';
  const w = getW(type, 'seq_mine');
  return {
    prediction: pred,
    confidence: Math.min(85, Math.round((68 + tot * 3) * w)),
    name: 'Seq x' + tot,
    id: 'seq_mine',
    score: tot
  };
}

function analyzePairs(results, type) {
  if (results.length < 6) return null;
  let pairs = 0, pType = [];
  let i = 0;
  while (i < results.length - 1 && pairs < 4) {
    if (results[i] === results[i + 1]) {
      pType.push(results[i]);
      pairs++;
      i += 2;
    } else break;
  }
  if (pairs >= 2) {
    let alt = true;
    for (let j = 1; j < pType.length; j++) if (pType[j] === pType[j - 1]) alt = false;
    if (alt) {
      const w = getW(type, 'cau_22');
      return {
        prediction: pType[pType.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(82, 66 + pairs * 4) * w),
        name: 'Cầu 2-2 (' + pairs + ')',
        id: 'cau_22',
        score: pairs
      };
    }
  }
  let triples = 0, tType = [];
  i = 0;
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      tType.push(results[i]);
      triples++;
      i += 3;
    } else break;
  }
  if (triples >= 1) {
    const w = getW(type, 'cau_33');
    const pos = results.length % 3;
    const last = tType[tType.length - 1];
    const pred = pos === 0 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last;
    return {
      prediction: pred,
      confidence: Math.round(Math.min(84, 70 + triples * 5) * w),
      name: 'Cầu 3-3 (' + triples + ')',
      id: 'cau_33',
      score: triples
    };
  }
  return null;
}

function analyzeFollow(results, type) {
  if (!results.length) return null;
  const w = getW(type, 'follow');
  return {
    prediction: results[0],
    confidence: Math.round(58 * w),
    name: 'Theo gần nhất',
    id: 'follow',
    score: 1
  };
}

function calculateAdvancedPrediction(data, type) {
  const results = data.slice(0, 80).map(d => d.Ket_qua);
  initializePatternStats(type);

  const signals = [];
  const add = (r) => { if (r) signals.push(r); };

  add(analyzeMarkov(results, type));
  add(analyzeCauBetSmart(results, type));
  add(analyzeCauDao(results, type));
  add(analyzeDice(data, type));
  add(analyzeTrendEntropy(results, type));
  add(analyzeSeq(results, type));
  add(analyzePairs(results, type));

  if (signals.length === 0) add(analyzeFollow(results, type));

  let scoreT = 0, scoreX = 0;
  const factors = [];
  signals.forEach(s => {
    const pts = s.confidence * (0.7 + (s.score || 1) * 0.08);
    if (s.prediction === 'Tài') scoreT += pts;
    else scoreX += pts;
    factors.push(s.name);
  });

  const wrongStreak = learningData[type].recentWrongStreak || 0;
  if (wrongStreak >= 3) {
    const tmp = scoreT;
    scoreT = scoreX * 1.4;
    scoreX = tmp * 1.4;
    factors.unshift('Tự đảo (sai ' + wrongStreak + ' liên tục)');
  }

  const currStreak = learningData[type].streakAnalysis.currentStreak;
  if (currStreak <= -2) {
    if (scoreT > scoreX) scoreX *= 1.25;
    else scoreT *= 1.25;
  }

  let finalPred = scoreT >= scoreX ? 'Tài' : 'Xỉu';

  const agreeT = signals.filter(s => s.prediction === 'Tài').length;
  const agreeX = signals.filter(s => s.prediction === 'Xỉu').length;
  const totalSig = signals.length;
  const agreeRatio = Math.max(agreeT, agreeX) / (totalSig || 1);

  let conf = 62;
  conf += agreeRatio * 18;
  conf += Math.min(12, Math.abs(scoreT - scoreX) / 40);

  if (wrongStreak >= 2) conf -= 8;
  if (wrongStreak >= 4) conf -= 6;

  const ra = learningData[type].recentAccuracy;
  if (ra.length >= 8) {
    const acc = ra.reduce((a, b) => a + b, 0) / ra.length;
    if (acc > 0.65) conf += 6;
    else if (acc < 0.40) conf -= 8;
  }

  conf = Math.max(55, Math.min(91, Math.round(conf)));

  if (conf < 68 && agreeRatio < 0.6) {
    const st = getStreak(results);
    if (st.len >= 2 && st.len <= 4) {
      finalPred = st.type;
      conf = Math.max(conf, 66);
      factors.unshift('An toàn theo bệt ngắn');
    }
  }

  return {
    prediction: finalPred,
    confidence: conf,
    factors: factors.slice(0, 6),
    detailedAnalysis: {
      totalSignals: totalSig,
      taiVotes: agreeT,
      xiuVotes: agreeX,
      scoreT: Math.round(scoreT),
      scoreX: Math.round(scoreX),
      wrongStreak,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0
          ? ((learningData[type].correctPredictions / learningData[type].totalPredictions) * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak,
        recentWrongStreak: wrongStreak
      }
    }
  };
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const p = phien.toString();
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  learningData[type].predictions.unshift({
    phien: p, prediction, confidence, patterns,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  });
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
      const norm = pred.prediction === 'Tài' ? 'Tài' : 'Xỉu';
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

      if (pred.patterns && pred.patterns.length) {
        pred.patterns.forEach(pn => {
          let id = null;
          if (pn.includes('Markov')) id = 'markov';
          else if (pn.includes('bệt') || pn.includes('rồng') || pn.includes('Theo bệt')) id = 'cau_bet';
          else if (pn.includes('Đảo')) id = 'cau_dao';
          else if (pn.includes('Dice') || pn.includes('Sum')) id = 'dice_bias';
          else if (pn.includes('Seq')) id = 'seq_mine';
          else if (pn.includes('2-2')) id = 'cau_22';
          else if (pn.includes('3-3')) id = 'cau_33';
          else if (pn.includes('Xu hướng') || pn.includes('Lệch')) id = 'xu_huong';
          if (id) updatePatternPerf(type, id, pred.isCorrect);
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
    Do_tin_cay: confidence + '%',
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
    if (!data || !data.length) return;
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
  } catch (e) {}
}

async function autoProcessPredictions() {
  try {
    for (const pair of [['hu', fetchDataHu], ['md5', fetchDataMd5]]) {
      const type = pair[0];
      const fetchFn = pair[1];
      const data = await fetchFn();
      if (!data || !data.length) continue;
      const next = data[0].Phien + 1;
      if (lastProcessedPhien[type] !== next && !hasPredictionForPhien(type, next)) {
        await verifyPredictions(type, data);
        const result = calculateAdvancedPrediction(data, type);
        savePredictionToHistory(type, next, result.prediction, result.confidence, data[0]);
        recordPrediction(type, next, result.prediction, result.confidence, result.factors);
        lastProcessedPhien[type] = next;
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ': ' + result.prediction + ' (' + result.confidence + '%)');
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
  console.log('🔄 Auto every ' + (AUTO_SAVE_INTERVAL / 1000) + 's');
  setTimeout(autoProcessPredictions, 3000);
  setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

async function handlePredict(type, fetchFn, req, res) {
  try {
    const data = await fetchFn();
    if (!data || !data.length) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    await verifyPredictions(type, data);
    const next = data[0].Phien + 1;

    if (hasPredictionForPhien(type, next)) {
      const exist = getExistingPrediction(type, next);
      return res.json({
        Phien: exist.Phien, Xuc_xac_1: exist.Xuc_xac_1, Xuc_xac_2: exist.Xuc_xac_2,
        Xuc_xac_3: exist.Xuc_xac_3, Tong: exist.Tong, Ket_qua: exist.Ket_qua,
        Do_tin_cay: exist.Do_tin_cay, Phien_hien_tai: exist.Phien_hien_tai,
        Du_doan: exist.Du_doan, ket_qua_du_doan: exist.ket_qua_du_doan || '',
        factors: [], id: '@phamkhoi', cached: true
      });
    }

    const result = calculateAdvancedPrediction(data, type);
    const record = savePredictionToHistory(type, next, result.prediction, result.confidence, data[0]);
    recordPrediction(type, next, result.prediction, result.confidence, result.factors);
    lastProcessedPhien[type] = next;
    savePredictionHistory();
    setTimeout(function() { updateHistoryStatus(type); }, 3000);
    res.json({
      Phien: record.Phien, Xuc_xac_1: record.Xuc_xac_1, Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3, Tong: record.Tong, Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay, Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan, ket_qua_du_doan: '',
      factors: result.factors.slice(0, 5), id: '@phamkhoi', cached: false
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
}

app.get('/api/hu', function(req, res) { handlePredict('hu', fetchDataHu, req, res); });
app.get('/api/md5', function(req, res) { handlePredict('md5', fetchDataMd5, req, res); });

app.get('/api/hu/lichsu', async function(req, res) {
  await updateHistoryStatus('hu');
  res.json({ type: 'Hũ - Phạm Khôi', history: predictionHistory.hu, total: predictionHistory.hu.length });
});
app.get('/api/md5/lichsu', async function(req, res) {
  await updateHistoryStatus('md5');
  res.json({ type: 'MD5 - Phạm Khôi', history: predictionHistory.md5, total: predictionHistory.md5.length });
});

app.get('/api/hu/analysis', async function(req, res) {
  try {
    const data = await fetchDataHu();
    if (!data || !data.length) return res.status(500).json({ error: 'No data' });
    await verifyPredictions('hu', data);
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});
app.get('/api/md5/analysis', async function(req, res) {
  try {
    const data = await fetchDataMd5();
    if (!data || !data.length) return res.status(500).json({ error: 'No data' });
    await verifyPredictions('md5', data);
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({ prediction: result.prediction, confidence: result.confidence, factors: result.factors, analysis: result.detailedAnalysis });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/hu/learning', function(req, res) {
  const s = learningData.hu;
  const acc = s.totalPredictions > 0 ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'Hũ - Phạm Khôi',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%',
    streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0
  });
});
app.get('/api/md5/learning', function(req, res) {
  const s = learningData.md5;
  const acc = s.totalPredictions > 0 ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'MD5 - Phạm Khôi',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%',
    streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0
  });
});

app.get('/api/reset-learning', function(req, res) {
  learningData = { hu: createEmptyLearning(), md5: createEmptyLearning() };
  learningData.hu.patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  learningData.md5.patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  saveLearningData();
  res.json({ message: 'Reset OK' });
});

app.get('/', function(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Phạm Khôi</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{font-family:Inter,system-ui,sans-serif;box-sizing:border-box}
  body{background:#0a0a0f;color:#e2e8f0;min-height:100vh}
  .card{background:#12121a;border:1px solid rgba(255,255,255,0.06);border-radius:20px}
  .tai{color:#34d399}.xiu{color:#fb7185}
  .glow-t{box-shadow:0 0 32px -8px rgba(52,211,153,0.3)}
  .glow-x{box-shadow:0 0 32px -8px rgba(251,113,133,0.3)}
  .dot{width:7px;height:7px;border-radius:50%;animation:p 1.8s infinite}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.4}}
  .chip{font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.45)}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px}
</style>
</head>
<body class="px-3 py-5 max-w-lg mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2.5">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-sm font-black text-black">PK</div>
      <div>
        <div class="font-bold text-[15px] leading-tight">Phạm Khôi</div>
        <div class="text-[10px] text-white/30">Tài Xỉu • Bắt Cầu</div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span id="clock" class="text-[10px] text-white/25 tabular-nums"></span>
      <button onclick="refreshAll()" class="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 font-medium">Làm mới</button>
    </div>
  </div>

  <div class="space-y-3 mb-5">
    <div id="card-hu" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1.5"><span class="dot bg-emerald-400"></span><span class="text-xs font-semibold text-white/70">Hũ</span></div>
        <span id="hu-phien" class="text-[10px] text-white/25 font-mono">#—</span>
      </div>
      <div class="text-center py-2">
        <div id="hu-pred" class="text-4xl font-extrabold tracking-tight">—</div>
        <div id="hu-conf" class="text-lg font-bold text-amber-400/90 mt-0.5">—%</div>
      </div>
      <div class="flex justify-center gap-5 text-[11px] text-white/35 mt-1 mb-2">
        <span>Xúc xắc <b id="hu-dice" class="text-white/60 font-mono">—</b></span>
        <span>Tổng <b id="hu-tong" class="text-white/60">—</b></span>
      </div>
      <div id="hu-factors" class="flex flex-wrap gap-1 justify-center min-h-[20px] mb-2"></div>
      <div class="grid grid-cols-3 gap-1 pt-2 border-t border-white/5 text-center text-[10px]">
        <div><div class="text-white/25">Chính xác</div><div id="hu-acc" class="font-bold text-emerald-400">—</div></div>
        <div><div class="text-white/25">Chuỗi</div><div id="hu-streak" class="font-bold">—</div></div>
        <div><div class="text-white/25">Phiên</div><div id="hu-next" class="font-bold text-amber-400/70">#—</div></div>
      </div>
    </div>

    <div id="card-md5" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1.5"><span class="dot bg-violet-400"></span><span class="text-xs font-semibold text-white/70">MD5</span></div>
        <span id="md5-phien" class="text-[10px] text-white/25 font-mono">#—</span>
      </div>
      <div class="text-center py-2">
        <div id="md5-pred" class="text-4xl font-extrabold tracking-tight">—</div>
        <div id="md5-conf" class="text-lg font-bold text-amber-400/90 mt-0.5">—%</div>
      </div>
      <div class="flex justify-center gap-5 text-[11px] text-white/35 mt-1 mb-2">
        <span>Xúc xắc <b id="md5-dice" class="text-white/60 font-mono">—</b></span>
        <span>Tổng <b id="md5-tong" class="text-white/60">—</b></span>
      </div>
      <div id="md5-factors" class="flex flex-wrap gap-1 justify-center min-h-[20px] mb-2"></div>
      <div class="grid grid-cols-3 gap-1 pt-2 border-t border-white/5 text-center text-[10px]">
        <div><div class="text-white/25">Chính xác</div><div id="md5-acc" class="font-bold text-emerald-400">—</div></div>
        <div><div class="text-white/25">Chuỗi</div><div id="md5-streak" class="font-bold">—</div></div>
        <div><div class="text-white/25">Phiên</div><div id="md5-next" class="font-bold text-amber-400/70">#—</div></div>
      </div>
    </div>
  </div>

  <div class="space-y-3 mb-5">
    <div class="card p-3.5">
      <div class="text-xs font-semibold text-white/50 mb-2">Lịch sử Hũ</div>
      <div id="hu-history" class="space-y-0.5 max-h-52 overflow-y-auto text-[12px]"></div>
    </div>
    <div class="card p-3.5">
      <div class="text-xs font-semibold text-white/50 mb-2">Lịch sử MD5</div>
      <div id="md5-history" class="space-y-0.5 max-h-52 overflow-y-auto text-[12px]"></div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-3 mb-6">
    <div class="card p-3">
      <div class="text-[11px] font-semibold text-white/45 mb-1.5">Thống kê Hũ</div>
      <div id="hu-learning" class="text-[11px] text-white/40 space-y-0.5"></div>
    </div>
    <div class="card p-3">
      <div class="text-[11px] font-semibold text-white/45 mb-1.5">Thống kê MD5</div>
      <div id="md5-learning" class="text-[11px] text-white/40 space-y-0.5"></div>
    </div>
  </div>

  <div class="text-center text-[10px] text-white/15 pb-4">Phạm Khôi • Một phiên – Một dự đoán</div>

<script>
const $=id=>document.getElementById(id);
function tick(){$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false})}
setInterval(tick,1000);tick();
function pc(p){return p==='Tài'?'tai':p==='Xỉu'?'xiu':''}
function gc(p){return p==='Tài'?'glow-t':p==='Xỉu'?'glow-x':''}

async function loadSide(s){
  try{
    const r=await fetch('/api/'+s);const d=await r.json();if(d.error)return;
    $(s+'-phien').textContent='#'+d.Phien;
    $(s+'-next').textContent='#'+d.Phien_hien_tai;
    $(s+'-pred').textContent=d.Du_doan;
    $(s+'-pred').className='text-4xl font-extrabold tracking-tight '+pc(d.Du_doan);
    $(s+'-conf').textContent=d.Do_tin_cay;
    $(s+'-dice').textContent=d.Xuc_xac_1+' '+d.Xuc_xac_2+' '+d.Xuc_xac_3;
    $(s+'-tong').textContent=d.Tong+' · '+d.Ket_qua;
    $('card-'+s).className='card p-4 '+gc(d.Du_doan);
    $(s+'-factors').innerHTML=(d.factors||[]).slice(0,3).map(f=>'<span class="chip">'+f.split('→')[0].trim().substring(0,18)+'</span>').join('');
  }catch(e){}
}
async function loadHist(s){
  try{
    const r=await fetch('/api/'+s+'/lichsu');const d=await r.json();
    const box=$(s+'-history');
    if(!d.history||!d.history.length){box.innerHTML='<div class="text-white/15 text-center py-4 text-[11px]">Chưa có dữ liệu</div>';return}
    box.innerHTML=d.history.slice(0,18).map(h=>{
      const ok=h.ket_qua_du_doan||'';
      const c=ok.includes('Đúng')?'text-emerald-400':ok.includes('Sai')?'text-rose-400':'text-white/20';
      return '<div class="flex items-center justify-between py-1 px-1 rounded hover:bg-white/[0.03]"><span class="font-mono text-[10px] text-white/25">#'+h.Phien_hien_tai+'</span><span class="font-semibold '+pc(h.Du_doan)+'">'+h.Du_doan+'</span><span class="text-[10px] text-white/30">'+h.Do_tin_cay+'</span><span class="text-[10px] '+c+'">'+(ok||'…')+'</span></div>';
    }).join('');
  }catch(e){}
}
async function loadLearn(s){
  try{
    const r=await fetch('/api/'+s+'/learning');const d=await r.json();
    const st=d.streakAnalysis||{};
    $(s+'-learning').innerHTML='Tổng: <b class="text-white/70">'+d.totalPredictions+'</b><br>Đúng: <b class="text-emerald-400">'+d.correctPredictions+'</b> — <b class="text-amber-400">'+d.overallAccuracy+'</b><br>Chuỗi: <b class="text-white/70">'+(st.currentStreak||0)+'</b> · Best '+(st.bestStreak||0)+' · Worst <span class="text-rose-400">'+(st.worstStreak||0)+'</span>'+(d.recentWrongStreak?('<br><span class="text-rose-400">Sai liên tục: '+d.recentWrongStreak+'</span>'):'');
    $(s+'-acc').textContent=d.overallAccuracy;
    $(s+'-streak').textContent=((st.currentStreak||0)>=0?'+':'')+(st.currentStreak||0);
  }catch(e){}
}
async function refreshAll(){await Promise.all([loadSide('hu'),loadSide('md5'),loadHist('hu'),loadHist('md5'),loadLearn('hu'),loadLearn('md5')])}
refreshAll();setInterval(refreshAll,15000);
</script>
</body>
</html>`);
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', function() {
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  PHẠM KHÔI TÀI XỈU');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Anti-loss · Smart Bệt · Consensus');
  console.log('══════════════════════════════════════');
  startAutoSaveTask();
});
