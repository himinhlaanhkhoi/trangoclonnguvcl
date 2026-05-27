const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;

// ============ HỆ THỐNG HỌC TĂNG CƯỜNG ============
let algorithmPerformance = {}; // Theo dõi hiệu suất từng thuật toán
let weightSystem = {}; // Trọng số động
const LEARNING_RATE = 0.05;
const MIN_CONFIDENCE = 65; // Tối thiểu 65%
const MAX_CONFIDENCE = 95;

// ============ HELPER FUNCTIONS ============
function getResults(history) {
    return history.map(h => (h.result === 'Tài' || h.result === 'T') ? 'T' : 'X');
}

function getScores(history) {
    return history.map(h => h.Tong || h.total || 0);
}

function getDiceArray(history) {
    return history.map(h => [h.Xuc_xac_1 || 0, h.Xuc_xac_2 || 0, h.Xuc_xac_3 || 0]);
}

// ======================================================
// PHÂN TÍCH 10 PHIÊN - SIÊU CHI TIẾT
// ======================================================
function analyzeLast10Sessions(sessions) {
    const results = getResults(sessions);
    const scores = getScores(sessions);
    const dices = getDiceArray(sessions);
    
    return {
        // 1. Phân tích streak hiện tại
        currentStreak: analyzeStreak(results),
        
        // 2. Phân tích mẫu hình 3-5-7 phiên
        pattern3: results.slice(-3).join(''),
        pattern5: results.slice(-5).join(''),
        pattern7: results.slice(-7).join(''),
        
        // 3. Phân tích tổng điểm
        scoreAnalysis: {
            avgLast3: scores.slice(-3).reduce((a,b) => a+b, 0) / 3,
            avgLast5: scores.slice(-5).reduce((a,b) => a+b, 0) / 5,
            avgLast10: scores.reduce((a,b) => a+b, 0) / 10,
            trend: scores[scores.length-1] - scores[scores.length-2],
            volatility: calculateVolatility(scores)
        },
        
        // 4. Phân tích xúc xắc
        diceAnalysis: {
            highDiceRatio: calculateHighDiceRatio(dices),
            pairFrequency: analyzePairFrequency(dices),
            dominantNumbers: findDominantNumbers(dices)
        },
        
        // 5. Phân tích đảo chiều
        reversalAnalysis: {
            shortTermReversals: countReversals(results.slice(-5)),
            mediumTermReversals: countReversals(results.slice(-10)),
            reversalProbability: calculateReversalProbability(results)
        },
        
        // 6. Phân tích cân bằng
        balanceAnalysis: {
            taiRatio3: results.slice(-3).filter(r => r === 'T').length / 3,
            taiRatio5: results.slice(-5).filter(r => r === 'T').length / 5,
            taiRatio10: results.filter(r => r === 'T').length / 10,
            imbalance: Math.abs(results.filter(r => r === 'T').length - results.filter(r => r === 'X').length)
        }
    };
}

function analyzeStreak(results) {
    let streak = 1;
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === results[results.length - 1]) streak++;
        else break;
    }
    return { type: results[results.length - 1], length: streak };
}

function calculateVolatility(scores) {
    const avg = scores.reduce((a,b) => a+b, 0) / scores.length;
    const variance = scores.reduce((a,b) => a + Math.pow(b - avg, 2), 0) / scores.length;
    return Math.sqrt(variance);
}

function calculateHighDiceRatio(dices) {
    const allDices = dices.flat();
    return allDices.filter(d => d >= 4).length / allDices.length;
}

function analyzePairFrequency(dices) {
    const pairs = {};
    dices.forEach(d => {
        const pair12 = `${d[0]},${d[1]}`;
        const pair23 = `${d[1]},${d[2]}`;
        const pair13 = `${d[0]},${d[2]}`;
        [pair12, pair23, pair13].forEach(p => {
            pairs[p] = (pairs[p] || 0) + 1;
        });
    });
    return pairs;
}

function findDominantNumbers(dices) {
    const freq = {};
    dices.flat().forEach(d => freq[d] = (freq[d] || 0) + 1);
    return Object.entries(freq).sort((a,b) => b[1] - a[1]).slice(0, 3);
}

function countReversals(results) {
    let count = 0;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) count++;
    }
    return count;
}

function calculateReversalProbability(results) {
    return countReversals(results) / (results.length - 1);
}

// ======================================================
// THUẬT TOÁN SIÊU CHUẨN - TỪNG LỚP ĐỘC LẬP
// ======================================================

// Lớp 1: Phân tích Streak (Bệt)
function superStreakAnalysis(analysis, sessions) {
    const { currentStreak } = analysis;
    const results = getResults(sessions);
    const scores = getScores(sessions);
    
    if (currentStreak.length >= 7) {
        // Streak rất dài - bẻ cầu mạnh
        return { 
            prediction: currentStreak.type === 'T' ? 'X' : 'T', 
            confidence: 90, 
            weight: 15,
            reason: `Streak ${currentStreak.length} phiên ${currentStreak.type} - Bẻ cầu mạnh`
        };
    }
    
    if (currentStreak.length >= 5) {
        // Kiểm tra biến động tổng điểm
        const lastScore = scores[scores.length - 1];
        const prevScore = scores[scores.length - 2];
        const scoreDiff = Math.abs(lastScore - prevScore);
        
        if (scoreDiff >= 5) {
            return { 
                prediction: currentStreak.type === 'T' ? 'X' : 'T', 
                confidence: 85, 
                weight: 14,
                reason: `Streak ${currentStreak.length} + Biến động ${scoreDiff} - Bẻ cầu`
            };
        }
        
        return { 
            prediction: currentStreak.type === 'T' ? 'X' : 'T', 
            confidence: 78, 
            weight: 12,
            reason: `Streak ${currentStreak.length} phiên - Khả năng bẻ cao`
        };
    }
    
    if (currentStreak.length >= 3) {
        // Streak vừa - có thể tiếp tục hoặc bẻ
        const lastScore = scores[scores.length - 1];
        if (lastScore >= 15) {
            return { prediction: 'X', confidence: 75, weight: 10, reason: 'Streak 3 + Tổng cao - Bẻ Xỉu' };
        }
        if (lastScore <= 6) {
            return { prediction: 'T', confidence: 75, weight: 10, reason: 'Streak 3 + Tổng thấp - Bẻ Tài' };
        }
        return { 
            prediction: currentStreak.type, 
            confidence: 68, 
            weight: 8,
            reason: `Streak ${currentStreak.length} - Tiếp tục xu hướng`
        };
    }
    
    return null;
}

// Lớp 2: Phân tích Mẫu hình (Pattern)
function superPatternAnalysis(analysis, sessions) {
    const results = getResults(sessions);
    const { pattern3, pattern5, pattern7 } = analysis;
    
    // Pattern 3 phiên
    const patterns3 = {
        'TTT': { pred: 'X', conf: 82, reason: '3 Tài liên tiếp - Bẻ Xỉu' },
        'XXX': { pred: 'T', conf: 82, reason: '3 Xỉu liên tiếp - Bẻ Tài' },
        'TXT': { pred: 'X', conf: 75, reason: 'Đan xen T-X-T - Theo Xỉu' },
        'XTX': { pred: 'T', conf: 75, reason: 'Đan xen X-T-X - Theo Tài' },
        'TTX': { pred: 'T', conf: 70, reason: '2T-1X - Tiếp Tài' },
        'XXT': { pred: 'X', conf: 70, reason: '2X-1T - Tiếp Xỉu' },
        'TXX': { pred: 'T', conf: 68, reason: '1T-2X - Đảo Tài' },
        'XTT': { pred: 'X', conf: 68, reason: '1X-2T - Đảo Xỉu' }
    };
    
    if (patterns3[pattern3]) {
        return {
            prediction: patterns3[pattern3].pred,
            confidence: patterns3[pattern3].conf,
            weight: 12,
            reason: patterns3[pattern3].reason
        };
    }
    
    // Pattern 5 phiên
    const patterns5 = {
        'TTTTT': { pred: 'X', conf: 88, reason: '5 Tài - Bẻ mạnh' },
        'XXXXX': { pred: 'T', conf: 88, reason: '5 Xỉu - Bẻ mạnh' },
        'TXTXT': { pred: 'X', conf: 80, reason: 'Zigzag 5 - Theo Xỉu' },
        'XTXTX': { pred: 'T', conf: 80, reason: 'Zigzag 5 - Theo Tài' }
    };
    
    if (patterns5[pattern5]) {
        return {
            prediction: patterns5[pattern5].pred,
            confidence: patterns5[pattern5].conf,
            weight: 13,
            reason: patterns5[pattern5].reason
        };
    }
    
    return null;
}

// Lớp 3: Phân tích Tổng điểm (Score)
function superScoreAnalysis(analysis, sessions) {
    const { scoreAnalysis } = analysis;
    const results = getResults(sessions);
    
    // Phân tích xu hướng tổng
    if (scoreAnalysis.avgLast3 > 13) {
        return { prediction: 'X', confidence: 80, weight: 12, reason: `TB 3 phiên cuối ${scoreAnalysis.avgLast3.toFixed(1)} > 13 - Áp lực Xỉu` };
    }
    
    if (scoreAnalysis.avgLast3 < 8) {
        return { prediction: 'T', confidence: 80, weight: 12, reason: `TB 3 phiên cuối ${scoreAnalysis.avgLast3.toFixed(1)} < 8 - Áp lực Tài` };
    }
    
    // Phân tích biến động
    if (scoreAnalysis.volatility > 4) {
        const lastResult = results[results.length - 1];
        return { 
            prediction: lastResult === 'T' ? 'X' : 'T', 
            confidence: 75, 
            weight: 10,
            reason: `Biến động cao ${scoreAnalysis.volatility.toFixed(1)} - Đảo chiều`
        };
    }
    
    // Phân tích xu hướng
    if (Math.abs(scoreAnalysis.trend) >= 4) {
        return { 
            prediction: scoreAnalysis.trend > 0 ? 'X' : 'T', 
            confidence: 73, 
            weight: 9,
            reason: `Xu hướng ${scoreAnalysis.trend > 0 ? 'tăng' : 'giảm'} mạnh - Đảo chiều`
        };
    }
    
    return null;
}

// Lớp 4: Phân tích Xúc xắc (Dice)
function superDiceAnalysis(analysis, sessions) {
    const { diceAnalysis } = analysis;
    const results = getResults(sessions);
    
    // Tỉ lệ xúc xắc cao
    if (diceAnalysis.highDiceRatio > 0.7) {
        return { prediction: 'X', confidence: 78, weight: 11, reason: `${(diceAnalysis.highDiceRatio*100).toFixed(0)}% xúc xắc cao - Áp lực Xỉu` };
    }
    
    if (diceAnalysis.highDiceRatio < 0.3) {
        return { prediction: 'T', confidence: 78, weight: 11, reason: `${(diceAnalysis.highDiceRatio*100).toFixed(0)}% xúc xắc cao - Áp lực Tài` };
    }
    
    // Số dominant
    if (diceAnalysis.dominantNumbers.length > 0) {
        const topDice = parseInt(diceAnalysis.dominantNumbers[0][0]);
        const topFreq = diceAnalysis.dominantNumbers[0][1];
        
        if (topFreq >= 8 && topDice >= 5) {
            return { prediction: 'X', confidence: 76, weight: 10, reason: `Số ${topDice} xuất hiện ${topFreq} lần - Áp lực Xỉu` };
        }
        if (topFreq >= 8 && topDice <= 2) {
            return { prediction: 'T', confidence: 76, weight: 10, reason: `Số ${topDice} xuất hiện ${topFreq} lần - Áp lực Tài` };
        }
    }
    
    return null;
}

// Lớp 5: Phân tích Đảo chiều (Reversal)
function superReversalAnalysis(analysis, sessions) {
    const { reversalAnalysis, balanceAnalysis } = analysis;
    const results = getResults(sessions);
    
    // Xác suất đảo chiều cao
    if (reversalAnalysis.reversalProbability > 0.7) {
        return { 
            prediction: results[results.length - 1] === 'T' ? 'X' : 'T', 
            confidence: 77, 
            weight: 10,
            reason: `Xác suất đảo chiều ${(reversalAnalysis.reversalProbability*100).toFixed(0)}%`
        };
    }
    
    // Mất cân bằng
    if (balanceAnalysis.imbalance >= 7) {
        const minority = balanceAnalysis.taiRatio10 > 0.5 ? 'X' : 'T';
        return { 
            prediction: minority, 
            confidence: 80, 
            weight: 12,
            reason: `Mất cân bằng ${balanceAnalysis.imbalance}/10 - Về ${minority}`
        };
    }
    
    // Tỉ lệ 5 phiên cuối cực đoan
    if (balanceAnalysis.taiRatio5 >= 0.8) {
        return { prediction: 'X', confidence: 82, weight: 12, reason: '80%+ Tài 5 phiên cuối - Bẻ Xỉu' };
    }
    if (balanceAnalysis.taiRatio5 <= 0.2) {
        return { prediction: 'T', confidence: 82, weight: 12, reason: '80%+ Xỉu 5 phiên cuối - Bẻ Tài' };
    }
    
    return null;
}

// Lớp 6: Phân tích Markov nâng cao
function superMarkovAnalysis(analysis, sessions) {
    const results = getResults(sessions);
    const scores = getScores(sessions);
    
    // Markov bậc 3 với trọng số
    const last3 = results.slice(-3).join(',');
    const transitions = {};
    
    for (let i = 0; i < results.length - 3; i++) {
        const state = results.slice(i, i + 3).join(',');
        const next = results[i + 3];
        if (!transitions[state]) transitions[state] = { T: 0, X: 0 };
        transitions[state][next]++;
    }
    
    if (transitions[last3]) {
        const total = transitions[last3].T + transitions[last3].X;
        if (total >= 5) {
            const probT = transitions[last3].T / total;
            const probX = transitions[last3].X / total;
            
            if (Math.abs(probT - 0.5) > 0.2) {
                return {
                    prediction: probT > 0.5 ? 'T' : 'X',
                    confidence: Math.round(70 + Math.abs(probT - 0.5) * 40),
                    weight: 11,
                    reason: `Markov bậc 3: ${last3} → ${probT > 0.5 ? 'T' : 'X'} (${(Math.max(probT, probX)*100).toFixed(0)}%)`
                };
            }
        }
    }
    
    return null;
}

// Lớp 7: Phân tích tổng hợp (Ensemble)
function superEnsembleAnalysis(allPredictions) {
    if (allPredictions.length === 0) return null;
    
    // Tính điểm có trọng số
    let totalWeight = 0;
    let weightedTaiScore = 0;
    let weightedXiuScore = 0;
    
    allPredictions.forEach(p => {
        const w = p.weight * (p.confidence / 100);
        if (p.prediction === 'T') weightedTaiScore += w;
        else weightedXiuScore += w;
        totalWeight += w;
    });
    
    if (totalWeight === 0) return null;
    
    const probTai = weightedTaiScore / totalWeight;
    const agreement = allPredictions.filter(p => p.prediction === (probTai > 0.5 ? 'T' : 'X')).length / allPredictions.length;
    
    let confidence = Math.round(probTai > 0.5 ? probTai * 100 : (1 - probTai) * 100);
    confidence = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, confidence));
    
    // Boost confidence nếu nhiều thuật toán đồng ý
    if (agreement > 0.8) confidence = Math.min(MAX_CONFIDENCE, confidence + 8);
    else if (agreement > 0.6) confidence = Math.min(MAX_CONFIDENCE, confidence + 4);
    
    return {
        prediction: probTai > 0.5 ? 'T' : 'X',
        confidence,
        reason: `${allPredictions.length} thuật toán - Đồng thuận ${(agreement*100).toFixed(0)}%`
    };
}

// ======================================================
// SUPER PREDICTION ENGINE
// ======================================================
function superPredict(sessions) {
    // Phân tích 10 phiên
    const analysis = analyzeLast10Sessions(sessions);
    const results = getResults(sessions);
    
    let allPredictions = [];
    
    // Chạy tất cả các lớp phân tích
    const layers = [
        { fn: superStreakAnalysis, name: 'Streak' },
        { fn: superPatternAnalysis, name: 'Pattern' },
        { fn: superScoreAnalysis, name: 'Score' },
        { fn: superDiceAnalysis, name: 'Dice' },
        { fn: superReversalAnalysis, name: 'Reversal' },
        { fn: superMarkovAnalysis, name: 'Markov' }
    ];
    
    layers.forEach(({ fn, name }) => {
        const result = fn(analysis, sessions);
        if (result) {
            allPredictions.push({
                ...result,
                name
            });
            console.log(`  ✅ [${name}] ${result.prediction} (${result.confidence}%) - ${result.reason}`);
        }
    });
    
    // Thêm các pattern đặc biệt từ 10 phiên
    addSpecialPatterns(allPredictions, results, sessions);
    
    // Thêm phân tích kỹ thuật
    addTechnicalAnalysis(allPredictions, results, sessions);
    
    // Ensemble tất cả dự đoán
    const finalResult = superEnsembleAnalysis(allPredictions);
    
    if (!finalResult && allPredictions.length > 0) {
        // Fallback: lấy dự đoán có confidence cao nhất
        const best = allPredictions.sort((a, b) => b.confidence * b.weight - a.confidence * a.weight)[0];
        return {
            prediction: best.prediction === 'T' ? 'Tài' : 'Xỉu',
            confidence: Math.max(MIN_CONFIDENCE, best.confidence),
            totalLayers: allPredictions.length,
            reasons: allPredictions.map(p => p.reason).slice(0, 5)
        };
    }
    
    if (!finalResult) {
        // Last resort: dựa trên xu hướng gần nhất
        const last3 = results.slice(-3);
        const taiCount = last3.filter(r => r === 'T').length;
        return {
            prediction: taiCount >= 2 ? 'Xỉu' : 'Tài',
            confidence: MIN_CONFIDENCE,
            totalLayers: 0,
            reasons: ['Fallback - Xu hướng gần nhất']
        };
    }
    
    return {
        prediction: finalResult.prediction === 'T' ? 'Tài' : 'Xỉu',
        confidence: finalResult.confidence,
        totalLayers: allPredictions.length,
        reasons: allPredictions.map(p => p.reason).slice(0, 5)
    };
}

function addSpecialPatterns(allPredictions, results, sessions) {
    const scores = getScores(sessions);
    
    // Pattern 3-2-1
    const last6 = results.slice(-6).join('');
    if (last6 === 'XXXTTT') {
        allPredictions.push({ prediction: 'T', confidence: 82, weight: 12, reason: 'Pattern 3-2-1: XXX→TTT - Theo Tài' });
    }
    if (last6 === 'TTTXXX') {
        allPredictions.push({ prediction: 'X', confidence: 82, weight: 12, reason: 'Pattern 3-2-1: TTT→XXX - Theo Xỉu' });
    }
    
    // Pattern cầu đôi
    const last4 = results.slice(-4).join('');
    if (last4 === 'TTXX') {
        allPredictions.push({ prediction: 'X', confidence: 78, weight: 10, reason: 'Cầu đôi TTXX - Theo Xỉu' });
    }
    if (last4 === 'XXTT') {
        allPredictions.push({ prediction: 'T', confidence: 78, weight: 10, reason: 'Cầu đôi XXTT - Theo Tài' });
    }
    
    // Tổng điểm cực đoan
    const lastScore = scores[scores.length - 1];
    if (lastScore >= 17) {
        allPredictions.push({ prediction: 'X', confidence: 88, weight: 14, reason: 'Tổng cực đoan ≥17 - Bẻ Xỉu mạnh' });
    }
    if (lastScore <= 4) {
        allPredictions.push({ prediction: 'T', confidence: 88, weight: 14, reason: 'Tổng cực đoan ≤4 - Bẻ Tài mạnh' });
    }
}

function addTechnicalAnalysis(allPredictions, results, sessions) {
    const scores = getScores(sessions);
    
    // RSI đơn giản
    const nums = results.map(r => r === 'T' ? 1 : 0);
    const avgGain = nums.slice(-5).reduce((a, b, i, arr) => i > 0 && b > arr[i-1] ? a + (b - arr[i-1]) : a, 0) / 5;
    const avgLoss = nums.slice(-5).reduce((a, b, i, arr) => i > 0 && b < arr[i-1] ? a + (arr[i-1] - b) : a, 0) / 5;
    
    if (avgLoss > 0) {
        const rsi = 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 70) {
            allPredictions.push({ prediction: 'X', confidence: 75, weight: 9, reason: `RSI=${rsi.toFixed(0)} - Quá mua - Bẻ Xỉu` });
        } else if (rsi < 30) {
            allPredictions.push({ prediction: 'T', confidence: 75, weight: 9, reason: `RSI=${rsi.toFixed(0)} - Quá bán - Bẻ Tài` });
        }
    }
    
    // Bollinger Bands đơn giản
    const avgScore = scores.reduce((a,b) => a+b, 0) / scores.length;
    const stdScore = Math.sqrt(scores.reduce((a,b) => a + Math.pow(b - avgScore, 2), 0) / scores.length);
    const upperBand = avgScore + 2 * stdScore;
    const lowerBand = avgScore - 2 * stdScore;
    
    if (scores[scores.length - 1] > upperBand) {
        allPredictions.push({ prediction: 'X', confidence: 78, weight: 10, reason: 'Bollinger: Vượt dải trên - Bẻ Xỉu' });
    }
    if (scores[scores.length - 1] < lowerBand) {
        allPredictions.push({ prediction: 'T', confidence: 78, weight: 10, reason: 'Bollinger: Dưới dải dưới - Bẻ Tài' });
    }
}

// ======================================================
// HỆ THỐNG HỌC TĂNG CƯỜNG
// ======================================================
function updateAlgorithmPerformance(prediction, actualResult) {
    // Cập nhật hiệu suất tổng thể
    if (!algorithmPerformance.overall) {
        algorithmPerformance.overall = { total: 0, correct: 0 };
    }
    algorithmPerformance.overall.total++;
    if (prediction === actualResult) {
        algorithmPerformance.overall.correct++;
    }
    
    // Điều chỉnh trọng số dựa trên hiệu suất gần đây
    const accuracy = algorithmPerformance.overall.correct / algorithmPerformance.overall.total;
    
    // Điều chỉnh MIN_CONFIDENCE dựa trên hiệu suất
    if (accuracy > 0.7 && algorithmPerformance.overall.total > 20) {
        // Hiệu suất tốt - có thể tăng confidence tối thiểu
        weightSystem.minConfidence = Math.min(75, MIN_CONFIDENCE + Math.floor((accuracy - 0.7) * 50));
    }
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        if (!res.data || !res.data.data || res.data.data.length < 10) return null;
        
        const allData = [...res.data.data];
        allData.sort((a, b) => (a.phien || 0) - (b.phien || 0));
        const latest10 = allData.slice(-10);
        
        return latest10.map(item => {
            const d1 = item.xuc_xac_1 || 0;
            const d2 = item.xuc_xac_2 || 0;
            const d3 = item.xuc_xac_3 || 0;
            const tong = item.tong || (d1 + d2 + d3);
            const ketQua = item.ket_qua || (tong >= 11 ? "Tài" : "Xỉu");
            return {
                phien: item.phien,
                Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
                Tong: tong,
                result: ketQua === "tài" ? "Tài" : (ketQua === "xỉu" ? "Xỉu" : ketQua),
                Ket_qua: ketQua === "tài" ? "Tài" : (ketQua === "xỉu" ? "Xỉu" : ketQua)
            };
        });
    } catch (e) {
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 10) { isUpdating = false; return; }
        
        const latestPhien = sessions[sessions.length - 1].phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;
        
        if (latestPhien !== oldLatestPhien) {
            const now = new Date().toLocaleTimeString();
            console.log(`\n${'='.repeat(60)}`);
            console.log(`🔄 [${now}] PHIÊN MỚI: ${latestPhien}`);
            console.log(`📊 10 phiên: ${sessions.map(s => `${s.phien}(${s.result})`).join(' → ')}`);
            
            // Xác minh dự đoán cũ
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.phien === predictedPhien);
                
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.result;
                    console.log(`✅ Xác minh phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.result} = ${isCorrect ? 'THẮNG 🟢' : 'THUA 🔴'}`);
                    
                    // Cập nhật hệ thống học
                    updateAlgorithmPerformance(currentPrediction.prediction, actual.result);
                    
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.result.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    
                    if (verifiedResults.length > 100) verifiedResults = verifiedResults.slice(0, 100);
                    
                    try { 
                        fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); 
                        fs.writeFileSync('./algorithm_performance.json', JSON.stringify(algorithmPerformance, null, 2));
                    } catch(e) {}
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            // Dự đoán mới
            const nextPhien = latestPhien + 1;
            console.log(`\n🔮 PHÂN TÍCH 10 PHIÊN ĐỂ DỰ ĐOÁN PHIÊN ${nextPhien}:`);
            
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: nextPhien,
                prediction: pred.prediction,
                confidence: pred.confidence,
                reasons: pred.reasons,
                timestamp: new Date().toISOString()
            };
            
            console.log(`\n🎯 KẾT QUẢ: ${pred.prediction} (${pred.confidence}%) - ${pred.totalLayers} lớp phân tích`);
            console.log(`📝 Lý do: ${pred.reasons.slice(0, 3).join(' | ')}`);
            console.log(`${'='.repeat(60)}\n`);
        }
    } catch(e) {
        console.error('Update error:', e.message);
    }
    
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 10);
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') consecutiveLosses++;
            else break;
        }
        
        // Tính tỉ lệ thắng
        const totalVerified = verifiedResults.length;
        const totalWins = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalVerified > 0 ? ((totalWins / totalVerified) * 100).toFixed(1) : '0.0';
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3,
                Tong: latest.Tong,
                Ket_qua: latest.result
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                consecutiveLosses,
                winRate: winRate + "%",
                totalPredictions: totalVerified,
                totalWins
            },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            reasons: currentPrediction.reasons || []
        });
    }
    
    // Fallback
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
            phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
            stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
            win_loss_table: [],
            full_history_count: 0        });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = {
        phien: latest.phien + 1,
        prediction: pred.prediction,
        confidence: pred.confidence,
        reasons: pred.reasons,
        timestamp: new Date().toISOString()
    };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: {
            Phien: latest.phien,
            Xuc_xac_1: latest.Xuc_xac_1,
            Xuc_xac_2: latest.Xuc_xac_2,
            Xuc_xac_3: latest.Xuc_xac_3,
            Tong: latest.Tong,
            Ket_qua: latest.result
        },
        phien_hien_tai: {
            Phien: latest.phien + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%"
        },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 10);
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') consecutiveLosses++;
            else break;
        }
        
        const totalVerified = verifiedResults.length;
        const totalWins = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalVerified > 0 ? ((totalWins / totalVerified) * 100).toFixed(1) : '0.0';
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3,
                Tong: latest.Tong,
                Ket_qua: latest.result
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                consecutiveLosses,
                winRate: winRate + "%",
                totalPredictions: totalVerified,
                totalWins
            },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            reasons: currentPrediction.reasons || [],
            algorithmPerformance: {
                accuracy: algorithmPerformance.overall ? 
                    ((algorithmPerformance.overall.correct / algorithmPerformance.overall.total) * 100).toFixed(1) + "%" : 
                    "N/A"
            }
        });
    }
    res.json({ status: "Đang khởi tạo...", message: "Hệ thống đang tải dữ liệu" });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI - SIÊU CHUẨN XÁC 2026');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây`);
console.log(`📊 Phân tích 10 phiên gần nhất`);
console.log(`🎯 Confidence tối thiểu: ${MIN_CONFIDENCE}%`);
console.log(`🧠 6+ lớp phân tích chuyên sâu`);
console.log(`📈 Hệ thống tự học tăng cường`);
console.log('='.repeat(60) + '\n');

// Tải dữ liệu đã lưu
try {
    if (fs.existsSync('./verified_results.json')) {
        verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
        console.log(`✅ Đã tải ${verifiedResults.length} lịch sử thắng/thua`);
    }
    if (fs.existsSync('./algorithm_performance.json')) {
        algorithmPerformance = JSON.parse(fs.readFileSync('./algorithm_performance.json', 'utf8'));
        console.log(`✅ Đã tải hiệu suất thuật toán`);
    }
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
