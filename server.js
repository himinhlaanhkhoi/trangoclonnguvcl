const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

const LEARNING_FILE = "./learning_data.json";
const HISTORY_FILE = "./prediction_history.json";
const MAX_HISTORY = 100;
const REQUIRED_SESSIONS = 10;

let learningData = {
    b52: {
        patternWeights: {},
        patternStats: {},
        predictions: [],
        totalPredictions: 0,
        correctPredictions: 0,
        streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0, wins: 0, losses: 0 },
        recentAccuracy: [],
        transitionMatrix: {},
        reversalState: { active: false, activatedAt: null, consecutiveLosses: 0, reversalCount: 0, lastReversalResult: null },
        lastUpdate: null
    }
};

let predictionHistory = { b52: [] };

const DEFAULT_PATTERN_WEIGHTS = {
    'cau_bet': 1.2, 'cau_dao_11': 1.1, 'cau_22': 1.0, 'cau_33': 1.0,
    'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 0.9,
    'cau_nhip_nghieng': 1.0, 'cau_3van1': 0.9, 'cau_be_cau': 1.1,
    'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.1,
    'sum_trend': 1.0, 'edge_cases': 1.1, 'momentum': 1.0,
    'cau_tu_nhien': 0.8, 'dice_trend_line': 1.2, 'break_pattern': 1.3,
    'fibonacci': 1.0, 'resistance_support': 1.0, 'wave': 1.0,
    'golden_ratio': 1.0, 'day_gay': 1.3, 'cau_44': 1.1, 'cau_55': 1.1,
    'cau_212': 1.0, 'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_gap': 0.9,
    'cau_ziczac': 1.1, 'cau_doi': 1.0, 'cau_rong': 1.2,
    'smart_bet': 1.2, 'markov_chain': 1.3, 'moving_avg_drift': 1.2,
    'sum_pressure': 1.2, 'volatility': 1.1, 'neural_pattern': 1.4,
    'deep_analysis': 1.3, 'probability_engine': 1.4, 'trend_reversal': 1.3
};

// ======================================================
// DATA FETCHING - ĐÃ SỬA: LẤY ĐÚNG THỨ TỰ
// ======================================================
async function fetchData() {
    try {
        console.log(`[FETCH] Đang lấy dữ liệu từ API...`);
        const response = await axios.get(API_URL, { timeout: 15000 });
        
        if (!response.data || !response.data.data || response.data.data.length === 0) {
            console.error('[FETCH] API trả về dữ liệu rỗng');
            return null;
        }
        
        const allData = response.data.data;
        console.log(`[FETCH] API trả về ${allData.length} phiên tổng cộng`);
        
        // LẤY 10 PHIÊN GẦN NHẤT (đã là mới nhất -> cũ nhất từ API)
        const last10 = allData.slice(0, REQUIRED_SESSIONS);
        
        if (last10.length < REQUIRED_SESSIONS) {
            console.error(`[FETCH] Chỉ có ${last10.length}/${REQUIRED_SESSIONS} phiên`);
            return null;
        }
        
        console.log(`[FETCH] Đã lấy ${REQUIRED_SESSIONS} phiên gần nhất`);
        console.log(`[FETCH] Phiên mới nhất: ${last10[0].Phien}, Phiên cũ nhất: ${last10[9].Phien}`);
        
        return { data: last10 };
        
    } catch (error) {
        console.error('[FETCH] Lỗi:', error.message);
        return null;
    }
}

// ======================================================
// NORMALIZE DATA - ĐÃ SỬA: GIỮ NGUYÊN THỨ TỰ MỚI -> CŨ
// ======================================================
function normalizeData(rawData) {
    if (!Array.isArray(rawData)) rawData = [rawData];
    
    const normalized = rawData.map((item, index) => {
        const d1 = item.Xuc_xac_1 || item.x1 || item.xuc_xac_1 || 0;
        const d2 = item.Xuc_xac_2 || item.x2 || item.xuc_xac_2 || 0;
        const d3 = item.Xuc_xac_3 || item.x3 || item.xuc_xac_3 || 0;
        const tong = item.Tong || item.tong || item.total || (d1 + d2 + d3);
        const ketQua = item.Ket_qua || item.ket_qua || item.result || (tong >= 11 ? "Tài" : "Xỉu");
        const phien = item.Phien || item.phien || item.session || item.id || 0;
        
        const normalizedKetQua = (ketQua === "Tài" || ketQua === "tài") ? "Tài" : "Xỉu";
        
        console.log(`  [NORMALIZE] Phiên ${phien}: Xúc xắc [${d1},${d2},${d3}] = ${tong} → ${normalizedKetQua}`);
        
        return {
            phien: phien,
            dice: [d1, d2, d3],
            Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
            Tong: tong, total: tong,
            Ket_qua: normalizedKetQua,
            result: normalizedKetQua,
            originalIndex: index
        };
    }).filter(item => item.phien > 0 && item.Tong >= 3 && item.Tong <= 18);
    
    // SẮP XẾP: Mới nhất đầu tiên (index 0), cũ nhất cuối cùng
    normalized.sort((a, b) => b.phien - a.phien);
    
    console.log(`[NORMALIZE] Đã chuẩn hóa ${normalized.length} phiên (mới nhất -> cũ nhất)`);
    console.log(`[NORMALIZE] Thứ tự: ${normalized.map(s => s.phien).join(' → ')}`);
    
    return normalized;
}

// ======================================================
// LEARNING SYSTEM FUNCTIONS
// ======================================================
function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.b52) learningData = { ...learningData, ...parsed };
            console.log('[LEARNING] Dữ liệu học đã được tải');
        }
    } catch (error) {
        console.error('[LEARNING] Lỗi tải dữ liệu:', error.message);
    }
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('[LEARNING] Lỗi lưu dữ liệu:', error.message);
    }
}

function initializePatternStats(type) {
    if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
        learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
    }
    Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
        if (!learningData[type].patternStats[pattern]) {
            learningData[type].patternStats[pattern] = {
                total: 0, correct: 0, accuracy: 0.5,
                recentResults: [], lastAdjustment: null
            };
        }
    });
}

function getPatternWeight(type, patternId) {
    initializePatternStats(type);
    return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
    initializePatternStats(type);
    const stats = learningData[type].patternStats[patternId];
    if (!stats) return;
    stats.total++;
    if (isCorrect) stats.correct++;
    stats.recentResults.push(isCorrect ? 1 : 0);
    if (stats.recentResults.length > 20) stats.recentResults.shift();
    const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
    stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
    const oldWeight = learningData[type].patternWeights[patternId];
    let newWeight = oldWeight;
    if (stats.recentResults.length >= 5) {
        if (recentAccuracy > 0.6) newWeight = Math.min(2.0, oldWeight * 1.05);
        else if (recentAccuracy < 0.4) newWeight = Math.max(0.3, oldWeight * 0.95);
    }
    learningData[type].patternWeights[patternId] = newWeight;
    stats.lastAdjustment = new Date().toISOString();
}

function getAdaptiveConfidenceBoost(type) {
    const recentAcc = learningData[type].recentAccuracy;
    if (recentAcc.length < 10) return 0;
    const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
    if (accuracy > 0.65) return 5;
    if (accuracy > 0.55) return 2;
    if (accuracy < 0.4) return -5;
    if (accuracy < 0.45) return -2;
    return 0;
}

// ======================================================
// HELPER FUNCTIONS
// ======================================================
function countReversals(results) {
    let count = 0;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i - 1]) count++;
    }
    return count;
}

function getCurrentStreak(results) {
    // results[0] là kết quả mới nhất
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    return streak;
}

function calculateConditionalProb(results, target, streak) {
    let count = 0, total = 0;
    // Duyệt từ cũ -> mới để tìm pattern
    for (let i = results.length - 1; i >= streak; i--) {
        const prevStreak = results.slice(i - streak, i).every(r => r === target);
        if (prevStreak) {
            total++;
            if (results[i] !== target) count++;
        }
    }
    return total > 0 ? count / total : 0.5;
}

function calculateReversalProb(results) {
    let reversals = 0;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i - 1]) reversals++;
    }
    return reversals / (results.length - 1);
}

function calculateSumProb(sums) {
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    return avg / 21;
}

// ======================================================
// PATTERN DETECTION FUNCTIONS - GIỮ NGUYÊN TẤT CẢ
// ======================================================

// Cầu Bệt
function analyzeCauBet(results, type) {
    // results: mảng kết quả từ mới nhất -> cũ nhất
    if (results.length < 3) return { detected: false };
    
    let streakType = results[0]; // Kết quả mới nhất
    let streakLength = 1;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === streakType) streakLength++;
        else break;
    }
    
    if (streakLength >= 3) {
        const weight = getPatternWeight(type, 'cau_bet');
        let shouldBreak = streakLength >= 6;
        let prediction;
        
        if (shouldBreak) {
            // Bẻ cầu - dự đoán ngược lại
            prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
        } else {
            // Tiếp tục cầu
            prediction = streakType;
        }
        
        return {
            detected: true,
            prediction: prediction,
            confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight),
            name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
            patternId: 'cau_bet'
        };
    }
    return { detected: false };
}

// Cầu Đảo 1-1
function analyzeCauDao11(results, type) {
    if (results.length < 4) return { detected: false };
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 10); i++) {
        if (results[i] !== results[i - 1]) alternatingLength++;
        else break;
    }
    
    if (alternatingLength >= 4) {
        const weight = getPatternWeight(type, 'cau_dao_11');
        // Đang đan xen -> dự đoán ngược với kết quả mới nhất
        return {
            detected: true,
            prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight),
            name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
            patternId: 'cau_dao_11'
        };
    }
    return { detected: false };
}

// Chu Kỳ
function detectCyclePattern(results, type) {
    if (results.length < 12) return { detected: false };
    
    for (let cycleLength = 2; cycleLength <= 6; cycleLength++) {
        let isRepeating = true;
        const pattern = results.slice(0, cycleLength);
        
        for (let i = cycleLength; i < Math.min(cycleLength * 3, results.length); i++) {
            if (results[i] !== pattern[i % cycleLength]) {
                isRepeating = false;
                break;
            }
        }
        
        if (isRepeating) {
            const nextPosition = results.length % cycleLength;
            const weight = getPatternWeight(type, 'cau_chu_ky');
            return {
                detected: true,
                prediction: pattern[nextPosition],
                confidence: Math.round(9 * weight),
                name: `Cầu Chu Kỳ ${cycleLength}`,
                patternId: 'cau_chu_ky'
            };
        }
    }
    return { detected: false };
}

// Cực Điểm
function analyzeEdgeCases(data, type) {
    if (data.length < 10) return { detected: false };
    
    const recentTotals = data.slice(0, 10).map(d => d.Tong);
    const extremeHighCount = recentTotals.filter(t => t >= 14).length;
    const extremeLowCount = recentTotals.filter(t => t <= 7).length;
    const weight = getPatternWeight(type, 'edge_cases');
    
    if (extremeHighCount >= 4) {
        return {
            detected: true,
            prediction: 'Xỉu',
            confidence: Math.round(7 * weight),
            name: `Cực Điểm Cao (${extremeHighCount} phiên >= 14)`,
            patternId: 'edge_cases'
        };
    }
    if (extremeLowCount >= 4) {
        return {
            detected: true,
            prediction: 'Tài',
            confidence: Math.round(7 * weight),
            name: `Cực Điểm Thấp (${extremeLowCount} phiên <= 7)`,
            patternId: 'edge_cases'
        };
    }
    return { detected: false };
}

// Markov Chain
function analyzeMarkovChain(results, data, type) {
    if (results.length < 20) return { detected: false };
    
    const transitions = { 'Tài->Tài': 0, 'Tài->Xỉu': 0, 'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0 };
    
    // Duyệt từ cũ -> mới để xây dựng ma trận chuyển tiếp
    for (let i = results.length - 1; i >= 1; i--) {
        const from = results[i];     // Cũ hơn
        const to = results[i - 1];   // Mới hơn
        transitions[`${from}->${to}`]++;
    }
    
    const currentResult = results[0]; // Kết quả mới nhất
    let prediction, probability;
    
    if (currentResult === 'Tài') {
        const total = transitions['Tài->Tài'] + transitions['Tài->Xỉu'];
        if (total > 0) {
            probability = transitions['Tài->Tài'] / total;
            prediction = probability > 0.55 ? 'Tài' : 'Xỉu';
        } else return { detected: false };
    } else {
        const total = transitions['Xỉu->Tài'] + transitions['Xỉu->Xỉu'];
        if (total > 0) {
            probability = transitions['Xỉu->Xỉu'] / total;
            prediction = probability > 0.55 ? 'Xỉu' : 'Tài';
        } else return { detected: false };
    }
    
    const weight = getPatternWeight(type, 'markov_chain');
    const confidence = Math.round(Math.min(15, Math.abs(probability - 0.5) * 30 + 8) * weight);
    
    if (Math.abs(probability - 0.5) > 0.1) {
        return {
            detected: true,
            prediction,
            confidence,
            name: `Markov Chain (${currentResult} → ${prediction}: ${(probability * 100).toFixed(0)}%)`,
            patternId: 'markov_chain'
        };
    }
    return { detected: false };
}

// Moving Average Drift
function analyzeMovingAverageDrift(data, type) {
    if (data.length < 20) return { detected: false };
    
    const sums = data.slice(0, 20).map(d => d.Tong);
    const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const shortTermDrift = ma5 - ma10;
    const weight = getPatternWeight(type, 'moving_avg_drift');
    
    if (Math.abs(shortTermDrift) > 1.5) {
        const prediction = shortTermDrift > 0 ? 'Tài' : 'Xỉu';
        return {
            detected: true,
            prediction,
            confidence: Math.round(14 * weight),
            name: `MA Drift (MA5:${ma5.toFixed(1)} MA10:${ma10.toFixed(1)})`,
            patternId: 'moving_avg_drift'
        };
    }
    return { detected: false };
}

// Sum Pressure
function analyzeSumPressure(data, type) {
    if (data.length < 15) return { detected: false };
    
    const EXPECTED_MEAN = 10.5;
    const recentSums = data.slice(0, 15).map(d => d.Tong);
    const avgSum = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
    const deviation = avgSum - EXPECTED_MEAN;
    const weight = getPatternWeight(type, 'sum_pressure');
    
    if (Math.abs(deviation) > 1.5) {
        const prediction = deviation > 0 ? 'Xỉu' : 'Tài';
        return {
            detected: true,
            prediction,
            confidence: Math.round(Math.min(15, Math.abs(deviation) * 5 + 7) * weight),
            name: `Áp Lực Tổng (Avg:${avgSum.toFixed(1)} vs Mean:${EXPECTED_MEAN})`,
            patternId: 'sum_pressure'
        };
    }
    return { detected: false };
}

// Volatility
function analyzeVolatility(data, type) {
    if (data.length < 10) return { detected: false };
    
    const sums = data.slice(0, 10).map(d => d.Tong);
    const changes = [];
    for (let i = 0; i < sums.length - 1; i++) {
        changes.push(Math.abs(sums[i] - sums[i + 1]));
    }
    
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    const maxChange = Math.max(...changes);
    const weight = getPatternWeight(type, 'volatility');
    
    if (avgChange > 4 && maxChange >= 7) {
        const lastResult = data[0].Ket_qua;
        return {
            detected: true,
            prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(12 * weight),
            name: `Biến Động Cao (Avg:${avgChange.toFixed(1)}, Max:${maxChange})`,
            patternId: 'volatility'
        };
    }
    return { detected: false };
}

// Dây Gãy
function analyzeDayGay(data, type) {
    if (data.length < 3) return { detected: false };
    
    const current = data[0], previous = data[1];
    const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
    const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
    
    const directions = [];
    for (let i = 0; i < 3; i++) {
        if (currentDices[i] > previousDices[i]) directions.push('up');
        else if (currentDices[i] < previousDices[i]) directions.push('down');
        else directions.push('same');
    }
    
    const upCount = directions.filter(d => d === 'up').length;
    const downCount = directions.filter(d => d === 'down').length;
    const sameCount = directions.filter(d => d === 'same').length;
    const weight = getPatternWeight(type, 'day_gay');
    
    if (sameCount === 2 && upCount === 1) {
        return {
            detected: true,
            prediction: 'Xỉu',
            confidence: Math.round(14 * weight),
            name: 'Dây Gãy (2 thẳng + 1 lên → Xỉu)',
            patternId: 'day_gay'
        };
    }
    if (sameCount === 2 && downCount === 1) {
        return {
            detected: true,
            prediction: 'Tài',
            confidence: Math.round(14 * weight),
            name: 'Dây Gãy (2 thẳng + 1 xuống → Tài)',
            patternId: 'day_gay'
        };
    }
    return { detected: false };
}

// Fibonacci
function analyzeFibonacciPattern(data, type) {
    if (data.length < 13) return { detected: false };
    
    const weight = getPatternWeight(type, 'fibonacci');
    const fibPositions = [1, 2, 3, 5, 8, 13];
    let taiAtFib = 0, xiuAtFib = 0;
    
    fibPositions.forEach(pos => {
        if (pos <= data.length) {
            if (data[pos - 1].Ket_qua === 'Tài') taiAtFib++;
            else xiuAtFib++;
        }
    });
    
    if (taiAtFib >= 5 || xiuAtFib >= 5) {
        const dominant = taiAtFib > xiuAtFib ? 'Tài' : 'Xỉu';
        return {
            detected: true,
            prediction: dominant,
            confidence: Math.round(11 * weight),
            name: `Fibonacci (${taiAtFib}T-${xiuAtFib}X tại vị trí Fib)`,
            patternId: 'fibonacci'
        };
    }
    return { detected: false };
}

// Break Pattern
function analyzeBreakPattern(results, data, type) {
    if (results.length < 5) return { detected: false };
    
    const weight = getPatternWeight(type, 'break_pattern');
    let streakLength = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streakLength++;
        else break;
    }
    
    if (streakLength >= 5) {
        const current = data[0], previous = data[1];
        const sumDiff = Math.abs(current.Tong - previous.Tong);
        
        if (sumDiff >= 5 || streakLength >= 7) {
            return {
                detected: true,
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: Math.round(15 * weight),
                name: `Cầu Liên Tục ${streakLength} (Biến động → Bẻ)`,
                patternId: 'break_pattern'
            };
        }
    }
    return { detected: false };
}

// Smart Bet
function analyzeSmartBet(results, type) {
    if (results.length < 10) return { detected: false };
    
    const weight = getPatternWeight(type, 'smart_bet');
    const last5 = results.slice(0, 5);
    const prev5 = results.slice(5, 10);
    const taiLast5 = last5.filter(r => r === 'Tài').length;
    const taiPrev5 = prev5.filter(r => r === 'Tài').length;
    
    const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
    
    if (trendChanging) {
        const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
        return {
            detected: true,
            prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(13 * weight),
            name: `Đảo Xu Hướng (${taiLast5}T vs ${taiPrev5}T)`,
            patternId: 'smart_bet'
        };
    }
    
    const last10 = results.slice(0, 10);
    const taiLast10 = last10.filter(r => r === 'Tài').length;
    
    if (taiLast10 >= 8 || taiLast10 <= 2) {
        const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
        return {
            detected: true,
            prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(12 * weight),
            name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X trong 10 phiên)`,
            patternId: 'smart_bet'
        };
    }
    return { detected: false };
}

// Phân bố
function analyzeDistribution(data, type, windowSize = 50) {
    const window = data.slice(0, windowSize);
    const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
    const xiuCount = window.length - taiCount;
    return {
        taiPercent: (taiCount / window.length) * 100,
        xiuPercent: (xiuCount / window.length) * 100,
        taiCount, xiuCount, total: window.length,
        imbalance: Math.abs(taiCount - xiuCount) / window.length
    };
}

// ======================================================
// ADVANCED AI ALGORITHMS
// ======================================================

// Neural Pattern
function analyzeNeuralPattern(sessions) {
    if (sessions.length < REQUIRED_SESSIONS) return { detected: false };
    
    const results = sessions.map(s => s.Ket_qua === 'Tài' ? 1 : 0);
    const sums = sessions.map(s => s.Tong);
    
    const patterns = {
        last3Trend: results.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
        last5Trend: results.slice(0, 5).reduce((a, b) => a + b, 0) / 5,
        fullTrend: results.reduce((a, b) => a + b, 0) / REQUIRED_SESSIONS,
        sumVariance: Math.abs(sums[0] - sums.reduce((a, b) => a + b, 0) / REQUIRED_SESSIONS),
        reversals: countReversals(results),
        currentStreak: getCurrentStreak(results),
        last3TaiCount: results.slice(0, 3).filter(r => r === 1).length
    };
    
    let taiScore = 0, xiuScore = 0;
    
    if (patterns.last3TaiCount === 3) xiuScore += 30;
    else if (patterns.last3TaiCount === 0) taiScore += 30;
    
    if (patterns.currentStreak >= 4) {
        if (results[0] === 1) xiuScore += 25;
        else taiScore += 25;
    } else if (patterns.currentStreak >= 3) {
        if (results[0] === 1) xiuScore += 20;
        else taiScore += 20;
    }
    
    if (patterns.fullTrend > 0.7) xiuScore += 15;
    else if (patterns.fullTrend < 0.3) taiScore += 15;
    
    if (patterns.sumVariance > 4) {
        if (sums[0] > 10.5) xiuScore += 15;
        else taiScore += 15;
    }
    
    if (patterns.reversals >= 5) {
        if (results[0] === 1) xiuScore += 10;
        else taiScore += 10;
    }
    
    const prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    const confidence = Math.round(50 + Math.abs(taiScore - xiuScore));
    
    return {
        detected: true,
        prediction,
        confidence: Math.min(95, confidence),
        name: `Neural Pattern (T:${taiScore} vs X:${xiuScore})`,
        patternId: 'neural_pattern'
    };
}

// Deep Analysis
function analyzeDeepPattern(sessions) {
    if (sessions.length < REQUIRED_SESSIONS) return { detected: false };
    
    const results = sessions.map(s => s.Ket_qua === 'Tài' ? 'T' : 'X');
    const dices = sessions.map(s => [s.Xuc_xac_1, s.Xuc_xac_2, s.Xuc_xac_3]);
    let patternScore = { T: 0, X: 0 };
    
    for (let i = 0; i < dices.length - 1; i++) {
        const currentSum = dices[i].reduce((a, b) => a + b, 0);
        const nextSum = dices[i + 1] ? dices[i + 1].reduce((a, b) => a + b, 0) : 0;
        if (currentSum - nextSum >= 5) patternScore.T += 10;
        if (nextSum - currentSum >= 5) patternScore.X += 10;
    }
    
    const diceFrequency = {};
    dices.flat().forEach(d => { diceFrequency[d] = (diceFrequency[d] || 0) + 1; });
    
    const highDice = (diceFrequency[4] || 0) + (diceFrequency[5] || 0) + (diceFrequency[6] || 0);
    const lowDice = (diceFrequency[1] || 0) + (diceFrequency[2] || 0) + (diceFrequency[3] || 0);
    
    if (highDice > lowDice * 1.5) patternScore.X += 15;
    if (lowDice > highDice * 1.5) patternScore.T += 15;
    
    const resultString = results.join('');
    if (resultString.match(/(TX){3,}/) || resultString.match(/(XT){3,}/)) {
        if (results[0] === 'T') patternScore.X += 20;
        else patternScore.T += 20;
    }
    if (resultString.match(/T{3,}/)) patternScore.X += 25;
    if (resultString.match(/X{3,}/)) patternScore.T += 25;
    
    const prediction = patternScore.T > patternScore.X ? 'Tài' : 'Xỉu';
    const confidence = Math.round(55 + Math.abs(patternScore.T - patternScore.X) * 0.5);
    
    return {
        detected: true,
        prediction,
        confidence: Math.min(92, confidence),
        name: `Deep Analysis (T:${patternScore.T} vs X:${patternScore.X})`,
        patternId: 'deep_analysis'
    };
}

// Probability Engine
function analyzeProbabilityEngine(sessions) {
    if (sessions.length < REQUIRED_SESSIONS) return { detected: false };
    
    const results = sessions.map(s => s.Ket_qua === 'Tài' ? 'T' : 'X');
    const sums = sessions.map(s => s.Tong);
    
    const probabilities = {
        after3Tai: calculateConditionalProb(results, 'T', 3),
        after3Xiu: calculateConditionalProb(results, 'X', 3),
        reversalProb: calculateReversalProb(results),
        sumProb: calculateSumProb(sums)
    };
    
    let taiProb = 0, xiuProb = 0;
    
    if (results.slice(0, 3).every(r => r === 'T')) xiuProb += probabilities.after3Tai * 100;
    if (results.slice(0, 3).every(r => r === 'X')) taiProb += probabilities.after3Xiu * 100;
    
    if (probabilities.reversalProb > 0.6) {
        if (results[0] === 'T') xiuProb += 30;
        else taiProb += 30;
    }
    
    if (probabilities.sumProb > 0.6) taiProb += 20;
    else if (probabilities.sumProb < 0.4) xiuProb += 20;
    
    const prediction = taiProb > xiuProb ? 'Tài' : 'Xỉu';
    const confidence = Math.round(50 + Math.abs(taiProb - xiuProb));
    
    return {
        detected: true,
        prediction,
        confidence: Math.min(93, Math.max(55, confidence)),
        name: `Probability Engine (T:${taiProb.toFixed(0)}% vs X:${xiuProb.toFixed(0)}%)`,
        patternId: 'probability_engine'
    };
}

// Trend Reversal
function analyzeTrendReversal(sessions) {
    if (sessions.length < REQUIRED_SESSIONS) return { detected: false };
    
    const results = sessions.map(s => s.Ket_qua === 'Tài' ? 1 : 0);
    const sums = sessions.map(s => s.Tong);
    
    const firstHalf = results.slice(5, 10);  // 5 phiên cũ hơn
    const secondHalf = results.slice(0, 5);  // 5 phiên mới hơn
    
    const firstHalfTai = firstHalf.filter(r => r === 1).length;
    const secondHalfTai = secondHalf.filter(r => r === 1).length;
    const trendChange = secondHalfTai - firstHalfTai;
    
    let prediction, confidence = 50;
    
    if (Math.abs(trendChange) >= 3) {
        prediction = trendChange > 0 ? 'Tài' : 'Xỉu';
        confidence = 65 + Math.abs(trendChange) * 10;
    } else if (Math.abs(trendChange) >= 2) {
        prediction = trendChange > 0 ? 'Tài' : 'Xỉu';
        confidence = 60 + Math.abs(trendChange) * 8;
    } else {
        prediction = secondHalfTai >= 3 ? 'Tài' : 'Xỉu';
        confidence = 55;
    }
    
    const avgSum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    if (avgSum > 12) { prediction = 'Xỉu'; confidence += 5; }
    else if (avgSum < 9) { prediction = 'Tài'; confidence += 5; }
    
    return {
        detected: true,
        prediction,
        confidence: Math.min(90, confidence),
        name: `Trend Reversal (Change: ${trendChange})`,
        patternId: 'trend_reversal'
    };
}

// ======================================================
// MAIN PREDICTION ENGINE - ĐÃ SỬA LOGIC
// ======================================================
function calculateAdvancedPrediction(data, type) {
    const sessions = data.slice(0, REQUIRED_SESSIONS);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔮 BẮT ĐẦU PHÂN TÍCH ${REQUIRED_SESSIONS} PHIÊN GẦN NHẤT`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 Phiên mới nhất: ${sessions[0].phien} → ${sessions[0].Ket_qua} (Tổng: ${sessions[0].Tong})`);
    console.log(`📊 Chuỗi kết quả (mới→cũ): ${sessions.map(s => s.Ket_qua).join(' → ')}`);
    console.log(`📊 Chuỗi tổng (mới→cũ): ${sessions.map(s => s.Tong).join(' → ')}`);
    
    initializePatternStats(type);
    
    let predictions = [];
    let factors = [];
    
    const results = sessions.map(s => s.Ket_qua);
    
    const allAlgorithms = [
        { fn: analyzeNeuralPattern, priority: 15, useData: true, desc: 'Neural Pattern' },
        { fn: analyzeDeepPattern, priority: 14, useData: true, desc: 'Deep Analysis' },
        { fn: analyzeProbabilityEngine, priority: 14, useData: true, desc: 'Probability Engine' },
        { fn: analyzeTrendReversal, priority: 13, useData: true, desc: 'Trend Reversal' },
        { fn: analyzeDayGay, priority: 13, useData: true, desc: 'Dây Gãy' },
        { fn: analyzeBreakPattern, priority: 12, useData: false, desc: 'Break Pattern' },
        { fn: analyzeMarkovChain, priority: 12, useData: false, desc: 'Markov Chain' },
        { fn: analyzeSmartBet, priority: 11, useData: false, desc: 'Smart Bet' },
        { fn: analyzeMovingAverageDrift, priority: 11, useData: true, desc: 'MA Drift' },
        { fn: analyzeSumPressure, priority: 11, useData: true, desc: 'Sum Pressure' },
        { fn: analyzeVolatility, priority: 10, useData: true, desc: 'Volatility' },
        { fn: analyzeCauBet, priority: 10, useData: false, desc: 'Cầu Bệt' },
        { fn: analyzeCauDao11, priority: 9, useData: false, desc: 'Cầu Đảo 1-1' },
        { fn: analyzeFibonacciPattern, priority: 8, useData: true, desc: 'Fibonacci' },
        { fn: analyzeEdgeCases, priority: 8, useData: true, desc: 'Edge Cases' },
        { fn: detectCyclePattern, priority: 7, useData: false, desc: 'Cycle Pattern' }
    ];
    
    allAlgorithms.forEach(({ fn, priority, useData, desc }) => {
        let result;
        try {
            if (fn.name === 'analyzeBreakPattern' || fn.name === 'analyzeMarkovChain') {
                result = fn(results, sessions, type);
            } else if (fn.name === 'detectCyclePattern' || fn.name === 'analyzeCauBet' || 
                       fn.name === 'analyzeCauDao11' || fn.name === 'analyzeSmartBet') {
                result = fn(results, type);
            } else {
                result = fn(sessions, type);
            }
            
            if (result && result.detected) {
                predictions.push({ 
                    prediction: result.prediction, 
                    confidence: result.confidence, 
                    priority, 
                    name: result.name 
                });
                factors.push(result.name);
                console.log(`  ✅ [${desc}] ${result.prediction} (${result.confidence}%)`);
            } else {
                console.log(`  ⏭️ [${desc}] Không phát hiện`);
            }
        } catch (e) {
            console.log(`  ❌ [${desc}] Lỗi: ${e.message}`);
        }
    });
    
    // Distribution
    const distribution = analyzeDistribution(data, type);
    if (distribution.imbalance > 0.2) {
        const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
        const weight = getPatternWeight(type, 'distribution');
        predictions.push({ 
            prediction: minority, confidence: Math.round(8 * weight), 
            priority: 6, name: 'Phân bố lệch' 
        });
    }
    
    // Fallback
    if (predictions.length === 0) {
        const last3 = results.slice(0, 3);
        const taiCount = last3.filter(r => r === 'Tài').length;
        predictions.push({ 
            prediction: taiCount >= 2 ? 'Xỉu' : 'Tài', 
            confidence: 55, priority: 1, name: 'Fallback' 
        });
        console.log('  ⚠️ Sử dụng Fallback');
    }
    
    // Sort and calculate
    predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
    
    const taiVotes = predictions.filter(p => p.prediction === 'Tài');
    const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
    
    const taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority * 0.1, 0);
    const xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority * 0.1, 0);
    
    let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    
    // Confidence calculation
    let baseConfidence = 50;
    const top3 = predictions.slice(0, 3);
    const top3Agree = top3.filter(p => p.prediction === finalPrediction).length;
    
    if (top3Agree === 3) baseConfidence += 25;
    else if (top3Agree === 2) baseConfidence += 15;
    else baseConfidence += 5;
    
    const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
    baseConfidence += Math.round(agreementRatio * 15);
    baseConfidence += getAdaptiveConfidenceBoost(type);
    
    let finalConfidence = Math.round(baseConfidence);
    finalConfidence = Math.max(55, Math.min(95, finalConfidence));
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 KẾT QUẢ CUỐI CÙNG: ${finalPrediction} (${finalConfidence}%)`);
    console.log(`📊 Tài: ${taiScore.toFixed(1)} | Xỉu: ${xiuScore.toFixed(1)}`);
    console.log(`📊 Thuật toán: ${predictions.length} | Đồng thuận: ${(agreementRatio * 100).toFixed(0)}%`);
    console.log(`📊 Top 3: ${top3.map(p => p.name).join(', ')}`);
    console.log(`${'='.repeat(60)}\n`);
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        factors: factors.slice(0, 5),
        detailedAnalysis: {
            totalAlgorithms: predictions.length,
            taiVotes: taiVotes.length,
            xiuVotes: xiuVotes.length,
            taiScore: taiScore.toFixed(1),
            xiuScore: xiuScore.toFixed(1),
            topAlgorithms: top3.map(p => `${p.name}(${p.prediction})`),
            distribution
        }
    };
}

// ======================================================
// BUILD WIN/LOSS TABLE - ĐÃ SỬA
// ======================================================
function buildWinLossTable(history) {
    let winLossTable = [];
    
    // Lấy 10 phiên gần nhất để hiển thị
    let recentHistory = history.slice(0, 10);
    
    for (let i = 0; i < recentHistory.length; i++) {
        let h = recentHistory[i];
        
        // Dự đoán cho phiên này dựa trên dữ liệu TRƯỚC ĐÓ
        // Lấy tất cả phiên từ vị trí i+1 trở đi (các phiên cũ hơn)
        let prevHistory = history.slice(i + 1);
        
        let predict;
        if (prevHistory.length >= REQUIRED_SESSIONS) {
            predict = calculateAdvancedPrediction(prevHistory, 'b52');
        } else {
            predict = { prediction: 'Tài', confidence: 50 };
        }
        
        let danhGia = "chưa xác định";
        if (predict.prediction && h.Ket_qua) {
            if (predict.prediction === h.Ket_qua) {
                danhGia = "thang";
            } else {
                danhGia = "thua";
            }
        }
        
        winLossTable.push({
            phien: h.phien,
            du_doan: predict.prediction.toLowerCase(),
            ket_qua: h.Ket_qua.toLowerCase(),
            danh_gia: danhGia
        });
    }
    
    return winLossTable;
}

function countConsecutiveLosses(winLossTable) {
    let consecutiveLosses = 0;
    // Duyệt từ mới nhất -> cũ nhất
    for (let i = 0; i < winLossTable.length; i++) {
        if (winLossTable[i].danh_gia === "thua") {
            consecutiveLosses++;
        } else {
            break;
        }
    }
    return consecutiveLosses;
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        console.log('\n' + '🔔 NHẬN REQUEST /taixiu');
        
        const rawData = await fetchData();
        if (!rawData || !rawData.data) {
            throw new Error("Không thể lấy dữ liệu từ API");
        }
        
        const sessions = normalizeData(rawData.data);
        
        if (sessions.length < REQUIRED_SESSIONS) {
            console.log(`⚠️ Chỉ có ${sessions.length}/${REQUIRED_SESSIONS} phiên`);
            return res.json({
                id: "@vuaoccac",
                phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
                phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
                stats: { consecutiveLosses: 0 },
                win_loss_table: [],
                full_history_count: 0
            });
        }
        
        // Phiên mới nhất là sessions[0]
        let latest = sessions[0];
        let predict = calculateAdvancedPrediction(sessions, 'b52');
        let winLossTable = buildWinLossTable(sessions);
        let consecutiveLosses = countConsecutiveLosses(winLossTable);
        let currentPhien = latest.phien + 1;
        
        const response = {
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3,
                Tong: latest.Tong,
                Ket_qua: latest.Ket_qua
            },
            phien_hien_tai: {
                Phien: currentPhien,
                Du_doan: predict.prediction,
                Do_tin_cay: predict.confidence + "%"
            },
            stats: { consecutiveLosses },
            win_loss_table: winLossTable,
            full_history_count: sessions.length
        };
        
        console.log('✅ Response gửi đi:');
        console.log(JSON.stringify(response, null, 2));
        
        res.json(response);
        
    } catch (err) {
        console.error("❌ Lỗi:", err.message);
        res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Lỗi kết nối" },
            phien_hien_tai: { Phien: 0, Du_doan: "Lỗi", Do_tin_cay: "0%" },
            stats: { consecutiveLosses: 0 },
            win_loss_table: [],
            full_history_count: 0
        });
    }
});

app.get("/", async (req, res) => {
    try {
        const rawData = await fetchData();
        if (!rawData || !rawData.data) throw new Error("Không thể lấy dữ liệu");
        
        const sessions = normalizeData(rawData.data);
        
        if (sessions.length < REQUIRED_SESSIONS) {
            return res.json({ 
                status: "error", 
                message: `Cần ${REQUIRED_SESSIONS} phiên, hiện có ${sessions.length} phiên` 
            });
        }
        
        let latest = sessions[0];
        let predict = calculateAdvancedPrediction(sessions, 'b52');
        let winLossTable = buildWinLossTable(sessions);
        let consecutiveLosses = countConsecutiveLosses(winLossTable);
        let currentPhien = latest.phien + 1;
        
        res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3,
                Tong: latest.Tong,
                Ket_qua: latest.Ket_qua
            },
            phien_hien_tai: {
                Phien: currentPhien,
                Du_doan: predict.prediction,
                Do_tin_cay: predict.confidence + "%"
            },
            stats: { consecutiveLosses },
            win_loss_table: winLossTable,
            full_history_count: sessions.length,
            analysis: predict.detailedAnalysis
        });
    } catch (err) {
        console.error("Lỗi:", err.message);
        res.json({ status: "error", message: err.message });
    }
});

// ======================================================
// START SERVER
// ======================================================
loadLearningData();

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 TÀI XỈU AI SERVER - PHIÊN BẢN ĐÃ SỬA');
    console.log('='.repeat(60));
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔗 API: ${API_URL}`);
    console.log(`📊 Bắt buộc: ${REQUIRED_SESSIONS} phiên gần nhất`);
    console.log(`🧠 Thuật toán: 16+ (Neural + Deep + Probability + Classic)`);
    console.log(`✅ Thứ tự dữ liệu: Mới nhất → Cũ nhất (đã sửa)`);
    console.log('='.repeat(60) + '\n');
});
