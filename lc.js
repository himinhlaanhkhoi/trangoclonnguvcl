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
const MAX_HISTORY = 180;
const AUTO_INTERVAL = 14000;
let lastProcessed = { hu: null, md5: null };
let learningData = { hu: emptyL(), md5: emptyL() };

// ==================== ENHANCED LEARNING STATE ====================
function emptyL() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    recentWrongStreak: 0,
    lastPredDirection: null,
    // NÂNG CẤP MỚI
    consecutiveLosses: 0,
    antiLossMode: false,
    antiLossCount: 0,
    lastPatterns: [],
    patternHistory: [],
    modelWeights: {
      markov1: 1.0,
      markov2: 1.0,
      markov3: 1.0,
      streak: 1.0,
      dice: 1.0,
      balance: 1.0,
      antiLoss: 1.0
    },
    predictionStats: {
      correctAfterAntiLoss: 0,
      totalAfterAntiLoss: 0,
      correctNormal: 0,
      totalNormal: 0
    },
    lastVerified: null
  };
}

// ==================== LOAD/SAVE ====================
function loadL() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const saved = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      // Merge với emptyL để đảm bảo đủ field mới
      learningData = {
        hu: { ...emptyL(), ...saved.hu },
        md5: { ...emptyL(), ...saved.md5 }
      };
      console.log('✅ Learning data loaded');
    }
  } catch (e) {
    console.error('❌ Load learning error:', e.message);
  }
}

function saveL() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (e) {
    console.error('❌ Save learning error:', e.message);
  }
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
          if (seen.has(r.Phien_hien_tai)) return false;
          seen.add(r.Phien_hien_tai);
          return true;
        });
      });
      console.log('✅ History loaded - HU:' + predictionHistory.hu.length + ' MD5:' + predictionHistory.md5.length);
    }
  } catch (e) {
    console.error('❌ Load history error:', e.message);
  }
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

// ==================== TRANSFORM ====================
function transform(api) {
  if (!api?.list?.length) return null;
  return api.list.map(i => ({
    Phien: i.id,
    Ket_qua: i.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: i.dices[0],
    Xuc_xac_2: i.dices[1],
    Xuc_xac_3: i.dices[2],
    Tong: i.point
  }));
}

// ==================== FETCH ====================
async function fetchHu() {
  try {
    const r = await axios.get(API_URL_HU, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    console.error('❌ HU fetch:', e.message);
    return null;
  }
}

async function fetchMd5() {
  try {
    const r = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    console.error('❌ MD5 fetch:', e.message);
    return null;
  }
}

// ==================== NÂNG CẤP THUẬT TOÁN ====================
/*
  ⚡ THUẬT TOÁN V3 - ĐA TẦNG PHÂN TÍCH ⚡
  
  TẦNG 1: MARKOV CHAIN (Bậc 1-2-3-4)
  TẦNG 2: PATTERN MATCHING (So khớp chuỗi lịch sử)
  TẦNG 3: DICE ANALYSIS (Phân tích xúc xắc)
  TẦNG 4: STATISTICAL BALANCE (Cân bằng thống kê)
  TẦNG 5: ANTI-LOSS SYSTEM (Chống thua liên tục)
  TẦNG 6: TREND REVERSAL (Đảo chiều xu hướng)
  TẦNG 7: BAYESIAN UPDATE (Cập nhật Bayesian)
  TẦNG 8: NEURAL WEIGHT ADJUSTMENT (Điều chỉnh trọng số)
*/

function analyze(data, type) {
  // data: newest first
  const R = data.map(d => d.Ket_qua === 'Tài' ? 1 : 0); // 1=Tài 0=Xỉu
  const n = R.length;
  if (n < 10) {
    return { prediction: 'Xỉu', confidence: 55, factors: ['Ít data'], agree: '-' };
  }

  // oldest-first for transition counting
  const H = [...R].reverse();

  // ==================== TẦNG 1: MARKOV CHAIN NÂNG CẤP ====================
  function markovProb(order) {
    if (H.length < order + 6) return null;
    const pattern = H.slice(-order).join('');
    let cntT = 0,
      cntX = 0;
    for (let i = 0; i <= H.length - order - 1; i++) {
      if (H.slice(i, i + order).join('') === pattern) {
        if (H[i + order] === 1) cntT++;
        else cntX++;
      }
    }
    const tot = cntT + cntX;
    if (tot < 2) return null;
    const pT = cntT / tot;

    // Bayesian smoothing
    const smoothPT = (cntT + 1) / (tot + 2);

    return {
      pred: pT >= 0.5 ? 1 : 0,
      conf: 0.52 + Math.abs(smoothPT - 0.5) * 0.9,
      strength: tot,
      pT: smoothPT,
      weight: learningData[type].modelWeights['markov' + order] || 1.0
    };
  }

  const m1 = markovProb(1);
  const m2 = markovProb(2);
  const m3 = markovProb(3);
  const m4 = markovProb(4); // NÂNG CẤP: Markov bậc 4

  // ==================== TẦNG 2: PATTERN MATCHING ====================
  function patternMatch() {
    const seq = H.slice(-6).join('');
    const patterns = [];
    for (let i = 0; i <= H.length - 12; i++) {
      const windowSeq = H.slice(i, i + 6).join('');
      if (windowSeq === seq) {
        const nextVal = H[i + 6];
        if (nextVal !== undefined) patterns.push(nextVal);
      }
    }
    if (patterns.length < 2) return null;
    const pT = patterns.filter(p => p === 1).length / patterns.length;
    return {
      pred: pT >= 0.5 ? 1 : 0,
      conf: 0.55 + Math.abs(pT - 0.5) * 0.7,
      strength: patterns.length,
      pT,
      weight: 1.2 // Pattern matching có trọng số cao
    };
  }

  const pm = patternMatch();

  // ==================== TẦNG 3: DICE ANALYSIS NÂNG CẤP ====================
  let diceStats = {
    sum: 0,
    high: 0,
    low: 0,
    odd: 0,
    even: 0,
    diceSumHistory: []
  };

  data.slice(0, 20).forEach((d, idx) => {
    diceStats.sum += d.Tong;
    [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3].forEach(f => {
      if (f >= 4) diceStats.high++;
      else diceStats.low++;
      if (f % 2 === 1) diceStats.odd++;
      else diceStats.even++;
    });
    diceStats.diceSumHistory.push(d.Tong);
  });

  const avgDice = diceStats.sum / Math.min(20, data.length);
  const diceBias = (diceStats.high - diceStats.low) / (diceStats.high + diceStats.low || 1);

  // Mean reversion
  const meanReversion = avgDice > 11 ? 1 : avgDice < 9 ? 0 : null;

  // ==================== TẦNG 4: STATISTICAL BALANCE ====================
  const t10 = R.slice(0, 10).filter(x => x === 1).length;
  const t20 = R.slice(0, 20).filter(x => x === 1).length;
  const t30 = R.slice(0, 30).filter(x => x === 1).length;

  const balance10 = t10 / 10;
  const balance20 = t20 / 20;
  const balance30 = t30 / Math.min(30, R.length);

  // ==================== TẦNG 5: STREAK ANALYSIS ====================
  let streakLen = 1;
  for (let i = 1; i < R.length; i++) {
    if (R[i] === R[0]) streakLen++;
    else break;
  }
  const streakVal = R[0];

  // Alternating
  let altLen = 1;
  for (let i = 1; i < Math.min(R.length, 20); i++) {
    if (R[i] !== R[i - 1]) altLen++;
    else break;
  }

  // ==================== TẦNG 6: ANTI-LOSS SYSTEM ====================
  const wrongStreak = learningData[type].recentWrongStreak || 0;
  const consecutiveLosses = learningData[type].consecutiveLosses || 0;
  const lastDir = learningData[type].lastPredDirection;
  const antiLossMode = learningData[type].antiLossMode || false;

  // ==================== TẦNG 7: BAYESIAN UPDATE ====================
  // Prior từ lịch sử dự đoán
  const totalPreds = learningData[type].totalPredictions || 0;
  const correctPreds = learningData[type].correctPredictions || 0;
  const bayesianPrior = totalPreds > 0 ? correctPreds / totalPreds : 0.5;

  // ==================== TẦNG 8: TREND REVERSAL ====================
  // Phát hiện xu hướng đảo chiều
  const recentTrend = R.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
  const olderTrend = R.slice(8, 16).reduce((a, b) => a + b, 0) / 8;
  const trendDirection = recentTrend > olderTrend ? 'up' : recentTrend < olderTrend ? 'down' : 'flat';

  // ==================== BUILD SCORES ====================
  let scoreT = 0,
    scoreX = 0;
  const factors = [];
  const modelContributions = [];

  // Markov với trọng số động
  [m4, m3, m2, m1].forEach((m, idx) => {
    if (m && m.strength >= 2) {
      const order = 4 - idx;
      const w = (3.5 - order * 0.4) * m.conf * m.weight;
      if (m.pred === 1) scoreT += w;
      else scoreX += w;
      factors.push('M' + order + '(' + (m.pred === 1 ? 'T' : 'X') + ':' + Math.round(m.conf * 100) + '%)');
      modelContributions.push({ model: 'markov' + order, pred: m.pred, weight: w });
    }
  });

  // Pattern Matching
  if (pm && pm.strength >= 3) {
    const w = 2.5 * pm.conf * pm.weight;
    if (pm.pred === 1) scoreT += w;
    else scoreX += w;
    factors.push('Pattern(' + (pm.pred === 1 ? 'T' : 'X') + ':' + pm.strength + ' khớp)');
    modelContributions.push({ model: 'pattern', pred: pm.pred, weight: w });
  }

  // Streak logic
  if (streakLen >= 2 && streakLen <= 3) {
    const w = 1.2 * learningData[type].modelWeights.streak;
    if (streakVal === 1) scoreT += w;
    else scoreX += w;
    factors.push('Bệt' + streakLen);
  } else if (streakLen >= 4 && streakLen <= 5) {
    const w = 0.8 * learningData[type].modelWeights.streak;
    if (streakVal === 1) scoreT += w;
    else scoreX += w;
    factors.push('Bệt' + streakLen);
  } else if (streakLen >= 6) {
    const w = (1.8 + Math.min(1.2, (streakLen - 6) * 0.3)) * learningData[type].modelWeights.streak;
    if (streakVal === 1) scoreX += w;
    else scoreT += w;
    factors.push('Bẻ' + streakLen);
  }

  // Alternating
  if (altLen >= 5) {
    const w = 1.5;
    if (R[0] === 1) scoreX += w;
    else scoreT += w;
    factors.push('Đảo' + altLen);
  }

  // Statistical Balance
  if (balance10 > 0.7) {
    scoreX += 1.5 * learningData[type].modelWeights.balance;
    factors.push('LệchT10');
  } else if (balance10 < 0.3) {
    scoreT += 1.5 * learningData[type].modelWeights.balance;
    factors.push('LệchX10');
  }

  if (balance20 > 0.65) {
    scoreX += 1.2 * learningData[type].modelWeights.balance;
    factors.push('LệchT20');
  } else if (balance20 < 0.35) {
    scoreT += 1.2 * learningData[type].modelWeights.balance;
    factors.push('LệchX20');
  }

  // Dice Analysis
  if (meanReversion === 1) {
    scoreX += 1.4 * learningData[type].modelWeights.dice;
    factors.push('DiceCao→X');
  } else if (meanReversion === 0) {
    scoreT += 1.4 * learningData[type].modelWeights.dice;
    factors.push('DiceThấp→T');
  }

  // Dice bias
  if (diceBias > 0.2) {
    scoreX += 1.2;
    factors.push('BiasCao');
  } else if (diceBias < -0.2) {
    scoreT += 1.2;
    factors.push('BiasThấp');
  }

  // ==================== ANTI-LOSS: ĐẢO CHIỀU SAU 3 PHIÊN THUA ====================
  let antiLossActive = false;
  let antiLossDirection = null;

  if (consecutiveLosses >= 3 || wrongStreak >= 3) {
    antiLossActive = true;
    antiLossDirection = lastDir === 1 ? 0 : 1;

    // Đảo mạnh - nhân hệ số
    const antiLossWeight = 3.5 + (consecutiveLosses - 3) * 1.5;
    if (antiLossDirection === 1) {
      scoreT += antiLossWeight * learningData[type].modelWeights.antiLoss;
      scoreX *= 0.3; // Giảm mạnh phe đối diện
    } else {
      scoreX += antiLossWeight * learningData[type].modelWeights.antiLoss;
      scoreT *= 0.3;
    }

    factors.unshift('🔄 ĐẢO SAU ' + consecutiveLosses + ' THUA');
    factors.push('AntiLoss: ' + (antiLossDirection === 1 ? 'T' : 'X'));
    learningData[type].antiLossMode = true;
    learningData[type].antiLossCount = (learningData[type].antiLossCount || 0) + 1;
  } else if (consecutiveLosses >= 2) {
    // Cảnh báo - nghiêng nhẹ
    if (lastDir === 1) scoreX += 1.2;
    else scoreT += 1.2;
    factors.push('Cảnh báo thua ' + consecutiveLosses);
    learningData[type].antiLossMode = false;
  } else {
    learningData[type].antiLossMode = false;
  }

  // ==================== TREND REVERSAL ADJUSTMENT ====================
  if (trendDirection === 'up' && recentTrend > 0.7) {
    scoreX += 1.1;
    factors.push('Đảo trend↑');
  } else if (trendDirection === 'down' && recentTrend < 0.3) {
    scoreT += 1.1;
    factors.push('Đảo trend↓');
  }

  // ==================== BAYESIAN ADJUSTMENT ====================
  if (bayesianPrior < 0.4) {
    // Nếu đang thua nhiều, giảm confidence
    // Nhưng không thay đổi dự đoán
  }

  // ==================== FINAL DECISION ====================
  let finalPred = scoreT >= scoreX ? 1 : 0;

  // Nếu anti-loss active, ép theo hướng đảo
  if (antiLossActive && antiLossDirection !== null) {
    finalPred = antiLossDirection;
  }

  // ==================== CONFIDENCE CALCULATION ====================
  const totalScore = scoreT + scoreX || 1;
  const dominance = Math.abs(scoreT - scoreX) / totalScore;
  let confidence = 56 + dominance * 30;

  // Điều chỉnh theo model agreement
  const contributingModels = modelContributions.filter(m => m.weight > 0);
  const agreeingModels = contributingModels.filter(m => m.pred === finalPred);
  const agreementRatio = contributingModels.length > 0 ?
    agreeingModels.length / contributingModels.length : 0.5;

  confidence += agreementRatio * 8;

  // Anti-loss adjustment
  if (antiLossActive) {
    confidence += 5;
  }

  // Bayesian prior adjustment
  confidence += (bayesianPrior - 0.5) * 10;

  // Penalty khi đang thua
  if (consecutiveLosses >= 2) confidence -= 3;
  if (consecutiveLosses >= 4) confidence -= 4;
  if (consecutiveLosses >= 6) confidence -= 5;

  confidence = Math.max(53, Math.min(88, Math.round(confidence)));

  // Lưu direction để lần sau anti-loss
  learningData[type].lastPredDirection = finalPred;
  learningData[type].lastPatterns = factors.slice(0, 8);

  // Lưu pattern history
  learningData[type].patternHistory.push({
    phien: data[0].Phien + 1,
    patterns: factors.slice(0, 8),
    prediction: finalPred,
    confidence: confidence,
    timestamp: new Date().toISOString(),
    antiLossActive: antiLossActive
  });
  if (learningData[type].patternHistory.length > 100) {
    learningData[type].patternHistory = learningData[type].patternHistory.slice(-100);
  }

  // ==================== NEURAL WEIGHT ADJUSTMENT ====================
  // Tự động điều chỉnh trọng số dựa trên hiệu suất
  const recentAcc = learningData[type].recentAccuracy.slice(-15);
  if (recentAcc.length >= 10) {
    const recentAccRate = recentAcc.filter(a => a === 1).length / recentAcc.length;
    if (recentAccRate < 0.35) {
      // Giảm trọng số Markov, tăng anti-loss
      learningData[type].modelWeights.markov1 *= 0.95;
      learningData[type].modelWeights.markov2 *= 0.95;
      learningData[type].modelWeights.markov3 *= 0.95;
      learningData[type].modelWeights.antiLoss *= 1.1;
    } else if (recentAccRate > 0.65) {
      // Tăng trọng số Markov
      learningData[type].modelWeights.markov1 = Math.min(1.3, learningData[type].modelWeights.markov1 * 1.05);
      learningData[type].modelWeights.markov2 = Math.min(1.3, learningData[type].modelWeights.markov2 * 1.05);
      learningData[type].modelWeights.markov3 = Math.min(1.3, learningData[type].modelWeights.markov3 * 1.05);
    }
  }

  saveL();

  return {
    prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
    confidence: confidence,
    factors: factors.slice(0, 6),
    agree: (scoreT > scoreX ? 'T' : 'X') + '(' + Math.round(dominance * 100) + '%)',
    antiLossActive: antiLossActive,
    consecutiveLosses: consecutiveLosses,
    modelStats: {
      markov1: m1 ? Math.round(m1.pT * 100) + '%' : '-',
      markov2: m2 ? Math.round(m2.pT * 100) + '%' : '-',
      markov3: m3 ? Math.round(m3.pT * 100) + '%' : '-',
      markov4: m4 ? Math.round(m4.pT * 100) + '%' : '-',
      pattern: pm ? Math.round(pm.pT * 100) + '%' : '-',
      diceAvg: avgDice.toFixed(1),
      balance10: Math.round(balance10 * 100) + '%',
      balance20: Math.round(balance20 * 100) + '%'
    }
  };
}

// ==================== RECORD / VERIFY ====================
function hasPred(type, phien) {
  return predictionHistory[type].some(r => r.Phien_hien_tai === String(phien));
}

function getExist(type, phien) {
  return predictionHistory[type].find(r => r.Phien_hien_tai === String(phien)) || null;
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
    verified: false,
    antiLossActive: learningData[type].antiLossMode || false
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  saveL();
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
        learningData[type].streakAnalysis.currentStreak >= 0 ?
        learningData[type].streakAnalysis.currentStreak + 1 : 1;
      if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
        learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
      }
      learningData[type].recentWrongStreak = 0;
      learningData[type].consecutiveLosses = 0;
      learningData[type].antiLossMode = false;

      // Thống kê anti-loss
      if (pred.antiLossActive) {
        learningData[type].predictionStats.correctAfterAntiLoss++;
        learningData[type].predictionStats.totalAfterAntiLoss++;
      } else {
        learningData[type].predictionStats.correctNormal++;
        learningData[type].predictionStats.totalNormal++;
      }
    } else {
      learningData[type].streakAnalysis.losses++;
      learningData[type].streakAnalysis.currentStreak =
        learningData[type].streakAnalysis.currentStreak <= 0 ?
        learningData[type].streakAnalysis.currentStreak - 1 : -1;
      if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
        learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
      }
      learningData[type].recentWrongStreak = (learningData[type].recentWrongStreak || 0) + 1;
      learningData[type].consecutiveLosses = (learningData[type].consecutiveLosses || 0) + 1;

      // Thống kê anti-loss
      if (pred.antiLossActive) {
        learningData[type].predictionStats.totalAfterAntiLoss++;
      } else {
        learningData[type].predictionStats.totalNormal++;
      }
    }

    learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
    if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
    learningData[type].lastVerified = {
      phien: pred.phien,
      prediction: pred.prediction,
      actual: pred.actual,
      isCorrect: pred.isCorrect,
      timestamp: new Date().toISOString()
    };
    up = true;
  }

  // Cập nhật antiLossMode dựa trên consecutiveLosses
  learningData[type].antiLossMode = (learningData[type].consecutiveLosses || 0) >= 3;

  if (up) saveL();
}

function saveToHist(type, phien, pred, conf, latest) {
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
    if (up) saveH();
  } catch (e) {}
}

async function autoRun() {
  try {
    for (const [type, fn] of [
        ['hu', fetchHu],
        ['md5', fetchMd5]
      ]) {
      const data = await fn();
      if (!data?.length) continue;
      const next = data[0].Phien + 1;
      if (lastProcessed[type] !== next && !hasPred(type, next)) {
        await verify(type, data);
        const r = analyze(data, type);
        saveToHist(type, next, r.prediction, r.confidence, data[0]);
        record(type, next, r.prediction, r.confidence, r.factors);
        lastProcessed[type] = next;
        const antiMsg = r.antiLossActive ? ' 🔄 ANTI-LOSS' : '';
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ': ' + r.prediction +
          ' (' + r.confidence + '%)' + antiMsg);
        saveH();
        saveL();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) { console.error('[Auto]', e.message); }
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
        Phien: e.Phien,
        Xuc_xac_1: e.Xuc_xac_1,
        Xuc_xac_2: e.Xuc_xac_2,
        Xuc_xac_3: e.Xuc_xac_3,
        Tong: e.Tong,
        Ket_qua: e.Ket_qua,
        Do_tin_cay: e.Do_tin_cay,
        Phien_hien_tai: e.Phien_hien_tai,
        Du_doan: e.Du_doan,
        ket_qua_du_doan: e.ket_qua_du_doan || '',
        factors: [],
        id: '@phamkhoi',
        cached: true
      });
    }

    const r = analyze(data, type);
    const rec = saveToHist(type, next, r.prediction, r.confidence, data[0]);
    record(type, next, r.prediction, r.confidence, r.factors);
    lastProcessed[type] = next;
    saveH();
    setTimeout(() => updateStatus(type), 2000);

    res.json({
      Phien: rec.Phien,
      Xuc_xac_1: rec.Xuc_xac_1,
      Xuc_xac_2: rec.Xuc_xac_2,
      Xuc_xac_3: rec.Xuc_xac_3,
      Tong: rec.Tong,
      Ket_qua: rec.Ket_qua,
      Do_tin_cay: rec.Do_tin_cay,
      Phien_hien_tai: rec.Phien_hien_tai,
      Du_doan: rec.Du_doan,
      ket_qua_du_doan: '',
      factors: r.factors,
      agree: r.agree,
      antiLossActive: r.antiLossActive,
      consecutiveLosses: r.consecutiveLosses,
      modelStats: r.modelStats,
      id: '@phamkhoi',
      cached: false
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
}

// ==================== API ROUTES ====================
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
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'Hũ',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%',
    streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0,
    consecutiveLosses: s.consecutiveLosses || 0,
    antiLossMode: s.antiLossMode || false,
    antiLossCount: s.antiLossCount || 0,
    modelWeights: s.modelWeights,
    predictionStats: s.predictionStats
  });
});

app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'MD5',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%',
    streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0,
    consecutiveLosses: s.consecutiveLosses || 0,
    antiLossMode: s.antiLossMode || false,
    antiLossCount: s.antiLossCount || 0,
    modelWeights: s.modelWeights,
    predictionStats: s.predictionStats
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: emptyL(), md5: emptyL() };
  saveL();
  res.json({ message: 'Reset OK' });
});

// ==================== FRONTEND ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Phạm Khôi V3 - Anti-Loss</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{font-family:Inter,system-ui,sans-serif;box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#fafafa;min-height:100vh}
.card{background:#111114;border:1px solid rgba(255,255,255,.06);border-radius:16px}
.tai{color:#4ade80}.xiu{color:#fb7185}
.gt{box-shadow:0 0 24px -6px rgba(74,222,128,.25)}
.gx{box-shadow:0 0 24px -6px rgba(251,113,133,.25)}
.anti{box-shadow:0 0 24px -6px rgba(251,191,36,.35);border:1px solid rgba(251,191,36,.3)}
.dot{width:6px;height:6px;border-radius:50%;animation:b 1.5s infinite}
@keyframes b{0%,100%{opacity:1}50%{opacity:.3}}
.chip{font-size:9px;padding:2px 6px;border-radius:99px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.4)}
.chip-anti{font-size:9px;padding:2px 6px;border-radius:99px;background:rgba(251,191,36,.15);color:#fbbf24}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}
.anti-badge{animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
</style>
</head>
<body class="px-3 py-4 max-w-md mx-auto">
<div class="flex items-center justify-between mb-4">
  <div class="flex items-center gap-2">
    <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xs font-black text-black">PK</div>
    <div>
      <div class="font-bold text-sm leading-none">Phạm Khôi V3</div>
      <div class="text-[9px] text-white/25 mt-0.5">Anti-Loss Engine</div>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <span id="clock" class="text-[9px] text-white/15 tabular-nums"></span>
    <button onclick="go()" class="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 active:bg-white/10 font-medium">Làm mới</button>
  </div>
</div>

<div class="space-y-2.5 mb-4">
  <div id="c-hu" class="card p-3.5">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5"><span class="dot bg-emerald-400"></span><span class="text-[11px] font-semibold text-white/55">Hũ</span><span id="hu-anti-badge" class="hidden anti-badge text-[8px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-400 font-bold">🔄 ANTI-LOSS</span></div>
      <span id="hu-p" class="text-[9px] text-white/18 font-mono">#—</span>
    </div>
    <div class="text-center py-1">
      <div id="hu-d" class="text-3xl font-extrabold tracking-tight">—</div>
      <div id="hu-c" class="text-base font-bold text-amber-400/85 mt-0.5">—%</div>
    </div>
    <div class="flex justify-center gap-4 text-[10px] text-white/25 mt-0.5 mb-1.5">
      <span>XX <b id="hu-x" class="text-white/50 font-mono">—</b></span>
      <span>Tổng <b id="hu-t" class="text-white/50">—</b></span>
    </div>
    <div id="hu-f" class="flex flex-wrap gap-1 justify-center min-h-[16px] mb-1.5"></div>
    <div class="grid grid-cols-3 gap-1 pt-1.5 border-t border-white/5 text-center text-[9px]">
      <div><div class="text-white/18">Đúng</div><div id="hu-a" class="font-bold text-emerald-400">—</div></div>
      <div><div class="text-white/18">Chuỗi</div><div id="hu-s" class="font-bold">—</div></div>
      <div><div class="text-white/18">Thua LT</div><div id="hu-cl" class="font-bold text-rose-400">—</div></div>
    </div>
  </div>

  <div id="c-md5" class="card p-3.5">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5"><span class="dot bg-violet-400"></span><span class="text-[11px] font-semibold text-white/55">MD5</span><span id="md5-anti-badge" class="hidden anti-badge text-[8px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-400 font-bold">🔄 ANTI-LOSS</span></div>
      <span id="md5-p" class="text-[9px] text-white/18 font-mono">#—</span>
    </div>
    <div class="text-center py-1">
      <div id="md5-d" class="text-3xl font-extrabold tracking-tight">—</div>
      <div id="md5-c" class="text-base font-bold text-amber-400/85 mt-0.5">—%</div>
    </div>
    <div class="flex justify-center gap-4 text-[10px] text-white/25 mt-0.5 mb-1.5">
      <span>XX <b id="md5-x" class="text-white/50 font-mono">—</b></span>
      <span>Tổng <b id="md5-t" class="text-white/50">—</b></span>
    </div>
    <div id="md5-f" class="flex flex-wrap gap-1 justify-center min-h-[16px] mb-1.5"></div>
    <div class="grid grid-cols-3 gap-1 pt-1.5 border-t border-white/5 text-center text-[9px]">
      <div><div class="text-white/18">Đúng</div><div id="md5-a" class="font-bold text-emerald-400">—</div></div>
      <div><div class="text-white/18">Chuỗi</div><div id="md5-s" class="font-bold">—</div></div>
      <div><div class="text-white/18">Thua LT</div><div id="md5-cl" class="font-bold text-rose-400">—</div></div>
    </div>
  </div>
</div>

<div class="space-y-2.5 mb-4">
  <div class="card p-3">
    <div class="text-[10px] font-semibold text-white/35 mb-1.5">Lịch sử Hũ</div>
    <div id="hu-h" class="space-y-0 max-h-40 overflow-y-auto text-[11px]"></div>
  </div>
  <div class="card p-3">
    <div class="text-[10px] font-semibold text-white/35 mb-1.5">Lịch sử MD5</div>
    <div id="md5-h" class="space-y-0 max-h-40 overflow-y-auto text-[11px]"></div>
  </div>
</div>

<div class="grid grid-cols-2 gap-2 mb-4">
  <div class="card p-2.5">
    <div class="text-[9px] font-semibold text-white/30 mb-1">Thống kê Hũ</div>
    <div id="hu-l" class="text-[10px] text-white/30 space-y-0.5 leading-relaxed"></div>
  </div>
  <div class="card p-2.5">
    <div class="text-[9px] font-semibold text-white/30 mb-1">Thống kê MD5</div>
    <div id="md5-l" class="text-[10px] text-white/30 space-y-0.5 leading-relaxed"></div>
  </div>
</div>

<div class="text-center text-[9px] text-white/10 pb-3">Phạm Khôi V3 • Anti-Loss Engine</div>

<script>
const $=id=>document.getElementById(id);
const tick=()=>$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false});
setInterval(tick,1000);tick();
const pc=p=>p==='Tài'?'tai':p==='Xỉu'?'xiu':'';
const gc=(p,anti)=>anti?'anti':(p==='Tài'?'gt':p==='Xỉu'?'gx':'');

async function side(s){
  try{
    const r=await fetch('/api/'+s);const d=await r.json();if(d.error)return;
    $(s+'-p').textContent='#'+d.Phien;
    $(s+'-d').textContent=d.Du_doan;
    $(s+'-d').className='text-3xl font-extrabold tracking-tight '+pc(d.Du_doan);
    $(s+'-c').textContent=d.Do_tin_cay;
    $(s+'-x').textContent=d.Xuc_xac_1+' '+d.Xuc_xac_2+' '+d.Xuc_xac_3;
    $(s+'-t').textContent=d.Tong+' · '+d.Ket_qua;
    $('c-'+s).className='card p-3.5 '+gc(d.Du_doan,d.antiLossActive);
    $(s+'-f').innerHTML=(d.factors||[]).slice(0,5).map(f=>{
      const isAnti=f.includes('ĐẢO')||f.includes('AntiLoss');
      return '<span class="'+(isAnti?'chip-anti':'chip')+'">'+f+'</span>';
    }).join('');
    const badge=$(s+'-anti-badge');
    if(d.antiLossActive){badge.classList.remove('hidden');}else{badge.classList.add('hidden');}
  }catch(e){}
}
async function hist(s){
  try{
    const r=await fetch('/api/'+s+'/lichsu');const d=await r.json();
    const b=$(s+'-h');
    if(!d.history?.length){b.innerHTML='<div class="text-white/10 text-center py-3 text-[10px]">Chưa có dữ liệu</div>';return}
    b.innerHTML=d.history.slice(0,14).map(h=>{
      const ok=h.ket_qua_du_doan||'';
      const c=ok.includes('Đúng')?'text-emerald-400':ok.includes('Sai')?'text-rose-400':'text-white/12';
      return '<div class="flex items-center justify-between py-0.5"><span class="font-mono text-[9px] text-white/18">#'+h.Phien_hien_tai+'</span><span class="font-semibold '+pc(h.Du_doan)+'">'+h.Du_doan+'</span><span class="text-[9px] text-white/22">'+h.Do_tin_cay+'</span><span class="text-[9px] '+c+'">'+(ok||'…')+'</span></div>';
    }).join('');
  }catch(e){}
}
async function learn(s){
  try{
    const r=await fetch('/api/'+s+'/learning');const d=await r.json();
    const st=d.streakAnalysis||{};
    const antiInfo=d.antiLossMode?'<br><span class="text-amber-400">🔄 ANTI-LOSS ACTIVE</span>':'';
    const lossInfo=d.consecutiveLosses>0?'<br><span class="text-rose-400">Thua liên tục: '+d.consecutiveLosses+'</span>':'';
    $(s+'-l').innerHTML='Tổng <b class="text-white/55">'+d.totalPredictions+'</b><br>Đúng <b class="text-emerald-400">'+d.correctPredictions+'</b> · <b class="text-amber-400">'+d.overallAccuracy+'</b><br>Chuỗi <b class="text-white/55">'+(st.currentStreak||0)+'</b>'+lossInfo+antiInfo;
    $(s+'-a').textContent=d.overallAccuracy;
    $(s+'-s').textContent=((st.currentStreak||0)>=0?'+':'')+(st.currentStreak||0);
    $(s+'-cl').textContent=d.consecutiveLosses||0;
  }catch(e){}
}
async function go(){await Promise.all([side('hu'),side('md5'),hist('hu'),hist('md5'),learn('hu'),learn('md5')])}
go();setInterval(go,12000);
</script>
</body>
</html>`);
});

// ==================== INIT ====================
loadL();
loadH();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  PHẠM KHÔI V3 • Anti-Loss Markov Engine');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  🔄 Đảo chiều sau 3 phiên thua liên tục');
  console.log('  📊 Markov bậc 1-4 + Pattern Matching');
  console.log('  🎯 Neural Weight Adjustment tự động');
  console.log('══════════════════════════════════════════════');
  setTimeout(autoRun, 2000);
  setInterval(autoRun, AUTO_INTERVAL);
});
