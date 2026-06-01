const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'tiendat1.json';
const SESSIONS_FILE = 'sessions_data.json';

// ===== CẤU HÌNH =====
const MAX_SESSIONS = 30; // Chỉ lấy 30 phiên gần nhất để dự đoán
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
let lastProcessedPhien = { hu: null, md5: null };

let sessionsStore = {
  hu: [],
  md5: []
};

let isReady = {
  hu: false,
  md5: false
};

// ==================== SUPER INTELLIGENT PREDICTOR V6.0 ====================

class SuperIntelligentPredictor {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.level1 = this.initLevel1();
        this.level2 = this.initLevel2();
        this.level3 = this.initLevel3();
        this.level4 = this.initLevel4();
        this.level5 = this.initLevel5();
        this.level6 = this.initLevel6();
        this.level7 = this.initLevel7();
        this.level8 = this.initLevel8();
        
        this.weights = this.initAdaptiveWeights();
        
        if (data.length >= 20) {
            this.train(200);
        }
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const result = item.Ket_qua === "Tài" ? 1 : 0;
            const sum = dice[0] + dice[1] + dice[2];
            
            let streak = 1;
            if (idx > 0 && arr[idx-1].Ket_qua === item.Ket_qua) streak = arr[idx-1].streak + 1;
            
            const faceStreaks = {}, faceGaps = {};
            for (let f = 1; f <= 6; f++) {
                let s = 0, lastIdx = -1;
                for (let j = idx; j >= 0; j--) {
                    if (arr[j].Xuc_xac_1 === f || arr[j].Xuc_xac_2 === f || arr[j].Xuc_xac_3 === f) {
                        s++;
                        if (lastIdx === -1) lastIdx = j;
                    } else break;
                }
                faceStreaks[f] = s;
                faceGaps[f] = lastIdx === -1 ? idx + 1 : idx - lastIdx;
            }
            
            let sum5 = 0, sum10 = 0, sum20 = 0, tai5 = 0, tai10 = 0, tai20 = 0;
            for (let j = Math.max(0, idx-4); j <= idx; j++) { 
                sum5 += arr[j].Tong; 
                if (arr[j].Ket_qua === "Tài") tai5++; 
            }
            for (let j = Math.max(0, idx-9); j <= idx; j++) { 
                sum10 += arr[j].Tong; 
                if (arr[j].Ket_qua === "Tài") tai10++; 
            }
            for (let j = Math.max(0, idx-19); j <= idx; j++) { 
                sum20 += arr[j].Tong; 
                if (arr[j].Ket_qua === "Tài") tai20++; 
            }
            
            const avg5 = sum5 / Math.min(5, idx+1);
            const avg10 = sum10 / Math.min(10, idx+1);
            const avg20 = sum20 / Math.min(20, idx+1);
            
            const range = Math.max(...dice) - Math.min(...dice);
            const deviation = sum - avg10;
            const zScore = (sum - avg20) / (Math.sqrt(avg20) || 1);
            
            let entropy = 0;
            if (idx >= 9) {
                let tai = 0, xiu = 0;
                for (let j = idx-9; j <= idx; j++) {
                    if (arr[j].Ket_qua === "Tài") tai++;
                    else xiu++;
                }
                const pTai = tai / 10, pXiu = xiu / 10;
                entropy = -(pTai * Math.log2(pTai + 0.001) + pXiu * Math.log2(pXiu + 0.001));
            }
            
            let randomness = 0;
            if (idx >= 9) {
                let changes = 0;
                for (let j = idx-8; j <= idx; j++) {
                    if (arr[j].Ket_qua !== arr[j-1].Ket_qua) changes++;
                }
                randomness = changes / 9;
            }
            
            return {
                Phien: item.Phien, result, resultStr: item.Ket_qua,
                total: sum, dice, streak, faceStreaks, faceGaps,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                isPair: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2]),
                pairVal: dice[0] === dice[1] ? dice[0] : (dice[0] === dice[2] ? dice[0] : dice[1]),
                range, deviation, zScore, avg5, avg10, avg20,
                entropy, randomness, tai5, tai10, tai20,
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    initLevel1() {
        return { markov1: {}, markov2: {}, markov3: {}, markov4: {} };
    }

    initLevel2() {
        return { patterns: {}, rarePatterns: new Map(), patternStreaks: {} };
    }

    initLevel3() {
        return { fibonacci: [1, 2, 3, 5, 8, 13, 21, 34], cycles: {}, faceFibonacci: {} };
    }

    initLevel4() {
        return { entropyThreshold: 0.95, randomnessThreshold: 0.6 };
    }

    initLevel5() {
        return { expectedFreq: 0.5, thresholds: { under: 0.3, over: 0.8 } };
    }

    initLevel6() {
        return { prior: { Tai: 0.5386, Xiu: 0.4614 }, likelihoods: {}, posterior: { Tai: 0.5386, Xiu: 0.4614 } };
    }

    initLevel7() {
        return { models: [], weights: [], predictions: [] };
    }

    initLevel8() {
        return { qTable: {}, alpha: 0.1, gamma: 0.9, epsilon: 0.1 };
    }

    trainMarkov() {
        for (let i = 1; i < this.processed.length; i++) {
            const state = this.processed[i-1].result;
            const next = this.processed[i].result;
            if (!this.level1.markov1[state]) this.level1.markov1[state] = { 0: 0, 1: 0 };
            this.level1.markov1[state][next]++;
        }
        
        for (let i = 2; i < this.processed.length; i++) {
            const state = `${this.processed[i-2].result}${this.processed[i-1].result}`;
            const next = this.processed[i].result;
            if (!this.level1.markov2[state]) this.level1.markov2[state] = { 0: 0, 1: 0 };
            this.level1.markov2[state][next]++;
        }
        
        for (let i = 3; i < this.processed.length; i++) {
            const state = `${this.processed[i-3].result}${this.processed[i-2].result}${this.processed[i-1].result}`;
            const next = this.processed[i].result;
            if (!this.level1.markov3[state]) this.level1.markov3[state] = { 0: 0, 1: 0 };
            this.level1.markov3[state][next]++;
        }
        
        for (let i = 4; i < this.processed.length; i++) {
            const state = `${this.processed[i-4].result}${this.processed[i-3].result}${this.processed[i-2].result}${this.processed[i-1].result}`;
            const next = this.processed[i].result;
            if (!this.level1.markov4[state]) this.level1.markov4[state] = { 0: 0, 1: 0 };
            this.level1.markov4[state][next]++;
        }
    }

    trainPatterns() {
        for (let len of [3, 4, 5, 6, 7, 8]) {
            for (let i = len; i < this.processed.length; i++) {
                const pattern = this.processed.slice(i - len, i).map(p => p.result).join('');
                const next = this.processed[i].result;
                if (!this.level2.patterns[pattern]) this.level2.patterns[pattern] = { 0: 0, 1: 0, total: 0 };
                this.level2.patterns[pattern][next]++;
                this.level2.patterns[pattern].total++;
            }
        }
    }

    train(epochs = 200) {
        if (this.processed.length < 20) return;
        
        this.trainMarkov();
        this.trainPatterns();
        
        for (let i = 20; i < this.processed.length - 1 && i < 300; i++) {
            const state = this.getStateFromIdx(i);
            const action = this.getAction(state);
            const actual = this.processed[i + 1].result;
            const reward = (action === "Tài" && actual === 1) || (action === "Xỉu" && actual === 0) ? 1 : -1;
            const nextState = this.getStateFromIdx(i + 1);
            this.updateQ(state, action, reward, nextState);
        }
    }

    getStateFromIdx(idx) {
        const p = this.processed[idx];
        const start = Math.max(0, idx - 4);
        const last5 = this.processed.slice(start, idx + 1).map(p => p.result).join('');
        const streakState = p.streak >= 5 ? 5 : p.streak;
        return `${last5}_${streakState}_${p.total}`;
    }

    getAction(state) {
        if (!this.level8.qTable[state]) {
            this.level8.qTable[state] = { Tai: 0, Xiu: 0 };
        }
        if (Math.random() < this.level8.epsilon) {
            return Math.random() < 0.5 ? "Tài" : "Xỉu";
        }
        return this.level8.qTable[state].Tai >= this.level8.qTable[state].Xiu ? "Tài" : "Xỉu";
    }

    updateQ(state, action, reward, nextState) {
        if (!this.level8.qTable[state]) {
            this.level8.qTable[state] = { Tai: 0, Xiu: 0 };
        }
        if (!this.level8.qTable[nextState]) {
            this.level8.qTable[nextState] = { Tai: 0, Xiu: 0 };
        }
        
        const oldValue = this.level8.qTable[state][action];
        const nextMax = Math.max(this.level8.qTable[nextState].Tai, this.level8.qTable[nextState].Xiu);
        const newValue = oldValue + this.level8.alpha * (reward + this.level8.gamma * nextMax - oldValue);
        this.level8.qTable[state][action] = newValue;
    }

    batMarkov(order = 1) {
        if (this.processed.length < order) return null;
        const last = this.processed.slice(-order).map(p => p.result).join('');
        const chain = this.level1[`markov${order}`][last];
        if (chain && (chain[0] + chain[1]) > 5) {
            const taiProb = chain[1] / (chain[0] + chain[1]);
            if (taiProb > 0.65) return { pred: "Tài", conf: taiProb * 100, reason: `Markov bậc ${order}`, type: "markov" };
            if (taiProb < 0.35) return { pred: "Xỉu", conf: (1 - taiProb) * 100, reason: `Markov bậc ${order}`, type: "markov" };
        }
        return null;
    }

    batPatternThongMinh() {
        for (let len of [8, 7, 6, 5, 4, 3]) {
            if (this.processed.length < len) continue;
            const lastPattern = this.processed.slice(-len).map(p => p.result).join('');
            const patternStat = this.level2.patterns[lastPattern];
            if (patternStat && patternStat.total > 3) {
                const taiProb = patternStat[1] / patternStat.total;
                if (taiProb > 0.7) return { pred: "Tài", conf: taiProb * 100, reason: `Pattern ${len}p (cao)`, type: "pattern" };
                if (taiProb < 0.3) return { pred: "Xỉu", conf: (1 - taiProb) * 100, reason: `Pattern ${len}p (cao)`, type: "pattern" };
                if (taiProb > 0.62 && len >= 5) return { pred: "Tài", conf: taiProb * 100, reason: `Pattern ${len}p`, type: "pattern" };
                if (taiProb < 0.38 && len >= 5) return { pred: "Xỉu", conf: (1 - taiProb) * 100, reason: `Pattern ${len}p`, type: "pattern" };
            }
        }
        return null;
    }

    batFibonacci() {
        if (this.processed.length === 0) return null;
        const last = this.processed[this.processed.length - 1];
        
        for (let f = 1; f <= 6; f++) {
            const gap = last.faceGaps[f];
            if (this.level3.fibonacci.includes(gap) && gap <= 34) {
                const reverseProb = f <= 3 ? 68 : 72;
                return { pred: f <= 3 ? "Tài" : "Xỉu", conf: reverseProb, reason: `Fibonacci gap ${gap} mặt ${f}`, type: "fibonacci" };
            }
        }
        
        const lastResults = this.processed.slice(-34).map(p => p.result);
        for (let fib of this.level3.fibonacci) {
            if (fib < lastResults.length && lastResults[lastResults.length - fib] === last.result) {
                return { pred: last.result === 1 ? "Xỉu" : "Tài", conf: 64, reason: `Fibonacci chu kỳ ${fib}`, type: "fibonacci" };
            }
        }
        return null;
    }

    batEntropy() {
        if (this.processed.length === 0) return null;
        const last = this.processed[this.processed.length - 1];
        
        if (last.entropy > 0.98) {
            return { pred: last.result === 1 ? "Xỉu" : "Tài", conf: 67, reason: `Entropy cao → đảo`, type: "entropy" };
        }
        
        if (last.entropy < 0.85 && this.processed.length >= 5) {
            const lastResults = this.processed.slice(-5).map(p => p.result);
            const mostCommon = lastResults.filter(r => r === 1).length > 2 ? 1 : 0;
            return { pred: mostCommon === 1 ? "Tài" : "Xỉu", conf: 62, reason: `Entropy thấp → theo trend`, type: "entropy" };
        }
        return null;
    }

    batPoisson() {
        if (this.processed.length < 10) return null;
        const last = this.processed[this.processed.length - 1];
        
        for (let f = 1; f <= 6; f++) {
            let count = 0;
            for (let j = Math.max(0, this.processed.length - 10); j < this.processed.length; j++) {
                if (this.processed[j].has(f)) count++;
            }
            const freq = count / 10;
            if (freq < 0.2 && !last.has(f)) {
                const reverseProb = f <= 3 ? 70 : 74;
                return { pred: f <= 3 ? "Tài" : "Xỉu", conf: reverseProb, reason: `Poisson: mặt ${f} vắng ${10-count}/10`, type: "poisson" };
            }
        }
        return null;
    }

    updateBayesian(observation) {
        const likelihood = { Tai: 0.55, Xiu: 0.45 };
        const posteriorTai = (this.level6.posterior.Tai * likelihood.Tai) / 
            (this.level6.posterior.Tai * likelihood.Tai + this.level6.posterior.Xiu * likelihood.Xiu);
        this.level6.posterior = { Tai: posteriorTai, Xiu: 1 - posteriorTai };
    }

    batBayesian() {
        const posterior = this.level6.posterior;
        if (posterior.Tai > 0.65) return { pred: "Tài", conf: posterior.Tai * 100, reason: "Bayesian posterior", type: "bayesian" };
        if (posterior.Xiu > 0.65) return { pred: "Xỉu", conf: posterior.Xiu * 100, reason: "Bayesian posterior", type: "bayesian" };
        return null;
    }

    ensemblePredict() {
        const predictions = [];
        
        const markov1 = this.batMarkov(1);
        if (markov1) predictions.push({ pred: markov1.pred, weight: 0.9 });
        
        const markov2 = this.batMarkov(2);
        if (markov2) predictions.push({ pred: markov2.pred, weight: 0.85 });
        
        const pattern = this.batPatternThongMinh();
        if (pattern) predictions.push({ pred: pattern.pred, weight: 0.88 });
        
        const fibonacci = this.batFibonacci();
        if (fibonacci) predictions.push({ pred: fibonacci.pred, weight: 0.82 });
        
        const entropy = this.batEntropy();
        if (entropy) predictions.push({ pred: entropy.pred, weight: 0.75 });
        
        const poisson = this.batPoisson();
        if (poisson) predictions.push({ pred: poisson.pred, weight: 0.8 });
        
        if (predictions.length === 0) return null;
        
        let taiScore = 0, xiuScore = 0;
        for (const p of predictions) {
            if (p.pred === "Tài") taiScore += p.weight;
            else xiuScore += p.weight;
        }
        
        const total = taiScore + xiuScore;
        const confidence = Math.max(taiScore, xiuScore) / total * 100;
        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        
        return { pred: finalPred, conf: confidence, reason: "Ensemble learning", type: "ensemble" };
    }

    batReinforcement() {
        if (this.processed.length === 0) return null;
        const state = this.getStateFromIdx(this.processed.length - 1);
        const action = this.getAction(state);
        const confidence = this.level8.qTable[state] ? 
            Math.abs(this.level8.qTable[state].Tai - this.level8.qTable[state].Xiu) * 50 + 50 : 55;
        return { pred: action, conf: Math.min(85, confidence), reason: "Reinforcement learning", type: "rl" };
    }

    batCau11() {
        if (this.processed.length < 2) return null;
        const last2 = this.processed.slice(-2);
        if (last2[0].result !== last2[1].result) {
            return { pred: last2[1].result === 1 ? "Xỉu" : "Tài", conf: 61, reason: "Cầu 1-1", type: "cau11" };
        }
        return null;
    }

    batCau22() {
        if (this.processed.length < 4) return null;
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
            return { pred: last4[0] === 1 ? "Xỉu" : "Tài", conf: 62.5, reason: "Cầu 2-2", type: "cau22" };
        }
        return null;
    }

    batCau33() {
        if (this.processed.length < 6) return null;
        const last6 = this.processed.slice(-6).map(p => p.result);
        if (last6[0] === last6[1] && last6[1] === last6[2] && 
            last6[3] === last6[4] && last6[4] === last6[5] &&
            last6[0] !== last6[3]) {
            return { pred: last6[0] === 1 ? "Xỉu" : "Tài", conf: 64, reason: "Cầu 3-3", type: "cau33" };
        }
        return null;
    }

    batCau121() {
        if (this.processed.length < 5) return null;
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] !== last5[4]) {
            return { pred: last5[0] === 1 ? "Tài" : "Xỉu", conf: 63, reason: "Cầu 1-2-1", type: "cau121" };
        }
        return null;
    }

    batCau212() {
        if (this.processed.length < 5) return null;
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
            return { pred: last5[0] === 1 ? "Xỉu" : "Tài", conf: 62, reason: "Cầu 2-1-2", type: "cau212" };
        }
        return null;
    }

    batCau12321() {
        if (this.processed.length < 7) return null;
        const last7 = this.processed.slice(-7).map(p => p.result);
        if (last7[0] !== last7[1] && last7[1] === last7[2] && last7[2] !== last7[3] &&
            last7[3] !== last7[4] && last7[4] === last7[5] && last7[5] !== last7[6]) {
            return { pred: last7[0] === 1 ? "Tài" : "Xỉu", conf: 66, reason: "Cầu 1-2-3-2-1", type: "cau12321" };
        }
        return null;
    }

    batCauDoiXung() {
        if (this.processed.length < 10) return null;
        const last10 = this.processed.slice(-10).map(p => p.result);
        let isSymmetric = true;
        for (let i = 0; i < 5; i++) {
            if (last10[i] !== last10[9 - i]) { isSymmetric = false; break; }
        }
        if (isSymmetric) {
            return { pred: last10[4] === 1 ? "Xỉu" : "Tài", conf: 68, reason: "Cầu đối xứng 10 nhịp", type: "doiXung" };
        }
        return null;
    }

    batCauTangDan() {
        if (this.processed.length < 6) return null;
        const last6 = this.processed.slice(-6).map(p => p.total);
        let isIncreasing = true, isDecreasing = true;
        for (let i = 1; i < 6; i++) {
            if (last6[i] <= last6[i-1]) isIncreasing = false;
            if (last6[i] >= last6[i-1]) isDecreasing = false;
        }
        if (isIncreasing) return { pred: "Xỉu", conf: 64, reason: "Tổng tăng dần 6 phiên", type: "tangDan" };
        if (isDecreasing) return { pred: "Tài", conf: 63, reason: "Tổng giảm dần 6 phiên", type: "tangDan" };
        return null;
    }

    initAdaptiveWeights() {
        return {
            level1: 95, level2: 90, level3: 85, level4: 80, level5: 82, level6: 78, level7: 92, level8: 88,
            cau11: 85, cau22: 85, cau33: 80, cau121: 82, cau212: 82, cau12321: 88, doiXung: 86, tangDan: 75
        };
    }

    predict() {
        const signals = [];
        
        const markov1 = this.batMarkov(1);
        if (markov1) signals.push({ ...markov1, weight: this.weights.level1 });
        
        const markov2 = this.batMarkov(2);
        if (markov2) signals.push({ ...markov2, weight: this.weights.level1 - 5 });
        
        const pattern = this.batPatternThongMinh();
        if (pattern) signals.push({ ...pattern, weight: this.weights.level2 });
        
        const fibonacci = this.batFibonacci();
        if (fibonacci) signals.push({ ...fibonacci, weight: this.weights.level3 });
        
        const entropy = this.batEntropy();
        if (entropy) signals.push({ ...entropy, weight: this.weights.level4 });
        
        const poisson = this.batPoisson();
        if (poisson) signals.push({ ...poisson, weight: this.weights.level5 });
        
        const bayesian = this.batBayesian();
        if (bayesian) signals.push({ ...bayesian, weight: this.weights.level6 });
        
        const ensemble = this.ensemblePredict();
        if (ensemble) signals.push({ ...ensemble, weight: this.weights.level7 });
        
        const rl = this.batReinforcement();
        if (rl) signals.push({ ...rl, weight: this.weights.level8 });
        
        const cau11 = this.batCau11();
        if (cau11) signals.push({ ...cau11, weight: this.weights.cau11 });
        
        const cau22 = this.batCau22();
        if (cau22) signals.push({ ...cau22, weight: this.weights.cau22 });
        
        const cau33 = this.batCau33();
        if (cau33) signals.push({ ...cau33, weight: this.weights.cau33 });
        
        const cau121 = this.batCau121();
        if (cau121) signals.push({ ...cau121, weight: this.weights.cau121 });
        
        const cau212 = this.batCau212();
        if (cau212) signals.push({ ...cau212, weight: this.weights.cau212 });
        
        const cau12321 = this.batCau12321();
        if (cau12321) signals.push({ ...cau12321, weight: this.weights.cau12321 });
        
        const doiXung = this.batCauDoiXung();
        if (doiXung) signals.push({ ...doiXung, weight: this.weights.doiXung });
        
        const tangDan = this.batCauTangDan();
        if (tangDan) signals.push({ ...tangDan, weight: this.weights.tangDan });
        
        const validSignals = signals.filter(s => s.conf >= 55);
        
        if (validSignals.length === 0 && this.processed.length >= 10) {
            const last10 = this.processed.slice(-10).map(p => p.result);
            const taiCount = last10.reduce((a, b) => a + b, 0);
            const pred = taiCount >= 7 ? "Xỉu" : (taiCount <= 3 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }
        
        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => {
            const w = (s.weight / 100) * (s.conf / 100);
            if (s.pred === "Tài") taiScore += w;
            else xiuScore += w;
        });
        
        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        confidence = Math.min(97, Math.max(60, confidence));
        
        this.updateBayesian(finalPred);
        
        return {
            prediction: finalPred,
            confidence: Math.round(confidence),
            signals: validSignals.sort((a, b) => b.weight - a.weight),
            fallback: false
        };
    }

    updateWithNewData(newData) {
        if (!newData || newData.length === 0) return;
        
        this.raw = [...newData, ...this.raw].slice(0, MAX_SESSIONS);
        this.processed = this.preprocess(this.raw);
        
        if (this.processed.length >= 20) {
            this.train(50);
        }
    }
}

// ==================== PREDICTOR INSTANCES ====================

let predictors = {
    hu: null,
    md5: null
};

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadSessionsStore() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      sessionsStore = JSON.parse(data);
      console.log('✅ Sessions data loaded from sessions_data.json');
      console.log(`   - HU: ${sessionsStore.hu.length} sessions`);
      console.log(`   - MD5: ${sessionsStore.md5.length} sessions`);
      
      if (sessionsStore.hu.length >= MAX_SESSIONS) {
        isReady.hu = true;
        predictors.hu = new SuperIntelligentPredictor(sessionsStore.hu.slice(0, MAX_SESSIONS));
        console.log(`   ✅ HU ready (${sessionsStore.hu.length} sessions)`);
      }
      if (sessionsStore.md5.length >= MAX_SESSIONS) {
        isReady.md5 = true;
        predictors.md5 = new SuperIntelligentPredictor(sessionsStore.md5.slice(0, MAX_SESSIONS));
        console.log(`   ✅ MD5 ready (${sessionsStore.md5.length} sessions)`);
      }
    }
  } catch (error) {
    console.error('❌ Error loading sessions data:', error.message);
  }
}

function saveSessionsStore() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsStore, null, 2));
  } catch (error) {
    console.error('❌ Error saving sessions data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Prediction history loaded from tiendat1.json');
    }
  } catch (error) {
    console.error('❌ Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('❌ Error saving prediction history:', error.message);
  }
}

// ==================== API DATA FETCHING ====================

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) {
    return null;
  }
  
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
    const response = await axios.get(API_URL_HU, { 
      timeout: 15000,
      params: { limit: FETCH_PER_REQUEST }
    });
    return transformApiData(response.data);
  } catch (error) {
    console.error('❌ [HU] Fetch error:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { 
      timeout: 15000,
      params: { limit: FETCH_PER_REQUEST }
    });
    return transformApiData(response.data);
  } catch (error) {
    console.error('❌ [MD5] Fetch error:', error.message);
    return null;
  }
}

// ==================== TÍCH LŨY PHIÊN ====================

function updateSessions(type, newData) {
  if (!newData || newData.length === 0) return 0;
  
  const existingMap = new Map();
  sessionsStore[type].forEach(s => existingMap.set(s.Phien, s));
  
  let addedCount = 0;
  newData.forEach(s => {
    if (!existingMap.has(s.Phien)) {
      sessionsStore[type].push(s);
      addedCount++;
    }
  });
  
  sessionsStore[type].sort((a, b) => b.Phien - a.Phien);
  
  if (sessionsStore[type].length > MAX_SESSIONS * 2) {
    sessionsStore[type] = sessionsStore[type].slice(0, MAX_SESSIONS * 2);
  }
  
  return addedCount;
}

async function fetchAndUpdate(type) {
  let fetchFn = type === 'hu' ? fetchDataHu : fetchDataMd5;
  let data = await fetchFn();
  
  if (!data || data.length === 0) return false;
  
  const addedCount = updateSessions(type, data);
  
  if (addedCount > 0) {
    console.log(`📥 [${type.toUpperCase()}] +${addedCount} mới | Tổng: ${sessionsStore[type].length} phiên`);
    saveSessionsStore();
  }
  
  if (!isReady[type] && sessionsStore[type].length >= MAX_SESSIONS) {
    isReady[type] = true;
    predictors[type] = new SuperIntelligentPredictor(sessionsStore[type].slice(0, MAX_SESSIONS));
    console.log(`🎉 [${type.toUpperCase()}] ĐÃ SẴN SÀNG! Dùng ${MAX_SESSIONS} phiên gần nhất`);
  } else if (isReady[type] && predictors[type] && addedCount > 0) {
    const latestSessions = sessionsStore[type].slice(0, MAX_SESSIONS);
    predictors[type].updateWithNewData(latestSessions);
  }
  
  return true;
}

// ==================== AUTO FETCH LOOP ====================

async function fetchLoop() {
  console.log('═══════════════════════════════════════════════════');
  console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU...');
  console.log(`📋 Lấy ${FETCH_PER_REQUEST} phiên mỗi lần, nghỉ ${FETCH_INTERVAL/1000}s`);
  console.log(`🎯 Chỉ giữ ${MAX_SESSIONS} phiên gần nhất để dự đoán`);
  console.log('═══════════════════════════════════════════════════');
  
  while (true) {
    const tasks = [];
    
    if (!isReady.hu || true) {
      tasks.push(fetchAndUpdate('hu'));
    }
    
    if (!isReady.md5 || true) {
      tasks.push(fetchAndUpdate('md5'));
    }
    
    await Promise.all(tasks);
    
    const huStatus = isReady.hu ? '✅' : `${sessionsStore.hu.length}/${MAX_SESSIONS}`;
    const md5Status = isReady.md5 ? '✅' : `${sessionsStore.md5.length}/${MAX_SESSIONS}`;
    console.log(`📊 Trạng thái: HU=[${huStatus}] | MD5=[${md5Status}]`);
    
    await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
  }
}

// ==================== VERIFY PREDICTIONS ====================

async function verifyPredictions(type, currentData) {
  if (!predictors[type]) return;
  
  let updated = false;
  
  for (const record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actualResult) {
      if (record.Du_doan === actualResult.Ket_qua) {
        record.ket_qua_du_doan = 'Đúng ✅';
      } else {
        record.ket_qua_du_doan = 'Sai ❌';
      }
      updated = true;
    }
  }
  
  if (updated) {
    savePredictionHistory();
  }
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: 'love trang',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

// ==================== AUTO PROCESS ====================

async function autoProcessPredictions() {
  if (!isReady.hu && !isReady.md5) {
    return;
  }
  
  try {
    if (isReady.hu && predictors.hu) {
      await fetchAndUpdate('hu');
      
      const latestSessions = sessionsStore.hu.slice(0, MAX_SESSIONS);
      if (latestSessions.length > 0) {
        predictors.hu.updateWithNewData(latestSessions);
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        
        if (lastProcessedPhien.hu !== nextPhien) {
          await verifyPredictions('hu', sessionsStore.hu);
          
          const result = predictors.hu.predict();
          savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, latestSessions[0]);
          
          lastProcessedPhien.hu = nextPhien;
          console.log(`[DỰ ĐOÁN] 🧠 HU Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - Signals: ${result.signals.length}`);
        }
      }
    }
    
    if (isReady.md5 && predictors.md5) {
      await fetchAndUpdate('md5');
      
      const latestSessions = sessionsStore.md5.slice(0, MAX_SESSIONS);
      if (latestSessions.length > 0) {
        predictors.md5.updateWithNewData(latestSessions);
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        
        if (lastProcessedPhien.md5 !== nextPhien) {
          await verifyPredictions('md5', sessionsStore.md5);
          
          const result = predictors.md5.predict();
          savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, latestSessions[0]);
          
          lastProcessedPhien.md5 = nextPhien;
          console.log(`[DỰ ĐOÁN] 🧠 MD5 Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - Signals: ${result.signals.length}`);
        }
      }
    }
    
    savePredictionHistory();
    
  } catch (error) {
    console.error('[Auto] ❌ Error:', error.message);
  }
}

// ==================== STARTUP ====================

async function startup() {
  loadSessionsStore();
  loadPredictionHistory();
  
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 KHỞI ĐỘNG SUPER INTELLIGENT PREDICTOR V6.0');
  console.log(`📋 Chỉ giữ ${MAX_SESSIONS} phiên gần nhất để dự đoán`);
  console.log('═══════════════════════════════════════════════════');
  
  fetchLoop();
  
  setTimeout(() => {
    startAutoSaveTask();
  }, 5000);
}

function startAutoSaveTask() {
  console.log(`⏰ Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools');
});

app.get('/status', (req, res) => {
  res.json({
    hu: {
      sessions: sessionsStore.hu.length,
      maxSessions: MAX_SESSIONS,
      ready: isReady.hu,
      predictions: predictionHistory.hu.length
    },
    md5: {
      sessions: sessionsStore.md5.length,
      maxSessions: MAX_SESSIONS,
      ready: isReady.md5,
      predictions: predictionHistory.md5.length
    }
  });
});

app.get('/lc79-hu', async (req, res) => {
  try {
    if (!isReady.hu || !predictors.hu) {
      return res.json({ 
        status: 'loading', 
        message: `Đang tải dữ liệu HU: ${sessionsStore.hu.length}/${MAX_SESSIONS}`,
        progress: `${Math.round(sessionsStore.hu.length / MAX_SESSIONS * 100)}%`
      });
    }
    
    await fetchAndUpdate('hu');
    
    const latestSessions = sessionsStore.hu.slice(0, MAX_SESSIONS);
    predictors.hu.updateWithNewData(latestSessions);
    await verifyPredictions('hu', sessionsStore.hu);
    
    const latestPhien = latestSessions[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const predictionResult = predictors.hu.predict();
    
    const record = savePredictionToHistory('hu', nextPhien, predictionResult.prediction, predictionResult.confidence, latestSessions[0]);
    
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
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      totalSessions: sessionsStore.hu.length,
      signals: predictionResult.signals.slice(0, 5)
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    if (!isReady.md5 || !predictors.md5) {
      return res.json({ 
        status: 'loading', 
        message: `Đang tải dữ liệu MD5: ${sessionsStore.md5.length}/${MAX_SESSIONS}`,
        progress: `${Math.round(sessionsStore.md5.length / MAX_SESSIONS * 100)}%`
      });
    }
    
    await fetchAndUpdate('md5');
    
    const latestSessions = sessionsStore.md5.slice(0, MAX_SESSIONS);
    predictors.md5.updateWithNewData(latestSessions);
    await verifyPredictions('md5', sessionsStore.md5);
    
    const latestPhien = latestSessions[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const predictionResult = predictors.md5.predict();
    
    const record = savePredictionToHistory('md5', nextPhien, predictionResult.prediction, predictionResult.confidence, latestSessions[0]);
    
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
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      totalSessions: sessionsStore.md5.length,
      signals: predictionResult.signals.slice(0, 5)
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await verifyPredictions('hu', sessionsStore.hu);
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length,
      accumulatedSessions: sessionsStore.hu.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    await verifyPredictions('md5', sessionsStore.md5);
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length,
      accumulatedSessions: sessionsStore.md5.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    if (!isReady.hu || !predictors.hu) {
      return res.json({ 
        status: 'loading',
        message: `Đang tải: ${sessionsStore.hu.length}/${MAX_SESSIONS}`
      });
    }
    
    const latestSessions = sessionsStore.hu.slice(0, MAX_SESSIONS);
    predictors.hu.updateWithNewData(latestSessions);
    const result = predictors.hu.predict();
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      signals: result.signals,
      fallback: result.fallback
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    if (!isReady.md5 || !predictors.md5) {
      return res.json({ 
        status: 'loading',
        message: `Đang tải: ${sessionsStore.md5.length}/${MAX_SESSIONS}`
      });
    }
    
    const latestSessions = sessionsStore.md5.slice(0, MAX_SESSIONS);
    predictors.md5.updateWithNewData(latestSessions);
    const result = predictors.md5.predict();
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      signals: result.signals,
      fallback: result.fallback
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log('🧠 SUPER INTELLIGENT PREDICTOR V6.0 - 8 CẤP ĐỘ THÔNG MINH');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('📊 CƠ CHẾ HOẠT ĐỘNG:');
  console.log(`   1. Fetch ${FETCH_PER_REQUEST} phiên mỗi ${FETCH_INTERVAL/1000}s`);
  console.log(`   2. Chỉ giữ ${MAX_SESSIONS} phiên gần nhất để dự đoán`);
  console.log(`   3. Dự đoán bằng 8 cấp độ thông minh:`);
  console.log(`      - Markov chains (bậc 1-4)`);
  console.log(`      - Pattern recognition`);
  console.log(`      - Fibonacci & chu kỳ`);
  console.log(`      - Entropy & randomness`);
  console.log(`      - Poisson distribution`);
  console.log(`      - Bayesian updating`);
  console.log(`      - Ensemble learning`);
  console.log(`      - Reinforcement learning (Q-learning)`);
  console.log(`   4. +10 dạng cầu đặc biệt (1-1, 2-2, 3-3, 1-2-1, 2-1-2, 1-2-3-2-1, đối xứng, tăng dần)`);
  console.log('');
  console.log('📁 Files:');
  console.log('   - sessions_data.json: Lưu phiên đã fetch');
  console.log('   - tiendat1.json: Lịch sử dự đoán');
  console.log('👤 ID: love trang');
  console.log('═══════════════════════════════════════════════════');
  
  startup();
});
