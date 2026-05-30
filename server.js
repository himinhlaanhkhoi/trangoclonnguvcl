const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

// ============ MATH HELPERS ============
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function avg(arr) { return arr.length ? sum(arr) / arr.length : 0; }
function entropy(arr) {
    if (!arr.length) return 0;
    const freq = {};
    for (const v of arr) freq[v] = (freq[v] || 0) + 1;
    let e = 0;
    const n = arr.length;
    for (const k in freq) {
        const p = freq[k] / n;
        e -= p * Math.log2(p);
    }
    return e;
}
function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let m = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) m++; }
    return m / a.length;
}
function lastN(arr, n) { return arr.slice(-Math.min(n, arr.length)); }
function majority(obj) {
    let maxK = null, maxV = -Infinity;
    for (const k in obj) { if (obj[k] > maxV) { maxV = obj[k]; maxK = k; } }
    return { key: maxK, val: maxV };
}

// ============ EXTRACT FEATURES ============
function extractFeatures(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const freq = {};
    for (const v of tx) freq[v] = (freq[v] || 0) + 1;
    let runs = [], cur = tx[0], len = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur) len++;
        else { runs.push({ val: cur, len }); cur = tx[i]; len = 1; }
    }
    if (tx.length) runs.push({ val: cur, len });
    const meanTotal = avg(totals);
    const variance = avg(totals.map(t => Math.pow(t - meanTotal, 2)));
    return {
        tx, totals, freq, runs,
        maxRun: runs.reduce((m, r) => Math.max(m, r.len), 0),
        meanTotal, stdTotal: Math.sqrt(variance),
        entropy: entropy(tx),
        last3Pattern: tx.slice(-3).join(''),
        last5Pattern: tx.slice(-5).join(''),
        last8Pattern: tx.slice(-8).join(''),
        trends: {
            upward: totals.filter((t, i) => i > 0 && t > totals[i-1]).length,
            downward: totals.filter((t, i) => i > 0 && t < totals[i-1]).length
        }
    };
}

// ============ PATTERN DETECTION ============
function detectPatternType(runs) {
    if (runs.length < 3) return null;
    const lastRuns = runs.slice(-6);
    const lengths = lastRuns.map(r => r.len);
    const values = lastRuns.map(r => r.val);
    if (lastRuns.length >= 3) {
        if (lengths.every(l => l === 1)) {
            const isAlt = values.every((v, i) => i === 0 || v !== values[i-1]);
            if (isAlt) return '1_1_pattern';
        }
        if (lengths.every(l => l === 2)) {
            const isAlt = values.every((v, i) => i === 0 || v !== values[i-1]);
            if (isAlt) return '2_2_pattern';
        }
        if (lengths.every(l => l === 3)) {
            const isAlt = values.every((v, i) => i === 0 || v !== values[i-1]);
            if (isAlt) return '3_3_pattern';
        }
        if (lengths.length >= 5 && lengths[0]===2&&lengths[1]===1&&lengths[2]===2&&lengths[3]===1&&lengths[4]===2) return '2_1_2_pattern';
        if (lengths.length >= 5 && lengths[0]===1&&lengths[1]===2&&lengths[2]===1&&lengths[3]===2&&lengths[4]===1) return '1_2_1_pattern';
    }
    const lastRun = lastRuns[lastRuns.length - 1];
    if (lastRun && lastRun.len >= 5) return 'long_run_pattern';
    return 'random_pattern';
}

function predictNextFromPattern(patternType, runs, lastTx) {
    if (!patternType) return null;
    const lastRun = runs[runs.length - 1];
    switch (patternType) {
        case '1_1_pattern': return lastTx === 'T' ? 'X' : 'T';
        case '2_2_pattern': return lastRun.len === 2 ? (lastRun.val === 'T' ? 'X' : 'T') : lastRun.val;
        case '3_3_pattern': return lastRun.len === 3 ? (lastRun.val === 'T' ? 'X' : 'T') : lastRun.val;
        case '2_1_2_pattern':
            if (lastRun.val === 'T' && lastRun.len === 2) return 'X';
            if (lastRun.val === 'X' && lastRun.len === 2) return 'T';
            if (lastRun.len === 1) return lastRun.val;
            return null;
        case '1_2_1_pattern':
            if (lastRun.val === 'T' && lastRun.len === 1) return 'X';
            if (lastRun.val === 'X' && lastRun.len === 1) return 'T';
            if (lastRun.len === 2) return lastRun.val;
            return null;
        case 'long_run_pattern':
            if (lastRun.len > 7) return lastRun.val === 'T' ? 'X' : 'T';
            if (lastRun.len >= 4 && lastRun.len <= 7) return lastRun.val;
            return null;
        default: return null;
    }
}

// ============ 10 THUẬT TOÁN ============

// 1. FREQUENCY REBALANCE
function algo1_freqRebalance(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const tCount = tx.filter(t => t === 'T').length;
    const xCount = tx.filter(t => t === 'X').length;
    const recent = tx.slice(-30);
    const recentT = recent.filter(t => t === 'T').length;
    const recentX = recent.filter(t => t === 'X').length;
    if (recentT > recentX + 2) return 'X';
    if (recentX > recentT + 2) return 'T';
    return null;
}

// 2. MARKOV CHAIN
function algo2_markov(history) {
    if (history.length < 15) return null;
    const tx = history.map(h => h.tx);
    let bestPred = null, bestScore = -1;
    const maxOrder = history.length < 30 ? 3 : 4;
    for (let order = 2; order <= maxOrder; order++) {
        if (tx.length < order + 8) continue;
        const transitions = {};
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            const weight = Math.pow(0.95, tx.length - i - 1);
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next] += weight;
        }
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        if (counts && (counts.T + counts.X) > 0.5) {
            const total = counts.T + counts.X;
            const confidence = Math.abs(counts.T - counts.X) / total;
            const pred = counts.T > counts.X ? 'T' : 'X';
            const score = confidence * (order / maxOrder);
            if (score > bestScore) { bestScore = score; bestPred = pred; }
        }
    }
    return bestPred;
}

// 3. N-GRAM
function algo3_ngram(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    let bestPred = null, bestConf = 0;
    const sizes = history.length >= 50 ? [5, 6, 4, 3, 2] : [4, 3, 2];
    for (const n of sizes) {
        if (tx.length < n * 2) continue;
        const target = tx.slice(-n).join('');
        const matches = [];
        for (let i = 0; i <= tx.length - n - 1; i++) {
            if (tx.slice(i, i + n).join('') === target) {
                matches.push({ next: tx[i + n], distance: tx.length - i });
            }
        }
        if (matches.length >= 2) {
            const weights = { T: 0, X: 0 };
            let tw = 0;
            for (const m of matches) {
                const w = 1 / (m.distance * 0.5 + 1);
                weights[m.next] += w;
                tw += w;
            }
            if (tw > 0) {
                const conf = Math.abs(weights.T - weights.X) / tw;
                if (conf > bestConf) { bestConf = conf; bestPred = weights.T > weights.X ? 'T' : 'X'; }
            }
        }
    }
    return bestConf > 0.3 ? bestPred : null;
}

// 4. NEO PATTERN
function algo4_neoPattern(history) {
    if (history.length < 25) return null;
    const features = extractFeatures(history);
    const { runs, tx } = features;
    const patternType = detectPatternType(runs);
    if (!patternType || patternType === 'random_pattern') return null;
    const prediction = predictNextFromPattern(patternType, runs, tx[tx.length - 1]);
    if (prediction) {
        const recentRuns = runs.slice(-Math.min(8, runs.length));
        const consistency = recentRuns.filter(r => patternType.includes('_pattern') || (patternType === 'long_run_pattern' && r.len >= 4)).length / recentRuns.length;
        if (consistency > 0.6) return prediction;
    }
    return null;
}

// 5. SUPER DEEP ANALYSIS
function algo5_superDeep(history) {
    if (history.length < 60) return null;
    const timeframes = [{ lookback: 10, weight: 0.3 }, { lookback: 30, weight: 0.4 }, { lookback: 60, weight: 0.3 }];
    let totalScore = { T: 0, X: 0 }, totalWeight = 0;
    for (const tf of timeframes) {
        if (history.length < tf.lookback) continue;
        const slice = history.slice(-tf.lookback);
        const tx = slice.map(h => h.tx);
        const totals = slice.map(h => h.total);
        const tCount = tx.filter(t => t === 'T').length;
        const xCount = tx.filter(t => t === 'X').length;
        const meanTotal = avg(totals);
        const volatility = Math.sqrt(avg(totals.map(t => Math.pow(t - meanTotal, 2))));
        let tS = 0, xS = 0;
        if (meanTotal > 12) xS += 0.4;
        if (meanTotal < 9) tS += 0.4;
        if (tCount > xCount + 3) xS += 0.3;
        if (xCount > tCount + 3) tS += 0.3;
        if (volatility > 4) { if (tx[tx.length-1] === 'T') tS += 0.2; else xS += 0.2; }
        const trend = totals[totals.length-1] - totals[0];
        if (trend > 3) xS += 0.1;
        if (trend < -3) tS += 0.1;
        const tfWeight = tf.weight * (tx.length / tf.lookback);
        totalScore.T += tS * tfWeight;
        totalScore.X += xS * tfWeight;
        totalWeight += tfWeight;
    }
    if (totalWeight > 0 && Math.abs(totalScore.T - totalScore.X) > 0.15) return totalScore.T > totalScore.X ? 'T' : 'X';
    return null;
}

// 6. TRANSFORMER
function algo6_transformer(history) {
    if (history.length < 100) return null;
    const tx = history.map(h => h.tx);
    const seqLengths = [6, 8, 10, 12];
    let scores = { T: 0, X: 0 };
    for (const seqLen of seqLengths) {
        if (tx.length < seqLen * 2) continue;
        const targetSeq = tx.slice(-seqLen).join('');
        for (let i = 0; i <= tx.length - seqLen - 1; i++) {
            const histSeq = tx.slice(i, i + seqLen).join('');
            const matchScore = similarity(histSeq, targetSeq);
            if (matchScore >= 0.7) {
                const next = tx[i + seqLen];
                const weight = matchScore * (1 / (tx.length - i)) * (seqLen / 12);
                scores[next] = (scores[next] || 0) + weight;
            }
        }
    }
    if (scores.T + scores.X > 0.2) {
        const total = scores.T + scores.X;
        if (Math.abs(scores.T - scores.X) / total > 0.25) return scores.T > scores.X ? 'T' : 'X';
    }
    return null;
}

// 7. SUPER BRIDGE
function algo7_superBridge(history) {
    const features = extractFeatures(history);
    const { runs, tx } = features;
    if (runs.length < 4) return null;
    const lastRun = runs[runs.length - 1];
    let prediction = null, confidence = 0;
    if (lastRun.len >= 8) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.8; }
    else if (lastRun.len >= 5) {
        const avgLen = avg(runs.map(r => r.len));
        if (lastRun.len > avgLen * 1.8) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.65; }
        else { prediction = lastRun.val; confidence = 0.6; }
    }
    if (!prediction && runs.length >= 5) {
        const lengths = runs.slice(-5).map(r => r.len);
        if (lengths[0]===1&&lengths[1]===1&&lengths[2]>=3&&lastRun.len>=3) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.7; }
    }
    return confidence > 0.55 ? prediction : null;
}

// 8. ADAPTIVE MARKOV
function algo8_adaptiveMarkov(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.tx);
    let votes = { T: 0, X: 0 };
    // Markov
    for (let order = 2; order <= 4; order++) {
        if (tx.length < order + 5) continue;
        const transitions = {};
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next]++;
        }
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        if (counts && counts.T + counts.X >= 2) {
            const pred = counts.T > counts.X ? 'T' : 'X';
            votes[pred] += (Math.abs(counts.T - counts.X) / (counts.T + counts.X)) * (order / 10);
        }
    }
    // Frequency
    for (const lookback of [10, 20, 30]) {
        if (tx.length < lookback) continue;
        const recent = tx.slice(-lookback);
        const tCount = recent.filter(t => t === 'T').length;
        if (Math.abs(tCount - (lookback - tCount)) > lookback * 0.2) {
            const pred = tCount > (lookback - tCount) ? 'X' : 'T';
            votes[pred] += Math.abs(tCount - (lookback - tCount)) / lookback * 0.5;
        }
    }
    if (votes.T + votes.X > 0.3) return votes.T > votes.X ? 'T' : 'X';
    return null;
}

// 9. PATTERN MASTER
function algo9_patternMaster(history) {
    if (history.length < 35) return null;
    const features = extractFeatures(history);
    const { runs, tx } = features;
    if (runs.length < 5) return null;
    const recentRuns = runs.slice(-8);
    const runLengths = recentRuns.map(r => r.len);
    const runValues = recentRuns.map(r => r.val);
    const runPattern = runLengths.join('');
    let ps = { T: 0, X: 0 };
    const lib = [
        { pattern: '12121', pred: runValues[runValues.length-1] === 'T' ? 'X' : 'T', s: 0.7 },
        { pattern: '21212', pred: runValues[runValues.length-1] === 'T' ? 'T' : 'X', s: 0.7 },
        { pattern: '13131', pred: runValues[runValues.length-1], s: 0.6 },
        { pattern: '31313', pred: runValues[runValues.length-1] === 'T' ? 'X' : 'T', s: 0.6 },
    ];
    for (const lp of lib) { if (runPattern.includes(lp.pattern)) ps[lp.pred] += lp.s; }
    const lastRun = recentRuns[recentRuns.length - 1];
    if (lastRun) {
        const avgLen = avg(runLengths);
        if (lastRun.len > avgLen * 1.8) ps[lastRun.val === 'T' ? 'X' : 'T'] += 0.5;
        else if (lastRun.len < avgLen * 0.6) ps[lastRun.val] += 0.4;
    }
    if (ps.T + ps.X > 0 && Math.abs(ps.T - ps.X) / (ps.T + ps.X) > 0.3) return ps.T > ps.X ? 'T' : 'X';
    return null;
}

// 10. QUANTUM ENTROPY
function algo10_quantumEntropy(history) {
    if (history.length < 40) return null;
    const features = extractFeatures(history);
    const { tx, runs } = features;
    let ep = { T: 0, X: 0 };
    for (const w of [10, 20, 30]) {
        if (tx.length < w) continue;
        const winTx = tx.slice(-w);
        const winEnt = entropy(winTx);
        if (winEnt < 0.3) ep[winTx[winTx.length-1]] += 0.6;
        else if (winEnt > 0.9) {
            const t = winTx.filter(x => x === 'T').length;
            if (t > w - t) ep['X'] += 0.5; else ep['T'] += 0.5;
        }
    }
    if (features.entropy < 0.4) ep[tx[tx.length-1]] += 0.3;
    else if (features.entropy > 0.95) {
        const t = tx.slice(-20).filter(x => x === 'T').length;
        if (t > 20 - t) ep['X'] += 0.4; else ep['T'] += 0.4;
    }
    if (ep.T + ep.X > 0.4) return ep.T > ep.X ? 'T' : 'X';
    return null;
}

// ============ DANH SÁCH THUẬT TOÁN ============
const ALL_ALGS = [
    { id: 'freqRebalance', fn: algo1_freqRebalance },
    { id: 'markov', fn: algo2_markov },
    { id: 'ngram', fn: algo3_ngram },
    { id: 'neoPattern', fn: algo4_neoPattern },
    { id: 'superDeep', fn: algo5_superDeep },
    { id: 'transformer', fn: algo6_transformer },
    { id: 'superBridge', fn: algo7_superBridge },
    { id: 'adaptiveMarkov', fn: algo8_adaptiveMarkov },
    { id: 'patternMaster', fn: algo9_patternMaster },
    { id: 'quantumEntropy', fn: algo10_quantumEntropy },
];

// ============ ENSEMBLE ============
class SieuEnsemble {
    constructor(algorithms) {
        this.algs = algorithms;
        this.weights = {};
        this.perfHistory = {};
        this.patternMemory = {};
        for (const a of algorithms) {
            this.weights[a.id] = 1.0;
            this.perfHistory[a.id] = [];
        }
    }

    predict(history) {
        if (history.length < 12) return { prediction: 'Tài', confidence: 55 };

        const features = extractFeatures(history);
        const patternType = detectPatternType(features.runs);
        const votes = { T: 0, X: 0 };

        for (const a of this.algs) {
            try {
                const pred = a.fn(history);
                if (!pred) continue;
                let weight = this.weights[a.id] || 0.01;
                if (patternType) {
                    const key = `${a.id}_${patternType}`;
                    if ((this.patternMemory[key] || 0) > 2) weight *= 1.2;
                }
                votes[pred] = (votes[pred] || 0) + weight;
            } catch (e) {}
        }

        if (votes.T === 0 && votes.X === 0) {
            const fallback = algo1_freqRebalance(history) || 'T';
            return { prediction: fallback === 'T' ? 'Tài' : 'Xỉu', confidence: 55 };
        }

        const { key: best, val: bestVal } = majority(votes);
        const totalVotes = votes.T + votes.X;
        let confidence = bestVal / totalVotes;

        const tAlgs = this.algs.filter(a => { try { return a.fn(history) === 'T'; } catch { return false; } }).length;
        const xAlgs = this.algs.filter(a => { try { return a.fn(history) === 'X'; } catch { return false; } }).length;
        const totalAlgs = tAlgs + xAlgs;
        if (totalAlgs > 0) {
            const consensus = Math.max(tAlgs, xAlgs) / totalAlgs;
            if (consensus > 0.7) confidence += 0.1;
            if (consensus > 0.8) confidence += 0.15;
        }

        confidence = Math.min(0.96, Math.max(0.55, confidence));
        const predResult = best === 'T' ? 'Tài' : 'Xỉu';
        const confPct = Math.round(confidence * 100);

        return { prediction: predResult, confidence: Math.max(60, Math.min(98, confPct)) };
    }

    updateWithOutcome(historyPrefix, actualTx) {
        if (historyPrefix.length < 10) return;
        const features = extractFeatures(historyPrefix);
        const patternType = detectPatternType(features.runs);
        for (const a of this.algs) {
            try {
                const pred = a.fn(historyPrefix);
                const correct = pred === actualTx ? 1 : 0;
                this.perfHistory[a.id].push(correct);
                if (this.perfHistory[a.id].length > 60) this.perfHistory[a.id].shift();
                const recent = this.perfHistory[a.id].slice(-25);
                let wAcc = 0, wSum = 0;
                for (let i = 0; i < recent.length; i++) {
                    const w = Math.pow(0.9, recent.length - i - 1);
                    wAcc += recent[i] * w;
                    wSum += w;
                }
                const recentAcc = wSum > 0 ? wAcc / wSum : 0.5;
                let patternBonus = 0;
                if (patternType && (this.patternMemory[`${a.id}_${patternType}`] || 0) > 3) patternBonus = 0.1;
                const target = Math.min(1, recentAcc + patternBonus + 0.1);
                const current = this.weights[a.id] || 0.01;
                this.weights[a.id] = Math.max(0.01, Math.min(1.5, 0.06 * target + 0.94 * current));
                if (patternType && correct) {
                    const key = `${a.id}_${patternType}`;
                    this.patternMemory[key] = (this.patternMemory[key] || 0) + 1;
                }
            } catch (e) {
                this.weights[a.id] = Math.max(0.01, (this.weights[a.id] || 1) * 0.92);
            }
        }
        const sumW = Object.values(this.weights).reduce((s, w) => s + w, 0);
        if (sumW > 0) { for (const id in this.weights) this.weights[id] /= sumW; }
    }
}

// ============ KHỞI TẠO ENSEMBLE ============
const ensemble = new SieuEnsemble(ALL_ALGS);

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const history = sessions.map(s => ({
        tx: getTong(s) >= 11 ? 'T' : 'X',
        total: getTong(s),
        dice: [getX1(s), getX2(s), getX3(s)]
    }));
    return ensemble.predict(history);
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));
        const count = Math.min(30, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);
        return latest;
    } catch (e) { return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }
        const latestPhien = getPhien(sessions[sessions.length - 1]);
        const oldLatestPhien = gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0;

        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }

                    // Update ensemble
                    const historyForUpdate = gameHistory.map(s => ({
                        tx: getTong(s) >= 11 ? 'T' : 'X',
                        total: getTong(s)
                    }));
                    ensemble.updateWithOutcome(historyForUpdate, getTong(actual) >= 11 ? 'T' : 'X');

                    verifiedResults.unshift({
                        phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch (e) {}
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                timestamp: new Date().toISOString()
            };
        }
    } catch (e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "AnhKhoizZz cute",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({ id: "AnhKhoizZz cute", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Dang tai..." }, phien_hien_tai: { Phien: 0, Du_doan: "Dang tai...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: getPhien(latest) + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
    res.json({
        id: "AnhKhoizZz cute",
        phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
        phien_hien_tai: { Phien: getPhien(latest) + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: []
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? ((totalW / verifiedResults.length) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "AnhkhoizZz cute",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { totalPredictions: verifiedResults.length, winRate: winRate + "%", consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss
        });
    }
    res.json({ status: "OK" });
});

// ============ KHỞI ĐỘNG ============
try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch (e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('SIEU ENSEMBLE - 10 THUAT TOAN');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT} | API: ${API_URL}`);
    console.log(`30 phien | 500 lich su`);
    console.log(`10 thuat toan: FreqRebalance, Markov, N-Gram, NeoPattern,`);
    console.log(`SuperDeep, Transformer, SuperBridge, AdaptiveMarkov,`);
    console.log(`PatternMaster, QuantumEntropy`);
    console.log(`Ensemble: trong so dong + pattern memory + EMA cap nhat`);
    console.log('='.repeat(60));
});
