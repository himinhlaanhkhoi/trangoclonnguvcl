const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500;
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let predictionHistory = [];
let lastProcessedPhien = null;
let sessionsStore = [];
let isReady = false;
let predictor = null;

// ==================== GOD PREDICTOR ULTIMATE V2 ====================

class GodPredictorUltimateV2 {
    constructor(data) {
        this.raw = data;
        this.data = this.preprocessData(data);
        this.weights = this.initWeights();
        this.accuracyMemory = {};
        this.predictionHistory = [];
        this.errorPatterns = {};
        this.successPatterns = {};
        this.consecutiveErrors = 0;
        this.initializeAccuracy();
        this.learnFromHistory();
    }

    preprocessData(data) {
        return data.map((item, idx, arr) => {
            let streak = 1;
            if (idx > 0 && arr[idx-1].Ket_qua === item.Ket_qua) {
                streak = arr[idx-1].streak + 1;
            }
            
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const sum = item.Tong;
            const sortedDice = [...dice].sort((a, b) => a - b);
            
            return {
                result: item.Ket_qua,
                resultNum: item.Ket_qua === "Tài" ? 1 : 0,
                total: sum,
                streak: streak,
                dice: dice,
                sortedDice: sortedDice,
                phien: item.Phien,
                
                hasDouble: new Set(dice).size <= 2 ? 1 : 0,
                hasTriple: new Set(dice).size === 1 ? 1 : 0,
                isEven: sum % 2 === 0 ? 1 : 0,
                diceSum: sum,
                diceProduct: dice[0] * dice[1] * dice[2],
                maxDice: Math.max(...dice),
                minDice: Math.min(...dice),
                midDice: sortedDice[1],
                diffMaxMin: Math.max(...dice) - Math.min(...dice),
                diceStd: this.calculateStd(dice),
                totalCategory: sum <= 7 ? 0 : (sum <= 13 ? 1 : 2),
                totalMod3: sum % 3,
                totalChange: idx > 0 ? sum - arr[idx-1].Tong : 0,
                totalChangeAbs: idx > 0 ? Math.abs(sum - arr[idx-1].Tong) : 0,
                sameResult: idx > 0 ? (item.Ket_qua === arr[idx-1].Ket_qua ? 1 : 0) : 0,
                isConsecutive: sortedDice[2] - sortedDice[0] === 2 && new Set(dice).size === 3 ? 1 : 0,
                hasOneAndSix: dice.includes(1) && dice.includes(6) ? 1 : 0,
                uniqueDiceCount: new Set(dice).size,
                last3Tai: idx >= 2 ? arr.slice(idx-2, idx+1).filter(d => d.Ket_qua === "Tài").length : 0,
                last5Tai: idx >= 4 ? arr.slice(idx-4, idx+1).filter(d => d.Ket_qua === "Tài").length : 0,
                last10Tai: idx >= 9 ? arr.slice(idx-9, idx+1).filter(d => d.Ket_qua === "Tài").length : 0
            };
        });
    }

    calculateStd(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    learnFromHistory() {
        for (let i = 50; i < this.data.length - 1; i++) {
            const features = this.extractFeatures(i);
            const actual = this.data[i + 1].result;
            const patternKey = this.createPatternKey(features);
            
            if (!this.successPatterns[patternKey]) {
                this.successPatterns[patternKey] = { 'Tài': 0, 'Xỉu': 0, total: 0 };
            }
            this.successPatterns[patternKey][actual]++;
            this.successPatterns[patternKey].total++;
        }
    }

    extractFeatures(index) {
        const d = this.data[index];
        return {
            total: d.total,
            streak: d.streak,
            hasDouble: d.hasDouble,
            hasTriple: d.hasTriple,
            isEven: d.isEven,
            diffMaxMin: d.diffMaxMin,
            uniqueDiceCount: d.uniqueDiceCount,
            totalCategory: d.totalCategory,
            last3Tai: d.last3Tai,
            last5Tai: d.last5Tai,
            result: d.result,
            totalChange: d.totalChange,
            sameResult: d.sameResult
        };
    }

    createPatternKey(features) {
        return `${features.total}|${features.streak}|${features.hasDouble}|${features.hasTriple}|${features.totalCategory}|${features.uniqueDiceCount}|${features.result}`;
    }

    deepPatternPredict() {
        if (this.data.length < 50) return null;
        
        const currentFeatures = this.extractFeatures(this.data.length - 1);
        const patternKey = this.createPatternKey(currentFeatures);
        const similarPatterns = [];
        const searchRadius = 0.3;
        
        for (const [key, stats] of Object.entries(this.successPatterns)) {
            const similarity = this.calculatePatternSimilarity(currentFeatures, key);
            if (similarity > searchRadius && stats.total >= 3) {
                similarPatterns.push({
                    key: key,
                    similarity: similarity,
                    stats: stats,
                    accuracy: Math.max(stats['Tài'], stats['Xỉu']) / stats.total
                });
            }
        }
        
        if (similarPatterns.length === 0) return null;
        
        similarPatterns.sort((a, b) => {
            const scoreA = a.similarity * 0.6 + a.accuracy * 0.4;
            const scoreB = b.similarity * 0.6 + b.accuracy * 0.4;
            return scoreB - scoreA;
        });
        
        const topPatterns = similarPatterns.slice(0, 10);
        const votes = { 'Tài': 0, 'Xỉu': 0 };
        
        topPatterns.forEach(pattern => {
            const weight = pattern.similarity * pattern.accuracy * pattern.stats.total;
            votes['Tài'] += pattern.stats['Tài'] * weight;
            votes['Xỉu'] += pattern.stats['Xỉu'] * weight;
        });
        
        const pred = votes['Tài'] > votes['Xỉu'] ? 'Tài' : 'Xỉu';
        const conf = Math.min(95, (Math.max(votes['Tài'], votes['Xỉu']) / (votes['Tài'] + votes['Xỉu'])) * 100);
        
        return { pred: pred, conf: conf, name: 'deep_pattern', reason: `Deep learning: ${topPatterns.length} patterns` };
    }

    calculatePatternSimilarity(features, patternKey) {
        try {
            const parts = patternKey.split('|');
            const patternFeatures = {
                total: parseInt(parts[0]),
                streak: parseInt(parts[1]),
                hasDouble: parseInt(parts[2]),
                hasTriple: parseInt(parts[3]),
                totalCategory: parseInt(parts[4]),
                uniqueDiceCount: parseInt(parts[5]),
                result: parts[6]
            };
            
            let similarity = 0;
            if (Math.abs(features.total - patternFeatures.total) <= 2) similarity += 0.2;
            if (features.streak === patternFeatures.streak) similarity += 0.15;
            if (features.hasDouble === patternFeatures.hasDouble) similarity += 0.15;
            if (features.hasTriple === patternFeatures.hasTriple) similarity += 0.2;
            if (features.totalCategory === patternFeatures.totalCategory) similarity += 0.1;
            if (features.uniqueDiceCount === patternFeatures.uniqueDiceCount) similarity += 0.1;
            if (features.result === patternFeatures.result) similarity += 0.1;
            return similarity;
        } catch (e) {
            return 0;
        }
    }

    smartTrendAnalysis() {
        if (this.data.length < 30) return null;
        
        const windows = [5, 10, 15, 20, 30];
        const trends = [];
        
        windows.forEach(window => {
            if (this.data.length >= window) {
                const slice = this.data.slice(-window);
                const taiCount = slice.filter(d => d.result === 'Tài').length;
                const ratio = taiCount / window;
                
                const firstHalf = slice.slice(0, Math.floor(window/2));
                const secondHalf = slice.slice(Math.floor(window/2));
                const firstTai = firstHalf.filter(d => d.result === 'Tài').length / firstHalf.length;
                const secondTai = secondHalf.filter(d => d.result === 'Tài').length / secondHalf.length;
                const trendDirection = secondTai - firstTai;
                
                trends.push({ window: window, ratio: ratio, trend: trendDirection, strength: Math.abs(trendDirection) });
            }
        });
        
        const avgRatio = trends.reduce((sum, t) => sum + t.ratio, 0) / trends.length;
        const avgTrend = trends.reduce((sum, t) => sum + t.trend, 0) / trends.length;
        
        if (Math.abs(avgTrend) > 0.1) {
            const pred = avgTrend > 0 ? 'Tài' : 'Xỉu';
            const conf = Math.min(80, 55 + Math.abs(avgTrend) * 100);
            return { pred: pred, conf: conf, name: 'smart_trend', reason: `Xu hướng ${avgTrend > 0 ? 'tăng' : 'giảm'}` };
        }
        
        if (avgRatio > 0.6) return { pred: 'Xỉu', conf: 65, name: 'smart_trend', reason: 'Mean reversion: Tài quá nhiều' };
        if (avgRatio < 0.4) return { pred: 'Tài', conf: 65, name: 'smart_trend', reason: 'Mean reversion: Xỉu quá nhiều' };
        return null;
    }

    advancedCycleDetection() {
        if (this.data.length < 40) return null;
        
        const results = this.data.map(d => d.resultNum);
        const cycles = [];
        
        for (let cycle = 2; cycle <= 15; cycle++) {
            const matches = [];
            for (let i = cycle; i < results.length - cycle; i++) {
                const pattern1 = results.slice(i - cycle, i);
                const pattern2 = results.slice(i, i + cycle);
                let matchCount = 0;
                for (let j = 0; j < cycle; j++) {
                    if (pattern1[j] === pattern2[j]) matchCount++;
                }
                const similarity = matchCount / cycle;
                if (similarity > 0.7) matches.push({ position: i, similarity: similarity });
            }
            
            if (matches.length >= 3) {
                const avgSimilarity = matches.reduce((sum, m) => sum + m.similarity, 0) / matches.length;
                cycles.push({ cycle: cycle, matches: matches.length, avgSimilarity: avgSimilarity, score: matches.length * avgSimilarity });
            }
        }
        
        if (cycles.length === 0) return null;
        cycles.sort((a, b) => b.score - a.score);
        const bestCycle = cycles[0];
        const lastCycleStart = results.length - bestCycle.cycle;
        const predictedPattern = results.slice(lastCycleStart);
        const nextPred = predictedPattern[0];
        
        return {
            pred: nextPred === 1 ? 'Tài' : 'Xỉu',
            conf: Math.min(75, 50 + bestCycle.avgSimilarity * 30),
            name: 'advanced_cycle',
            reason: `Chu kỳ ${bestCycle.cycle} phiên`
        };
    }

    totalScoreAnalysis() {
        if (this.data.length < 20) return null;
        
        const last20 = this.data.slice(-20);
        const totals = last20.map(d => d.total);
        const avgTotal = totals.reduce((a, b) => a + b, 0) / 20;
        const lastTotal = this.data[this.data.length - 1].total;
        
        if (lastTotal <= 5) return { pred: 'Tài', conf: 75, name: 'total_score', reason: `Tổng rất thấp (${lastTotal})` };
        if (lastTotal >= 16) return { pred: 'Xỉu', conf: 75, name: 'total_score', reason: `Tổng rất cao (${lastTotal})` };
        
        const last10Totals = totals.slice(-10);
        const first5Avg = last10Totals.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        const last5Avg = last10Totals.slice(5).reduce((a, b) => a + b, 0) / 5;
        const totalTrend = last5Avg - first5Avg;
        
        if (Math.abs(totalTrend) > 1) {
            const pred = totalTrend > 0 ? 'Tài' : 'Xỉu';
            const conf = Math.min(70, 55 + Math.abs(totalTrend) * 10);
            return { pred: pred, conf: conf, name: 'total_score', reason: `Xu hướng tổng ${totalTrend > 0 ? 'tăng' : 'giảm'}` };
        }
        return null;
    }

    advancedDiceAnalysis() {
        if (this.data.length < 10) return null;
        
        const last = this.data[this.data.length - 1];
        
        if (last.hasTriple) {
            const face = last.dice[0];
            if (face === 1) return { pred: 'Xỉu', conf: 95, name: 'dice_analysis', reason: 'Bộ 3 mặt 1' };
            if (face === 6) return { pred: 'Tài', conf: 92, name: 'dice_analysis', reason: 'Bộ 3 mặt 6' };
            if (face >= 4) return { pred: 'Tài', conf: 80, name: 'dice_analysis', reason: `Bộ 3 mặt ${face}` };
            return { pred: 'Xỉu', conf: 80, name: 'dice_analysis', reason: `Bộ 3 mặt ${face}` };
        }
        
        if (last.hasDouble) {
            const counts = {};
            last.dice.forEach(d => counts[d] = (counts[d] || 0) + 1);
            const doubleFace = Object.keys(counts).find(k => counts[k] === 2);
            if (doubleFace) {
                const face = parseInt(doubleFace);
                if (face === 1) return { pred: 'Xỉu', conf: 82, name: 'dice_analysis', reason: 'Đôi 1' };
                if (face === 6) return { pred: 'Tài', conf: 78, name: 'dice_analysis', reason: 'Đôi 6' };
                if (face >= 5) return { pred: 'Tài', conf: 68, name: 'dice_analysis', reason: `Đôi ${face}` };
                if (face <= 2) return { pred: 'Xỉu', conf: 65, name: 'dice_analysis', reason: `Đôi ${face}` };
            }
        }
        
        const sorted = [...last.dice].sort((a, b) => a - b);
        if (sorted[2] - sorted[0] === 2 && new Set(last.dice).size === 3) {
            if (sorted[0] >= 4) return { pred: 'Tài', conf: 67, name: 'dice_analysis', reason: 'Dãy liên tiếp cao' };
            if (sorted[2] <= 3) return { pred: 'Xỉu', conf: 62, name: 'dice_analysis', reason: 'Dãy liên tiếp thấp' };
        }
        return null;
    }

    markovGeneric(order, name) {
        if (this.data.length < order + 1) return null;
        const model = {};
        for (let i = 0; i < this.data.length - order; i++) {
            const state = this.data.slice(i, i + order).map(d => d.result).join(',');
            const next = this.data[i + order].result;
            if (!model[state]) model[state] = { 'Tài': 0, 'Xỉu': 0 };
            model[state][next]++;
        }
        const currentState = this.data.slice(-order).map(d => d.result).join(',');
        if (model[currentState]) {
            const counts = model[currentState];
            const total = counts['Tài'] + counts['Xỉu'];
            const pred = counts['Tài'] > counts['Xỉu'] ? 'Tài' : 'Xỉu';
            const conf = (Math.max(counts['Tài'], counts['Xỉu']) / total) * 100;
            return { pred: pred, conf: conf, name: name, reason: `Markov bậc ${order}` };
        }
        return null;
    }

    pattern_matching() {
        if (this.data.length < 50) return null;
        const last10 = this.data.slice(-10).map(d => d.result).join(',');
        let bestMatch = null, bestCount = 0;
        for (let i = 0; i < this.data.length - 11; i++) {
            const window = this.data.slice(i, i + 10).map(d => d.result).join(',');
            if (window === last10 && i + 10 < this.data.length) {
                const next = this.data[i + 10].result;
                if (bestMatch === null) { bestMatch = next; bestCount = 1; }
                else if (next === bestMatch) bestCount++;
            }
        }
        if (bestCount >= 2) return { pred: bestMatch, conf: 75, name: 'pattern_matching', reason: `Khớp ${bestCount} lần` };
        return null;
    }

    frequency_20() {
        if (this.data.length < 20) return null;
        const taiCount = this.data.slice(-20).filter(d => d.result === 'Tài').length;
        if (taiCount >= 14) return { pred: 'Xỉu', conf: 65, name: 'frequency_20', reason: `${taiCount}/20 Tài` };
        if (taiCount <= 6) return { pred: 'Tài', conf: 65, name: 'frequency_20', reason: `${taiCount}/20 Tài` };
        return null;
    }

    mean_reversion() {
        if (this.data.length < 20) return null;
        const totals = this.data.slice(-20).map(d => d.total);
        const mean = totals.reduce((a, b) => a + b, 0) / 20;
        const lastTotal = this.data[this.data.length - 1].total;
        if (lastTotal > mean + 2) return { pred: 'Xỉu', conf: 65, name: 'mean_reversion', reason: 'Hồi quy trung bình' };
        if (lastTotal < mean - 2) return { pred: 'Tài', conf: 65, name: 'mean_reversion', reason: 'Hồi quy trung bình' };
        return null;
    }

    initWeights() {
        const weights = {
            deep_pattern: 1.8, smart_trend: 1.5, advanced_cycle: 1.3, dice_analysis: 1.5,
            total_score: 1.2, markov_3: 1.4, markov_4: 1.3, pattern_matching: 1.5,
            frequency_20: 1.0, mean_reversion: 1.0
        };
        return weights;
    }

    initializeAccuracy() {
        Object.keys(this.weights).forEach(name => {
            this.accuracyMemory[name] = { correct: 0, total: 0, accuracy: 0.5 };
        });
    }

    selfCorrection(currentPred) {
        if (this.consecutiveErrors >= 2) {
            const shouldReverse = Math.random() < 0.7;
            if (shouldReverse) {
                const reversed = currentPred === 'Tài' ? 'Xỉu' : 'Tài';
                return { pred: reversed, conf: 60, name: 'self_correction', reason: `Tự sửa lỗi sau ${this.consecutiveErrors} lần sai`, isCorrected: true };
            }
        }
        return null;
    }

    predict() {
        const algorithms = [
            this.deepPatternPredict.bind(this),
            this.smartTrendAnalysis.bind(this),
            this.advancedCycleDetection.bind(this),
            this.advancedDiceAnalysis.bind(this),
            this.totalScoreAnalysis.bind(this),
            this.markovGeneric.bind(this, 3, 'markov_3'),
            this.markovGeneric.bind(this, 4, 'markov_4'),
            this.pattern_matching.bind(this),
            this.frequency_20.bind(this),
            this.mean_reversion.bind(this)
        ];
        
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        let activeAlgorithms = 0;
        
        algorithms.forEach(algo => {
            try {
                const result = algo();
                if (result && result.conf > 0) {
                    const weight = this.weights[result.name] || 1.0;
                    scores[result.pred] += result.conf * weight;
                    activeAlgorithms++;
                }
            } catch (e) {}
        });
        
        if (this.data.length >= 20) {
            const last20 = this.data.slice(-20);
            const taiCount = last20.filter(d => d.result === 'Tài').length;
            if (taiCount >= 16) scores['Xỉu'] += 40;
            else if (taiCount <= 4) scores['Tài'] += 40;
        }
        
        const last = this.data[this.data.length - 1];
        if (last.hasTriple) {
            if (last.dice[0] === 1) scores['Xỉu'] += 60;
            else if (last.dice[0] === 6) scores['Tài'] += 60;
        }
        
        let finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        const totalScore = scores['Tài'] + scores['Xỉu'];
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        
        const correction = this.selfCorrection(finalPred);
        if (correction && correction.isCorrected) {
            finalPred = correction.pred;
            confidence = Math.max(confidence * 0.9, 60);
        }
        
        confidence = Math.min(99, Math.max(55, confidence));
        
        this.predictionHistory.push({ pred: finalPred, conf: confidence, timestamp: new Date() });
        
        return { prediction: finalPred, confidence: Math.round(confidence), activeAlgorithms: activeAlgorithms };
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 1000);
        this.data = this.preprocessData(this.raw);
        this.learnFromHistory();
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadAllData() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: ${sessionsStore.length} phiên`);
            
            if (sessionsStore.length >= 30) {
                isReady = true;
                predictor = new GodPredictorUltimateV2(sessionsStore);
            }
        }
    } catch (error) { console.error('❌ Lỗi load sessions:', error.message); }
    
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.predictionHistory || [];
            lastProcessedPhien = parsed.lastProcessedPhien || null;
            console.log(`✅ Đã tải lịch sử dự đoán: ${predictionHistory.length} phiên`);
        }
    } catch (error) { console.error('❌ Lỗi load dự đoán:', error.message); }
}

function saveAllData() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsStore, null, 2));
    } catch (error) { console.error('❌ Lỗi save sessions:', error.message); }
    
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({ predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString() }, null, 2));
    } catch (error) { console.error('❌ Lỗi save dự đoán:', error.message); }
}

// ==================== API DATA FETCHING ====================

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

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5, { timeout: 15000, params: { limit: FETCH_PER_REQUEST } });
        return transformApiData(response.data);
    } catch (error) {
        console.error('❌ [MD5] Fetch error:', error.message);
        return null;
    }
}

// ==================== UPDATE SESSIONS ====================

function updateSessions(newData) {
    if (!newData || newData.length === 0) return 0;
    
    const existingMap = new Map();
    sessionsStore.forEach(s => existingMap.set(s.Phien, s));
    
    let addedCount = 0;
    for (const s of newData) {
        if (!existingMap.has(s.Phien)) {
            sessionsStore.push(s);
            addedCount++;
        }
    }
    
    sessionsStore.sort((a, b) => b.Phien - a.Phien);
    if (sessionsStore.length > 1000) {
        sessionsStore = sessionsStore.slice(0, 1000);
    }
    return addedCount;
}

async function fetchAndUpdate() {
    const data = await fetchDataMd5();
    if (!data) return false;
    
    const addedCount = updateSessions(data);
    if (addedCount > 0) saveAllData();
    
    if (!isReady && sessionsStore.length >= 30) {
        isReady = true;
        predictor = new GodPredictorUltimateV2(sessionsStore);
        console.log(`🎉 [MD5] ĐÃ SẴN SÀNG!`);
    } else if (isReady && predictor && addedCount > 0) {
        predictor.updateWithNewData(sessionsStore);
    }
    return true;
}

// ==================== VERIFY & RECORD ====================

function verifyAndRecord() {
    if (!predictor) return;
    
    let updated = false;
    
    for (let i = 0; i < predictionHistory.length; i++) {
        const record = predictionHistory[i];
        if (record.da_kiem_tra) continue;
        
        const actualResult = sessionsStore.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            record.ket_qua_du_doan = record.du_doan === actualResult.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            updated = true;
        }
    }
    
    if (predictionHistory.length > MAX_HISTORY) {
        predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    
    if (updated) saveAllData();
}

function savePredictionToHistory(phienTruocDo, phienHienTai, prediction, confidence, latestData) {
    const record = {
        phien_truoc_do: phienTruocDo.toString(),
        phien_hien_tai: phienHienTai.toString(),
        du_doan: prediction,
        do_tin_cay: `${confidence}%`,
        ket_qua_du_doan: '',
        ket_qua_thuc_te: '',
        da_kiem_tra: false,
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
        id: 'love trang',
        timestamp: new Date().toISOString()
    };
    
    predictionHistory.unshift(record);
    if (predictionHistory.length > MAX_HISTORY) {
        predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    return record;
}

// ==================== AUTO PROCESS ====================

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU MD5...');
    console.log('═══════════════════════════════════════════════════');
    
    while (true) {
        await fetchAndUpdate();
        await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
    }
}

async function autoProcess() {
    if (!isReady || !predictor) return;
    
    try {
        await fetchAndUpdate();
        verifyAndRecord();
        
        const latestSessions = sessionsStore;
        if (latestSessions.length > 0 && predictor) {
            const latestPhien = latestSessions[0].Phien;
            const nextPhien = latestPhien + 1;
            
            if (lastProcessedPhien !== nextPhien) {
                const result = predictor.predict();
                savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                lastProcessedPhien = nextPhien;
                console.log(`[DỰ ĐOÁN] 👑 MD5 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeAlgorithms} thuật toán`);
                saveAllData();
            }
        }
    } catch (error) {
        console.error('[Auto] ❌ Error:', error.message);
    }
}

// ==================== STARTUP ====================

async function startup() {
    loadAllData();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('👑 GOD PREDICTOR ULTIMATE V2 - MD5 TÀI XỈU');
    console.log(`📋 Lưu tối đa ${MAX_HISTORY} phiên`);
    console.log('═══════════════════════════════════════════════════');
    
    fetchLoop();
    setTimeout(() => {
        setInterval(autoProcess, AUTO_SAVE_INTERVAL);
    }, 5000);
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('t.me/CuTools');
});

app.get('/status', (req, res) => {
    res.json({
        md5: { sessions: sessionsStore.length, ready: isReady }
    });
});

app.get('/lc79-md5', async (req, res) => {
    try {
        if (!isReady || !predictor) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.length}/30` });
        }
        
        await fetchAndUpdate();
        verifyAndRecord();
        
        const latestSessions = sessionsStore;
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictor.predict();
        
        const record = savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
        
        res.json({
            phien_truoc_do: record.phien_truoc_do,
            phien_hien_tai: record.phien_hien_tai,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            id: 'love trang'
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        lich_su_du_doan: predictionHistory,
        tong_so: predictionHistory.length
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 GOD PREDICTOR ULTIMATE V2 - MD5 TÀI XỈU');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC THUẬT TOÁN DEEP LEARNING:');
    console.log('   • Deep Pattern Learning - Học từ hàng ngàn patterns');
    console.log('   • Smart Trend Analysis - Phân tích xu hướng thông minh');
    console.log('   • Advanced Cycle Detection - Phát hiện chu kỳ nâng cao');
    console.log('   • Advanced Dice Analysis - Phân tích xúc xắc chuyên sâu');
    console.log('   • Total Score Analysis - Phân tích tổng điểm');
    console.log('   • Markov Chains - Xác suất chuỗi');
    console.log('   • Pattern Matching - So khớp mẫu');
    console.log('   • Mean Reversion - Hồi quy trung bình');
    console.log('   • Self-Correction - Tự động sửa lỗi');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
