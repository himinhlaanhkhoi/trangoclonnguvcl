const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';
const MEMORY_FILE_HU = 'ai_memory_hu.json';
const MEMORY_FILE_MD5 = 'ai_memory_md5.json';
const KETQUA_FILE = 'ketqua_thang_thua.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500; // Lưu tối đa 500 phiên
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let winLossHistory = { hu: [], md5: [] };
let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let sessionsStore = { hu: [], md5: [] };
let isReady = { hu: false, md5: false };

// ==================== SIÊU AI PREDICTOR V11.0 ====================

class SieuAIPredictorV11 {
    constructor(data, type, memoryFile) {
        this.type = type;
        this.raw = data;
        this.memoryFile = memoryFile;
        this.processed = this.sieuPreprocess(data);
        this.memory = this.loadMemory();
        this.patternLibrary = this.buildPatternLibrary();
        this.weights = this.initWeights();
        this.train();
    }

    loadMemory() {
        try {
            if (fs.existsSync(this.memoryFile)) {
                const mem = JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
                console.log(`📀 [${this.type.toUpperCase()}] Đã tải bộ nhớ (${mem.totalSessions || 0} phiên)`);
                return mem;
            }
        } catch(e) {}
        return { patterns: {}, sessions: [], weights: {}, totalSessions: 0 };
    }

    saveMemory() {
        try {
            const toSave = {
                patterns: this.memory.patterns,
                sessions: (this.memory.sessions || []).slice(-1000),
                weights: this.weights,
                totalSessions: (this.memory.sessions || []).length,
                lastUpdate: new Date().toISOString()
            };
            fs.writeFileSync(this.memoryFile, JSON.stringify(toSave, null, 2));
        } catch(e) {}
    }

    sieuPreprocess(data) {
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
            
            const windows = [5, 10, 20, 30, 50];
            const stats = {};
            for (const w of windows) {
                const start = Math.max(0, idx - w + 1);
                const slice = arr.slice(start, idx + 1);
                const tCount = slice.filter(p => p.Ket_qua === "Tài").length;
                const totals = slice.map(p => p.Tong);
                const avgTotal = totals.reduce((a,b) => a+b, 0) / totals.length;
                stats[`taiRate_${w}`] = tCount / w;
                stats[`avgTotal_${w}`] = avgTotal;
                stats[`entropy_${w}`] = this.calcEntropy(slice.map(p => p.Ket_qua === "Tài" ? 1 : 0));
            }
            
            const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
            const tripleVal = isTriple ? dice[0] : 0;
            const isPair = (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !isTriple;
            const pairVal = isPair ? (dice[0] === dice[1] ? dice[0] : (dice[0] === dice[2] ? dice[0] : dice[1])) : 0;
            const range = Math.max(...dice) - Math.min(...dice);
            
            let momentum = 0, zigzag = 0, cluster3 = 0;
            if (idx >= 5) {
                const recent = arr.slice(idx-4, idx+1);
                const recentTai = recent.filter(p => p.Ket_qua === "Tài").length;
                momentum = recentTai - 2.5;
                let changes = 0;
                for (let j = idx-4; j <= idx; j++) {
                    if (j > idx-4 && arr[j].Ket_qua !== arr[j-1].Ket_qua) changes++;
                }
                zigzag = changes / 5;
            }
            if (idx >= 2 && arr[idx-2].Tong === arr[idx-1].Tong && arr[idx-1].Tong === sum) cluster3 = 1;
            
            return {
                Phien: item.Phien, result, resultStr: item.Ket_qua,
                total: sum, dice, streak, faceStreaks, faceGaps,
                isTriple, tripleVal, isPair, pairVal, range,
                momentum, zigzag, cluster3, ...stats
            };
        });
    }

    calcEntropy(arr) {
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

    buildPatternLibrary() {
        const lib = {};
        const patterns = [
            ['TT', 'T', 0.58], ['XX', 'X', 0.58],
            ['TXT', 'T', 0.62], ['XTX', 'X', 0.62],
            ['TTXX', 'X', 0.61], ['XXTT', 'T', 0.61],
            ['TTTXXX', 'X', 0.60], ['XXXTTT', 'T', 0.60],
            ['TXTX', 'X', 0.64], ['XTXT', 'T', 0.64],
            ['TXTXT', 'X', 0.66], ['XTXTX', 'T', 0.66],
            ['TTXXTT', 'X', 0.63], ['XXTTXX', 'T', 0.63],
            ['TTTXXXTTT', 'X', 0.62], ['XXXTTTXXX', 'T', 0.62],
            ['TXXT', 'X', 0.65], ['XTTX', 'T', 0.65],
            ['TXXTX', 'T', 0.67], ['XTTXT', 'X', 0.67],
            ['TTXTT', 'X', 0.64], ['XXTXX', 'T', 0.64],
            ['TXXXT', 'X', 0.66], ['XTTTX', 'T', 0.66],
            ['TTTXTTT', 'X', 0.65], ['XXXTXXX', 'T', 0.65],
            ['TXXTTXXT', 'X', 0.69], ['XTTXXTTX', 'T', 0.69],
            ['TX|XT', 'T', 0.68], ['XT|TX', 'X', 0.68],
            ['TXTXTXT', 'X', 0.70], ['XTXTXTX', 'T', 0.70],
            ['UP_5', 'X', 0.67], ['DOWN_5', 'T', 0.66],
            ['BET2_T', 'T', 0.59], ['BET2_X', 'X', 0.59],
            ['BET3_T', 'T', 0.62], ['BET3_X', 'X', 0.62],
            ['BET4_T', 'X', 0.68], ['BET4_X', 'T', 0.68],
            ['BET5_T', 'X', 0.72], ['BET5_X', 'T', 0.72],
            ['FIB_3', 'X', 0.64], ['FIB_5', 'T', 0.65],
            ['FIB_8', 'X', 0.66], ['FIB_13', 'T', 0.67]
        ];
        for (const [pattern, pred, conf] of patterns) {
            lib[pattern] = { pred, conf };
        }
        return lib;
    }

    initWeights() {
        if (this.memory.weights && Object.keys(this.memory.weights).length > 0) {
            return this.memory.weights;
        }
        return {
            patternMatch: 1.0, markov: 0.95, frequency: 0.85,
            momentum: 0.80, entropy: 0.75, streak: 0.90,
            total: 0.70, triple: 0.85, pair: 0.70,
            faceVacant: 0.88, zigzag: 0.75, cluster: 0.80,
            bet: 0.92, beBet: 0.94, ensemble: 1.0,
            cau11: 0.86, cau22: 0.85, cau121: 0.87,
            cau212: 0.86, doiXung: 0.88, tamGiac: 0.89,
            fibo: 0.82, poisson: 0.84
        };
    }

    train() {
        const trainSize = Math.min(300, Math.floor(this.processed.length * 0.3));
        const performance = {};
        
        for (let i = trainSize; i < this.processed.length - 1 && i < 800; i++) {
            const hist = this.processed.slice(0, i + 1);
            const actual = this.processed[i + 1].resultStr;
            const predictions = this.getAllPredictions(hist);
            
            for (const [method, pred] of Object.entries(predictions)) {
                if (!pred) continue;
                const key = `${method}_${pred}`;
                if (!performance[key]) performance[key] = { correct: 0, total: 0 };
                performance[key].total++;
                if (pred === actual) performance[key].correct++;
            }
        }
        
        for (const method in this.weights) {
            const keyT = `${method}_Tài`;
            const keyX = `${method}_Xỉu`;
            const perfT = performance[keyT];
            const perfX = performance[keyX];
            let accuracy = 0.5;
            if (perfT && perfT.total > 10) accuracy = Math.max(accuracy, perfT.correct / perfT.total);
            if (perfX && perfX.total > 10) accuracy = Math.max(accuracy, perfX.correct / perfX.total);
            this.weights[method] = Math.min(1.2, Math.max(0.3, accuracy * 1.2));
        }
    }

    getAllPredictions(history) {
        return {
            patternMatch: this.predictPattern(history)?.pred,
            markov: this.predictMarkov(history)?.pred,
            frequency: this.predictFrequency(history)?.pred,
            momentum: this.predictMomentum(history)?.pred,
            entropy: this.predictEntropy(history)?.pred,
            total: this.predictTotal(history)?.pred,
            triple: this.predictTriple(history)?.pred,
            pair: this.predictPair(history)?.pred,
            faceVacant: this.predictFaceVacant(history)?.pred,
            zigzag: this.predictZigzag(history)?.pred,
            cluster: this.predictCluster(history)?.pred,
            bet: this.predictBet(history)?.pred,
            cau11: this.predictCau11(history)?.pred,
            cau22: this.predictCau22(history)?.pred,
            cau121: this.predictCau121(history)?.pred,
            cau212: this.predictCau212(history)?.pred,
            doiXung: this.predictDoiXung(history)?.pred,
            tamGiac: this.predictTamGiac(history)?.pred,
            fibo: this.predictFibonacci(history)?.pred,
            poisson: this.predictPoisson(history)?.pred
        };
    }

    predictBet(history) {
        const last = history[history.length - 1];
        if (last.streak < 2) return null;
        
        let avgBetLength = 2.5;
        const streaks = [];
        let cur = history[0].result;
        let len = 1;
        for (let i = 1; i < history.length; i++) {
            if (history[i].result === cur) len++;
            else {
                streaks.push(len);
                cur = history[i].result;
                len = 1;
            }
        }
        streaks.push(len);
        if (streaks.length > 10) avgBetLength = streaks.reduce((a,b)=>a+b,0)/streaks.length;
        
        const currentBetLen = last.streak;
        const isTai = last.result === 1;
        
        if (currentBetLen === 2) {
            const pred = isTai ? "Tài" : "Xỉu";
            let conf = 0.59;
            return { pred, conf, method: "bet" };
        }
        if (currentBetLen === 3) {
            const pred = isTai ? "Tài" : "Xỉu";
            let conf = 0.62;
            return { pred, conf, method: "bet" };
        }
        if (currentBetLen === 4) {
            const pred = isTai ? "Xỉu" : "Tài";
            let conf = 0.68;
            return { pred, conf, method: "beBet" };
        }
        if (currentBetLen >= 5) {
            const pred = isTai ? "Xỉu" : "Tài";
            let conf = 0.72 + Math.min(0.10, (currentBetLen - 5) * 0.02);
            if (currentBetLen >= 8) conf = 0.82;
            return { pred, conf, method: "beBet" };
        }
        return null;
    }

    predictCau11(history) {
        if (history.length < 4) return null;
        const last4 = history.slice(-4).map(h => h.resultStr === "Tài" ? 'T' : 'X');
        if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
            const pred = last4[3] === 'T' ? 'Xỉu' : 'Tài';
            return { pred, conf: 0.66, method: "cau11" };
        }
        return null;
    }

    predictCau22(history) {
        if (history.length < 6) return null;
        const last6 = history.slice(-6).map(h => h.resultStr === "Tài" ? 'T' : 'X');
        if (last6[0] === last6[1] && last6[2] === last6[3] && last6[4] === last6[5] && 
            last6[0] !== last6[2] && last6[2] !== last6[4]) {
            const pred = last6[4] === 'T' ? 'Xỉu' : 'Tài';
            return { pred, conf: 0.65, method: "cau22" };
        }
        return null;
    }

    predictCau121(history) {
        if (history.length < 7) return null;
        const last7 = history.slice(-7).map(h => h.resultStr === "Tài" ? 'T' : 'X');
        if (last7[0] !== last7[1] && last7[1] === last7[2] && last7[2] !== last7[3] &&
            last7[3] !== last7[4] && last7[4] === last7[5] && last7[5] !== last7[6]) {
            const pred = last7[0] === 'T' ? 'Tài' : 'Xỉu';
            return { pred, conf: 0.69, method: "cau121" };
        }
        return null;
    }

    predictCau212(history) {
        if (history.length < 7) return null;
        const last7 = history.slice(-7).map(h => h.resultStr === "Tài" ? 'T' : 'X');
        if (last7[0] === last7[1] && last7[1] !== last7[2] && last7[2] !== last7[3] &&
            last7[3] === last7[4] && last7[4] !== last7[5] && last7[5] !== last7[6]) {
            const pred = last7[0] === 'T' ? 'Xỉu' : 'Tài';
            return { pred, conf: 0.68, method: "cau212" };
        }
        return null;
    }

    predictDoiXung(history) {
        if (history.length < 10) return null;
        const last10 = history.slice(-10).map(h => h.resultStr === "Tài" ? 'T' : 'X');
        let symmetric = true;
        for (let i = 0; i < 5; i++) {
            if (last10[i] !== last10[9-i]) { symmetric = false; break; }
        }
        if (symmetric) {
            const pred = last10[4] === 'T' ? 'Xỉu' : 'Tài';
            return { pred, conf: 0.70, method: "doiXung" };
        }
        return null;
    }

    predictTamGiac(history) {
        if (history.length < 8) return null;
        const last8 = history.slice(-8).map(h => h.resultStr === "Tài" ? 'T' : 'X');
        let isTriangle = true;
        for (let i = 1; i < 8; i++) {
            if (last8[i] === last8[i-1]) { isTriangle = false; break; }
        }
        if (isTriangle) {
            const pred = last8[7] === 'T' ? 'Xỉu' : 'Tài';
            return { pred, conf: 0.72, method: "tamGiac" };
        }
        return null;
    }

    predictFibonacci(history) {
        const fibs = [3, 5, 8, 13, 21];
        const last = history[history.length - 1];
        for (const fib of fibs) {
            if (history.length >= fib + 1) {
                const prevAtFib = history[history.length - fib].result;
                if (prevAtFib === last.result) {
                    const pred = last.result === 1 ? "Xỉu" : "Tài";
                    let conf = 0.64 + (fib > 10 ? 0.03 : 0);
                    return { pred, conf, method: "fibo" };
                }
            }
        }
        return null;
    }

    predictPoisson(history) {
        const last = history[history.length - 1];
        for (let f = 1; f <= 6; f++) {
            if (last.faceGaps[f] >= 8) {
                const pred = f <= 3 ? "Tài" : "Xỉu";
                let conf = 0.72 + Math.min(0.08, (last.faceGaps[f] - 8) * 0.01);
                return { pred, conf, method: "poisson" };
            }
        }
        return null;
    }

    predictPattern(history) {
        if (history.length < 20) return null;
        const recent = history.slice(-15).map(h => h.resultStr === "Tài" ? 'T' : 'X').join('');
        for (const [pattern, data] of Object.entries(this.patternLibrary)) {
            if (recent.includes(pattern)) {
                return { pred: data.pred === 'T' ? "Tài" : "Xỉu", conf: data.conf, method: "patternMatch" };
            }
        }
        const last5Totals = history.slice(-5).map(h => h.total);
        let isUp = true, isDown = true;
        for (let i = 1; i < 5; i++) {
            if (last5Totals[i] <= last5Totals[i-1]) isUp = false;
            if (last5Totals[i] >= last5Totals[i-1]) isDown = false;
        }
        if (isUp) return { pred: "Xỉu", conf: 0.67, method: "patternMatch" };
        if (isDown) return { pred: "Tài", conf: 0.66, method: "patternMatch" };
        return null;
    }

    predictMarkov(history) {
        const tx = history.map(h => h.result);
        const orders = [3, 4, 5];
        let best = { pred: null, conf: 0 };
        for (const order of orders) {
            if (tx.length < order + 3) continue;
            const transitions = {};
            for (let i = 0; i <= tx.length - order - 1; i++) {
                const key = tx.slice(i, i + order).join('');
                const next = tx[i + order];
                if (!transitions[key]) transitions[key] = { 0: 0, 1: 0 };
                transitions[key][next]++;
            }
            const lastKey = tx.slice(-order).join('');
            const counts = transitions[lastKey];
            if (counts && counts[0] + counts[1] >= 3) {
                const total = counts[0] + counts[1];
                const conf = Math.max(counts[0], counts[1]) / total;
                const pred = counts[1] > counts[0] ? "Tài" : "Xỉu";
                if (conf > best.conf) best = { pred, conf, method: "markov" };
            }
        }
        return best.pred ? best : null;
    }

    predictFrequency(history) {
        if (history.length < 20) return null;
        const last30 = history.slice(-30);
        const tCount = last30.filter(h => h.result === 1).length;
        const xCount = 30 - tCount;
        const diff = Math.abs(tCount - xCount);
        if (diff >= 8) {
            const pred = tCount > xCount ? "Xỉu" : "Tài";
            const conf = 0.55 + Math.min(0.2, diff / 100);
            return { pred, conf, method: "frequency" };
        }
        return null;
    }

    predictMomentum(history) {
        const last = history[history.length - 1];
        if (Math.abs(last.momentum) > 1.5) {
            const pred = last.momentum > 0 ? "Tài" : "Xỉu";
            return { pred, conf: 0.60 + Math.min(0.15, Math.abs(last.momentum) / 20), method: "momentum" };
        }
        return null;
    }

    predictEntropy(history) {
        const last = history[history.length - 1];
        const entropy = last.entropy_30 || 1;
        if (entropy < 0.65) {
            const recent = history.slice(-10);
            const tCount = recent.filter(h => h.result === 1).length;
            const pred = tCount >= 6 ? "Tài" : "Xỉu";
            return { pred, conf: 0.68, method: "entropy" };
        }
        if (entropy > 0.92) {
            const last20 = history.slice(-20);
            const tCount = last20.filter(h => h.result === 1).length;
            const pred = tCount > 10 ? "Xỉu" : "Tài";
            return { pred, conf: 0.62, method: "entropy" };
        }
        return null;
    }

    predictTotal(history) {
        const last = history[history.length - 1];
        if (last.total <= 6) return { pred: "Tài", conf: 0.66, method: "total" };
        if (last.total >= 15) return { pred: "Xỉu", conf: 0.65, method: "total" };
        if (last.total >= 7 && last.total <= 9) return { pred: "Tài", conf: 0.58, method: "total" };
        if (last.total >= 12 && last.total <= 14) return { pred: "Xỉu", conf: 0.57, method: "total" };
        return null;
    }

    predictTriple(history) {
        const last = history[history.length - 1];
        if (last.isTriple) {
            const pred = last.tripleVal <= 3 ? "Tài" : "Xỉu";
            return { pred, conf: 0.72, method: "triple" };
        }
        return null;
    }

    predictPair(history) {
        const last = history[history.length - 1];
        if (last.isPair && !last.isTriple) {
            if (last.pairVal <= 2) return { pred: "Xỉu", conf: 0.60, method: "pair" };
            if (last.pairVal >= 5) return { pred: "Tài", conf: 0.61, method: "pair" };
        }
        return null;
    }

    predictFaceVacant(history) {
        const last = history[history.length - 1];
        for (let f = 1; f <= 6; f++) {
            if (last.faceGaps[f] >= 8) {
                const pred = f <= 3 ? "Tài" : "Xỉu";
                let conf = 0.72 + Math.min(0.12, (last.faceGaps[f] - 8) * 0.02);
                return { pred, conf, method: "faceVacant" };
            }
        }
        return null;
    }

    predictZigzag(history) {
        const last = history[history.length - 1];
        if (last.zigzag > 0.75) {
            const pred = last.result === 1 ? "Xỉu" : "Tài";
            return { pred, conf: 0.64, method: "zigzag" };
        }
        return null;
    }

    predictCluster(history) {
        const last = history[history.length - 1];
        if (last.cluster3) {
            const pred = last.result === 1 ? "Xỉu" : "Tài";
            return { pred, conf: 0.66, method: "cluster" };
        }
        return null;
    }

    predict() {
        const history = this.processed;
        if (history.length < 30) {
            return { prediction: "Tài", confidence: 50, details: [] };
        }
        
        const predictions = [];
        const methods = [
            this.predictPattern(history), this.predictMarkov(history),
            this.predictFrequency(history), this.predictMomentum(history),
            this.predictEntropy(history), this.predictTotal(history),
            this.predictTriple(history), this.predictPair(history),
            this.predictFaceVacant(history), this.predictZigzag(history),
            this.predictCluster(history), this.predictBet(history),
            this.predictCau11(history), this.predictCau22(history),
            this.predictCau121(history), this.predictCau212(history),
            this.predictDoiXung(history), this.predictTamGiac(history),
            this.predictFibonacci(history), this.predictPoisson(history)
        ];
        
        for (const p of methods) {
            if (p && p.pred) predictions.push(p);
        }
        
        if (predictions.length === 0) {
            const last10 = history.slice(-10);
            const taiCount = last10.filter(h => h.result === 1).length;
            const fallback = taiCount >= 6 ? "Xỉu" : "Tài";
            return { prediction: fallback, confidence: 52, details: [] };
        }
        
        let taiScore = 0, xiuScore = 0;
        const details = [];
        for (const p of predictions) {
            const weight = this.weights[p.method] || 0.7;
            const score = p.conf * weight;
            if (p.pred === "Tài") taiScore += score;
            else xiuScore += score;
            details.push({ method: p.method, pred: p.pred, conf: p.conf.toFixed(3), weight: weight.toFixed(3) });
        }
        
        const total = taiScore + xiuScore;
        let confidence = total > 0 ? Math.max(taiScore, xiuScore) / total : 0.5;
        confidence = Math.min(0.96, Math.max(0.55, confidence));
        const finalPred = taiScore > xiuScore ? "Tài" : "Xỉu";
        
        return {
            prediction: finalPred,
            confidence: Math.round(confidence * 100),
            details: details.sort((a, b) => parseFloat(b.conf) - parseFloat(a.conf)),
            raw: { taiScore: taiScore.toFixed(3), xiuScore: xiuScore.toFixed(3) }
        };
    }

    updateWithNewSession(newSession) {
        const newProcessed = this.sieuPreprocess([newSession]);
        this.processed.push(newProcessed[0]);
        if (!this.memory.sessions) this.memory.sessions = [];
        this.memory.sessions.push(newSession);
        
        const recentTx = this.processed.slice(-15).map(h => h.resultStr === "Tài" ? 'T' : 'X').join('');
        const actualResult = newSession.Ket_qua;
        
        for (const [pattern, data] of Object.entries(this.patternLibrary)) {
            if (recentTx.includes(pattern)) {
                const key = `${pattern}_${actualResult}`;
                this.memory.patterns[key] = (this.memory.patterns[key] || 0) + 1;
            }
        }
        
        const lastPred = this.predict();
        if (lastPred.prediction === actualResult) {
            for (const detail of lastPred.details) {
                if (this.weights[detail.method]) {
                    this.weights[detail.method] = Math.min(1.2, this.weights[detail.method] * 1.01);
                }
            }
        } else {
            for (const detail of lastPred.details) {
                if (this.weights[detail.method]) {
                    this.weights[detail.method] = Math.max(0.3, this.weights[detail.method] * 0.98);
                }
            }
        }
        
        this.saveMemory();
    }
}

// ==================== PREDICTOR INSTANCES ====================

let predictors = { hu: null, md5: null };

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadWinLossHistory() {
    try {
        if (fs.existsSync(KETQUA_FILE)) {
            const data = fs.readFileSync(KETQUA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            winLossHistory = parsed.winLossHistory || { hu: [], md5: [] };
            console.log(`✅ Đã tải lịch sử thắng thua: HU=${winLossHistory.hu.length}, MD5=${winLossHistory.md5.length} phiên`);
        }
    } catch (error) {
        console.error('❌ Error loading win/loss history:', error.message);
    }
}

function saveWinLossHistory() {
    try {
        const toSave = {
            winLossHistory,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(KETQUA_FILE, JSON.stringify(toSave, null, 2));
    } catch (error) {
        console.error('❌ Error saving win/loss history:', error.message);
    }
}

function loadSessionsStore() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: HU=${sessionsStore.hu.length}, MD5=${sessionsStore.md5.length}`);
            
            if (sessionsStore.hu.length >= 20) {
                isReady.hu = true;
                predictors.hu = new SieuAIPredictorV11(sessionsStore.hu.slice(0, 200), 'hu', MEMORY_FILE_HU);
            }
            if (sessionsStore.md5.length >= 20) {
                isReady.md5 = true;
                predictors.md5 = new SieuAIPredictorV11(sessionsStore.md5.slice(0, 200), 'md5', MEMORY_FILE_MD5);
            }
        }
    } catch (error) {
        console.error('❌ Error loading sessions:', error.message);
    }
}

function saveSessionsStore() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsStore, null, 2));
    } catch (error) {
        console.error('❌ Error saving sessions:', error.message);
    }
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.predictionHistory || { hu: [], md5: [] };
            lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            console.log(`✅ Đã tải lịch sử dự đoán: HU=${predictionHistory.hu.length}, MD5=${predictionHistory.md5.length}`);
        }
    } catch (error) {
        console.error('❌ Error loading prediction history:', error.message);
    }
}

function savePredictionHistory() {
    try {
        const toSave = {
            predictionHistory,
            lastProcessedPhien,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(toSave, null, 2));
    } catch (error) {
        console.error('❌ Error saving prediction history:', error.message);
    }
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
    if (sessionsStore[type].length > 1000) {
        sessionsStore[type] = sessionsStore[type].slice(0, 1000);
    }
    return addedCount;
}

async function fetchAndUpdate(type) {
    let fetchFn = type === 'hu' ? fetchDataHu : fetchDataMd5;
    let data = await fetchFn();
    if (!data || data.length === 0) return false;
    
    const addedCount = updateSessions(type, data);
    if (addedCount > 0) saveSessionsStore();
    
    if (!isReady[type] && sessionsStore[type].length >= 20) {
        isReady[type] = true;
        predictors[type] = new SieuAIPredictorV11(sessionsStore[type].slice(0, 200), type, type === 'hu' ? MEMORY_FILE_HU : MEMORY_FILE_MD5);
        console.log(`🎉 [${type.toUpperCase()}] ĐÃ SẴN SÀNG!`);
    } else if (isReady[type] && predictors[type] && addedCount > 0) {
        for (const newSession of data) {
            predictors[type].updateWithNewSession(newSession);
        }
    }
    return true;
}

// ==================== VERIFY PREDICTIONS & GHI THẮNG THUA ====================

async function verifyAndRecordResults(type) {
    if (!predictors[type]) return;
    
    const data = sessionsStore[type];
    let updated = false;
    
    for (const record of predictionHistory[type]) {
        if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
        
        const actualResult = data.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            const isCorrect = record.du_doan === actualResult.Ket_qua;
            record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            
            // Ghi vào lịch sử thắng thua
            winLossHistory[type].push({
                phien: record.phien_du_doan,
                phien_hien_tai: record.phien_hien_tai,
                du_doan: record.du_doan,
                ket_qua_thuc_te: actualResult.Ket_qua,
                ket_qua: isCorrect ? 'Đúng' : 'Sai',
                do_tin_cay: record.do_tin_cay,
                thoi_gian: new Date().toISOString()
            });
            
            updated = true;
        }
    }
    
    // Giữ tối đa MAX_HISTORY phiên
    if (winLossHistory[type].length > MAX_HISTORY) {
        winLossHistory[type] = winLossHistory[type].slice(-MAX_HISTORY);
    }
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    
    if (updated) {
        savePredictionHistory();
        saveWinLossHistory();
        
        const stats = calculateStats(type);
        console.log(`📊 [${type.toUpperCase()}] Thống kê: Đúng=${stats.dung}, Sai=${stats.sai}, Tỉ lệ=${stats.tiLe}%`);
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
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
        signals: signals.slice(0, 5).map(s => s.method),
        id: 'love trang',
        timestamp: new Date().toISOString()
    };
    
    predictionHistory[type].unshift(record);
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    return record;
}

// ==================== AUTO FETCH LOOP ====================

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU...');
    console.log('═══════════════════════════════════════════════════');
    
    while (true) {
        await Promise.all([fetchAndUpdate('hu'), fetchAndUpdate('md5')]);
        await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
    }
}

async function autoProcessPredictions() {
    if (!isReady.hu && !isReady.md5) return;
    
    try {
        if (isReady.hu && predictors.hu) {
            await fetchAndUpdate('hu');
            await verifyAndRecordResults('hu');
            
            const latestSessions = sessionsStore.hu.slice(0, 200);
            if (latestSessions.length > 0 && predictors.hu) {
                const latestPhien = latestSessions[0].Phien;
                const nextPhien = latestPhien + 1;
                
                if (lastProcessedPhien.hu !== nextPhien) {
                    const result = predictors.hu.predict();
                    const record = savePredictionToHistory('hu', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
                    lastProcessedPhien.hu = nextPhien;
                    const stats = calculateStats('hu');
                    console.log(`[DỰ ĐOÁN] 🧠 HU Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - Tín hiệu: ${result.details.length} - 📊 TL: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
                    savePredictionHistory();
                }
            }
        }
        
        if (isReady.md5 && predictors.md5) {
            await fetchAndUpdate('md5');
            await verifyAndRecordResults('md5');
            
            const latestSessions = sessionsStore.md5.slice(0, 200);
            if (latestSessions.length > 0 && predictors.md5) {
                const latestPhien = latestSessions[0].Phien;
                const nextPhien = latestPhien + 1;
                
                if (lastProcessedPhien.md5 !== nextPhien) {
                    const result = predictors.md5.predict();
                    const record = savePredictionToHistory('md5', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
                    lastProcessedPhien.md5 = nextPhien;
                    const stats = calculateStats('md5');
                    console.log(`[DỰ ĐOÁN] 🧠 MD5 Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - Tín hiệu: ${result.details.length} - 📊 TL: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
                    savePredictionHistory();
                }
            }
        }
    } catch (error) {
        console.error('[Auto] ❌ Error:', error.message);
    }
}

// ==================== STARTUP ====================

async function startup() {
    loadWinLossHistory();
    loadSessionsStore();
    loadPredictionHistory();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('🚀 SIÊU AI PREDICTOR V11.0 - TỰ HỌC & GHI NHỚ THẮNG THUA');
    console.log(`📋 Lưu tối đa ${MAX_HISTORY} phiên`);
    console.log('═══════════════════════════════════════════════════');
    
    fetchLoop();
    setTimeout(() => {
        setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
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
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.hu.length}/20` });
        }
        
        await fetchAndUpdate('hu');
        await verifyAndRecordResults('hu');
        
        const latestSessions = sessionsStore.hu.slice(0, 200);
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictors.hu.predict();
        const stats = calculateStats('hu');
        
        const record = savePredictionToHistory('hu', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
        
        res.json({
            phien_hien_tai: record.phien_hien_tai,
            phien_du_doan: record.phien_du_doan,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            signals: result.details.slice(0, 8),
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
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.md5.length}/20` });
        }
        
        await fetchAndUpdate('md5');
        await verifyAndRecordResults('md5');
        
        const latestSessions = sessionsStore.md5.slice(0, 200);
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictors.md5.predict();
        const stats = calculateStats('md5');
        
        const record = savePredictionToHistory('md5', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
        
        res.json({
            phien_hien_tai: record.phien_hien_tai,
            phien_du_doan: record.phien_du_doan,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            signals: result.details.slice(0, 8),
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
        signals: result.details.slice(0, 10),
        raw_scores: result.raw
    });
});

app.get('/lc79-md5/analysis', (req, res) => {
    if (!isReady.md5 || !predictors.md5) return res.json({ status: 'loading' });
    const result = predictors.md5.predict();
    res.json({
        prediction: result.prediction,
        confidence: result.confidence,
        signals: result.details.slice(0, 10),
        raw_scores: result.raw
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('🚀 SIÊU AI PREDICTOR V11.0 - TỰ HỌC & GHI NHỚ');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC DẠNG CẦU ĐƯỢC HỖ TRỢ:');
    console.log('   • Bệt & bẻ bệt (độ chính xác cao)');
    console.log('   • Cầu 1-1, 2-2, 3-3');
    console.log('   • Cầu 1-2-1, 2-1-2, 1-2-3-2-1');
    console.log('   • Cầu đối xứng, tam giác, kim tự tháp');
    console.log('   • Markov bậc 3-5');
    console.log('   • Poisson (mặt vắng)');
    console.log('   • Fibonacci');
    console.log('   • Tổng điểm, entropy, momentum, zigzag');
    console.log('');
    console.log('📊 TÍNH NĂNG MỚI:');
    console.log(`   • Ghi nhớ thắng/thua tối đa ${MAX_HISTORY} phiên`);
    console.log('   • Tự động đối chiếu kết quả thực tế');
    console.log('   • Lưu chi tiết từng phiên dự đoán');
    console.log('   • Thống kê tỉ lệ thắng tự động');
    console.log('');
    console.log('📁 Files:');
    console.log('   - sessions_data.json: Lưu phiên đã fetch');
    console.log('   - lichsu_du_doan.json: Lịch sử dự đoán');
    console.log('   - ketqua_thang_thua.json: Kết quả thắng/thua');
    console.log('   - ai_memory_hu.json / ai_memory_md5.json: Bộ nhớ AI');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
