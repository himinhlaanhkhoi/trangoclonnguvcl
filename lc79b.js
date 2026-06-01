const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'tiendat1.json';
const SESSIONS_FILE = 'sessions_data.json';
const RESULT_TRACKING_FILE = 'ketqua_tracking.json';

// ===== CẤU HÌNH =====
const MAX_SESSIONS = 50;
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let predictionHistory = { hu: [], md5: [] };
let resultTracking = { hu: {}, md5: {} };
const MAX_HISTORY = 200;
let lastProcessedPhien = { hu: null, md5: null };

let sessionsStore = {
  hu: [],
  md5: []
};

let isReady = {
  hu: false,
  md5: false
};

// ==================== ULTIMATE PREDICTOR V7.0 ====================

class UltimatePredictorV7 {
    constructor(data, type = 'hu') {
        this.type = type;
        this.raw = data;
        this.processed = this.preprocess(data);
        this.memory = this.initMemory();
        this.weights = this.initWeights();
        this.cauDB = this.initCauDB();
        this.phuTroDB = this.initPhuTroDB();
        this.adaptive = this.initAdaptive();
        this.stats = this.initStats();
        
        if (data.length >= 30) {
            this.learnFromAllData();
            this.adaptiveFromRecent(50);
            this.initPatternMemory();
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
            
            let sum5 = 0, sum10 = 0, sum20 = 0, sum50 = 0;
            let tai5 = 0, tai10 = 0, tai20 = 0, tai50 = 0;
            
            for (let j = Math.max(0, idx-4); j <= idx; j++) { sum5 += arr[j].Tong; if (arr[j].Ket_qua === "Tài") tai5++; }
            for (let j = Math.max(0, idx-9); j <= idx; j++) { sum10 += arr[j].Tong; if (arr[j].Ket_qua === "Tài") tai10++; }
            for (let j = Math.max(0, idx-19); j <= idx; j++) { sum20 += arr[j].Tong; if (arr[j].Ket_qua === "Tài") tai20++; }
            for (let j = Math.max(0, idx-49); j <= idx; j++) { sum50 += arr[j].Tong; if (arr[j].Ket_qua === "Tài") tai50++; }
            
            const avg5 = sum5 / Math.min(5, idx+1);
            const avg10 = sum10 / Math.min(10, idx+1);
            const avg20 = sum20 / Math.min(20, idx+1);
            const avg50 = sum50 / Math.min(50, idx+1);
            
            const range = Math.max(...dice) - Math.min(...dice);
            const deviation = sum - avg10;
            const zScore = (sum - avg20) / (Math.sqrt(avg20) || 1);
            const zScore50 = (sum - avg50) / (Math.sqrt(avg50) || 1);
            
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
            
            let movingProb = 0.5386;
            if (idx >= 99) {
                let tai = 0;
                for (let j = idx-99; j <= idx; j++) if (arr[j].Ket_qua === "Tài") tai++;
                movingProb = tai / 100;
            }
            
            return {
                Phien: item.Phien, result, resultStr: item.Ket_qua,
                total: sum, dice, streak, faceStreaks, faceGaps,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                isPair: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2]),
                pairVal: dice[0] === dice[1] ? dice[0] : (dice[0] === dice[2] ? dice[0] : dice[1]),
                range, deviation, zScore, zScore50,
                avg5, avg10, avg20, avg50,
                entropy, randomness, movingProb,
                tai5, tai10, tai20, tai50,
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    initMemory() {
        return {
            patterns: new Map(),
            rarePatterns: new Map(),
            successPatterns: new Map(),
            sequences: [],
            sequenceLengths: [3, 4, 5, 6, 7, 8, 9, 10],
            faceHistory: [],
            facePatterns: {},
            totalHistory: [],
            totalPatterns: {},
            resultHistory: [],
            resultPatterns: {},
            learnedPatterns: [],
            highProbPatterns: [],
            cache: {}
        };
    }

    initWeights() {
        return {
            primary: 100, secondary: 85, tertiary: 70, auxiliary: 55, dynamic: {}
        };
    }

    initCauDB() {
        return {
            coBan: {
                '11': { count: 0, correct: 0, prob: 0.613 },
                '22': { count: 0, correct: 0, prob: 0.578 },
                '33': { count: 0, correct: 0, prob: 0.592 },
                '44': { count: 0, correct: 0, prob: 0.55 },
                '12': { count: 0, correct: 0, prob: 0.56 },
                '21': { count: 0, correct: 0, prob: 0.565 },
                '13': { count: 0, correct: 0, prob: 0.586 },
                '31': { count: 0, correct: 0, prob: 0.592 }
            },
            phucHop: {
                '121': { count: 0, correct: 0, prob: 0.63 },
                '212': { count: 0, correct: 0, prob: 0.62 },
                '12321': { count: 0, correct: 0, prob: 0.66 },
                '112211': { count: 0, correct: 0, prob: 0.61 }
            },
            dacBiet: {
                'doiXung': { count: 0, correct: 0, prob: 0.68 },
                'tamGiac': { count: 0, correct: 0, prob: 0.67 },
                'kimTuThap': { count: 0, correct: 0, prob: 0.65 }
            },
            tichLuy: {
                'markov1': { count: 0, correct: 0, prob: 0.61 },
                'markov2': { count: 0, correct: 0, prob: 0.63 },
                'markov3': { count: 0, correct: 0, prob: 0.66 },
                'markov4': { count: 0, correct: 0, prob: 0.68 }
            }
        };
    }

    initPhuTroDB() {
        return {
            tongDiem: {
                '3-6': { count: 0, correct: 0, prob: 0.657 },
                '15-18': { count: 0, correct: 0, prob: 0.632 }
            },
            matVang: {
                'gap5': { count: 0, correct: 0, prob: 0.62 },
                'gap6': { count: 0, correct: 0, prob: 0.65 },
                'gap7': { count: 0, correct: 0, prob: 0.68 },
                'gap8': { count: 0, correct: 0, prob: 0.71 },
                'gap9': { count: 0, correct: 0, prob: 0.73 },
                'gap10': { count: 0, correct: 0, prob: 0.75 }
            },
            range: {
                '0': { count: 0, correct: 0, prob: 0.55 },
                '1': { count: 0, correct: 0, prob: 0.53 },
                '4': { count: 0, correct: 0, prob: 0.51 },
                '5': { count: 0, correct: 0, prob: 0.50 }
            },
            boBa: {
                '1': { count: 0, correct: 0, prob: 0.68 },
                '2': { count: 0, correct: 0, prob: 0.65 },
                '3': { count: 0, correct: 0, prob: 0.62 },
                '4': { count: 0, correct: 0, prob: 0.61 },
                '5': { count: 0, correct: 0, prob: 0.64 },
                '6': { count: 0, correct: 0, prob: 0.67 }
            },
            cap: {
                '1': { count: 0, correct: 0, prob: 0.58 },
                '2': { count: 0, correct: 0, prob: 0.57 },
                '5': { count: 0, correct: 0, prob: 0.57 },
                '6': { count: 0, correct: 0, prob: 0.58 }
            }
        };
    }

    initAdaptive() {
        return {
            weights: {
                cauCoBan: 85, cauPhucHop: 90, cauDacBiet: 88, cauTichLuy: 92,
                phuTroTong: 70, phuTroMat: 75, phuTroVang: 85, phuTroRange: 65,
                phuTroBoBa: 80, phuTroCap: 75, patternMemory: 88
            },
            learningRate: 0.05,
            recentAccuracy: [],
            adaptiveHistory: [],
            thresholds: { high: 70, medium: 60, low: 55 }
        };
    }

    initStats() {
        return {
            totalPhien: 0, taiRate: 0.5386, xiuRate: 0.4614,
            avgTotal: 10.5, stdTotal: 3.2,
            faceRates: { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5, 6: 0.5 },
            streakDistribution: {}, patternConfidence: {}
        };
    }

    learnFromAllData() {
        let taiCount = 0;
        let totalSum = 0;
        const faceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        
        for (const p of this.processed) {
            if (p.result === 1) taiCount++;
            totalSum += p.total;
            for (let f = 1; f <= 6; f++) {
                if (p.has(f)) faceCounts[f]++;
            }
        }
        
        this.stats.totalPhien = this.processed.length;
        this.stats.taiRate = taiCount / this.processed.length;
        this.stats.xiuRate = 1 - this.stats.taiRate;
        this.stats.avgTotal = totalSum / this.processed.length;
        
        for (let f = 1; f <= 6; f++) {
            this.stats.faceRates[f] = faceCounts[f] / (this.processed.length * 3);
        }
        
        this.learnPatterns();
        this.learnCauFromHistory();
        this.learnPhuTroFromHistory();
    }

    learnPatterns() {
        for (let len of this.memory.sequenceLengths) {
            for (let i = len; i < this.processed.length - 1; i++) {
                const pattern = this.processed.slice(i - len, i).map(p => p.result).join('');
                const next = this.processed[i + 1].result;
                const key = `${len}_${pattern}`;
                
                if (!this.memory.patterns.has(key)) {
                    this.memory.patterns.set(key, { tai: 0, xiu: 0, total: 0 });
                }
                const stat = this.memory.patterns.get(key);
                if (next === 1) stat.tai++;
                else stat.xiu++;
                stat.total++;
            }
        }
        
        for (const [key, stat] of this.memory.patterns) {
            if (stat.total >= 5) {
                const confidence = Math.max(stat.tai, stat.xiu) / stat.total;
                if (confidence >= 0.7) {
                    this.memory.highProbPatterns.push({ key, stat, confidence });
                }
            }
        }
        this.memory.highProbPatterns.sort((a, b) => b.confidence - a.confidence);
    }

    learnCauFromHistory() {
        for (let i = 2; i < this.processed.length - 1; i++) {
            const last2 = this.processed.slice(i-2, i).map(p => p.result);
            const next = this.processed[i+1].result;
            const key = last2[0] === last2[1] ? `${last2[0]}${last2[0]}` : `${last2[0]}${last2[1]}`;
            
            if (this.cauDB.coBan[key]) {
                this.cauDB.coBan[key].count++;
                const expected = key === "11" ? (last2[0] === 1 ? 0 : 1) : (last2[0] === 1 ? 1 : 0);
                if (next === expected) this.cauDB.coBan[key].correct++;
            }
        }
        
        for (let i = 4; i < this.processed.length - 1; i++) {
            const last5 = this.processed.slice(i-4, i+1).map(p => p.result);
            const pattern5 = last5.join('');
            
            if (pattern5 === "10101" || pattern5 === "01010") {
                this.cauDB.phucHop['121'].count++;
                const expected = pattern5[0] === 1 ? 0 : 1;
                if (this.processed[i+1].result === expected) this.cauDB.phucHop['121'].correct++;
            }
            
            if (pattern5 === "11011" || pattern5 === "00100") {
                this.cauDB.phucHop['212'].count++;
                const expected = pattern5[0] === 1 ? 0 : 1;
                if (this.processed[i+1].result === expected) this.cauDB.phucHop['212'].correct++;
            }
        }
        
        for (let i = 5; i < this.processed.length - 1; i++) {
            const last6 = this.processed.slice(i-5, i+1).map(p => p.result);
            let isSymmetric = true;
            for (let j = 0; j < 3; j++) {
                if (last6[j] !== last6[5-j]) { isSymmetric = false; break; }
            }
            if (isSymmetric) {
                this.cauDB.dacBiet['doiXung'].count++;
                const expected = last6[2] === 1 ? 0 : 1;
                if (this.processed[i+1].result === expected) this.cauDB.dacBiet['doiXung'].correct++;
            }
        }
        
        for (const category of ['coBan', 'phucHop', 'dacBiet']) {
            for (const [key, data] of Object.entries(this.cauDB[category])) {
                if (data.count > 20) {
                    data.prob = data.correct / data.count;
                }
            }
        }
    }

    learnPhuTroFromHistory() {
        for (let i = 1; i < this.processed.length - 1; i++) {
            const prevTotal = this.processed[i-1].total;
            const next = this.processed[i+1].result;
            
            if (prevTotal >= 3 && prevTotal <= 6) {
                this.phuTroDB.tongDiem['3-6'].count++;
                if (next === 1) this.phuTroDB.tongDiem['3-6'].correct++;
            }
            if (prevTotal >= 15 && prevTotal <= 18) {
                this.phuTroDB.tongDiem['15-18'].count++;
                if (next === 0) this.phuTroDB.tongDiem['15-18'].correct++;
            }
        }
        
        for (let gap of [5, 6, 7, 8, 9, 10]) {
            for (let i = gap; i < this.processed.length - 1; i++) {
                for (let f = 1; f <= 6; f++) {
                    let absent = true;
                    for (let j = i - gap + 1; j <= i; j++) {
                        if (this.processed[j].has(f)) { absent = false; break; }
                    }
                    if (absent && this.processed[i+1].has(f)) {
                        this.phuTroDB.matVang[`gap${gap}`].count++;
                        const expected = f <= 3 ? 1 : 0;
                        if (this.processed[i+1].result === expected) {
                            this.phuTroDB.matVang[`gap${gap}`].correct++;
                        }
                        break;
                    }
                }
            }
        }
        
        for (const category of ['tongDiem', 'matVang', 'range', 'boBa', 'cap']) {
            for (const [key, data] of Object.entries(this.phuTroDB[category])) {
                if (data.count > 15) {
                    data.prob = data.correct / data.count;
                }
            }
        }
    }

    adaptiveFromRecent(n = 50) {
        const recent = this.processed.slice(-n);
        let recentCorrect = 0;
        
        for (let i = 0; i < recent.length - 1; i++) {
            const prediction = this.simplePredict(recent[i]);
            if (prediction === recent[i+1].resultStr) recentCorrect++;
        }
        const recentAcc = recentCorrect / (recent.length - 1);
        
        if (recentAcc < 0.55) {
            this.adaptive.learningRate = Math.min(0.15, this.adaptive.learningRate + 0.02);
        } else if (recentAcc > 0.65) {
            this.adaptive.learningRate = Math.max(0.03, this.adaptive.learningRate - 0.01);
        }
        
        this.adaptive.recentAccuracy.push(recentAcc);
        if (this.adaptive.recentAccuracy.length > 10) this.adaptive.recentAccuracy.shift();
    }

    simplePredict(p) {
        if (p.streak >= 3) return p.result === 1 ? "Xỉu" : "Tài";
        if (p.total <= 6) return "Tài";
        if (p.total >= 15) return "Xỉu";
        return Math.random() < 0.5 ? "Tài" : "Xỉu";
    }

    initPatternMemory() {
        for (let i = 3; i < this.processed.length - 1; i++) {
            const pattern = this.processed.slice(i-3, i).map(p => p.result).join('');
            const next = this.processed[i+1].resultStr;
            const key = `${pattern}_${next}`;
            
            if (!this.memory.successPatterns.has(key)) {
                this.memory.successPatterns.set(key, 0);
            }
            this.memory.successPatterns.set(key, this.memory.successPatterns.get(key) + 1);
        }
    }

    batCauCoBan() {
        const signals = [];
        const last = this.processed[this.processed.length - 1];
        
        if (this.processed.length >= 2) {
            const prev = this.processed[this.processed.length - 2];
            if (prev.result !== last.result) {
                const pred = last.result === 1 ? "Xỉu" : "Tài";
                signals.push({ pred, conf: 61, reason: "Cầu 1-1", type: "coBan", weight: this.adaptive.weights.cauCoBan });
            }
        }
        
        if (this.processed.length >= 4) {
            const last4 = this.processed.slice(-4).map(p => p.result);
            if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
                const pred = last4[0] === 1 ? "Xỉu" : "Tài";
                signals.push({ pred, conf: 62.5, reason: "Cầu 2-2", type: "coBan", weight: this.adaptive.weights.cauCoBan });
            }
        }
        
        if (this.processed.length >= 6) {
            const last6 = this.processed.slice(-6).map(p => p.result);
            if (last6[0] === last6[1] && last6[1] === last6[2] &&
                last6[3] === last6[4] && last6[4] === last6[5] &&
                last6[0] !== last6[3]) {
                const pred = last6[0] === 1 ? "Xỉu" : "Tài";
                signals.push({ pred, conf: 64, reason: "Cầu 3-3", type: "coBan", weight: this.adaptive.weights.cauCoBan });
            }
        }
        
        return signals;
    }

    batCauPhucHop() {
        const signals = [];
        
        if (this.processed.length >= 5) {
            const last5 = this.processed.slice(-5).map(p => p.result);
            if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] !== last5[4]) {
                const pred = last5[0] === 1 ? "Tài" : "Xỉu";
                signals.push({ pred, conf: 63, reason: "Cầu 1-2-1", type: "phucHop", weight: this.adaptive.weights.cauPhucHop });
            }
            
            if (last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
                const pred = last5[0] === 1 ? "Xỉu" : "Tài";
                signals.push({ pred, conf: 62, reason: "Cầu 2-1-2", type: "phucHop", weight: this.adaptive.weights.cauPhucHop });
            }
        }
        
        if (this.processed.length >= 7) {
            const last7 = this.processed.slice(-7).map(p => p.result);
            if (last7[0] !== last7[1] && last7[1] === last7[2] && last7[2] !== last7[3] &&
                last7[3] !== last7[4] && last7[4] === last7[5] && last7[5] !== last7[6]) {
                const pred = last7[0] === 1 ? "Tài" : "Xỉu";
                signals.push({ pred, conf: 66, reason: "Cầu 1-2-3-2-1", type: "phucHop", weight: this.adaptive.weights.cauPhucHop });
            }
        }
        
        return signals;
    }

    batCauDacBiet() {
        const signals = [];
        
        if (this.processed.length >= 10) {
            const last10 = this.processed.slice(-10).map(p => p.result);
            let isSymmetric = true;
            for (let i = 0; i < 5; i++) {
                if (last10[i] !== last10[9-i]) { isSymmetric = false; break; }
            }
            if (isSymmetric) {
                const pred = last10[4] === 1 ? "Xỉu" : "Tài";
                signals.push({ pred, conf: 68, reason: "Cầu đối xứng 10 nhịp", type: "dacBiet", weight: this.adaptive.weights.cauDacBiet });
            }
        }
        
        return signals;
    }

    batCauTichLuy() {
        const signals = [];
        const last = this.processed[this.processed.length - 1];
        
        for (let order = 1; order <= 4; order++) {
            if (this.processed.length >= order + 1) {
                const lastOrder = this.processed.slice(-order).map(p => p.result).join('');
                let matchCount = 0, nextTai = 0, nextXiu = 0;
                
                for (let i = order; i < this.processed.length - 1; i++) {
                    const pattern = this.processed.slice(i - order, i).map(p => p.result).join('');
                    if (pattern === lastOrder) {
                        matchCount++;
                        if (this.processed[i+1].result === 1) nextTai++;
                        else nextXiu++;
                    }
                }
                
                if (matchCount >= 5) {
                    const prob = Math.max(nextTai, nextXiu) / matchCount;
                    if (prob > 0.65) {
                        const pred = nextTai > nextXiu ? "Tài" : "Xỉu";
                        signals.push({ pred, conf: prob * 100, reason: `Markov bậc ${order}`, type: "tichLuy", weight: this.adaptive.weights.cauTichLuy });
                    }
                }
            }
        }
        
        for (let f = 1; f <= 6; f++) {
            const gap = last.faceGaps[f];
            if (gap >= 8) {
                const pred = f <= 3 ? "Tài" : "Xỉu";
                signals.push({ pred, conf: 65 + Math.min(15, gap - 8), reason: `Mặt ${f} vắng ${gap} phiên`, type: "tichLuy", weight: this.adaptive.weights.cauTichLuy });
            }
        }
        
        return signals;
    }

    batPhuTro() {
        const signals = [];
        const last = this.processed[this.processed.length - 1];
        
        if (last.total <= 6) {
            signals.push({ pred: "Tài", conf: 66, reason: `Tổng ${last.total} (cực thấp)`, type: "phuTro", weight: this.adaptive.weights.phuTroTong });
        } else if (last.total >= 15) {
            signals.push({ pred: "Xỉu", conf: 65, reason: `Tổng ${last.total} (cực cao)`, type: "phuTro", weight: this.adaptive.weights.phuTroTong });
        }
        
        if (last.isTriple) {
            const pred = last.tripleVal <= 3 ? "Tài" : "Xỉu";
            signals.push({ pred, conf: 70, reason: `Sau bộ ba ${last.tripleVal}`, type: "phuTro", weight: this.adaptive.weights.phuTroBoBa });
        }
        
        if (last.isPair && !last.isTriple) {
            if (last.pairVal <= 2) {
                signals.push({ pred: "Xỉu", conf: 65, reason: `Sau cặp ${last.pairVal}`, type: "phuTro", weight: this.adaptive.weights.phuTroCap });
            } else if (last.pairVal >= 5) {
                signals.push({ pred: "Tài", conf: 65, reason: `Sau cặp ${last.pairVal}`, type: "phuTro", weight: this.adaptive.weights.phuTroCap });
            }
        }
        
        return signals;
    }

    batPatternMemory() {
        const signals = [];
        
        for (let len of [3, 4, 5, 6]) {
            if (this.processed.length >= len + 1) {
                const currentPattern = this.processed.slice(-len).map(p => p.result).join('');
                const key = `${len}_${currentPattern}`;
                const stat = this.memory.patterns.get(key);
                
                if (stat && stat.total >= 3) {
                    const confidence = Math.max(stat.tai, stat.xiu) / stat.total;
                    if (confidence >= 0.7) {
                        const pred = stat.tai > stat.xiu ? "Tài" : "Xỉu";
                        signals.push({ pred, conf: confidence * 100, reason: `Pattern ${len}p (${stat.total} lần)`, type: "memory", weight: this.adaptive.weights.patternMemory });
                    }
                }
            }
        }
        
        return signals;
    }

    predict() {
        let allSignals = [];
        
        allSignals.push(...this.batCauCoBan());
        allSignals.push(...this.batCauPhucHop());
        allSignals.push(...this.batCauDacBiet());
        allSignals.push(...this.batCauTichLuy());
        allSignals.push(...this.batPhuTro());
        allSignals.push(...this.batPatternMemory());
        
        const uniqueSignals = [];
        const seen = new Set();
        
        for (const s of allSignals) {
            if (s.conf >= 55 && !seen.has(s.reason)) {
                seen.add(s.reason);
                uniqueSignals.push(s);
            }
        }
        
        if (uniqueSignals.length === 0 && this.processed.length >= 10) {
            const last = this.processed[this.processed.length - 1];
            const last10 = this.processed.slice(-10).map(p => p.result);
            const taiCount = last10.reduce((a, b) => a + b, 0);
            const pred = taiCount >= 7 ? "Xỉu" : (taiCount <= 3 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 54, signals: [], fallback: true };
        }
        
        let taiScore = 0, xiuScore = 0;
        for (const s of uniqueSignals) {
            const w = (s.weight / 100) * (s.conf / 100);
            if (s.pred === "Tài") taiScore += w;
            else xiuScore += w;
        }
        
        const avgRecentAcc = this.adaptive.recentAccuracy.reduce((a, b) => a + b, 0) / (this.adaptive.recentAccuracy.length || 1);
        const adaptiveFactor = Math.max(0.8, Math.min(1.2, avgRecentAcc / 0.6));
        
        taiScore *= adaptiveFactor;
        xiuScore *= adaptiveFactor;
        
        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        confidence = Math.min(96, Math.max(58, confidence));
        
        return {
            prediction: finalPred,
            confidence: Math.round(confidence),
            signals: uniqueSignals.sort((a, b) => b.weight * b.conf - a.weight * a.conf),
            signalCount: uniqueSignals.length,
            adaptiveFactor: adaptiveFactor.toFixed(2),
            fallback: false
        };
    }

    updateWithNewData(newData) {
        if (!newData || newData.length === 0) return;
        
        this.raw = [...newData, ...this.raw].slice(0, MAX_SESSIONS);
        this.processed = this.preprocess(this.raw);
        
        if (this.processed.length >= 30) {
            this.learnFromAllData();
            this.adaptiveFromRecent(50);
            this.initPatternMemory();
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
      
      if (sessionsStore.hu.length >= 10) {
        isReady.hu = true;
        predictors.hu = new UltimatePredictorV7(sessionsStore.hu.slice(0, MAX_SESSIONS), 'hu');
        console.log(`   ✅ HU ready (${sessionsStore.hu.length} sessions)`);
      }
      if (sessionsStore.md5.length >= 10) {
        isReady.md5 = true;
        predictors.md5 = new UltimatePredictorV7(sessionsStore.md5.slice(0, MAX_SESSIONS), 'md5');
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

function loadResultTracking() {
  try {
    if (fs.existsSync(RESULT_TRACKING_FILE)) {
      const data = fs.readFileSync(RESULT_TRACKING_FILE, 'utf8');
      resultTracking = JSON.parse(data);
      console.log('✅ Result tracking loaded');
    }
  } catch (error) {
    console.error('❌ Error loading result tracking:', error.message);
  }
}

function saveResultTracking() {
  try {
    fs.writeFileSync(RESULT_TRACKING_FILE, JSON.stringify(resultTracking, null, 2));
  } catch (error) {
    console.error('❌ Error saving result tracking:', error.message);
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
  
  if (sessionsStore[type].length > MAX_SESSIONS * 4) {
    sessionsStore[type] = sessionsStore[type].slice(0, MAX_SESSIONS * 4);
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
  
  if (!isReady[type] && sessionsStore[type].length >= 20) {
    isReady[type] = true;
    predictors[type] = new UltimatePredictorV7(sessionsStore[type].slice(0, MAX_SESSIONS), type);
    console.log(`🎉 [${type.toUpperCase()}] ĐÃ SẴN SÀNG!`);
  } else if (isReady[type] && predictors[type] && addedCount > 0) {
    const latestSessions = sessionsStore[type].slice(0, MAX_SESSIONS);
    predictors[type].updateWithNewData(latestSessions);
  }
  
  return true;
}

// ==================== VERIFY PREDICTIONS (GHI NHỚ THẮNG THUA CHÍNH XÁC) ====================

async function verifyAndUpdateResults(type) {
  if (!predictors[type]) return;
  
  const data = sessionsStore[type];
  let updated = false;
  
  for (const record of predictionHistory[type]) {
    if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
    
    const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
    if (actualResult) {
      if (record.Du_doan === actualResult.Ket_qua) {
        record.ket_qua_du_doan = 'Đúng ✅';
      } else {
        record.ket_qua_du_doan = 'Sai ❌';
      }
      
      // Ghi nhận kết quả vào tracking
      const phienKey = record.Phien_hien_tai.toString();
      if (!resultTracking[type][phienKey]) {
        resultTracking[type][phienKey] = [];
      }
      resultTracking[type][phienKey].push({
        phien: record.Phien,
        du_doan: record.Du_doan,
        ket_qua_thuc_te: actualResult.Ket_qua,
        ket_qua: record.ket_qua_du_doan,
        do_tin_cay: record.Do_tin_cay,
        thoi_gian: new Date().toISOString()
      });
      
      updated = true;
    }
  }
  
  if (updated) {
    savePredictionHistory();
    saveResultTracking();
    
    // Tính thống kê thắng thua cho từng loại
    const stats = calculateWinLossStats(type);
    console.log(`📊 [${type.toUpperCase()}] Thống kê: Đúng=${stats.dung}, Sai=${stats.sai}, Tỉ lệ=${stats.tiLe}%`);
  }
}

function calculateWinLossStats(type) {
  let dung = 0, sai = 0;
  
  for (const record of predictionHistory[type]) {
    if (record.ket_qua_du_doan === 'Đúng ✅') dung++;
    else if (record.ket_qua_du_doan === 'Sai ❌') sai++;
  }
  
  const total = dung + sai;
  const tiLe = total > 0 ? (dung / total * 100).toFixed(2) : 0;
  
  return { dung, sai, tiLe, total };
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData, signals = []) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Do_tin_cay_hien_tai: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    signals_used: signals.slice(0, 5).map(s => s.reason),
    signal_count: signals.length,
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
  console.log(`📋 Lấy ${FETCH_PER_REQUEST} phiên mỗi lần, nghỉ ${FETCH_INTERVAL/1000}s`);
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
    
    const huStatus = isReady.hu ? '✅' : `${sessionsStore.hu.length}/20`;
    const md5Status = isReady.md5 ? '✅' : `${sessionsStore.md5.length}/20`;
    console.log(`📊 Trạng thái: HU=[${huStatus}] | MD5=[${md5Status}]`);
    
    await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
  }
}

// ==================== AUTO PROCESS PREDICTIONS ====================

async function autoProcessPredictions() {
  if (!isReady.hu && !isReady.md5) {
    return;
  }
  
  try {
    if (isReady.hu && predictors.hu) {
      await fetchAndUpdate('hu');
      await verifyAndUpdateResults('hu');
      
      const latestSessions = sessionsStore.hu.slice(0, MAX_SESSIONS);
      if (latestSessions.length > 0) {
        predictors.hu.updateWithNewData(latestSessions);
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        
        if (lastProcessedPhien.hu !== nextPhien) {
          const result = predictors.hu.predict();
          const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, latestSessions[0], result.signals);
          
          lastProcessedPhien.hu = nextPhien;
          const stats = calculateWinLossStats('hu');
          console.log(`[DỰ ĐOÁN] 🧠 HU Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - Signals: ${result.signalCount} - 📊 Tỉ lệ thắng: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
          
          savePredictionHistory();
        }
      }
    }
    
    if (isReady.md5 && predictors.md5) {
      await fetchAndUpdate('md5');
      await verifyAndUpdateResults('md5');
      
      const latestSessions = sessionsStore.md5.slice(0, MAX_SESSIONS);
      if (latestSessions.length > 0) {
        predictors.md5.updateWithNewData(latestSessions);
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        
        if (lastProcessedPhien.md5 !== nextPhien) {
          const result = predictors.md5.predict();
          const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, latestSessions[0], result.signals);
          
          lastProcessedPhien.md5 = nextPhien;
          const stats = calculateWinLossStats('md5');
          console.log(`[DỰ ĐOÁN] 🧠 MD5 Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - Signals: ${result.signalCount} - 📊 Tỉ lệ thắng: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
          
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
  loadSessionsStore();
  loadPredictionHistory();
  loadResultTracking();
  
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('🏆 ULTIMATE PREDICTOR V7.0 - TOÀN DIỆN NHẤT');
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
  const huStats = calculateWinLossStats('hu');
  const md5Stats = calculateWinLossStats('md5');
  
  res.json({
    hu: {
      sessions: sessionsStore.hu.length,
      ready: isReady.hu,
      predictions: predictionHistory.hu.length,
      winRate: huStats.tiLe,
      wins: huStats.dung,
      losses: huStats.sai
    },
    md5: {
      sessions: sessionsStore.md5.length,
      ready: isReady.md5,
      predictions: predictionHistory.md5.length,
      winRate: md5Stats.tiLe,
      wins: md5Stats.dung,
      losses: md5Stats.sai
    }
  });
});

app.get('/lc79-hu', async (req, res) => {
  try {
    if (!isReady.hu || !predictors.hu) {
      return res.json({ 
        status: 'loading', 
        message: `Đang tải dữ liệu HU: ${sessionsStore.hu.length}/20`,
        progress: `${Math.round(sessionsStore.hu.length / 20 * 100)}%`
      });
    }
    
    await fetchAndUpdate('hu');
    await verifyAndUpdateResults('hu');
    
    const latestSessions = sessionsStore.hu.slice(0, MAX_SESSIONS);
    predictors.hu.updateWithNewData(latestSessions);
    
    const latestPhien = latestSessions[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const predictionResult = predictors.hu.predict();
    const stats = calculateWinLossStats('hu');
    
    const record = savePredictionToHistory('hu', nextPhien, predictionResult.prediction, predictionResult.confidence, latestSessions[0], predictionResult.signals);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Do_tin_cay_hien_tai: record.Do_tin_cay_hien_tai,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      signals: predictionResult.signals.slice(0, 5),
      signal_count: predictionResult.signal_count,
      thong_ke: {
        tong_du_doan: stats.total,
所以_hai: stats.dung,
        so_sai: stats.sai,
        ti_le_thang: `${stats.tiLe}%`
      }
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
        message: `Đang tải dữ liệu MD5: ${sessionsStore.md5.length}/20`,
        progress: `${Math.round(sessionsStore.md5.length / 20 * 100)}%`
      });
    }
    
    await fetchAndUpdate('md5');
    await verifyAndUpdateResults('md5');
    
    const latestSessions = sessionsStore.md5.slice(0, MAX_SESSIONS);
    predictors.md5.updateWithNewData(latestSessions);
    
    const latestPhien = latestSessions[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const predictionResult = predictors.md5.predict();
    const stats = calculateWinLossStats('md5');
    
    const record = savePredictionToHistory('md5', nextPhien, predictionResult.prediction, predictionResult.confidence, latestSessions[0], predictionResult.signals);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Do_tin_cay_hien_tai: record.Do_tin_cay_hien_tai,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id,
      signals: predictionResult.signals.slice(0, 5),
      signal_count: predictionResult.signal_count,
      thong_ke: {
        tong_du_doan: stats.total,
        so_dung: stats.dung,
        so_sai: stats.sai,
        ti_le_thang: `${stats.tiLe}%`
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await verifyAndUpdateResults('hu');
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
    await verifyAndUpdateResults('md5');
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
        message: `Đang tải: ${sessionsStore.hu.length}/20`
      });
    }
    
    const latestSessions = sessionsStore.hu.slice(0, MAX_SESSIONS);
    predictors.hu.updateWithNewData(latestSessions);
    const result = predictors.hu.predict();
    const stats = calculateWinLossStats('hu');
    
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      signals: result.signals.slice(0, 10),
      signal_count: result.signal_count,
      adaptiveFactor: result.adaptiveFactor,
      fallback: result.fallback,
      thong_ke: {
        tong_du_doan: stats.total,
        so_dung: stats.dung,
        so_sai: stats.sai,
        ti_le_thang: `${stats.tiLe}%`
      }
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
        message: `Đang tải: ${sessionsStore.md5.length}/20`
      });
    }
    
    const latestSessions = sessionsStore.md5.slice(0, MAX_SESSIONS);
    predictors.md5.updateWithNewData(latestSessions);
    const result = predictors.md5.predict();
    const stats = calculateWinLossStats('md5');
    
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      signals: result.signals.slice(0, 10),
      signal_count: result.signal_count,
      adaptiveFactor: result.adaptiveFactor,
      fallback: result.fallback,
      thong_ke: {
        tong_du_doan: stats.total,
        so_dung: stats.dung,
        so_sai: stats.sai,
        ti_le_thang: `${stats.tiLe}%`
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/thongke', (req, res) => {
  const stats = calculateWinLossStats('hu');
  res.json({
    type: 'HU',
    tong_du_doan: stats.total,
    so_lan_dung: stats.dung,
    so_lan_sai: stats.sai,
    ti_le_chinh_xac: `${stats.tiLe}%`,
    lich_su_gan_day: predictionHistory.hu.slice(0, 20).map(r => ({
      phien: r.Phien_hien_tai,
      du_doan: r.Du_doan,
      ket_qua: r.ket_qua_du_doan,
      do_tin_cay: r.Do_tin_cay
    }))
  });
});

app.get('/lc79-md5/thongke', (req, res) => {
  const stats = calculateWinLossStats('md5');
  res.json({
    type: 'MD5',
    tong_du_doan: stats.total,
    so_lan_dung: stats.dung,
    so_lan_sai: stats.sai,
    ti_le_chinh_xac: `${stats.tiLe}%`,
    lich_su_gan_day: predictionHistory.md5.slice(0, 20).map(r => ({
      phien: r.Phien_hien_tai,
      du_doan: r.Du_doan,
      ket_qua: r.ket_qua_du_doan,
      do_tin_cay: r.Do_tin_cay
    }))
  });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log('🏆 ULTIMATE PREDICTOR V7.0 - TOÀN DIỆN NHẤT');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('📊 CÁC DẠNG CẦU ĐƯỢC HỖ TRỢ:');
  console.log('   • Cầu cơ bản: 1-1, 2-2, 3-3');
  console.log('   • Cầu phức hợp: 1-2-1, 2-1-2, 1-2-3-2-1');
  console.log('   • Cầu đặc biệt: Đối xứng, tam giác, kim tự tháp');
  console.log('   • Cầu tích lũy: Markov bậc 1-4, mặt vắng Poisson');
  console.log('   • Bộ nhớ pattern thông minh');
  console.log('   • Phụ trợ: Tổng điểm, range, bộ ba, cặp');
  console.log('');
  console.log('📊 TÍNH NĂNG MỚI:');
  console.log('   • Ghi nhớ kết quả thắng/thua chính xác từng phiên');
  console.log('   • Hiển thị độ tin cậy cho phiên hiện tại');
  console.log('   • Thống kê tỉ lệ thắng tự động');
  console.log('   • Lưu trữ lịch sử chi tiết');
  console.log('');
  console.log('📁 Files:');
  console.log('   - sessions_data.json: Lưu phiên đã fetch');
  console.log('   - tiendat1.json: Lịch sử dự đoán');
  console.log('   - ketqua_tracking.json: Lưu kết quả thắng/thua');
  console.log('👤 ID: love trang');
  console.log('═══════════════════════════════════════════════════');
  
  startup();
});
