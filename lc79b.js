const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';
const KETQUA_FILE = 'ketqua_thang_thua.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500;
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let winLossHistory = { hu: [], md5: [] };
let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let sessionsStore = { hu: [], md5: [] };
let isReady = { hu: false, md5: false };
let predictors = { hu: null, md5: null };

// ==================== COMPOSITE PREDICTOR ====================

class CompositePredictor {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.results = this.processed.map(p => p.result);
        this.totals = this.processed.map(p => p.total);
        this.init();
        if (data.length >= 50) this.train();
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const result = item.Ket_qua === "Tài" ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx-1].Ket_qua === item.Ket_qua) streak = arr[idx-1].streak + 1;
            return {
                Phien: item.Phien, result, resultStr: item.Ket_qua,
                total: item.Tong, dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                isPair: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2]),
                pairVal: dice[0] === dice[1] ? dice[0] : (dice[0] === dice[2] ? dice[0] : dice[1]),
                range: Math.max(...dice) - Math.min(...dice),
                avg: (dice[0] + dice[1] + dice[2]) / 3
            };
        });
    }

    init() {
        this.markov = {};
        for (let order = 1; order <= 8; order++) this.markov[order] = {};
        this.freq = {};
        this.cycle = { length: 0, confidence: 0 };
        this.trend = { direction: 0, strength: 0 };
        this.streakStats = { Tai: {}, Xiu: {} };
        this.bayes = { Tai: 0.5386, Xiu: 0.4614 };
        this.fib = [2, 3, 5, 8, 13, 21];
        this.pairStats = {};
        this.rsi = { value: 50, signal: null };
        this.bollinger = { upper: 0, lower: 0, middle: 0 };
        this.macd = { macd: 0, signal: 0, histogram: 0 };
        this.stochastic = { k: 50, d: 50 };
        this.williams = { r: -50 };
        this.cci = { value: 0 };
        this.entropy = 0;
        this.linearReg = { slope: 0, intercept: 0 };
        this.knn = { k: 5, features: [], labels: [] };
        this.decisionTree = {};
        this.ensemble = { weights: {
            markov: 0.9, freq: 0.7, cycle: 0.65, trend: 0.7, streak: 0.85, bayes: 0.6,
            fibo: 0.7, pair: 0.7, rsi: 0.55, bollinger: 0.55, macd: 0.55, stochastic: 0.55,
            williams: 0.55, cci: 0.55, entropy: 0.65, linearReg: 0.6, knn: 0.75,
            decisionTree: 0.8, meanReversion: 0.65, patternMatching: 0.85
        } };
        this.meanReversion = { threshold: 0.6 };
        this.patternMatcher = { patterns: {} };
    }

    train() {
        if (this.processed.length < 50) return;
        
        for (let order = 1; order <= 8; order++) {
            const trans = {};
            for (let i = order; i < this.results.length - 1; i++) {
                const key = this.results.slice(i - order, i).join('');
                const next = this.results[i + 1];
                if (!trans[key]) trans[key] = { 0: 0, 1: 0 };
                trans[key][next]++;
            }
            this.markov[order] = trans;
        }

        for (let window of [10, 20, 50]) {
            let lastWin = this.results.slice(-Math.min(window, this.results.length));
            let tai = lastWin.filter(r => r === 1).length;
            this.freq[window] = tai / lastWin.length;
        }

        this.detectCycle();
        this.detectTrend();

        for (let s = 2; s <= 7; s++) {
            let tai = 0, xiu = 0;
            for (let i = s; i < this.results.length; i++) {
                let ok = true;
                for (let j = 1; j <= s; j++) {
                    if (this.results[i - j] !== this.results[i - 1]) { ok = false; break; }
                }
                if (ok) {
                    if (this.results[i] === 1) tai++;
                    else xiu++;
                }
            }
            if (tai + xiu > 15) {
                this.streakStats.Tai[s] = tai / (tai + xiu);
                this.streakStats.Xiu[s] = xiu / (tai + xiu);
            }
        }

        for (let p = 1; p <= 6; p++) {
            let tai = 0, xiu = 0;
            for (let i = 1; i < this.processed.length; i++) {
                if (this.processed[i-1].pairVal === p && !this.processed[i-1].isTriple) {
                    if (this.processed[i].result === 1) tai++;
                    else xiu++;
                }
            }
            if (tai + xiu > 8) this.pairStats[p] = tai / (tai + xiu);
        }

        this.trainKNN();
        this.trainDecisionTree();
    }

    detectCycle() {
        let bestCycle = 0, bestScore = 0;
        for (let cycle = 3; cycle <= 15; cycle++) {
            if (this.results.length <= cycle) continue;
            let matches = 0;
            for (let i = cycle; i < this.results.length; i++) {
                if (this.results[i] === this.results[i - cycle]) matches++;
            }
            let score = matches / (this.results.length - cycle);
            if (score > bestScore && score > 0.55) {
                bestScore = score;
                bestCycle = cycle;
            }
        }
        this.cycle = { length: bestCycle, confidence: bestScore };
    }

    detectTrend() {
        let n = Math.min(50, this.totals.length);
        if (n < 3) return;
        let x = Array.from({ length: n }, (_, i) => i);
        let y = this.totals.slice(-n);
        let xMean = x.reduce((a,b)=>a+b,0)/n;
        let yMean = y.reduce((a,b)=>a+b,0)/n;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
            num += (x[i] - xMean) * (y[i] - yMean);
            den += (x[i] - xMean) ** 2;
        }
        let slope = den ? num / den : 0;
        this.trend = { direction: slope > 0 ? 1 : -1, strength: Math.min(1, Math.abs(slope) / 5) };
        this.linearReg = { slope, intercept: yMean - slope * xMean };
    }

    trainKNN() {
        let features = [], labels = [];
        for (let i = 10; i < this.results.length - 1; i++) {
            let feat = [
                this.results.slice(i-5, i).reduce((a,b)=>a+b,0),
                this.totals.slice(i-5, i).reduce((a,b)=>a+b,0)/5,
                this.results[i-1]
            ];
            features.push(feat);
            labels.push(this.results[i+1]);
        }
        this.knn = { k: 5, features, labels };
    }

    trainDecisionTree() {
        let rules = {};
        for (let i = 5; i < this.results.length - 1; i++) {
            let key = this.results.slice(i-5, i).join('');
            let next = this.results[i+1];
            if (!rules[key]) rules[key] = { 0: 0, 1: 0 };
            rules[key][next]++;
        }
        this.decisionTree = rules;
    }

    // ========== CÁC PHƯƠNG PHÁP DỰ ĐOÁN ==========

    predictMarkov(order) {
        if (this.results.length < order + 2) return null;
        let key = this.results.slice(-order).join('');
        let trans = this.markov[order][key];
        if (trans && trans[0] + trans[1] >= 3) {
            let probTai = trans[1] / (trans[0] + trans[1]);
            if (probTai > 0.65) return { pred: "Tài", conf: probTai * 100, type: `Markov${order}` };
            if (probTai < 0.35) return { pred: "Xỉu", conf: (1 - probTai) * 100, type: `Markov${order}` };
        }
        return null;
    }

    predictAllMarkov() {
        for (let order = 8; order >= 3; order--) {
            let p = this.predictMarkov(order);
            if (p) return p;
        }
        return null;
    }

    predictFrequency(window) {
        if (!this.freq[window]) return null;
        let probTai = this.freq[window];
        if (probTai > 0.6) return { pred: "Tài", conf: probTai * 100, type: `Freq${window}` };
        if (probTai < 0.4) return { pred: "Xỉu", conf: (1 - probTai) * 100, type: `Freq${window}` };
        return null;
    }

    predictCycle() {
        if (this.cycle.length > 0 && this.cycle.confidence > 0.6 && this.results.length > this.cycle.length) {
            let expected = this.results[this.results.length - this.cycle.length];
            let pred = expected === 1 ? "Tài" : "Xỉu";
            return { pred, conf: this.cycle.confidence * 100, type: "Cycle" };
        }
        return null;
    }

    predictTrend() {
        if (Math.abs(this.trend.strength) > 0.3) {
            let pred = this.trend.direction === 1 ? "Tài" : "Xỉu";
            return { pred, conf: 60 + this.trend.strength * 20, type: "Trend" };
        }
        return null;
    }

    predictStreak() {
        let last = this.processed[this.processed.length - 1];
        if (last.streak >= 3) {
            let prob = last.result === 1 ? this.streakStats.Xiu[last.streak] : this.streakStats.Tai[last.streak];
            if (prob && prob > 0.55) {
                let pred = last.result === 1 ? "Xỉu" : "Tài";
                return { pred, conf: prob * 100, type: "Streak" };
            }
        }
        return null;
    }

    predictBayes() {
        let last = this.processed[this.processed.length - 1];
        let likelihood = last.result === 1 ? 0.55 : 0.45;
        let posteriorTai = (this.bayes.Tai * likelihood) / (this.bayes.Tai * likelihood + this.bayes.Xiu * (1 - likelihood));
        if (posteriorTai > 0.65) return { pred: "Tài", conf: posteriorTai * 100, type: "Bayes" };
        if (posteriorTai < 0.35) return { pred: "Xỉu", conf: (1 - posteriorTai) * 100, type: "Bayes" };
        return null;
    }

    predictFibonacci() {
        let last = this.processed[this.processed.length - 1];
        for (let fib of this.fib) {
            if (this.results.length > fib) {
                let prev = this.results[this.results.length - fib];
                if (prev === last.result) {
                    let pred = last.result === 1 ? "Xỉu" : "Tài";
                    return { pred, conf: 64, type: "Fibonacci" };
                }
            }
        }
        return null;
    }

    predictPair() {
        let last = this.processed[this.processed.length - 1];
        let prob = this.pairStats[last.pairVal];
        if (prob && prob > 0.6 && !last.isTriple) return { pred: "Tài", conf: prob * 100, type: "Pair" };
        if (prob && prob < 0.4 && !last.isTriple) return { pred: "Xỉu", conf: (1 - prob) * 100, type: "Pair" };
        return null;
    }

    predictRSI() {
        if (this.totals.length < 15) return null;
        let gains = [], losses = [];
        let period = 14;
        for (let i = this.totals.length - period; i < this.totals.length; i++) {
            if (i > 0) {
                let change = this.totals[i] - this.totals[i-1];
                if (change > 0) gains.push(change);
                else losses.push(-change);
            }
        }
        let avgGain = gains.reduce((a,b)=>a+b,0) / period;
        let avgLoss = losses.reduce((a,b)=>a+b,0) / period;
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        let rsi = 100 - (100 / (1 + rs));
        if (rsi > 70) return { pred: "Xỉu", conf: 62, type: "RSI" };
        if (rsi < 30) return { pred: "Tài", conf: 62, type: "RSI" };
        return null;
    }

    predictBollinger() {
        if (this.totals.length < 21) return null;
        let period = 20;
        let slice = this.totals.slice(-period);
        let mean = slice.reduce((a,b)=>a+b,0)/period;
        let variance = slice.map(v => (v - mean)**2).reduce((a,b)=>a+b,0)/period;
        let std = Math.sqrt(variance);
        let upper = mean + 2 * std;
        let lower = mean - 2 * std;
        let last = this.totals[this.totals.length - 1];
        if (last > upper) return { pred: "Xỉu", conf: 63, type: "Bollinger" };
        if (last < lower) return { pred: "Tài", conf: 63, type: "Bollinger" };
        return null;
    }

    predictMACD() {
        if (this.totals.length < 27) return null;
        let fast = 12, slow = 26, signal = 9;
        let emaFast = this.ema(this.totals, fast);
        let emaSlow = this.ema(this.totals, slow);
        let macdLine = emaFast - emaSlow;
        let signalLine = this.ema([macdLine], signal);
        let histogram = macdLine - signalLine;
        if (histogram > 0 && this.macd.histogram <= 0) return { pred: "Tài", conf: 60, type: "MACD" };
        if (histogram < 0 && this.macd.histogram >= 0) return { pred: "Xỉu", conf: 60, type: "MACD" };
        this.macd = { macd: macdLine, signal: signalLine, histogram };
        return null;
    }

    ema(data, period) {
        let k = 2 / (period + 1);
        let emaVal = data[0];
        for (let i = 1; i < data.length; i++) emaVal = data[i] * k + emaVal * (1 - k);
        return emaVal;
    }

    predictStochastic() {
        if (this.totals.length < 15) return null;
        let period = 14;
        let highs = [], lows = [];
        for (let i = this.totals.length - period; i < this.totals.length; i++) {
            highs.push(this.totals[i]);
            lows.push(this.totals[i]);
        }
        let highest = Math.max(...highs);
        let lowest = Math.min(...lows);
        let k = (this.totals[this.totals.length - 1] - lowest) / (highest - lowest) * 100;
        if (k > 80) return { pred: "Xỉu", conf: 61, type: "Stochastic" };
        if (k < 20) return { pred: "Tài", conf: 61, type: "Stochastic" };
        return null;
    }

    predictWilliams() {
        if (this.totals.length < 15) return null;
        let period = 14;
        let highs = [], lows = [];
        for (let i = this.totals.length - period; i < this.totals.length; i++) {
            highs.push(this.totals[i]);
            lows.push(this.totals[i]);
        }
        let highest = Math.max(...highs);
        let lowest = Math.min(...lows);
        let r = (highest - this.totals[this.totals.length - 1]) / (highest - lowest) * -100;
        if (r < -80) return { pred: "Tài", conf: 62, type: "Williams" };
        if (r > -20) return { pred: "Xỉu", conf: 62, type: "Williams" };
        return null;
    }

    predictCCI() {
        if (this.totals.length < 21) return null;
        let period = 20;
        let slice = this.totals.slice(-period);
        let mean = slice.reduce((a,b)=>a+b,0)/period;
        let mad = slice.map(v => Math.abs(v - mean)).reduce((a,b)=>a+b,0)/period;
        let cci = (this.totals[this.totals.length - 1] - mean) / (0.015 * mad);
        if (cci > 100) return { pred: "Xỉu", conf: 60, type: "CCI" };
        if (cci < -100) return { pred: "Tài", conf: 60, type: "CCI" };
        return null;
    }

    predictEntropy() {
        let last20 = this.results.slice(-20);
        let tai = last20.filter(r => r === 1).length;
        let p = tai / 20;
        let entropy = -(p * Math.log2(p + 0.001) + (1-p) * Math.log2(1-p + 0.001));
        if (entropy < 0.7) {
            let pred = tai >= 11 ? "Tài" : "Xỉu";
            return { pred, conf: 65, type: "Entropy" };
        }
        return null;
    }

    predictLinearReg() {
        if (this.totals.length < 50) return null;
        let last = this.totals[this.totals.length - 1];
        let predicted = this.linearReg.intercept + this.linearReg.slope * (this.totals.length);
        let diff = predicted - last;
        if (diff > 2) return { pred: "Tài", conf: 60, type: "LinearReg" };
        if (diff < -2) return { pred: "Xỉu", conf: 60, type: "LinearReg" };
        return null;
    }

    predictKNN() {
        if (!this.knn.features || this.knn.features.length === 0) return null;
        let lastFeat = [
            this.results.slice(-5).reduce((a,b)=>a+b,0),
            this.totals.slice(-5).reduce((a,b)=>a+b,0)/5,
            this.results[this.results.length - 1]
        ];
        let distances = [];
        for (let i = 0; i < this.knn.features.length; i++) {
            let dist = Math.hypot(
                lastFeat[0] - this.knn.features[i][0],
                lastFeat[1] - this.knn.features[i][1],
                lastFeat[2] - this.knn.features[i][2]
            );
            distances.push({ dist, label: this.knn.labels[i] });
        }
        distances.sort((a,b) => a.dist - b.dist);
        let kNearest = distances.slice(0, this.knn.k);
        let taiCount = kNearest.filter(d => d.label === 1).length;
        let prob = taiCount / this.knn.k;
        if (prob > 0.7) return { pred: "Tài", conf: prob * 100, type: "KNN" };
        if (prob < 0.3) return { pred: "Xỉu", conf: (1 - prob) * 100, type: "KNN" };
        return null;
    }

    predictDecisionTree() {
        if (this.results.length < 6) return null;
        let last5 = this.results.slice(-5).join('');
        let rule = this.decisionTree[last5];
        if (rule && rule[0] + rule[1] >= 3) {
            let prob = rule[1] / (rule[0] + rule[1]);
            if (prob > 0.7) return { pred: "Tài", conf: prob * 100, type: "DecisionTree" };
            if (prob < 0.3) return { pred: "Xỉu", conf: (1 - prob) * 100, type: "DecisionTree" };
        }
        return null;
    }

    predictMeanReversion() {
        if (this.totals.length < 21) return null;
        let last20 = this.totals.slice(-20);
        let mean = last20.reduce((a,b)=>a+b,0)/20;
        let last = this.totals[this.totals.length - 1];
        let diff = Math.abs(last - mean);
        if (diff > 4) {
            let pred = last > mean ? "Xỉu" : "Tài";
            return { pred, conf: 62, type: "MeanReversion" };
        }
        return null;
    }

    predictPatternMatching() {
        if (this.results.length < 12) return null;
        let last10 = this.results.slice(-10).join('');
        let best = { pred: null, conf: 0 };
        for (let i = 0; i < this.results.length - 12; i++) {
            let pattern = this.results.slice(i, i+10).join('');
            let match = 0;
            for (let j = 0; j < 10; j++) {
                if (pattern[j] == last10[j]) match++;
            }
            if (match >= 7) {
                let next = this.results[i+10];
                let pred = next === 1 ? "Tài" : "Xỉu";
                let conf = 55 + match * 3;
                if (conf > best.conf) best = { pred, conf, type: "PatternMatching" };
            }
        }
        return best.pred ? best : null;
    }

    predict() {
        let allSignals = [
            this.predictAllMarkov(),
            this.predictFrequency(10), this.predictFrequency(20), this.predictFrequency(50),
            this.predictCycle(), this.predictTrend(), this.predictStreak(), this.predictBayes(),
            this.predictFibonacci(), this.predictPair(), this.predictRSI(), this.predictBollinger(),
            this.predictMACD(), this.predictStochastic(), this.predictWilliams(), this.predictCCI(),
            this.predictEntropy(), this.predictLinearReg(), this.predictKNN(),
            this.predictDecisionTree(), this.predictMeanReversion(), this.predictPatternMatching()
        ].filter(p => p !== null);

        if (allSignals.length === 0) {
            let last10 = this.results.slice(-10);
            let taiCount = last10.filter(r => r === 1).length;
            let fallback = taiCount >= 6 ? "Xỉu" : "Tài";
            return { prediction: fallback, confidence: 52, signals: [] };
        }

        let taiScore = 0, xiuScore = 0;
        for (let p of allSignals) {
            let typeKey = p.type.replace(/[0-9]/g, '');
            let weight = this.ensemble.weights[typeKey] || 0.6;
            let score = (p.conf / 100) * weight;
            if (p.pred === "Tài") taiScore += score;
            else xiuScore += score;
        }
        
        let finalPred = taiScore > xiuScore ? "Tài" : "Xỉu";
        let total = taiScore + xiuScore;
        let confidence = total > 0 ? Math.max(taiScore, xiuScore) / total * 100 : 50;
        confidence = Math.min(94, Math.max(60, confidence));
        
        return {
            prediction: finalPred,
            confidence: Math.round(confidence),
            signals: allSignals.sort((a, b) => b.conf - a.conf)
        };
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadAllData() {
    try {
        if (fs.existsSync(KETQUA_FILE)) {
            const data = fs.readFileSync(KETQUA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            winLossHistory = parsed.winLossHistory || { hu: [], md5: [] };
            console.log(`✅ Đã tải lịch sử thắng thua: HU=${winLossHistory.hu.length}, MD5=${winLossHistory.md5.length}`);
        }
    } catch (error) { console.error('❌ Lỗi load thắng thua:', error.message); }
    
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: HU=${sessionsStore.hu.length}, MD5=${sessionsStore.md5.length}`);
            
            if (sessionsStore.hu.length >= 30) {
                isReady.hu = true;
                predictors.hu = new CompositePredictor(sessionsStore.hu);
            }
            if (sessionsStore.md5.length >= 30) {
                isReady.md5 = true;
                predictors.md5 = new CompositePredictor(sessionsStore.md5);
            }
        }
    } catch (error) { console.error('❌ Lỗi load sessions:', error.message); }
    
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.predictionHistory || { hu: [], md5: [] };
            lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            console.log(`✅ Đã tải lịch sử dự đoán: HU=${predictionHistory.hu.length}, MD5=${predictionHistory.md5.length}`);
        }
    } catch (error) { console.error('❌ Lỗi load dự đoán:', error.message); }
}

function saveAllData() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsStore, null, 2));
    } catch (error) { console.error('❌ Lỗi save sessions:', error.message); }
    
    try {
        fs.writeFileSync(KETQUA_FILE, JSON.stringify({ winLossHistory, lastUpdated: new Date().toISOString() }, null, 2));
    } catch (error) { console.error('❌ Lỗi save thắng thua:', error.message); }
    
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

async function fetchDataHu() {
    try {
        const response = await axios.get(API_URL_HU, { timeout: 15000, params: { limit: FETCH_PER_REQUEST } });
        return transformApiData(response.data);
    } catch (error) {
        console.error('❌ [HU] Fetch error:', error.message);
        return null;
    }
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

function updateSessions(type, newData) {
    if (!newData || newData.length === 0) return 0;
    
    const existingMap = new Map();
    sessionsStore[type].forEach(s => existingMap.set(s.Phien, s));
    
    let addedCount = 0;
    for (const s of newData) {
        if (!existingMap.has(s.Phien)) {
            sessionsStore[type].push(s);
            addedCount++;
        }
    }
    
    sessionsStore[type].sort((a, b) => b.Phien - a.Phien);
    if (sessionsStore[type].length > 1000) {
        sessionsStore[type] = sessionsStore[type].slice(0, 1000);
    }
    return addedCount;
}

async function fetchAndUpdate(type) {
    const fetchFn = type === 'hu' ? fetchDataHu : fetchDataMd5;
    const data = await fetchFn();
    if (!data) return false;
    
    const addedCount = updateSessions(type, data);
    if (addedCount > 0) saveAllData();
    
    if (!isReady[type] && sessionsStore[type].length >= 30) {
        isReady[type] = true;
        predictors[type] = new CompositePredictor(sessionsStore[type]);
        console.log(`🎉 [${type.toUpperCase()}] ĐÃ SẴN SÀNG!`);
    } else if (isReady[type] && predictors[type] && addedCount > 0) {
        predictors[type] = new CompositePredictor(sessionsStore[type]);
    }
    return true;
}

// ==================== VERIFY & RECORD (1 PHIÊN 1 DỮ LIỆU) ====================

function verifyAndRecord(type) {
    if (!predictors[type]) return;
    
    const data = sessionsStore[type];
    let updated = false;
    
    for (let i = 0; i < predictionHistory[type].length; i++) {
        const record = predictionHistory[type][i];
        if (record.da_kiem_tra) continue;
        
        const actualResult = data.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            const isCorrect = record.du_doan === actualResult.Ket_qua;
            record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            
            // Thêm vào lịch sử thắng thua - CHỈ 1 BẢN GHI DUY NHẤT
            const existingIndex = winLossHistory[type].findIndex(w => w.phien_du_doan === record.phien_du_doan);
            const winLossRecord = {
                phien_hien_tai: record.phien_hien_tai,
                phien_du_doan: record.phien_du_doan,
                du_doan: record.du_doan,
                ket_qua_thuc_te: actualResult.Ket_qua,
                ket_qua: isCorrect ? 'Đúng' : 'Sai',
                do_tin_cay: record.do_tin_cay,
                thoi_gian: new Date().toISOString()
            };
            
            if (existingIndex !== -1) {
                winLossHistory[type][existingIndex] = winLossRecord;
            } else {
                winLossHistory[type].push(winLossRecord);
            }
            updated = true;
        }
    }
    
    // Giới hạn 500 phiên
    if (winLossHistory[type].length > MAX_HISTORY) {
        winLossHistory[type] = winLossHistory[type].slice(-MAX_HISTORY);
    }
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    
    if (updated) {
        saveAllData();
        const stats = calculateStats(type);
        console.log(`📊 [${type.toUpperCase()}] Đúng=${stats.dung}, Sai=${stats.sai}, Tỉ lệ=${stats.tiLe}%`);
    }
}

function calculateStats(type) {
    let dung = 0, sai = 0;
    for (const record of winLossHistory[type]) {
        if (record.ket_qua === 'Đúng') dung++;
        else if (record.ket_qua === 'Sai') sai++;
    }
    const total = dung + sai;
    const tiLe = total > 0 ? (dung / total * 100).toFixed(2) : 0;
    return { dung, sai, tiLe, total };
}

function savePredictionToHistory(type, phienDuDoan, phienHienTai, prediction, confidence, latestData, signals = []) {
    const record = {
        phien_hien_tai: phienHienTai.toString(),
        phien_du_doan: phienDuDoan.toString(),
        du_doan: prediction,
        do_tin_cay: `${confidence}%`,
        ket_qua_du_doan: '',
        ket_qua_thuc_te: '',
        da_kiem_tra: false,
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
        signals: signals.slice(0, 5).map(s => s.type),
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

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU...');
    console.log('═══════════════════════════════════════════════════');
    
    while (true) {
        await Promise.all([fetchAndUpdate('hu'), fetchAndUpdate('md5')]);
        await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
    }
}

async function autoProcess() {
    if (!isReady.hu && !isReady.md5) return;
    
    try {
        if (isReady.hu && predictors.hu) {
            await fetchAndUpdate('hu');
            verifyAndRecord('hu');
            
            const latestSessions = sessionsStore.hu;
            if (latestSessions.length > 0 && predictors.hu) {
                const latestPhien = latestSessions[0].Phien;
                const nextPhien = latestPhien + 1;
                
                if (lastProcessedPhien.hu !== nextPhien) {
                    const result = predictors.hu.predict();
                    savePredictionToHistory('hu', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.signals);
                    lastProcessedPhien.hu = nextPhien;
                    const stats = calculateStats('hu');
                    console.log(`[DỰ ĐOÁN] 🧠 HU Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - 📊 TL: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
                    saveAllData();
                }
            }
        }
        
        if (isReady.md5 && predictors.md5) {
            await fetchAndUpdate('md5');
            verifyAndRecord('md5');
            
            const latestSessions = sessionsStore.md5;
            if (latestSessions.length > 0 && predictors.md5) {
                const latestPhien = latestSessions[0].Phien;
                const nextPhien = latestPhien + 1;
                
                if (lastProcessedPhien.md5 !== nextPhien) {
                    const result = predictors.md5.predict();
                    savePredictionToHistory('md5', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.signals);
                    lastProcessedPhien.md5 = nextPhien;
                    const stats = calculateStats('md5');
                    console.log(`[DỰ ĐOÁN] 🧠 MD5 Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - 📊 TL: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
                    saveAllData();
                }
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
    console.log('🚀 COMPOSITE PREDICTOR - 22+ PHƯƠNG PHÁP DỰ ĐOÁN');
    console.log(`📋 Lưu tối đa ${MAX_HISTORY} phiên - 1 phiên 1 dữ liệu`);
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
    const huStats = calculateStats('hu');
    const md5Stats = calculateStats('md5');
    res.json({
        hu: { sessions: sessionsStore.hu.length, ready: isReady.hu, ...huStats },
        md5: { sessions: sessionsStore.md5.length, ready: isReady.md5, ...md5Stats }
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        if (!isReady.hu || !predictors.hu) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.hu.length}/30` });
        }
        
        await fetchAndUpdate('hu');
        verifyAndRecord('hu');
        
        const latestSessions = sessionsStore.hu;
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictors.hu.predict();
        const stats = calculateStats('hu');
        
        const record = savePredictionToHistory('hu', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.signals);
        
        res.json({
            phien_hien_tai: record.phien_hien_tai,
            phien_du_doan: record.phien_du_doan,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            signals: result.signals.slice(0, 8).map(s => ({ type: s.type, pred: s.pred, conf: s.conf.toFixed(1) })),
            thong_ke: { tong_du_doan: stats.total, so_dung: stats.dung, so_sai: stats.sai, ti_le_thang: `${stats.tiLe}%` },
            id: 'love trang'
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        if (!isReady.md5 || !predictors.md5) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.md5.length}/30` });
        }
        
        await fetchAndUpdate('md5');
        verifyAndRecord('md5');
        
        const latestSessions = sessionsStore.md5;
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictors.md5.predict();
        const stats = calculateStats('md5');
        
        const record = savePredictionToHistory('md5', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.signals);
        
        res.json({
            phien_hien_tai: record.phien_hien_tai,
            phien_du_doan: record.phien_du_doan,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            signals: result.signals.slice(0, 8).map(s => ({ type: s.type, pred: s.pred, conf: s.conf.toFixed(1) })),
            thong_ke: { tong_du_doan: stats.total, so_dung: stats.dung, so_sai: stats.sai, ti_le_thang: `${stats.tiLe}%` },
            id: 'love trang'
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-hu/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
        lich_su_du_doan: predictionHistory.hu,
        lich_su_thang_thua: winLossHistory.hu,
        tong_so: predictionHistory.hu.length,
        thong_ke: calculateStats('hu')
    });
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        lich_su_du_doan: predictionHistory.md5,
        lich_su_thang_thua: winLossHistory.md5,
        tong_so: predictionHistory.md5.length,
        thong_ke: calculateStats('md5')
    });
});

app.get('/lc79-hu/thongke', (req, res) => {
    res.json({ type: 'HU', ...calculateStats('hu'), lich_su_gan_day: winLossHistory.hu.slice(-20) });
});

app.get('/lc79-md5/thongke', (req, res) => {
    res.json({ type: 'MD5', ...calculateStats('md5'), lich_su_gan_day: winLossHistory.md5.slice(-20) });
});

app.get('/lc79-hu/analysis', (req, res) => {
    if (!isReady.hu || !predictors.hu) return res.json({ status: 'loading' });
    const result = predictors.hu.predict();
    res.json({
        prediction: result.prediction,
        confidence: result.confidence,
        signals: result.signals.slice(0, 15).map(s => ({ type: s.type, pred: s.pred, conf: s.conf.toFixed(1) }))
    });
});

app.get('/lc79-md5/analysis', (req, res) => {
    if (!isReady.md5 || !predictors.md5) return res.json({ status: 'loading' });
    const result = predictors.md5.predict();
    res.json({
        prediction: result.prediction,
        confidence: result.confidence,
        signals: result.signals.slice(0, 15).map(s => ({ type: s.type, pred: s.pred, conf: s.conf.toFixed(1) }))
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('🚀 COMPOSITE PREDICTOR - 22+ PHƯƠNG PHÁP DỰ ĐOÁN');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC PHƯƠNG PHÁP DỰ ĐOÁN:');
    console.log('   • Markov chains (bậc 3-8)');
    console.log('   • Tần suất (10, 20, 50 phiên)');
    console.log('   • Chu kỳ & Xu hướng');
    console.log('   • Streak & Bẻ cầu');
    console.log('   • Bayes & Fibonacci');
    console.log('   • RSI, Bollinger, MACD, Stochastic, Williams, CCI');
    console.log('   • Entropy & Linear Regression');
    console.log('   • KNN, Decision Tree, Pattern Matching');
    console.log('');
    console.log('📊 TÍNH NĂNG:');
    console.log(`   • 1 phiên 1 dữ liệu - không bị nhảy`);
    console.log(`   • Lưu tối đa ${MAX_HISTORY} phiên`);
    console.log('   • Tự động đối chiếu kết quả');
    console.log('   • Thống kê tỉ lệ thắng');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
