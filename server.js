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
function getPhien(item) {
    return item.Phien || item.phien || 0;
}

function getKetQua(item) {
    return item.Ket_qua || item.ket_qua || '';
}

function getTong(item) {
    return item.Tong || item.tong || 0;
}

function getX1(item) {
    return item.Xuc_xac_1 || item.xuc_xac_1 || 0;
}

function getX2(item) {
    return item.Xuc_xac_2 || item.xuc_xac_2 || 0;
}

function getX3(item) {
    return item.Xuc_xac_3 || item.xuc_xac_3 || 0;
}

// ============ PATTERN DATABASE ============
const PATTERN_DATABASE = {
    '1-1': ['tx', 'xt'],
    'bệt_2': ['tt', 'xx'],
    'bệt_3': ['ttt', 'xxx'],
    'bệt_4': ['tttt', 'xxxx'],
    'bệt_5': ['ttttt', 'xxxxx'],
    'bệt_6': ['tttttt', 'xxxxxx'],
    'bệt_7': ['ttttttt', 'xxxxxxx'],
    'bệt_8': ['tttttttt', 'xxxxxxxx'],
    '2-2': ['ttxx', 'xxtt'],
    '3-3': ['tttxxx', 'xxxttt'],
    '4-4': ['ttttxxxx', 'xxxxtttt'],
    '5-5': ['tttttxxxxx', 'xxxxxttttt'],
    'zigzag_3': ['txt', 'xtx'],
    'zigzag_4': ['txtx', 'xtxt'],
    'zigzag_5': ['txtxt', 'xtxtx'],
    'zigzag_6': ['txtxtx', 'xtxtxt'],
    'zigzag_7': ['txtxtxt', 'xtxtxtx'],
    '1-2-1': ['txxxt', 'xtttx'],
    '2-1-2': ['ttxtt', 'xxtxx'],
    '1-2-3': ['txxttt', 'xttxxx'],
    '3-2-1': ['tttxtx', 'xxxtxt'],
    'tam_giac': ['txx', 'xtt'],
    'hinh_vuong': ['ttxx', 'xxtt'],
    'sóng_2': ['ttxx', 'xxtt'],
    'sóng_3': ['tttxxx', 'xxxttt'],
    'sóng_4': ['ttttxxxx', 'xxxxtttt'],
    'dao_1': ['ttx', 'xxt'],
    'dao_2': ['ttxx', 'xxtt'],
    'dao_3': ['tttxxx', 'xxxttt'],
    'xoan_1': ['txxxt', 'xtttx'],
    'xoan_2': ['ttxxxtt', 'xxtttxx'],
    'cap_so_1': ['tx', 'xt'],
    'cap_so_2': ['txx', 'xtt'],
    'cap_so_3': ['txxx', 'xttt'],
    'fib_1': ['t', 'x'],
    'fib_2': ['tx', 'xt'],
    'fib_3': ['txt', 'xtx'],
    'fib_4': ['txttx', 'xtxxt'],
    'doi_xung_1': ['txt', 'xtx'],
    'doi_xung_2': ['ttxxtt', 'xxttxx'],
    'doi_xung_3': ['tttxxxttt', 'xxxxttxxx'],
    'lap_2': ['tt', 'xx'],
    'lap_4': ['tttt', 'xxxx'],
    'lap_6': ['tttttt', 'xxxxxx'],
    'xen_1': ['txtxt', 'xtxtx'],
    'xen_2': ['ttxxtt', 'xxttxx'],
    'nhanh_1': ['ttxtx', 'xxtxt'],
    'nhanh_2': ['ttxxttx', 'xxttxx'],
    'mix_1': ['ttxtxx', 'xxtxtt'],
    'mix_2': ['txxxttx', 'xtttxxt'],
    'mix_3': ['tttxxtxx', 'xxxxttxx'],
};

// ============ MATH HELPERS ============
function calculateVolatility(numbers) {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const variance = numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numbers.length;
    return Math.sqrt(variance);
}

function calculateRSI(txArray) {
    if (txArray.length < 14) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < txArray.length; i++) {
        if (txArray[i] === 'T' && txArray[i - 1] === 'X') {
            gains++;
        } else if (txArray[i] === 'X' && txArray[i - 1] === 'T') {
            losses++;
        }
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function calculateBias(txArray) {
    const tCount = txArray.filter(t => t === 'T').length;
    return tCount / txArray.length;
}

function calculateMomentum(numbers) {
    if (numbers.length < 2) return 0;
    return numbers[numbers.length - 1] - numbers[0];
}

// ============ 17 THUẬT TOÁN ============

// Thuật toán 1: Ultra Pattern Recognition
function algo1_ultraPattern(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 10) return null;
    
    const fullPattern = tx.join('').toLowerCase();
    let matches = { t: 0, x: 0 };
    let totalWeight = 0;
    
    Object.entries(PATTERN_DATABASE).forEach(([name, patterns]) => {
        patterns.forEach(pattern => {
            const len = pattern.length;
            if (len > 8) return;
            
            for (let i = 0; i <= fullPattern.length - len - 1; i++) {
                if (fullPattern.substr(i, len) === pattern) {
                    const nextChar = fullPattern.charAt(i + len);
                    if (nextChar === 't' || nextChar === 'x') {
                        const weight = (len / 8) * (name.includes('expert') ? 1.8 : 1);
                        matches[nextChar] += weight;
                        totalWeight += weight;
                    }
                }
            }
        });
    });
    
    if (totalWeight === 0) return null;
    const tProb = matches.t / totalWeight;
    if (tProb >= 0.62) return 'T';
    if (tProb <= 0.38) return 'X';
    return null;
}

// Thuật toán 2: Quantum Adaptive AI
function algo2_quantumAI(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    if (history.length < 10) return null;
    
    let quantum = { t: 0.5, x: 0.5 };
    const recentCount = Math.min(10, history.length);
    
    for (let i = history.length - recentCount; i < history.length; i++) {
        if (tx[i] === 'T') {
            quantum.t *= 1.04;
            quantum.x *= 0.96;
        } else {
            quantum.x *= 1.04;
            quantum.t *= 0.96;
        }
    }
    
    const recentAvg = totals.slice(-5).reduce((a, b) => a + b, 0) / 5;
    if (recentAvg > 11.2) {
        quantum.t *= 0.85;
        quantum.x *= 1.15;
    } else if (recentAvg < 9.8) {
        quantum.t *= 1.15;
        quantum.x *= 0.85;
    }
    
    const total = quantum.t + quantum.x;
    quantum.t /= total;
    quantum.x /= total;
    
    if (quantum.t > 0.65) return 'T';
    if (quantum.x > 0.65) return 'X';
    return null;
}

// Thuật toán 3: Deep Trend Analysis
function algo3_deepTrend(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    if (history.length < 10) return null;
    
    const periods = [3, 5, 7, 10];
    const trends = { t: 0, x: 0 };
    
    periods.forEach(period => {
        if (tx.length >= period) {
            const recent = tx.slice(-period);
            const tCount = recent.filter(c => c === 'T').length;
            if (tCount > period / 2) {
                trends.t += 1;
            } else {
                trends.x += 1;
            }
        }
    });
    
    const totalAvg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const recentAvg = totals.slice(-5).reduce((a, b) => a + b, 0) / 5;
    
    if (recentAvg > totalAvg + 0.8) trends.t += 1.5;
    if (recentAvg < totalAvg - 0.8) trends.x += 1.5;
    
    if (trends.t > trends.x + 1.5) return 'T';
    if (trends.x > trends.t + 1.5) return 'X';
    return null;
}

// Thuật toán 4: Smart Bridge Detection
function algo4_smartBridge(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 8) return null;
    
    const recent = tx.slice(-8);
    const lastResult = recent[recent.length - 1];
    
    // Đếm streak hiện tại
    let runLength = 1;
    for (let i = recent.length - 2; i >= 0; i--) {
        if (recent[i] === lastResult) {
            runLength++;
        } else {
            break;
        }
    }
    
    // Streak dài -> bẻ cầu
    if (runLength >= 4) {
        return lastResult === 'T' ? 'X' : 'T';
    }
    
    // Streak vừa -> theo cầu
    if (runLength >= 2 && runLength <= 3) {
        return lastResult;
    }
    
    // Streak ngắn -> đảo
    return lastResult === 'T' ? 'X' : 'T';
}

// Thuật toán 5: Volatility Prediction
function algo5_volatility(history) {
    const totals = history.map(h => h.total);
    if (history.length < 10) return null;
    
    const recent5 = totals.slice(-5);
    const recent10 = totals.slice(-10);
    const vol5 = calculateVolatility(recent5);
    const vol10 = calculateVolatility(recent10);
    
    if (vol5 > vol10 * 1.5) {
        const avgRecent = recent5.reduce((a, b) => a + b, 0) / 5;
        if (avgRecent > 11.0) return 'X';
        if (avgRecent < 10.0) return 'T';
    }
    return null;
}

// Thuật toán 6: Pattern Fusion AI
function algo6_patternFusion(history) {
    const tx = history.map(h => h.tx.toLowerCase());
    if (tx.length < 10) return null;
    
    const patternTypes = [
        { length: 3, weight: 0.3 },
        { length: 5, weight: 0.5 },
        { length: 7, weight: 0.7 }
    ];
    
    const foundPatterns = [];
    
    patternTypes.forEach(type => {
        if (tx.length >= type.length + 1) {
            const lastPattern = tx.slice(-type.length).join('');
            let nextCounts = { t: 0, x: 0 };
            
            for (let i = 0; i <= tx.length - type.length - 1; i++) {
                if (tx.slice(i, i + type.length).join('') === lastPattern) {
                    const nextChar = tx[i + type.length];
                    nextCounts[nextChar]++;
                }
            }
            
            const total = nextCounts.t + nextCounts.x;
            if (total >= 2) {
                const confidence = Math.max(nextCounts.t, nextCounts.x) / total;
                if (confidence > 0.65) {
                    foundPatterns.push({
                        prediction: nextCounts.t > nextCounts.x ? 'T' : 'X',
                        confidence: confidence * type.weight
                    });
                }
            }
        }
    });
    
    if (foundPatterns.length === 0) return null;
    
    const combined = { t: 0, x: 0 };
    foundPatterns.forEach(p => {
        if (p.prediction === 'T') {
            combined.t += p.confidence;
        } else {
            combined.x += p.confidence;
        }
    });
    
    if (combined.t > combined.x * 1.3) return 'T';
    if (combined.x > combined.t * 1.3) return 'X';
    return null;
}

// Thuật toán 7: Real-time Adaptive AI
function algo7_realtimeAI(history) {
    const tx = history.map(h => h.tx);
    if (history.length < 10) return null;
    
    const rsi = calculateRSI(tx.slice(-10));
    const bias = calculateBias(tx.slice(-10));
    
    let tScore = 0;
    let xScore = 0;
    
    if (rsi > 70) {
        xScore += 1.5;
    } else if (rsi < 30) {
        tScore += 1.5;
    }
    
    if (bias > 0.6) {
        tScore += 1.2;
    } else if (bias < 0.4) {
        xScore += 1.2;
    }
    
    if (tScore > xScore + 1.5) return 'T';
    if (xScore > tScore + 1.5) return 'X';
    return null;
}

// Thuật toán 8: Neural Oscillator
function algo8_neuralOscillator(history) {
    const tx = history.map(h => h.tx);
    if (history.length < 10) return null;
    
    let oscillator = 0;
    
    for (let i = 1; i < Math.min(10, tx.length); i++) {
        if (tx[i] === 'T' && tx[i - 1] === 'X') {
            oscillator += 1;
        } else if (tx[i] === 'X' && tx[i - 1] === 'T') {
            oscillator -= 1;
        } else if (tx[i] === tx[i - 1]) {
            oscillator += 0.5;
        }
    }
    
    if (oscillator > 3) return 'X';
    if (oscillator < -3) return 'T';
    return null;
}

// Thuật toán 9: Support Resistance
function algo9_supportResistance(history) {
    const totals = history.map(h => h.total);
    if (history.length < 15) return null;
    
    const recent15 = totals.slice(-15);
    const support = Math.min(...recent15);
    const resistance = Math.max(...recent15);
    const lastTotal = totals[totals.length - 1];
    
    if (lastTotal <= support + 1) return 'T';
    if (lastTotal >= resistance - 1) return 'X';
    return null;
}

// Thuật toán 10: Markov Chain
function algo10_markovChain(history) {
    const tx = history.map(h => h.tx);
    if (history.length < 10) return null;
    
    const transitions = {};
    
    for (let i = 0; i < tx.length - 3; i++) {
        const state = tx[i] + tx[i + 1] + tx[i + 2];
        const next = tx[i + 3];
        
        if (!transitions[state]) {
            transitions[state] = { T: 0, X: 0 };
        }
        transitions[state][next]++;
    }
    
    const currentState = tx.slice(-3).join('');
    
    if (transitions[currentState]) {
        const stats = transitions[currentState];
        const total = stats.T + stats.X;
        
        if (total >= 3) {
            if (stats.T / total > 0.65) return 'T';
            if (stats.X / total > 0.65) return 'X';
        }
    }
    return null;
}

// Thuật toán 11: Ensemble Voting
function algo11_ensembleVoting(history) {
    const votes = { T: 0, X: 0 };
    const subAlgos = [algo1_ultraPattern, algo4_smartBridge, algo6_patternFusion, algo7_realtimeAI];
    
    for (const algo of subAlgos) {
        const result = algo(history);
        if (result === 'T') {
            votes.T++;
        } else if (result === 'X') {
            votes.X++;
        }
    }
    
    if (votes.T + votes.X >= 3) {
        return votes.T > votes.X ? 'T' : 'X';
    }
    return null;
}

// Thuật toán 12: Momentum Divergence
function algo12_momentumDivergence(history) {
    const totals = history.map(h => h.total);
    const results = history.map(h => h.tx === 'T' ? 1 : 0);
    if (history.length < 8) return null;
    
    const recent3Totals = totals.slice(-3);
    const prev3Totals = totals.slice(-6, -3);
    const recent3Results = results.slice(-3);
    const prev3Results = results.slice(-6, -3);
    
    const totalMomentum = (recent3Totals.reduce((a, b) => a + b, 0) / 3) - (prev3Totals.reduce((a, b) => a + b, 0) / 3);
    const resultMomentum = (recent3Results.reduce((a, b) => a + b, 0) / 3) - (prev3Results.reduce((a, b) => a + b, 0) / 3);
    
    if (totalMomentum > 0.5 && resultMomentum < -0.1) return 'T';
    if (totalMomentum < -0.5 && resultMomentum > 0.1) return 'X';
    return null;
}

// Thuật toán 13: Entropy Gradient
function algo13_entropyGradient(history) {
    const results = history.slice(0, 20).map(s => s.tx === 'T' ? 1 : 0);
    if (results.length < 15) return null;
    
    function localEntropy(arr) {
        if (arr.length < 3) return 0;
        const p = arr.reduce((a, b) => a + b, 0) / arr.length;
        if (p === 0 || p === 1) return 0;
        return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    }
    
    const e1 = localEntropy(results.slice(0, 6));
    const e2 = localEntropy(results.slice(6, 12));
    const e3 = localEntropy(results.slice(12, 18));
    
    if (e1 < e2 && e2 < e3) {
        const bias = results.slice(0, 6).reduce((a, b) => a + b, 0);
        return bias >= 3 ? 'T' : 'X';
    }
    
    if (e1 > e2 && e2 > e3 && e1 > 0.9) {
        return results[0] === 1 ? 'X' : 'T';
    }
    return null;
}

// Thuật toán 14: Cycle Detection
function algo14_cycleDetection(history) {
    const results = history.map(h => h.tx === 'T' ? 1 : 0);
    if (results.length < 12) return null;
    
    for (let cycle = 3; cycle <= 6; cycle++) {
        if (results.length >= cycle * 2) {
            let match = true;
            for (let i = 0; i < cycle; i++) {
                if (results[i] !== results[i + cycle]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return results[0] === 1 ? 'T' : 'X';
            }
        }
    }
    return null;
}

// Thuật toán 15: Mean Reversion
function algo15_meanReversion(history) {
    const totals = history.map(h => h.total);
    if (history.length < 15) return null;
    
    const mean = totals.slice(-15).reduce((a, b) => a + b, 0) / 15;
    const lastTotal = totals[totals.length - 1];
    
    if (lastTotal > mean + 2.5) return 'X';
    if (lastTotal < mean - 2.5) return 'T';
    return null;
}

// Thuật toán 16: Smart Counter
function algo16_smartCounter(history) {
    const tx = history.map(h => h.tx);
    if (history.length < 15) return null;
    
    const last3 = tx.slice(-3).join('');
    let tCount = 0;
    let xCount = 0;
    
    for (let i = 0; i <= tx.length - 4; i++) {
        if (tx.slice(i, i + 3).join('') === last3) {
            if (tx[i + 3] === 'T') {
                tCount++;
            } else {
                xCount++;
            }
        }
    }
    
    const total = tCount + xCount;
    if (total >= 3) {
        if (tCount > xCount * 1.5) return 'T';
        if (xCount > tCount * 1.5) return 'X';
    }
    return null;
}

// Thuật toán 17: Ultimate Hybrid
function algo17_ultimateHybrid(history) {
    if (history.length < 15) return null;
    
    let score = 0;
    const checks = [algo3_deepTrend, algo6_patternFusion, algo10_markovChain, algo11_ensembleVoting, algo12_momentumDivergence];
    let active = 0;
    
    for (const fn of checks) {
        const result = fn(history);
        if (result === 'T') {
            score += 1.5;
            active++;
        } else if (result === 'X') {
            score -= 1.5;
            active++;
        }
    }
    
    if (active < 3) return null;
    if (score >= 2.5) return 'T';
    if (score <= -2.5) return 'X';
    return null;
}

// ============ DANH SÁCH THUẬT TOÁN ============
const ALGORITHMS = [
    { id: 'ultra_pattern', fn: algo1_ultraPattern },
    { id: 'quantum_ai', fn: algo2_quantumAI },
    { id: 'deep_trend', fn: algo3_deepTrend },
    { id: 'smart_bridge', fn: algo4_smartBridge },
    { id: 'volatility', fn: algo5_volatility },
    { id: 'pattern_fusion', fn: algo6_patternFusion },
    { id: 'realtime_ai', fn: algo7_realtimeAI },
    { id: 'neural_osc', fn: algo8_neuralOscillator },
    { id: 'sup_res', fn: algo9_supportResistance },
    { id: 'markov', fn: algo10_markovChain },
    { id: 'ensemble', fn: algo11_ensembleVoting },
    { id: 'momentum_div', fn: algo12_momentumDivergence },
    { id: 'entropy', fn: algo13_entropyGradient },
    { id: 'cycle', fn: algo14_cycleDetection },
    { id: 'mean_rev', fn: algo15_meanReversion },
    { id: 'smart_counter', fn: algo16_smartCounter },
    { id: 'ultimate', fn: algo17_ultimateHybrid },
];

// ============ AI ENGINE ============
class UltimateBrainAI {
    constructor() {
        this.history = [];
        this.weights = {};
        this.performance = {};
        this.recentPredictions = {};
        
        ALGORITHMS.forEach(algo => {
            this.weights[algo.id] = 1.0;
            this.performance[algo.id] = {
                correct: 0,
                total: 0,
                recent: [],
                streak: 0
            };
            this.recentPredictions[algo.id] = null;
        });
    }

    updatePerformance(actualTx) {
        ALGORITHMS.forEach(algo => {
            const lastPred = this.recentPredictions[algo.id];
            if (lastPred) {
                const correct = lastPred === actualTx;
                const perf = this.performance[algo.id];
                
                perf.total++;
                if (correct) {
                    perf.correct++;
                    perf.streak = Math.max(0, perf.streak) + 1;
                } else {
                    perf.streak = Math.min(0, perf.streak) - 1;
                }
                
                perf.recent.push(correct ? 1 : 0);
                if (perf.recent.length > 10) {
                    perf.recent.shift();
                }
                
                if (perf.total >= 10) {
                    const accuracy = perf.correct / perf.total;
                    const recentAccuracy = perf.recent.reduce((a, b) => a + b, 0) / perf.recent.length;
                    let newWeight = Math.max(0.3, Math.min(3.0, (accuracy * 0.5 + recentAccuracy * 0.5) * 3));
                    this.weights[algo.id] = this.weights[algo.id] * 0.7 + newWeight * 0.3;
                }
            }
        });
    }

    predict() {
        if (this.history.length < 8) {
            return {
                prediction: 'Tài',
                confidence: 55
            };
        }

        const predictions = [];
        this.recentPredictions = {};

        ALGORITHMS.forEach(algo => {
            try {
                const result = algo.fn(this.history);
                if (result === 'T' || result === 'X') {
                    const weight = this.weights[algo.id] || 1.0;
                    predictions.push({
                        prediction: result,
                        weight: weight
                    });
                    this.recentPredictions[algo.id] = result;
                }
            } catch (e) {
                // Bỏ qua lỗi
            }
        });

        if (predictions.length === 0) {
            const last = this.history[this.history.length - 1];
            return {
                prediction: last.tx === 'T' ? 'Xỉu' : 'Tài',
                confidence: 55
            };
        }

        let scoreT = 0;
        let scoreX = 0;
        let totalWeight = 0;

        predictions.forEach(p => {
            if (p.prediction === 'T') {
                scoreT += p.weight;
            } else {
                scoreX += p.weight;
            }
            totalWeight += p.weight;
        });

        const finalPred = scoreT > scoreX ? 'T' : 'X';
        const confidence = Math.round((Math.max(scoreT, scoreX) / totalWeight) * 100);

        return {
            prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
            confidence: Math.max(60, Math.min(98, confidence))
        };
    }

    addResult(record) {
        const parsed = {
            session: record.session || getPhien(record),
            total: record.total || getTong(record),
            tx: (record.total || getTong(record)) >= 11 ? 'T' : 'X',
            result: record.result || getKetQua(record),
            dice: record.dice || [getX1(record), getX2(record), getX3(record)]
        };

        if (this.history.length >= 8) {
            this.updatePerformance(parsed.tx);
        }

        this.history.push(parsed);
        if (this.history.length > 50) {
            this.history = this.history.slice(-30);
        }

        return parsed;
    }
}

// ============ KHỞI TẠO AI ============
const ai = new UltimateBrainAI();

function superPredict(sessions) {
    // Nạp lịch sử vào AI
    ai.history = sessions.map(s => ({
        total: getTong(s),
        tx: getTong(s) >= 11 ? 'T' : 'X',
        result: getKetQua(s),
        dice: [getX1(s), getX2(s), getX3(s)],
        session: getPhien(s)
    }));

    return ai.predict();
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;

        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) {
            return null;
        }

        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));

        // Lấy 20 phiên gần nhất
        const count = Math.min(20, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);

        return latest;
    } catch (e) {
        console.error('Fetch error:', e.message);
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) {
            isUpdating = false;
            return;
        }

        const latestPhien = getPhien(sessions[sessions.length - 1]);
        const oldLatestPhien = gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0;

        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            // Xác minh dự đoán cũ
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);

                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);

                    if (isCorrect) {
                        consecutiveCorrect++;
                        consecutiveWrong = 0;
                    } else {
                        consecutiveWrong++;
                        consecutiveCorrect = 0;
                    }

                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: getKetQua(actual).toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });

                    if (verifiedResults.length > 500) {
                        verifiedResults = verifiedResults.slice(0, 500);
                    }

                    try {
                        fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2));
                    } catch (e) {}
                }
            }

            // Cập nhật game history
            gameHistory = sessions;

            // Dự đoán mới
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                timestamp: new Date().toISOString()
            };
        }
    } catch (e) {
        console.error('Update error:', e.message);
    }

    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    // Nếu có dữ liệu cache, trả về ngay
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);

        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') {
                consLosses++;
            } else {
                break;
            }
        }

        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';

        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: getPhien(latest),
                Xuc_xac_1: getX1(latest),
                Xuc_xac_2: getX2(latest),
                Xuc_xac_3: getX3(latest),
                Tong: getTong(latest),
                Ket_qua: getKetQua(latest)
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                consecutiveLosses: consLosses,
                winRate: winRate + "%",
                totalPredictions: totalV,
                totalWins: totalW
            },
            win_loss_table: winLoss
        });
    }

    // Fallback: fetch trực tiếp
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: 0,
                Xuc_xac_1: 0,
                Xuc_xac_2: 0,
                Xuc_xac_3: 0,
                Tong: 0,
                Ket_qua: "Đang tải..."
            },
            phien_hien_tai: {
                Phien: 0,
                Du_doan: "Đang tải...",
                Do_tin_cay: "0%"
            },
            stats: {
                consecutiveLosses: 0,
                winRate: "0%",
                totalPredictions: 0,
                totalWins: 0
            },
            win_loss_table: []
        });
    }

    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = {
        phien: getPhien(latest) + 1,
        prediction: pred.prediction,
        confidence: pred.confidence,
        timestamp: new Date().toISOString()
    };

    res.json({
        id: "@vuaoccac",
        phien_truoc: {
            Phien: getPhien(latest),
            Xuc_xac_1: getX1(latest),
            Xuc_xac_2: getX2(latest),
            Xuc_xac_3: getX3(latest),
            Tong: getTong(latest),
            Ket_qua: getKetQua(latest)
        },
        phien_hien_tai: {
            Phien: getPhien(latest) + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%"
        },
        stats: {
            consecutiveLosses: 0,
            winRate: "0%",
            totalPredictions: 0,
            totalWins: 0
        },
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
            id: "@vuaoccac",
            phien_truoc: {
                Phien: getPhien(latest),
                Xuc_xac_1: getX1(latest),
                Xuc_xac_2: getX2(latest),
                Xuc_xac_3: getX3(latest),
                Tong: getTong(latest),
                Ket_qua: getKetQua(latest)
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                totalPredictions: verifiedResults.length,
                winRate: winRate + "%",
                consecutiveCorrect: consecutiveCorrect,
                consecutiveWrong: consecutiveWrong
            },
            win_loss_table: winLoss
        });
    }
    res.json({ status: "OK" });
});

// ============ KHỞI ĐỘNG ============
try {
    if (fs.existsSync('./verified_results.json')) {
        verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    }
} catch (e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('ULTIMATE BRAIN AI - 17 THUẬT TOÁN - 20 PHIÊN');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT}`);
    console.log(`API: ${API_URL}`);
    console.log(`20 phiên phân tích | 500 phiên lịch sử`);
    console.log(`17 thuật toán: Ultra Pattern, Quantum AI, Deep Trend,`);
    console.log(`Smart Bridge, Volatility, Pattern Fusion, Real-time AI,`);
    console.log(`Neural Oscillator, Sup/Res, Markov, Ensemble, Momentum,`);
    console.log(`Entropy, Cycle, Mean Reversion, Smart Counter, Ultimate Hybrid`);
    console.log('='.repeat(60));
});
