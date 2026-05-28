const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunwin-ke-u8wn.onrender.com/sun";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let performanceHistory = [];
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || 0, s.Xuc_xac_2 || 0, s.Xuc_xac_3 || 0]); }
function calculateStdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
}

// ============ PATTERN DATABASE ============
const PATTERN_DATABASE = {
    '1-1': ['tx', 'xt'], 'bệt': ['tt', 'xx'],
    '2-2': ['ttxx', 'xxtt'], '3-3': ['tttxxx', 'xxxttt'],
    '4-4': ['ttttxxxx', 'xxxxtttt'], '5-5': ['tttttxxxxx', 'xxxxxttttt'],
    '1-2-1': ['txxxt', 'xtttx'], '2-1-2': ['ttxtt', 'xxtxx'],
    '1-2-3': ['txxttt', 'xttxxx'], '3-2-1': ['tttxtx', 'xxxtxt'],
    'zigzag': ['txt', 'xtx'], 'double_zigzag': ['txtxt', 'xtxtx'],
    'triple_zigzag': ['txtxtxt', 'xtxtxtx'],
    'wave_2': ['ttxx', 'xxtt'], 'wave_3': ['tttxxx', 'xxxttt'],
    'reverse_1': ['ttx', 'xxt'], 'reverse_2': ['ttxx', 'xxtt'],
    'symmetry_1': ['txt', 'xtx'], 'symmetry_2': ['ttxxtt', 'xxttxx'],
    'repeat_1': ['tt', 'xx'], 'repeat_2': ['tttt', 'xxxx'],
    'alternate_1': ['txtx', 'xtxt'], 'alternate_2': ['txtxtx', 'xtxtxt'],
    'mixed_1': ['ttxtxx', 'xxtxtt'], 'mixed_2': ['txxxttx', 'xtttxxt'],
    'triangle': ['txx', 'xtt'], 'square': ['ttxx', 'xxtt'],
    'spiral_1': ['txxxt', 'xtttx'], 'spiral_2': ['ttxxxtt', 'xxtttxx'],
    'branch_1': ['ttxtx', 'xxtxt'], 'branch_2': ['ttxxttx', 'xxttxx'],
    'interlace_1': ['txtxt', 'xtxtx'], 'interlace_2': ['ttxxtt', 'xxttxx'],
};

// ============ ULTIMATE AI SYSTEM (KHÔNG RÚT GỌN) ============
class UltimateAI {
    constructor() {
        this.history = [];
        this.predictions = [];
        this.accuracy = { total: 0, correct: 0 };
        this.algorithmWeights = {};
        this.algorithmPerformance = {};
        this.initAlgorithms();
    }

    initAlgorithms() {
        const algoNames = [
            'markov', 'frequency', 'cycle', 'trend', 'streak', 'bayes',
            'fibonacci', 'pair', 'rsi', 'bollinger', 'macd', 'stochastic',
            'linearRegression', 'knn', 'decisionTree', 'patternMatch', 'zigzag',
            'entropy', 'meanReversion', 'ensembleVoting',
            'detect_1_1', 'detect_2_2', 'detect_3_3', 'detect_1_2_3',
            'detect_dragon', 'detect_tiger', 'detect_triangle', 'detect_zigzag',
            'detect_4_4', 'detect_5_5',
            'diceTriple', 'diceSum', 'dicePair', 'diceHighLow', 'diceOddEven',
            'dicePrime', 'diceTransition', 'diceVariance',
            'scoreExtreme', 'scoreMA', 'scoreBollinger', 'scoreRSI', 'scoreMomentum',
            'trendShort', 'trendLong', 'switchRate', 'cycleAnalysis', 'entropyAnalysis',
            'pattern3', 'pattern4', 'pattern5', 'pattern6', 'pattern7', 'pattern8',
            'knnPattern', 'bayesianPattern',
            'markov2', 'markov3', 'markov5',
            'allTai', 'allXiu', 'alternateRecent', 'scoreRecent', 'diceRecent',
            'gap', 'fibonacciPosition',
            'meanReversion2', 'linearRegression2', 'decisionTree2', 'ensembleVoting2',
            'superBietKep', 'superDiceAll', 'superTrendAll', 'superPatternAll',
            'superCauAll', 'superRongHo', 'superScoreAll', 'superFinalAdjust',
            'ultraPattern', 'quantumAI', 'deepTrend', 'smartBridge',
            'volatilityPred', 'patternFusion', 'realtimeAdaptive',
            'cauBet', 'cauDao11', 'cau22', 'cau33', 'cau123', 'cau321',
            'rongLayer', 'hoLayer', 'doiXung', 'tamGiac',
            'scoreZoneLayer', 'cycleLayer', 'regimeLayer',
            'deepDiceAnalysis', 'deepScoreAnalysis', 'deepReversalAnalysis',
            'neuralPattern', 'probabilityEngine', 'trendReversalDetector',
            'markovXucXac123', 'bayesPredict', 'monteCarloPredict',
            'kalmanPredict', 'spectralPredict'
        ];
        
        algoNames.forEach(name => {
            this.algorithmWeights[name] = 1.0;
            this.algorithmPerformance[name] = { correct: 0, total: 0, recent: [], streak: 0 };
        });
    }

    // ============ MARKOV ============
    markov() {
        if (this.history.length < 4) return null;
        const seq = this.history.map(h => h.result === 'Tài' ? 'T' : 'X').join('');
        let best = null, bestConf = 0;
        for (let order = 2; order <= Math.min(4, seq.length - 1); order++) {
            const last = seq.slice(-order);
            const trans = {};
            for (let i = 0; i <= seq.length - order - 1; i++) {
                const pat = seq.slice(i, i + order);
                const next = seq[i + order];
                if (!trans[pat]) trans[pat] = { T: 0, X: 0 };
                trans[pat][next]++;
            }
            const possible = trans[last];
            if (!possible) continue;
            const total = possible.T + possible.X;
            if (total >= 2) {
                const probTai = possible.T / total;
                const conf = (Math.max(possible.T, possible.X) / total) * 100;
                if (conf > bestConf) { bestConf = conf; best = probTai > 0.5 ? 'T' : 'X'; }
            }
        }
        return best ? { prediction: best, confidence: bestConf, source: 'markov' } : null;
    }

    // ============ FREQUENCY ============
    frequency() {
        if (this.history.length < 5) return null;
        let wTai = 0, wXiu = 0;
        const recent = this.history.slice(-10);
        for (let i = 0; i < recent.length; i++) {
            const w = Math.pow(0.93, recent.length - 1 - i);
            if (recent[i].result === 'Tài') wTai += w; else wXiu += w;
        }
        if (wTai + wXiu === 0) return null;
        const probTai = wTai / (wTai + wXiu);
        return { prediction: probTai > 0.5 ? 'T' : 'X', confidence: Math.abs(probTai - 0.5) * 180, source: 'frequency' };
    }

    // ============ CYCLE ============
    cycle() {
        const seq = this.history.map(h => h.result === 'Tài' ? 'T' : 'X').join('');
        if (seq.length < 6) return null;
        for (let cycle = 2; cycle <= 6; cycle++) {
            if (seq.length < cycle * 2) continue;
            const lastCycle = seq.slice(-cycle);
            let matches = [];
            for (let i = 0; i <= seq.length - cycle - 1; i++) {
                if (seq.slice(i, i + cycle) === lastCycle) matches.push(i);
            }
            if (matches.length >= 2) {
                const nextIdx = matches[matches.length - 1] + cycle;
                if (nextIdx < seq.length) {
                    return { prediction: seq[nextIdx], confidence: 60 + Math.min(30, matches.length * 3), source: 'cycle' };
                }
            }
        }
        return null;
    }

    // ============ TREND ============
    trend() {
        if (this.history.length < 6) return null;
        const last6 = this.history.slice(-6).map(h => h.result === 'Tài' ? 'T' : 'X');
        const last3 = last6.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            return { prediction: last3[0] === 'T' ? 'X' : 'T', confidence: 72, source: 'trend_biet' };
        }
        let alt = true;
        for (let i = 1; i < last6.length; i++) if (last6[i] === last6[i - 1]) alt = false;
        if (alt && last6.length >= 4) {
            return { prediction: last6[last6.length - 1] === 'T' ? 'X' : 'T', confidence: 76, source: 'trend_alt' };
        }
        const tai = last6.filter(r => r === 'T').length;
        if (tai !== 3) return { prediction: tai > 3 ? 'T' : 'X', confidence: 55 + Math.abs(tai - 3) * 3, source: 'trend_imbalance' };
        return null;
    }

    // ============ STREAK ============
    streak() {
        if (this.history.length < 5) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let streakLen = 1;
        const last = results[results.length - 1];
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] === last) streakLen++; else break;
        }
        if (streakLen >= 5) return { prediction: last === 'T' ? 'X' : 'T', confidence: 70 + streakLen, source: 'streak_break' };
        if (streakLen >= 3) return { prediction: last, confidence: 55 + streakLen * 3, source: 'streak_continue' };
        if (streakLen <= 2) return { prediction: last === 'T' ? 'X' : 'T', confidence: 58, source: 'streak_short' };
        return null;
    }

    // ============ BAYES ============
    bayes() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const last3 = results.slice(-3).join('');
        let taiCount = 0, xiuCount = 0;
        for (let i = 0; i <= results.length - 4; i++) {
            if (results.slice(i, i + 3).join('') === last3) {
                if (results[i + 3] === 'T') taiCount++; else xiuCount++;
            }
        }
        if (taiCount + xiuCount < 2) return null;
        return { prediction: taiCount > xiuCount ? 'T' : 'X', confidence: 55 + Math.min(30, Math.abs(taiCount - xiuCount) * 3), source: 'bayes' };
    }

    // ============ FIBONACCI ============
    fibonacci() {
        if (this.history.length < 8) return null;
        const totals = this.history.slice(-8).map(h => h.Tong || 0);
        const diffs = [];
        for (let i = 1; i < totals.length; i++) diffs.push(totals[i] - totals[i - 1]);
        const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        let nextTotal = totals[totals.length - 1] + avgDiff;
        nextTotal = Math.min(18, Math.max(3, Math.round(nextTotal)));
        return { prediction: nextTotal > 10 ? 'T' : 'X', confidence: 55 + Math.min(25, Math.abs(avgDiff) * 2), source: 'fibonacci' };
    }

    // ============ PAIR ============
    pair() {
        if (this.history.length < 8) return null;
        const last = this.history[this.history.length - 1];
        const d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
        const lastPairs = { p12: `${d1},${d2}`, p23: `${d2},${d3}`, p13: `${d1},${d3}` };
        let tai = 0, xiu = 0;
        for (let i = 0; i < this.history.length - 1; i++) {
            const h = this.history[i];
            const hd1 = h.Xuc_xac_1 || 0, hd2 = h.Xuc_xac_2 || 0, hd3 = h.Xuc_xac_3 || 0;
            const hp12 = `${hd1},${hd2}`, hp23 = `${hd2},${hd3}`, hp13 = `${hd1},${hd3}`;
            if (hp12 === lastPairs.p12 || hp23 === lastPairs.p23 || hp13 === lastPairs.p13) {
                if (h.result === 'Tài') tai++; else xiu++;
            }
        }
        if (tai + xiu < 3) return null;
        return { prediction: tai > xiu ? 'T' : 'X', confidence: 55 + Math.min(25, Math.abs(tai - xiu) * 2), source: 'pair' };
    }

    // ============ RSI ============
    rsi() {
        if (this.history.length < 7) return null;
        const nums = this.history.slice(-7).map(h => h.result === 'Tài' ? 1 : 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < nums.length; i++) {
            const diff = nums[i] - nums[i - 1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / 7, avgLoss = losses / 7;
        let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 70) return { prediction: 'X', confidence: 68, source: 'rsi_overbought' };
        if (rsi < 30) return { prediction: 'T', confidence: 68, source: 'rsi_oversold' };
        return null;
    }

    // ============ BOLLINGER ============
    bollinger() {
        if (this.history.length < 8) return null;
        const nums = this.history.slice(-8).map(h => h.result === 'Tài' ? 1 : 0);
        const mean = nums.reduce((a, b) => a + b, 0) / 8;
        const variance = nums.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / 8;
        const std = Math.sqrt(variance);
        const last = nums[nums.length - 1];
        if (last > mean + 2 * std) return { prediction: 'X', confidence: 65, source: 'bollinger_high' };
        if (last < mean - 2 * std) return { prediction: 'T', confidence: 65, source: 'bollinger_low' };
        return null;
    }

    // ============ MACD ============
    macd() {
        if (this.history.length < 12) return null;
        const nums = this.history.map(h => h.result === 'Tài' ? 1 : 0);
        const emaShort = nums.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const emaLong = nums.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const macd = emaShort - emaLong;
        if (macd > 0.1) return { prediction: 'T', confidence: 60, source: 'macd_bullish' };
        if (macd < -0.1) return { prediction: 'X', confidence: 60, source: 'macd_bearish' };
        return null;
    }

    // ============ STOCHASTIC ============
    stochastic() {
        if (this.history.length < 7) return null;
        const nums = this.history.slice(-7).map(h => h.result === 'Tài' ? 1 : 0);
        const highest = Math.max(...nums), lowest = Math.min(...nums);
        if (highest === lowest) return null;
        const k = (nums[nums.length - 1] - lowest) / (highest - lowest) * 100;
        if (k > 80) return { prediction: 'X', confidence: 60, source: 'stochastic_overbought' };
        if (k < 20) return { prediction: 'T', confidence: 60, source: 'stochastic_oversold' };
        return null;
    }

    // ============ LINEAR REGRESSION ============
    linearRegression() {
        if (this.history.length < 8) return null;
        const y = this.history.slice(-8).map(h => h.result === 'Tài' ? 1 : 0);
        const x = Array.from({ length: 8 }, (_, i) => i);
        const n = 8;
        const sumX = x.reduce((a, b) => a + b, 0), sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0), sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
        const denom = n * sumX2 - sumX * sumX;
        if (denom === 0) return null;
        const slope = (n * sumXY - sumX * sumY) / denom;
        const pred = slope * 8 + (sumY - slope * sumX) / n;
        return { prediction: pred > 0.5 ? 'T' : 'X', confidence: 55 + Math.abs(slope) * 12, source: 'linear_regression' };
    }

    // ============ KNN ============
    knn() {
        if (this.history.length < 10) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const query = results.slice(-6);
        const distances = [];
        for (let i = 0; i < results.length - 6; i++) {
            const segment = results.slice(i, i + 6);
            let distance = 0;
            for (let j = 0; j < 6; j++) if (segment[j] !== query[j]) distance++;
            if (i + 6 < results.length) distances.push({ distance, next: results[i + 6] });
        }
        distances.sort((a, b) => a.distance - b.distance);
        if (distances.length >= 3) {
            const tCount = distances.slice(0, 5).filter(n => n.next === 'T').length;
            return { prediction: tCount > 2.5 ? 'T' : 'X', confidence: 50 + Math.abs(tCount - 2.5) * 15, source: 'knn' };
        }
        return null;
    }

    // ============ DECISION TREE ============
    decisionTree() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const last1 = results[results.length - 1], last2 = results[results.length - 2], last3 = results[results.length - 3];
        const t5 = results.slice(-5).filter(r => r === 'T').length;
        if (last1 === 'T' && last2 === 'T' && last3 === 'T') return { prediction: 'X', confidence: 72, source: 'dt_biet3' };
        if (last1 === 'X' && last2 === 'X' && last3 === 'X') return { prediction: 'T', confidence: 72, source: 'dt_biet3' };
        if (t5 >= 4) return { prediction: 'X', confidence: 62, source: 'dt_overbought' };
        if (t5 <= 1) return { prediction: 'T', confidence: 62, source: 'dt_oversold' };
        return { prediction: last1, confidence: 55, source: 'dt_default' };
    }

    // ============ PATTERN MATCH ============
    patternMatch() {
        if (this.history.length < 10) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const query = results.slice(-8);
        let bestMatch = -1, bestScore = -1;
        for (let i = 0; i < results.length - 8; i++) {
            const segment = results.slice(i, i + 8);
            let score = 0;
            for (let j = 0; j < 8; j++) if (segment[j] === query[j]) score++;
            if (score > bestScore) { bestScore = score; bestMatch = i; }
        }
        if (bestMatch !== -1 && bestMatch + 8 < results.length) {
            return { prediction: results[bestMatch + 8], confidence: 50 + (bestScore / 8) * 20, source: 'pattern_match' };
        }
        return null;
    }

    // ============ ZIGZAG ============
    zigzag() {
        if (this.history.length < 5) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let changes = 0;
        for (let i = 1; i < Math.min(5, results.length); i++) {
            if (results[results.length - i] !== results[results.length - i - 1]) changes++;
        }
        if (changes >= 4) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 65, source: 'zigzag' };
        return null;
    }

    // ============ ENTROPY ============
    entropy() {
        if (this.history.length < 8) return null;
        const results = this.history.slice(-8).map(h => h.result === 'Tài' ? 'T' : 'X');
        const p_t = results.filter(r => r === 'T').length / 8;
        if (p_t === 0 || p_t === 1) return { prediction: p_t === 0 ? 'T' : 'X', confidence: 70, source: 'entropy_extreme' };
        const entropy = -p_t * Math.log2(p_t) - (1 - p_t) * Math.log2(1 - p_t);
        if (entropy > 0.95) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 60, source: 'entropy_high' };
        return null;
    }

    // ============ MEAN REVERSION ============
    meanReversion() {
        if (this.history.length < 8) return null;
        const results = this.history.slice(-8).map(h => h.result === 'Tài' ? 'T' : 'X');
        const mean = results.filter(r => r === 'T').length / 8;
        if (mean > 0.7) return { prediction: 'X', confidence: 65, source: 'mean_reversion_high' };
        if (mean < 0.3) return { prediction: 'T', confidence: 65, source: 'mean_reversion_low' };
        return null;
    }

    // ============ ENSEMBLE VOTING ============
    ensembleVoting() {
        const methods = [this.markov.bind(this), this.trend.bind(this), this.streak.bind(this), this.rsi.bind(this), this.decisionTree.bind(this)];
        const votes = [];
        for (const m of methods) {
            const pred = m();
            if (pred) votes.push(pred.prediction);
        }
        if (votes.length < 2) return null;
        const tCount = votes.filter(v => v === 'T').length;
        return { prediction: tCount > votes.length / 2 ? 'T' : 'X', confidence: 50 + (Math.max(tCount, votes.length - tCount) / votes.length) * 25, source: 'ensemble_voting' };
    }

    // ============ PATTERN DETECTORS ============
    detect_1_1() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 4 && results.slice(-4).join('') === 'TXTX') return { prediction: 'X', confidence: 88, source: 'cau_1_1' };
        if (results.length >= 4 && results.slice(-4).join('') === 'XTXT') return { prediction: 'T', confidence: 88, source: 'cau_1_1' };
        return null;
    }

    detect_2_2() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 4 && results.slice(-4).join('') === 'TTXX') return { prediction: 'X', confidence: 82, source: 'cau_2_2' };
        if (results.length >= 4 && results.slice(-4).join('') === 'XXTT') return { prediction: 'T', confidence: 82, source: 'cau_2_2' };
        return null;
    }

    detect_3_3() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 6 && results.slice(-6).join('') === 'TTTXXX') return { prediction: 'X', confidence: 78, source: 'cau_3_3' };
        if (results.length >= 6 && results.slice(-6).join('') === 'XXXTTT') return { prediction: 'T', confidence: 78, source: 'cau_3_3' };
        return null;
    }

    detect_1_2_3() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 6 && results.slice(-6).join('') === 'TXXTTT') return { prediction: 'X', confidence: 77, source: 'cau_1_2_3' };
        if (results.length >= 6 && results.slice(-6).join('') === 'XTTXXX') return { prediction: 'T', confidence: 77, source: 'cau_1_2_3' };
        return null;
    }

    detect_dragon() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let tRun = 0;
        for (let i = results.length - 1; i >= 0 && results[i] === 'T'; i--) tRun++;
        if (tRun >= 5) return { prediction: 'X', confidence: 80, source: 'rong' };
        if (tRun >= 3) return { prediction: 'T', confidence: 68, source: 'rong' };
        return null;
    }

    detect_tiger() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let xRun = 0;
        for (let i = results.length - 1; i >= 0 && results[i] === 'X'; i--) xRun++;
        if (xRun >= 5) return { prediction: 'T', confidence: 80, source: 'ho' };
        if (xRun >= 3) return { prediction: 'X', confidence: 68, source: 'ho' };
        return null;
    }

    detect_triangle() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const last5 = results.slice(-5).join('');
        if (last5 === 'TXTXT') return { prediction: 'X', confidence: 80, source: 'tam_giac' };
        if (last5 === 'XTXTX') return { prediction: 'T', confidence: 80, source: 'tam_giac' };
        return null;
    }

    detect_zigzag() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 5 && results.slice(-5).join('') === 'TXTXT') return { prediction: 'X', confidence: 80, source: 'zigzag5' };
        return null;
    }

    detect_4_4() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 8 && results.slice(-8).join('') === 'TTTTXXXX') return { prediction: 'X', confidence: 79, source: 'cau_4_4' };
        if (results.length >= 8 && results.slice(-8).join('') === 'XXXXTTTT') return { prediction: 'T', confidence: 79, source: 'cau_4_4' };
        return null;
    }

    detect_5_5() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 10 && results.slice(-10).join('') === 'TTTTTXXXXX') return { prediction: 'X', confidence: 77, source: 'cau_5_5' };
        return null;
    }

    // ============ DICE ANALYSIS ============
    diceTriple() {
        if (this.history.length < 3) return null;
        const last = this.history[this.history.length - 1];
        const d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
        if (d1 === d2 && d2 === d3) return { prediction: d1 >= 4 ? 'X' : 'T', confidence: 75, source: 'dice_triple' };
        return null;
    }

    diceSum() {
        if (this.history.length < 5) return null;
        const lastScore = this.history[this.history.length - 1].Tong || 0;
        if (lastScore >= 16) return { prediction: 'X', confidence: 72, source: 'dice_sum_high' };
        if (lastScore <= 5) return { prediction: 'T', confidence: 72, source: 'dice_sum_low' };
        return null;
    }

    dicePair() {
        if (this.history.length < 3) return null;
        const last = this.history[this.history.length - 1];
        const dice = [last.Xuc_xac_1 || 0, last.Xuc_xac_2 || 0, last.Xuc_xac_3 || 0];
        const unique = new Set(dice).size;
        if (unique === 2) {
            const pairVal = dice.find((d, i) => dice.indexOf(d) !== i);
            return { prediction: pairVal >= 4 ? 'X' : 'T', confidence: 62, source: 'dice_pair' };
        }
        return null;
    }

    diceHighLow() {
        if (this.history.length < 5) return null;
        const last = this.history[this.history.length - 1];
        const dice = [last.Xuc_xac_1 || 0, last.Xuc_xac_2 || 0, last.Xuc_xac_3 || 0];
        const highCount = dice.filter(d => d >= 4).length;
        if (highCount === 3) return { prediction: 'X', confidence: 68, source: 'dice_hl_high' };
        if (highCount === 0) return { prediction: 'T', confidence: 68, source: 'dice_hl_low' };
        return null;
    }

    diceOddEven() {
        if (this.history.length < 5) return null;
        const last = this.history[this.history.length - 1];
        const dice = [last.Xuc_xac_1 || 0, last.Xuc_xac_2 || 0, last.Xuc_xac_3 || 0];
        const evenCount = dice.filter(d => d % 2 === 0).length;
        if (evenCount === 3) return { prediction: 'X', confidence: 60, source: 'dice_even' };
        if (evenCount === 0) return { prediction: 'T', confidence: 60, source: 'dice_odd' };
        return null;
    }

    dicePrime() {
        if (this.history.length < 5) return null;
        const last = this.history[this.history.length - 1];
        const dice = [last.Xuc_xac_1 || 0, last.Xuc_xac_2 || 0, last.Xuc_xac_3 || 0];
        const primeCount = dice.filter(d => [2, 3, 5].includes(d)).length;
        if (primeCount === 3) return { prediction: 'T', confidence: 62, source: 'dice_prime' };
        if (primeCount === 0) return { prediction: 'X', confidence: 62, source: 'dice_no_prime' };
        return null;
    }

    diceTransition() {
        if (this.history.length < 3) return null;
        const last = this.history[this.history.length - 1];
        const prev = this.history[this.history.length - 2];
        const d1 = [last.Xuc_xac_1 || 0, last.Xuc_xac_2 || 0, last.Xuc_xac_3 || 0];
        const d2 = [prev.Xuc_xac_1 || 0, prev.Xuc_xac_2 || 0, prev.Xuc_xac_3 || 0];
        let upCount = 0, downCount = 0;
        for (let i = 0; i < 3; i++) {
            if (d1[i] > d2[i]) upCount++;
            else if (d1[i] < d2[i]) downCount++;
        }
        if (upCount === 3) return { prediction: 'X', confidence: 65, source: 'dice_trans_up' };
        if (downCount === 3) return { prediction: 'T', confidence: 65, source: 'dice_trans_down' };
        return null;
    }

    diceVariance() {
        if (this.history.length < 8) return null;
        const scores = this.history.slice(-8).map(h => h.Tong || 0);
        const variance = calculateStdDev(scores);
        if (variance > 4) return { prediction: scores[scores.length - 1] >= 11 ? 'X' : 'T', confidence: 58, source: 'dice_variance_high' };
        if (variance < 2) return { prediction: scores[scores.length - 1] >= 11 ? 'T' : 'X', confidence: 58, source: 'dice_variance_low' };
        return null;
    }

    // ============ SCORE ANALYSIS ============
    scoreExtreme() {
        const lastScore = this.history[this.history.length - 1]?.Tong || 0;
        if (lastScore >= 17) return { prediction: 'X', confidence: 90, source: 'score_extreme_high' };
        if (lastScore >= 15) return { prediction: 'X', confidence: 75, source: 'score_high' };
        if (lastScore <= 4) return { prediction: 'T', confidence: 90, source: 'score_extreme_low' };
        if (lastScore <= 6) return { prediction: 'T', confidence: 70, source: 'score_low' };
        return null;
    }

    scoreMA() {
        if (this.history.length < 8) return null;
        const scores = this.history.slice(-8).map(h => h.Tong || 0);
        const ma3 = scores.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const ma8 = scores.reduce((a, b) => a + b, 0) / 8;
        if (ma3 > ma8 + 2) return { prediction: 'T', confidence: 64, source: 'score_ma_up' };
        if (ma3 < ma8 - 2) return { prediction: 'X', confidence: 64, source: 'score_ma_down' };
        return null;
    }

    scoreBollinger() {
        if (this.history.length < 8) return null;
        const scores = this.history.slice(-8).map(h => h.Tong || 0);
        const avg = scores.reduce((a, b) => a + b, 0) / 8;
        const std = calculateStdDev(scores);
        const last = scores[scores.length - 1];
        if (last > avg + 2 * std) return { prediction: 'X', confidence: 65, source: 'score_bb_high' };
        if (last < avg - 2 * std) return { prediction: 'T', confidence: 65, source: 'score_bb_low' };
        return null;
    }

    scoreRSI() {
        if (this.history.length < 8) return null;
        const scores = this.history.slice(-8).map(h => h.Tong || 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < 8; i++) {
            const diff = scores[i] - scores[i - 1];
            if (diff > 0) gains += diff; else losses -= Math.abs(diff);
        }
        const rs = losses === 0 ? 100 : gains / losses;
        const rsi = 100 - (100 / (1 + rs));
        if (rsi > 70) return { prediction: 'X', confidence: 62, source: 'score_rsi_high' };
        if (rsi < 30) return { prediction: 'T', confidence: 62, source: 'score_rsi_low' };
        return null;
    }

    scoreMomentum() {
        if (this.history.length < 8) return null;
        const scores = this.history.slice(-8).map(h => h.Tong || 0);
        const first4 = scores.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
        const last4 = scores.slice(-4).reduce((a, b) => a + b, 0) / 4;
        const momentum = last4 - first4;
        if (momentum > 2) return { prediction: 'T', confidence: 60, source: 'score_momentum_up' };
        if (momentum < -2) return { prediction: 'X', confidence: 60, source: 'score_momentum_down' };
        return null;
    }

    // ============ TREND ANALYSIS ============
    trendShort() {
        if (this.history.length < 5) return null;
        const results = this.history.slice(-5).map(h => h.result === 'Tài' ? 'T' : 'X');
        const tCount = results.filter(r => r === 'T').length;
        if (tCount >= 4) return { prediction: 'X', confidence: 62, source: 'trend_short_overbought' };
        if (tCount <= 1) return { prediction: 'T', confidence: 62, source: 'trend_short_oversold' };
        return null;
    }

    trendLong() {
        if (this.history.length < 10) return null;
        const results = this.history.slice(-10).map(h => h.result === 'Tài' ? 'T' : 'X');
        const tCount = results.filter(r => r === 'T').length;
        if (tCount >= 7) return { prediction: 'X', confidence: 65, source: 'trend_long_overbought' };
        if (tCount <= 3) return { prediction: 'T', confidence: 65, source: 'trend_long_oversold' };
        return null;
    }

    switchRate() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let sw = 0;
        for (let i = results.length - 7; i < results.length; i++) if (results[i] !== results[i - 1]) sw++;
        if (sw >= 6) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 68, source: 'switch_high' };
        if (sw <= 2) return { prediction: results[results.length - 1], confidence: 58, source: 'switch_low' };
        return null;
    }

    cycleAnalysis() {
        if (this.history.length < 10) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        for (let lag = 2; lag <= 5; lag++) {
            if (results.length <= lag * 2) continue;
            let matches = 0, total = 0;
            for (let i = lag; i < results.length; i++) {
                if (results[results.length - 1 - i] === results[results.length - 1 - i - lag]) matches++;
                total++;
            }
            const corr = total > 0 ? matches / total : 0;
            if (Math.abs(corr - 0.5) > 0.2) {
                return { prediction: results[results.length - 1 - lag], confidence: 55 + Math.abs(corr - 0.5) * 25, source: 'cycle' };
            }
        }
        return null;
    }

    entropyAnalysis() {
        if (this.history.length < 10) return null;
        const results = this.history.slice(-10).map(h => h.result === 'Tài' ? 'T' : 'X');
        const pT = results.filter(r => r === 'T').length / 10;
        if (pT === 0 || pT === 1) return { prediction: pT === 0 ? 'T' : 'X', confidence: 70, source: 'entropy_extreme' };
        return null;
    }

    // ============ PATTERN PREDICTORS ============
    pattern3() {
        if (this.history.length < 4) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const pattern = results.slice(-3).join('');
        const nextCounts = { T: 0, X: 0 };
        for (let i = 0; i < results.length - 3; i++) {
            if (results.slice(i, i + 3).join('') === pattern) nextCounts[results[i + 3]]++;
        }
        const total = nextCounts.T + nextCounts.X;
        if (total >= 3) {
            const probT = nextCounts.T / total;
            return { prediction: probT > 0.5 ? 'T' : 'X', confidence: 50 + Math.abs(probT - 0.5) * 60, source: 'pattern3' };
        }
        return null;
    }

    pattern4() {
        if (this.history.length < 5) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const pattern = results.slice(-4).join('');
        const nextCounts = { T: 0, X: 0 };
        for (let i = 0; i < results.length - 4; i++) {
            if (results.slice(i, i + 4).join('') === pattern) nextCounts[results[i + 4]]++;
        }
        const total = nextCounts.T + nextCounts.X;
        if (total >= 2) {
            const probT = nextCounts.T / total;
            return { prediction: probT > 0.5 ? 'T' : 'X', confidence: 50 + Math.abs(probT - 0.5) * 50, source: 'pattern4' };
        }
        return null;
    }

    pattern5() {
        if (this.history.length < 6) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const pattern = results.slice(-5).join('');
        const nextCounts = { T: 0, X: 0 };
        for (let i = 0; i < results.length - 5; i++) {
            if (results.slice(i, i + 5).join('') === pattern) nextCounts[results[i + 5]]++;
        }
        const total = nextCounts.T + nextCounts.X;
        if (total >= 2) {
            const probT = nextCounts.T / total;
            return { prediction: probT > 0.5 ? 'T' : 'X', confidence: 50 + Math.abs(probT - 0.5) * 40, source: 'pattern5' };
        }
        return null;
    }

    pattern6() { return this.genericPattern(6, 2, 'pattern6'); }
    pattern7() { return this.genericPattern(7, 2, 'pattern7'); }
    pattern8() { return this.genericPattern(8, 1, 'pattern8'); }

    genericPattern(len, minTotal, source) {
        if (this.history.length < len + 1) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const pattern = results.slice(-len).join('');
        const nextCounts = { T: 0, X: 0 };
        for (let i = 0; i < results.length - len; i++) {
            if (results.slice(i, i + len).join('') === pattern) nextCounts[results[i + len]]++;
        }
        const total = nextCounts.T + nextCounts.X;
        if (total >= minTotal) {
            const probT = nextCounts.T / total;
            return { prediction: probT > 0.5 ? 'T' : 'X', confidence: 50 + Math.abs(probT - 0.5) * (80 - len * 5), source };
        }
        return null;
    }

    knnPattern() {
        if (this.history.length < 10) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const query = results.slice(-6);
        const distances = [];
        for (let i = 0; i < results.length - 6; i++) {
            const seg = results.slice(i, i + 6);
            let dist = 0;
            for (let j = 0; j < 6; j++) if (seg[j] !== query[j]) dist++;
            if (i + 6 < results.length) distances.push({ dist, next: results[i + 6] });
        }
        distances.sort((a, b) => a.dist - b.dist);
        if (distances.length >= 3) {
            const tCount = distances.slice(0, 5).filter(n => n.next === 'T').length;
            return { prediction: tCount > 2.5 ? 'T' : 'X', confidence: 50 + Math.abs(tCount - 2.5) * 15, source: 'knn_pattern' };
        }
        return null;
    }

    bayesianPattern() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const last3 = results.slice(-3).join('');
        let condT = 0, condX = 0;
        for (let i = 0; i < results.length - 3; i++) {
            if (results.slice(i, i + 3).join('') === last3) {
                if (results[i + 3] === 'T') condT++; else condX++;
            }
        }
        const total = condT + condX;
        if (total >= 2) return { prediction: condT > condX ? 'T' : 'X', confidence: 55 + Math.abs(condT - condX) * 5, source: 'bayesian_pattern' };
        return null;
    }

    // ============ MARKOV 2,3,5 ============
    markov2() { return this.markovGeneric(2, 'markov2'); }
    markov3() { return this.markovGeneric(3, 'markov3'); }
    markov5() { return this.markovGeneric(4, 'markov4'); }

    markovGeneric(order, source) {
        if (this.history.length <= order) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const state = results.slice(-order).join(',');
        const nextCounts = { T: 0, X: 0 };
        for (let i = 0; i <= results.length - order - 1; i++) {
            if (results.slice(i, i + order).join(',') === state) nextCounts[results[i + order]]++;
        }
        const total = nextCounts.T + nextCounts.X;
        if (total >= 2) return { prediction: nextCounts.T > nextCounts.X ? 'T' : 'X', confidence: 55 + Math.abs(nextCounts.T - nextCounts.X) * 5, source };
        return null;
    }

    // ============ SPECIAL DETECTORS ============
    allTai() {
        const results = this.history.slice(-5).map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.every(r => r === 'T')) return { prediction: 'X', confidence: 78, source: 'all_tai' };
        return null;
    }

    allXiu() {
        const results = this.history.slice(-5).map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.every(r => r === 'X')) return { prediction: 'T', confidence: 78, source: 'all_xiu' };
        return null;
    }

    alternateRecent() {
        const results = this.history.slice(-4).map(h => h.result === 'Tài' ? 'T' : 'X');
        let isAlt = true;
        for (let i = 1; i < 4; i++) if (results[i] === results[i - 1]) { isAlt = false; break; }
        if (isAlt) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 72, source: 'alternate_recent' };
        return null;
    }

    scoreRecent() {
        if (this.history.length < 3) return null;
        const lastScores = this.history.slice(-3).map(h => h.Tong || 0);
        if (lastScores.every(s => s >= 15)) return { prediction: 'X', confidence: 75, source: 'score_recent_high' };
        if (lastScores.every(s => s <= 5)) return { prediction: 'T', confidence: 75, source: 'score_recent_low' };
        return null;
    }

    diceRecent() {
        if (this.history.length < 3) return null;
        const lastScores = this.history.slice(-3).map(h => h.Tong || 0);
        const allSame = lastScores.every(s => s === lastScores[0]);
        if (allSame) return { prediction: lastScores[0] >= 11 ? 'X' : 'T', confidence: 65, source: 'dice_recent' };
        return null;
    }

    // ============ ADVANCED ============
    gap() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const currentResult = results[results.length - 1];
        let countSince = 0;
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] !== currentResult) { countSince = results.length - 1 - i; break; }
        }
        if (countSince >= 4) return { prediction: currentResult === 'T' ? 'X' : 'T', confidence: 62, source: 'gap' };
        return null;
    }

    fibonacciPosition() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const fibs = [2, 3, 5, 8];
        const currentResult = results[results.length - 1];
        let matchCount = 0;
        for (const f of fibs) {
            if (results.length > f && results[results.length - 1 - f] === currentResult) matchCount++;
        }
        if (matchCount >= 3) return { prediction: currentResult === 'T' ? 'X' : 'T', confidence: 65, source: 'fibonacci_position' };
        return null;
    }

    meanReversion2() {
        if (this.history.length < 10) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const tCount = results.filter(r => r === 'T').length;
        const mean = tCount / results.length;
        const last5 = results.slice(-5).filter(r => r === 'T').length / 5;
        if (last5 > mean + 0.2) return { prediction: 'X', confidence: 62, source: 'mean_reversion2' };
        if (last5 < mean - 0.2) return { prediction: 'T', confidence: 62, source: 'mean_reversion2' };
        return null;
    }

    linearRegression2() {
        if (this.history.length < 8) return null;
        const results = this.history.slice(-8).map(h => h.result === 'Tài' ? 1 : 0);
        const x = Array.from({ length: 8 }, (_, i) => i);
        const sumX = x.reduce((a, b) => a + b, 0), sumY = results.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((s, xi, i) => s + xi * results[i], 0), sumX2 = x.reduce((s, xi) => s + xi * xi, 0);
        const slope = (8 * sumXY - sumX * sumY) / (8 * sumX2 - sumX * sumX);
        const nextPred = (sumY / 8) + slope * 8;
        return { prediction: nextPred > 0.5 ? 'T' : 'X', confidence: 55 + Math.abs(slope) * 8, source: 'linear_regression2' };
    }

    decisionTree2() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const last1 = results[results.length - 1], last2 = results[results.length - 2];
        if (last1 === 'T' && last2 === 'X') return { prediction: 'X', confidence: 65, source: 'dt2_pattern' };
        if (last1 === 'X' && last2 === 'T') return { prediction: 'T', confidence: 65, source: 'dt2_pattern' };
        return null;
    }

    ensembleVoting2() {
        const methods = [this.markov.bind(this), this.trend.bind(this), this.rsi.bind(this), this.meanReversion.bind(this)];
        const votes = [];
        for (const m of methods) {
            const pred = m();
            if (pred) votes.push(pred.prediction);
        }
        if (votes.length < 2) return null;
        const tCount = votes.filter(v => v === 'T').length;
        return { prediction: tCount > votes.length / 2 ? 'T' : 'X', confidence: 55 + (Math.max(tCount, votes.length - tCount) / votes.length) * 20, source: 'ensemble_voting2' };
    }

    // ============ SUPER PREDICTORS ============
    superBietKep() {
        if (this.history.length < 8) return null;
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let streak = 1;
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] === results[results.length - 1]) streak++; else break;
        }
        if (streak >= 4) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 70, source: 'super_biet_kep' };
        return null;
    }

    superDiceAll() {
        const preds = [this.diceTriple(), this.diceSum(), this.dicePair(), this.diceHighLow()].filter(p => p);
        if (preds.length >= 2 && preds.every(p => p.prediction === preds[0].prediction)) {
            return { prediction: preds[0].prediction, confidence: 70, source: 'super_dice_all' };
        }
        return null;
    }

    superTrendAll() {
        const preds = [this.trendShort(), this.trendLong(), this.switchRate()].filter(p => p);
        if (preds.length >= 2 && preds.every(p => p.prediction === preds[0].prediction)) {
            return { prediction: preds[0].prediction, confidence: 68, source: 'super_trend_all' };
        }
        return null;
    }

    superPatternAll() {
        const preds = [this.pattern3(), this.pattern4(), this.pattern5()].filter(p => p);
        if (preds.length >= 2 && preds.every(p => p.prediction === preds[0].prediction)) {
            return { prediction: preds[0].prediction, confidence: 68, source: 'super_pattern_all' };
        }
        return null;
    }

    superCauAll() {
        const preds = [this.detect_1_1(), this.detect_2_2(), this.detect_3_3(), this.detect_1_2_3()].filter(p => p);
        if (preds.length >= 2 && preds.every(p => p.prediction === preds[0].prediction)) {
            return { prediction: preds[0].prediction, confidence: 72, source: 'super_cau_all' };
        }
        return null;
    }

    superRongHo() {
        const rong = this.detect_dragon();
        const ho = this.detect_tiger();
        if (rong && ho && rong.prediction === ho.prediction) {
            return { prediction: rong.prediction, confidence: Math.max(rong.confidence, ho.confidence) + 5, source: 'super_rong_ho' };
        }
        return rong || ho;
    }

    superScoreAll() {
        const preds = [this.scoreExtreme(), this.scoreMA(), this.scoreBollinger()].filter(p => p);
        if (preds.length >= 2 && preds.every(p => p.prediction === preds[0].prediction)) {
            return { prediction: preds[0].prediction, confidence: 70, source: 'super_score_all' };
        }
        return null;
    }

    superFinalAdjust() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let streak = 1;
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] === results[results.length - 1]) streak++; else break;
        }
        if (streak >= 6) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 85, source: 'super_final_biet' };
        if (streak >= 4) {
            const lastScore = this.history[this.history.length - 1]?.Tong || 0;
            if (results[results.length - 1] === 'T' && lastScore >= 14) return { prediction: 'X', confidence: 80, source: 'super_final_score' };
            if (results[results.length - 1] === 'X' && lastScore <= 7) return { prediction: 'T', confidence: 80, source: 'super_final_score' };
        }
        return null;
    }

    // ============ ADVANCED AI ============
    ultraPattern() {
        const tx = this.history.map(h => (h.result === 'Tài' ? 't' : 'x'));
        if (tx.length < 8) return null;
        const fullPattern = tx.join('');
        let patternMatches = { t: 0, x: 0 }, totalWeight = 0;
        Object.entries(PATTERN_DATABASE).forEach(([name, patternList]) => {
            patternList.forEach(pattern => {
                const pl = pattern.length;
                if (pl > 8 || pl < 2) return;
                for (let i = 0; i <= fullPattern.length - pl - 1; i++) {
                    if (fullPattern.substr(i, pl) === pattern) {
                        const nextChar = fullPattern.charAt(i + pl);
                        if (nextChar === 't' || nextChar === 'x') {
                            const weight = (pl / 8) * (name.includes('wave') ? 1.3 : 1);
                            patternMatches[nextChar] += weight;
                            totalWeight += weight;
                        }
                    }
                }
            });
        });
        if (totalWeight === 0) return null;
        const tProb = patternMatches.t / totalWeight;
        if (tProb >= 0.62) return { prediction: 'T', confidence: Math.round(tProb * 100), source: 'ultra_pattern' };
        if (tProb <= 0.38) return { prediction: 'X', confidence: Math.round((1 - tProb) * 100), source: 'ultra_pattern' };
        return null;
    }

    quantumAI() {
        if (this.history.length < 8) return null;
        const tx = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const scores = this.history.map(h => h.Tong || 0);
        let qT = 0.5, qX = 0.5;
        for (let i = Math.max(0, this.history.length - 8); i < this.history.length; i++) {
            const w = 0.05;
            if (tx[i] === 'T') { qT *= (1 + w); qX *= (1 - w); }
            else { qX *= (1 + w); qT *= (1 - w); }
        }
        const recentAvg = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
        if (recentAvg > 11.2) { qT *= 0.85; qX *= 1.15; }
        else if (recentAvg < 9.8) { qT *= 1.15; qX *= 0.85; }
        const total = qT + qX;
        qT /= total; qX /= total;
        if (qT > 0.65) return { prediction: 'T', confidence: Math.round(qT * 100), source: 'quantum_ai' };
        if (qX > 0.65) return { prediction: 'X', confidence: Math.round(qX * 100), source: 'quantum_ai' };
        return null;
    }

    deepTrend() {
        if (this.history.length < 8) return null;
        const tx = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const scores = this.history.map(h => h.Tong || 0);
        const periods = [3, 5, 8];
        const trends = { t: 0, x: 0 };
        periods.forEach(p => {
            if (tx.length >= p) {
                const recent = tx.slice(-p);
                const tCount = recent.filter(c => c === 'T').length;
                if (tCount > p / 2) trends.t += 1; else trends.x += 1;
            }
        });
        const totalAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const recentAvg = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
        if (recentAvg > totalAvg + 0.8) trends.t += 1.5;
        if (recentAvg < totalAvg - 0.8) trends.x += 1.5;
        if (trends.t > trends.x + 1.5) return { prediction: 'T', confidence: 65, source: 'deep_trend' };
        if (trends.x > trends.t + 1.5) return { prediction: 'X', confidence: 65, source: 'deep_trend' };
        return null;
    }

    smartBridge() {
        const tx = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (tx.length < 6) return null;
        const lastResult = tx[tx.length - 1];
        let runLength = 1;
        for (let i = tx.length - 2; i >= 0; i--) {
            if (tx[i] === lastResult) runLength++; else break;
        }
        if (runLength >= 5) return { prediction: lastResult === 'T' ? 'X' : 'T', confidence: 75 + runLength, source: 'smart_bridge_break' };
        if (runLength >= 2 && runLength <= 4) return { prediction: lastResult, confidence: 60 + runLength * 3, source: 'smart_bridge_continue' };
        return null;
    }

    volatilityPred() {
        if (this.history.length < 8) return null;
        const scores = this.history.slice(-8).map(h => h.Tong || 0);
        const recent4 = scores.slice(-4), older4 = scores.slice(0, 4);
        const vol4 = calculateStdDev(recent4), vol8 = calculateStdDev(scores);
        if (vol4 > vol8 * 1.5) {
            const avgRecent = recent4.reduce((a, b) => a + b, 0) / 4;
            if (avgRecent > 11.0) return { prediction: 'X', confidence: 62, source: 'volatility_high' };
            if (avgRecent < 10.0) return { prediction: 'T', confidence: 62, source: 'volatility_low' };
        }
        return null;
    }

    patternFusion() {
        const tx = this.history.map(h => (h.result === 'Tài' ? 't' : 'x'));
        if (tx.length < 8) return null;
        const patternTypes = [{ length: 3, weight: 0.3 }, { length: 5, weight: 0.5 }];
        const patterns = [];
        patternTypes.forEach(type => {
            if (tx.length >= type.length + 1) {
                const lastPattern = tx.slice(-type.length).join('');
                let matches = { t: 0, x: 0 };
                for (let i = 0; i <= tx.length - type.length - 1; i++) {
                    if (tx.slice(i, i + type.length).join('') === lastPattern) {
                        const nextChar = tx[i + type.length];
                        matches[nextChar]++;
                    }
                }
                const total = matches.t + matches.x;
                if (total >= 2) {
                    const confidence = Math.max(matches.t, matches.x) / total;
                    if (confidence > 0.65) patterns.push({ prediction: matches.t > matches.x ? 'T' : 'X', confidence: confidence * type.weight });
                }
            }
        });
        if (patterns.length === 0) return null;
        const combined = { t: 0, x: 0 };
        patterns.forEach(p => { if (p.prediction === 'T') combined.t += p.confidence; else combined.x += p.confidence; });
        if (combined.t > combined.x * 1.3) return { prediction: 'T', confidence: Math.round(combined.t / (combined.t + combined.x) * 100), source: 'pattern_fusion' };
        if (combined.x > combined.t * 1.3) return { prediction: 'X', confidence: Math.round(combined.x / (combined.t + combined.x) * 100), source: 'pattern_fusion' };
        return null;
    }

    realtimeAdaptive() {
        if (this.history.length < 8) return null;
        const tx = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        const scores = this.history.map(h => h.Tong || 0);
        let tScore = 0, xScore = 0;
        const tCount5 = tx.slice(-5).filter(t => t === 'T').length;
        if (tCount5 >= 4) xScore += 1.5;
        else if (tCount5 <= 1) tScore += 1.5;
        const momentum = scores[scores.length - 1] - scores[scores.length - 2];
        if (momentum > 3) tScore += 1;
        else if (momentum < -3) xScore += 1;
        if (tScore > xScore + 1) return { prediction: 'T', confidence: 60, source: 'realtime_adaptive' };
        if (xScore > tScore + 1) return { prediction: 'X', confidence: 60, source: 'realtime_adaptive' };
        return null;
    }

    // ============ ADDITIONAL PREDICTORS ============
    cauBet() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let streak = 1;
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] === results[results.length - 1]) streak++; else break;
        }
        if (streak >= 3) return { prediction: results[results.length - 1], confidence: 60 + streak * 2, source: 'cau_bet' };
        return null;
    }

    cauDao11() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let alt = 0;
        for (let i = 1; i < Math.min(6, results.length); i++) {
            if (results[results.length - i] !== results[results.length - i - 1]) alt++; else break;
        }
        if (alt >= 3) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 65 + alt * 3, source: 'cau_dao_11' };
        return null;
    }

    cau22() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 6 && results.slice(-6).join('') === 'TTXXTT') return { prediction: 'X', confidence: 75, source: 'cau_22' };
        if (results.length >= 6 && results.slice(-6).join('') === 'XXTTXX') return { prediction: 'T', confidence: 75, source: 'cau_22' };
        return null;
    }

    cau33() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 9 && results.slice(-9).join('') === 'TTTXXXTTT') return { prediction: 'X', confidence: 72, source: 'cau_33' };
        return null;
    }

    cau123() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 6 && results.slice(-6).join('') === 'TXXTTT') return { prediction: 'X', confidence: 77, source: 'cau_123' };
        return null;
    }

    cau321() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 6 && results.slice(-6).join('') === 'TTTXXT') return { prediction: 'X', confidence: 76, source: 'cau_321' };
        return null;
    }

    rongLayer() { return this.detect_dragon(); }
    hoLayer() { return this.detect_tiger(); }

    doiXung() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        if (results.length >= 8) {
            const half = Math.floor(results.length / 2);
            const left = results.slice(-half).join('');
            const right = results.slice(-half * 2, -half).reverse().join('');
            if (left === right) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 65, source: 'doi_xung' };
        }
        return null;
    }

    tamGiac() { return this.detect_triangle(); }
    scoreZoneLayer() { return this.scoreExtreme(); }
    cycleLayer() { return this.cycleAnalysis(); }
    regimeLayer() { return this.entropyAnalysis(); }

    deepDiceAnalysis() {
        return this.diceTriple() || this.diceSum() || this.dicePair() || this.diceHighLow() || this.diceOddEven();
    }

    deepScoreAnalysis() {
        return this.scoreExtreme() || this.scoreMA() || this.scoreBollinger() || this.scoreRSI() || this.scoreMomentum();
    }

    deepReversalAnalysis() {
        const results = this.history.map(h => h.result === 'Tài' ? 'T' : 'X');
        let revs = 0;
        for (let i = 1; i < Math.min(8, results.length); i++) {
            if (results[results.length - i] !== results[results.length - i - 1]) revs++;
        }
        if (revs >= 5) return { prediction: results[results.length - 1] === 'T' ? 'X' : 'T', confidence: 65, source: 'deep_reversal' };
        return null;
    }

    neuralPattern() { return this.patternFusion(); }
    probabilityEngine() { return this.bayesianPattern(); }
    trendReversalDetector() { return this.smartBridge(); }

    markovXucXac123() {
        if (this.history.length < 5) return null;
        const last = this.history[this.history.length - 1];
        const dice = [last.Xuc_xac_1 || 0, last.Xuc_xac_2 || 0, last.Xuc_xac_3 || 0];
        const types = dice.map(d => d <= 2 ? 1 : d <= 4 ? 2 : 3);
        const prediction = types.filter(t => t === 3).length >= 2 ? 'X' : 'T';
        return { prediction, confidence: 62, source: 'markov_xuc_xac' };
    }

    bayesPredict() { return this.bayes(); }
    monteCarloPredict() { return this.knn(); }
    kalmanPredict() { return this.linearRegression(); }
    spectralPredict() { return this.cycleAnalysis(); }

    // ============ MAIN PREDICT ============
    predict() {
        if (this.history.length < 5) return { prediction: 'Tài', confidence: 50 };

        const allPredictions = [];
        const algoNames = Object.keys(this.algorithmWeights);
        
        for (const name of algoNames) {
            try {
                if (typeof this[name] === 'function') {
                    const pred = this[name]();
                    if (pred && pred.prediction) {
                        allPredictions.push({ ...pred, weight: this.algorithmWeights[name] || 1 });
                    }
                }
            } catch(e) {}
        }

        if (allPredictions.length === 0) {
            const last = this.history[this.history.length - 1];
            return { prediction: last.result === 'Tài' ? 'Xỉu' : 'Tài', confidence: 52 };
        }

        let scoreT = 0, scoreX = 0, totalWeight = 0;
        for (const pred of allPredictions) {
            const weight = (pred.weight || 1) * (pred.confidence / 100);
            if (pred.prediction === 'T') scoreT += weight;
            else scoreX += weight;
            totalWeight += weight;
        }

        if (totalWeight === 0) {
            const last = this.history[this.history.length - 1];
            return { prediction: last.result === 'Tài' ? 'Xỉu' : 'Tài', confidence: 52 };
        }

        const probT = scoreT / totalWeight;
        const finalPred = probT > 0.5 ? 'T' : 'X';
        let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
        confidence = Math.max(55, Math.min(95, confidence));

        const sorted = allPredictions.sort((a, b) => (b.weight || 1) * b.confidence - (a.weight || 1) * a.confidence);
        const top10 = sorted.slice(0, 10);
        if (top10.length > 0 && top10.every(p => p.prediction === top10[0].prediction)) {
            confidence = Math.min(95, confidence + 8);
        }

        return {
            prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
            confidence,
            totalAlgorithms: allPredictions.length
        };
    }

    addResult(record) {
        const parsed = {
            result: record.Ket_qua || '',
            Tong: record.Tong || 0,
            Xuc_xac_1: record.Xuc_xac_1 || 0,
            Xuc_xac_2: record.Xuc_xac_2 || 0,
            Xuc_xac_3: record.Xuc_xac_3 || 0
        };
        this.history.push(parsed);
        if (this.history.length > 100) this.history = this.history.slice(-50);
        return parsed;
    }
}

// ============ Khởi tạo AI Engine ============
const aiEngine = new UltimateAI();

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    aiEngine.history = sessions.map(s => ({
        result: s.Ket_qua || '',
        Tong: s.Tong || 0,
        Xuc_xac_1: s.Xuc_xac_1 || 0,
        Xuc_xac_2: s.Xuc_xac_2 || 0,
        Xuc_xac_3: s.Xuc_xac_3 || 0
    }));
    return aiEngine.predict();
}

// ============ FETCH & NORMALIZE (10 PHIÊN) ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        let allData = res.data;
        if (!Array.isArray(allData)) {
            if (allData.data && Array.isArray(allData.data)) allData = allData.data;
            else return null;
        }
        if (allData.length < 10) return null;
        allData.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        const latest10 = allData.slice(-10);
        allSessions = allData.slice(-100);
        return latest10.map(item => ({
            Phien: item.Phien || 0,
            Xuc_xac_1: item.Xuc_xac_1 || 0,
            Xuc_xac_2: item.Xuc_xac_2 || 0,
            Xuc_xac_3: item.Xuc_xac_3 || 0,
            Tong: item.Tong || (item.Xuc_xac_1 + item.Xuc_xac_2 + item.Xuc_xac_3),
            Ket_qua: item.Ket_qua === 'Tài' || item.Ket_qua === 'tài' ? 'Tài' : 'Xỉu',
        }));
    } catch (e) { return null; }
}

// ============ AUTO UPDATE (0.1 GIÂY) ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 10) { isUpdating = false; return; }
        
        const latestPhien = sessions[sessions.length - 1].Phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].Phien : 0;
        
        if (latestPhien !== oldLatestPhien) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.Phien === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.Ket_qua;
                    aiEngine.addResult(actual);
                    
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.Ket_qua.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    
                    if (verifiedResults.length > 100) verifiedResults = verifiedResults.slice(0, 100);
                    performanceHistory.push({ correct: isCorrect, confidence: currentPrediction.confidence });
                    if (performanceHistory.length > 50) performanceHistory = performanceHistory.slice(-50);
                    
                    console.log(`✅ ${isCorrect ? '🟢 THẮNG' : '🔴 THUA'} | Phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.Ket_qua}`);
                    
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                totalAlgorithms: pred.totalAlgorithms,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) | ${pred.totalAlgorithms} thuật toán`);
        }
    } catch(e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 100);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW, totalAlgorithms: currentPrediction.totalAlgorithms || 0 },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0, totalAlgorithms: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, totalAlgorithms: pred.totalAlgorithms, timestamp: new Date().toISOString() };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
        phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0, totalAlgorithms: pred.totalAlgorithms || 0 },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 100);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW, totalAlgorithms: currentPrediction.totalAlgorithms || 0 },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    res.json({ status: "Hệ thống đang chạy...", message: "Đợi dữ liệu từ API" });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI - ULTIMATE 100+ THUẬT TOÁN (KHÔNG RÚT GỌN)');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây | 📊 10 phiên từ API`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử thắng/thua`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
