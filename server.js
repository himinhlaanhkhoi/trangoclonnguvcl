const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// File paths for learning data
const LEARNING_FILE = "./learning_data.json";
const HISTORY_FILE = "./prediction_history.json";
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

// Learning data storage
let learningData = {
    b52: {
        patternWeights: {},
        patternStats: {},
        predictions: [],
        totalPredictions: 0,
        correctPredictions: 0,
        streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0, wins: 0, losses: 0 },
        recentAccuracy: [],
        transitionMatrix: null,
        reversalState: { active: false, activatedAt: null, consecutiveLosses: 0, reversalCount: 0, lastReversalResult: null },
        lastUpdate: null
    }
};

let predictionHistory = { b52: [] };
let lastProcessedPhien = { b52: null };

const DEFAULT_PATTERN_WEIGHTS = {
    'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0,
    'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
    'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0,
    'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0,
    'sum_trend': 1.0, 'edge_cases': 1.0, 'momentum': 1.0,
    'cau_tu_nhien': 1.0, 'dice_trend_line': 1.0, 'break_pattern': 1.0,
    'fibonacci': 1.0, 'resistance_support': 1.0, 'wave': 1.0,
    'golden_ratio': 1.0, 'day_gay': 1.0, 'cau_44': 1.0, 'cau_55': 1.0,
    'cau_212': 1.0, 'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_gap': 1.0,
    'cau_ziczac': 1.0, 'cau_doi': 1.0, 'cau_rong': 1.0,
    'smart_bet': 1.0, 'markov_chain': 1.2, 'moving_avg_drift': 1.1,
    'sum_pressure': 1.1, 'volatility': 1.0
};

const REVERSAL_THRESHOLD = 3;

// ======================================================
// DATA FETCHING & NORMALIZATION
// ======================================================
async function fetchData() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        return response.data;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        return null;
    }
}

function normalizeData(data) {
    if (!Array.isArray(data)) data = [data];
    return data.map(item => {
        const d1 = item.xuc_xac_1 || item.x1 || item.Xuc_xac_1 || 0;
        const d2 = item.xuc_xac_2 || item.x2 || item.Xuc_xac_2 || 0;
        const d3 = item.xuc_xac_3 || item.x3 || item.Xuc_xac_3 || 0;
        const tong = item.tong || item.total || item.Tong || (d1 + d2 + d3);
        const ketQua = (item.ket_qua || item.result || item.Ket_qua || (tong >= 11 ? "Tài" : "Xỉu"));
        
        return {
            phien: item.phien || item.session || item.id || item.Phien || 0,
            dice: [d1, d2, d3],
            Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
            Tong: tong, total: tong,
            Ket_qua: ketQua === "Tài" || ketQua === "tài" ? "Tài" : "Xỉu",
            result: ketQua === "Tài" || ketQua === "tài" ? "Tài" : "Xỉu"
        };
    }).filter(item => item.phien > 0 && item.Tong >= 3 && item.Tong <= 18);
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
            console.log('✅ Learning data loaded');
        }
    } catch (error) {
        console.error('Error loading learning data:', error.message);
    }
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('Error saving learning data:', error.message);
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

function normalizeResult(result) {
    if (result === 'Tài' || result === 'tài') return 'tai';
    if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
    return result.toLowerCase();
}

// ======================================================
// PATTERN DETECTION FUNCTIONS
// ======================================================
function analyzeCauBet(results, type) {
    if (results.length < 3) return { detected: false };
    let streakType = results[0];
    let streakLength = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === streakType) streakLength++;
        else break;
    }
    if (streakLength >= 3) {
        const weight = getPatternWeight(type, 'cau_bet');
        let shouldBreak = streakLength >= 6;
        return {
            detected: true, type: streakType, length: streakLength,
            prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
            confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight),
            name: `Cầu Bệt ${streakLength} phiên`, patternId: 'cau_bet'
        };
    }
    return { detected: false };
}

function analyzeCauDao11(results, type) {
    if (results.length < 4) return { detected: false };
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 10); i++) {
        if (results[i] !== results[i - 1]) alternatingLength++;
        else break;
    }
    if (alternatingLength >= 4) {
        const weight = getPatternWeight(type, 'cau_dao_11');
        return {
            detected: true, length: alternatingLength,
            prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight),
            name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`, patternId: 'cau_dao_11'
        };
    }
    return { detected: false };
}

function detectCyclePattern(results, type) {
    if (results.length < 12) return { detected: false };
    for (let cycleLength = 2; cycleLength <= 6; cycleLength++) {
        let isRepeating = true;
        const pattern = results.slice(0, cycleLength);
        for (let i = cycleLength; i < Math.min(cycleLength * 3, results.length); i++) {
            if (results[i] !== pattern[i % cycleLength]) { isRepeating = false; break; }
        }
        if (isRepeating) {
            const nextPosition = results.length % cycleLength;
            const weight = getPatternWeight(type, 'cau_chu_ky');
            return {
                detected: true, cycleLength, pattern,
                prediction: pattern[nextPosition],
                confidence: Math.round(9 * weight),
                name: `Cầu Chu Kỳ ${cycleLength}`, patternId: 'cau_chu_ky'
            };
        }
    }
    return { detected: false };
}

function analyzeEdgeCases(data, type) {
    if (data.length < 10) return { detected: false };
    const recentTotals = data.slice(0, 10).map(d => d.Tong);
    const extremeHighCount = recentTotals.filter(t => t >= 14).length;
    const extremeLowCount = recentTotals.filter(t => t <= 7).length;
    const weight = getPatternWeight(type, 'edge_cases');
    if (extremeHighCount >= 4) {
        return { detected: true, type: 'extreme_high', prediction: 'Xỉu',
            confidence: Math.round(7 * weight), name: `Cực Điểm Cao (${extremeHighCount} phiên >= 14)`, patternId: 'edge_cases' };
    }
    if (extremeLowCount >= 4) {
        return { detected: true, type: 'extreme_low', prediction: 'Tài',
            confidence: Math.round(7 * weight), name: `Cực Điểm Thấp (${extremeLowCount} phiên <= 7)`, patternId: 'edge_cases' };
    }
    return { detected: false };
}

// ======================================================
// ADVANCED AI PREDICTION FUNCTIONS (TỪ CÁC FILE KHÁC)
// ======================================================

// Markov Chain
function analyzeMarkovChain(results, data, type) {
    if (results.length < 20) return { detected: false };
    const transitions = { 'Tài->Tài': 0, 'Tài->Xỉu': 0, 'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0 };
    for (let i = 0; i < results.length - 1; i++) {
        const from = results[i + 1], to = results[i];
        transitions[`${from}->${to}`]++;
    }
    if (!learningData[type].transitionMatrix) learningData[type].transitionMatrix = { ...transitions };
    else {
        Object.keys(transitions).forEach(key => {
            learningData[type].transitionMatrix[key] = (learningData[type].transitionMatrix[key] || 0) * 0.9 + transitions[key] * 0.1;
        });
    }
    const currentResult = results[0];
    const taiToTai = transitions['Tài->Tài'], taiToXiu = transitions['Tài->Xỉu'];
    const xiuToTai = transitions['Xỉu->Tài'], xiuToXiu = transitions['Xỉu->Xỉu'];
    let prediction, probability;
    if (currentResult === 'Tài') {
        const total = taiToTai + taiToXiu;
        if (total > 0) { probability = taiToTai / total; prediction = probability > 0.55 ? 'Tài' : 'Xỉu'; }
        else return { detected: false };
    } else {
        const total = xiuToTai + xiuToXiu;
        if (total > 0) { probability = xiuToXiu / total; prediction = probability > 0.55 ? 'Xỉu' : 'Tài'; }
        else return { detected: false };
    }
    const weight = getPatternWeight(type, 'markov_chain');
    const confidence = Math.round(Math.min(15, Math.abs(probability - 0.5) * 30 + 8) * weight);
    if (Math.abs(probability - 0.5) > 0.1) {
        return {
            detected: true, type: 'markov_transition', prediction, confidence,
            probability: (probability * 100).toFixed(1) + '%',
            name: `Markov Chain (${currentResult} → ${prediction}: ${(probability * 100).toFixed(0)}%)`,
            patternId: 'markov_chain', analysis: { transitions, currentResult, probability }
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
            detected: true, type: 'strong_drift', prediction,
            confidence: Math.round(14 * weight),
            name: `MA Drift (MA5:${ma5.toFixed(1)} MA10:${ma10.toFixed(1)})`,
            patternId: 'moving_avg_drift', analysis: { ma5, ma10, shortTermDrift }
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
            detected: true, type: 'mean_reversion', prediction,
            confidence: Math.round(Math.min(15, Math.abs(deviation) * 5 + 7) * weight),
            name: `Áp Lực Tổng (Avg:${avgSum.toFixed(1)} vs Mean:${EXPECTED_MEAN})`,
            patternId: 'sum_pressure', analysis: { avgSum, deviation }
        };
    }
    return { detected: false };
}

// Volatility
function analyzeVolatility(data, type) {
    if (data.length < 10) return { detected: false };
    const sums = data.slice(0, 10).map(d => d.Tong);
    const changes = [];
    for (let i = 0; i < sums.length - 1; i++) changes.push(Math.abs(sums[i] - sums[i + 1]));
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    const maxChange = Math.max(...changes);
    const weight = getPatternWeight(type, 'volatility');
    if (avgChange > 4 && maxChange >= 7) {
        const lastResult = data[0].Ket_qua;
        return {
            detected: true, type: 'high_volatility',
            prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(12 * weight),
            name: `Biến Động Cao (Avg:${avgChange.toFixed(1)}, Max:${maxChange})`,
            patternId: 'volatility', analysis: { avgChange, maxChange }
        };
    }
    return { detected: false };
}

// Day Gay (dây gãy)
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
        return { detected: true, type: 'day_gay_2thang_1len', prediction: 'Xỉu',
            confidence: Math.round(14 * weight), name: 'Dây Gãy (2 thẳng + 1 lên → Xỉu)', patternId: 'day_gay' };
    }
    if (sameCount === 2 && downCount === 1) {
        return { detected: true, type: 'day_gay_2thang_1xuong', prediction: 'Tài',
            confidence: Math.round(14 * weight), name: 'Dây Gãy (2 thẳng + 1 xuống → Tài)', patternId: 'day_gay' };
    }
    return { detected: false };
}

// Fibonacci Pattern
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
            detected: true, type: 'fibonacci_dominant', prediction: dominant,
            confidence: Math.round(11 * weight),
            name: `Fibonacci (${taiAtFib}T-${xiuAtFib}X tại vị trí Fib)`, patternId: 'fibonacci'
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
                detected: true, type: 'break_after_streak',
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: Math.round(15 * weight),
                name: `Cầu Liên Tục ${streakLength} (Biến động → Bẻ)`, patternId: 'break_pattern'
            };
        }
    }
    return { detected: false };
}

// Smart Bet (xu hướng cực)
function analyzeSmartBet(results, type) {
    if (results.length < 10) return { detected: false };
    const weight = getPatternWeight(type, 'smart_bet');
    const last10 = results.slice(0, 10);
    const last5 = results.slice(0, 5);
    const prev5 = results.slice(5, 10);
    const taiLast5 = last5.filter(r => r === 'Tài').length;
    const taiPrev5 = prev5.filter(r => r === 'Tài').length;
    const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
    if (trendChanging) {
        const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
        return {
            detected: true, trendChange: true,
            prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(13 * weight),
            name: `Đảo Xu Hướng (${taiLast5}T vs ${taiPrev5}T)`, patternId: 'smart_bet'
        };
    }
    const taiLast10 = last10.filter(r => r === 'Tài').length;
    if (taiLast10 >= 8 || taiLast10 <= 2) {
        const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
        return {
            detected: true, extreme: true,
            prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.round(12 * weight),
            name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X trong 10 phiên)`, patternId: 'smart_bet'
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
// MAIN PREDICTION ENGINE
// ======================================================
function calculateAdvancedPrediction(data, type) {
    const last50 = data.slice(0, 50);
    const results = last50.map(d => d.Ket_qua);
    
    initializePatternStats(type);
    
    let predictions = [];
    let factors = [];
    let allPatterns = [];
    
    // Check all patterns
    const patterns = [
        { fn: analyzeCauBet, priority: 10 },
        { fn: analyzeCauDao11, priority: 9 },
        { fn: detectCyclePattern, priority: 7 },
        { fn: analyzeEdgeCases, priority: 5 },
        { fn: analyzeMarkovChain, priority: 12 },
        { fn: analyzeMovingAverageDrift, priority: 11 },
        { fn: analyzeSumPressure, priority: 11 },
        { fn: analyzeVolatility, priority: 10 },
        { fn: analyzeDayGay, priority: 13 },
        { fn: analyzeFibonacciPattern, priority: 8 },
        { fn: analyzeBreakPattern, priority: 12 },
        { fn: analyzeSmartBet, priority: 9 }
    ];
    
    patterns.forEach(({ fn, priority }) => {
        const result = fn.name === 'analyzeBreakPattern' || fn.name === 'analyzeMarkovChain' 
            ? fn(results, last50, type) 
            : fn.name === 'detectCyclePattern' || fn.name === 'analyzeCauBet' || 
              fn.name === 'analyzeCauDao11' || fn.name === 'analyzeSmartBet'
                ? fn(results, type)
                : fn(last50, type);
        
        if (result.detected) {
            predictions.push({ 
                prediction: result.prediction, 
                confidence: result.confidence, 
                priority, 
                name: result.name 
            });
            factors.push(result.name);
            allPatterns.push(result);
        }
    });
    
    // Distribution analysis
    const distribution = analyzeDistribution(last50, type);
    if (distribution.imbalance > 0.2) {
        const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
        const weight = getPatternWeight(type, 'distribution');
        predictions.push({ 
            prediction: minority, confidence: Math.round(6 * weight), 
            priority: 5, name: 'Phân bố lệch' 
        });
        factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
    }
    
    // Cầu tự nhiên fallback
    if (predictions.length === 0) {
        const last10 = results.slice(0, Math.min(10, results.length));
        const taiCount = last10.filter(r => r === 'Tài').length;
        const pred = taiCount > last10.length - taiCount ? 'Tài' : 'Xỉu';
        const weight = getPatternWeight(type, 'cau_tu_nhien');
        predictions.push({ prediction: pred, confidence: Math.round(5 * weight), priority: 1, name: 'Cầu Tự Nhiên' });
        factors.push('Cầu Tự Nhiên');
    }
    
    // Sort by priority and confidence
    predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
    
    // Calculate final prediction
    const taiVotes = predictions.filter(p => p.prediction === 'Tài');
    const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
    
    const taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
    const xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
    
    let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    
    // Calculate confidence
    let baseConfidence = 50;
    const topPredictions = predictions.slice(0, 3);
    topPredictions.forEach(p => {
        if (p.prediction === finalPrediction) baseConfidence += p.confidence;
    });
    
    const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
    baseConfidence += Math.round(agreementRatio * 10);
    
    const adaptiveBoost = getAdaptiveConfidenceBoost(type);
    baseConfidence += adaptiveBoost;
    
    const randomAdjust = (Math.random() * 4) - 2;
    let finalConfidence = Math.round(baseConfidence + randomAdjust);
    finalConfidence = Math.max(50, Math.min(85, finalConfidence));
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        factors,
        allPatterns,
        detailedAnalysis: {
            totalPatterns: predictions.length,
            taiVotes: taiVotes.length,
            xiuVotes: xiuVotes.length,
            topPattern: predictions[0]?.name || 'N/A',
            distribution
        }
    };
}

// ======================================================
// BUILD WIN/LOSS TABLE
// ======================================================
function buildWinLossTable(history) {
    let winLossTable = [];
    let recentHistory = history.slice(-10);
    
    for (let i = 0; i < recentHistory.length; i++) {
        let h = recentHistory[i];
        let prevHistory = history.slice(0, history.length - recentHistory.length + i);
        let predict = calculateAdvancedPrediction(prevHistory, 'b52');
        
        let danhGia = "chưa xác định";
        if (predict.prediction && h.Ket_qua) {
            if (predict.prediction === h.Ket_qua) danhGia = "thang";
            else danhGia = "thua";
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
    for (let i = winLossTable.length - 1; i >= 0; i--) {
        if (winLossTable[i].danh_gia === "thua") consecutiveLosses++;
        else break;
    }
    return consecutiveLosses;
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        const rawData = await fetchData();
        if (!rawData) throw new Error("No data from API");
        
        const dataArray = rawData.data || rawData || [];
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        
        if (history.length < 10) {
            return res.json({
                id: "@vuaoccac",
                phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
                phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
                stats: { consecutiveLosses: 0 },
                win_loss_table: [],
                full_history_count: 0
            });
        }
        
        let latest = history[history.length - 1];
        let predict = calculateAdvancedPrediction(history, 'b52');
        let winLossTable = buildWinLossTable(history);
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
            full_history_count: history.length
        });
    } catch (err) {
        console.error("Error:", err.message);
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
        if (!rawData) throw new Error("No data from API");
        
        const dataArray = rawData.data || rawData || [];
        let history = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        
        if (history.length < 10) {
            return res.json({
                id: "@vuaoccac",
                phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
                phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
                stats: { consecutiveLosses: 0 },
                win_loss_table: [],
                full_history_count:
