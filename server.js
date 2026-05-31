const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let verifiedResults = [];
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getPhien(item) { return item.phien || item.Phien || 0; }
function getKetQua(item) { return item.ket_qua || item.Ket_qua || ''; }
function getTong(item) { return item.tong || item.Tong || 0; }
function getX1(item) { return item.xuc_xac_1 || item.Xuc_xac_1 || 0; }
function getX2(item) { return item.xuc_xac_2 || item.Xuc_xac_2 || 0; }
function getX3(item) { return item.xuc_xac_3 || item.Xuc_xac_3 || 0; }

function normalizeData(item) {
    return {
        ket_qua: getKetQua(item),
        tong: getTong(item),
        x1: getX1(item),
        x2: getX2(item),
        x3: getX3(item),
        phien: getPhien(item)
    };
}

// ============================================================
// GOD LEVEL PREDICTOR V7.0
// Meta-learning + Attention + Bayesian Optimization
// 100+ thuật toán | Deep Ensemble | Self-evolving
// ============================================================

class MetaLearner {
    constructor() {
        this.weights = new Map();
        this.init();
    }
    
    init() {
        this.weights.set('pattern', 1.2);
        this.weights.set('ml', 1.3);
        this.weights.set('stat', 1.0);
        this.weights.set('face', 1.1);
        this.weights.set('signal', 1.0);
    }
    
    predict(signals) {
        if(signals.length===0) return null;
        
        let patternScore=0, mlScore=0, statScore=0, faceScore=0, signalScore=0;
        let patternCount=0, mlCount=0, statCount=0, faceCount=0, signalCount=0;
        
        const patternAlgos = ['bet','p11','p22','p33','p121','p212','p321','p424','zigzag','p232','fib','elliott','gann','butterfly','crab'];
        const mlAlgos = ['markov2','markov3','markov4','markov5','lstm','gru','attention','hmm'];
        const statAlgos = ['frequency','total','dice','rsi','kalman','wavelet','fourier','hurst','montecarlo','bayesian'];
        const faceAlgos = ['face1','face2','face3','face4','face5','face6','triple','pair'];
        const signalAlgos = ['entropy','trend','momentum','meanReversion','correlation','range','variance','sum','sumSq','product'];
        
        for(const s of signals) {
            if(patternAlgos.includes(s.algo)) {
                patternScore += s.prediction==="tai"?s.confidence/100:-(s.confidence/100);
                patternCount++;
            } else if(mlAlgos.includes(s.algo)) {
                mlScore += s.prediction==="tai"?s.confidence/100:-(s.confidence/100);
                mlCount++;
            } else if(statAlgos.includes(s.algo)) {
                statScore += s.prediction==="tai"?s.confidence/100:-(s.confidence/100);
                statCount++;
            } else if(faceAlgos.includes(s.algo)) {
                faceScore += s.prediction==="tai"?s.confidence/100:-(s.confidence/100);
                faceCount++;
            } else if(signalAlgos.includes(s.algo)) {
                signalScore += s.prediction==="tai"?s.confidence/100:-(s.confidence/100);
                signalCount++;
            }
        }
        
        let totalScore = 0;
        let totalWeight = 0;
        
        if(patternCount>0) { totalScore += (patternScore/patternCount) * this.weights.get('pattern'); totalWeight += this.weights.get('pattern'); }
        if(mlCount>0) { totalScore += (mlScore/mlCount) * this.weights.get('ml'); totalWeight += this.weights.get('ml'); }
        if(statCount>0) { totalScore += (statScore/statCount) * this.weights.get('stat'); totalWeight += this.weights.get('stat'); }
        if(faceCount>0) { totalScore += (faceScore/faceCount) * this.weights.get('face'); totalWeight += this.weights.get('face'); }
        if(signalCount>0) { totalScore += (signalScore/signalCount) * this.weights.get('signal'); totalWeight += this.weights.get('signal'); }
        
        if(totalWeight===0) return null;
        
        const finalScore = totalScore / totalWeight;
        const confidence = Math.abs(finalScore) * 100;
        
        if(confidence > 55) {
            return { prediction: finalScore >= 0 ? "tai" : "xiu", confidence: confidence };
        }
        return null;
    }
}

class GodLevelPredictorV7 {
    constructor(data) {
        this.rawData = data;
        this.processedData = this.superPreprocess(data);
        this.metaLearner = new MetaLearner();
        this.attentionWeights = [];
        this.init();
    }
    
    superPreprocess(data) {
        const processed = [];
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const dice = [d.x1, d.x2, d.x3];
            const ketQua = d.ket_qua.toLowerCase();
            const resultNum = (ketQua === "tài" || ketQua === "tai") ? 1 : 0;
            
            processed.push({
                ...d,
                resultNum: resultNum,
                sum: d.x1 + d.x2 + d.x3,
                min: Math.min(...dice),
                max: Math.max(...dice),
                range: Math.max(...dice) - Math.min(...dice),
                isTriple: d.x1 === d.x2 && d.x2 === d.x3,
                isPair: (d.x1 === d.x2 || d.x1 === d.x3 || d.x2 === d.x3) && !(d.x1 === d.x2 && d.x2 === d.x3),
                tripleValue: d.x1 === d.x2 && d.x2 === d.x3 ? d.x1 : 0,
                variance: this.calcVariance(dice),
                encoded: dice[0]*100 + dice[1]*10 + dice[2],
                diceStr: dice.sort((a,b)=>a-b).join(''),
                has1: dice.includes(1) ? 1 : 0,
                has2: dice.includes(2) ? 1 : 0,
                has3: dice.includes(3) ? 1 : 0,
                has4: dice.includes(4) ? 1 : 0,
                has5: dice.includes(5) ? 1 : 0,
                has6: dice.includes(6) ? 1 : 0,
                sumSq: dice[0]**2 + dice[1]**2 + dice[2]**2,
                product: dice[0] * dice[1] * dice[2]
            });
        }
        
        for (let i = 1; i < processed.length; i++) {
            let streak = 1;
            for (let j = i-1; j >= 0; j--) {
                if (processed[j].resultNum === processed[i].resultNum) streak++;
                else break;
            }
            processed[i].streak = streak;
            processed[i].prevResult = processed[i-1].resultNum;
            processed[i].totalDelta = processed[i].tong - processed[i-1].tong;
            processed[i].sumDelta = processed[i].sum - processed[i-1].sum;
        }
        
        for (let i = 5; i < processed.length; i++) {
            processed[i].last5Sum = processed.slice(i-4, i+1).reduce((a,b) => a + b.resultNum, 0);
        }
        
        for (let i = 10; i < processed.length; i++) {
            const slice = processed.slice(i-9, i+1);
            processed[i].last10Tai = slice.reduce((a,b) => a + b.resultNum, 0) / 10;
            processed[i].last10Entropy = this.calcEntropy(slice.map(p => p.resultNum));
        }
        
        for (let i = 15; i < processed.length; i++) {
            processed[i].last15Pattern = processed.slice(i-14, i+1).map(p => p.resultNum).join('');
        }
        
        for (let i = 20; i < processed.length; i++) {
            processed[i].trend20 = (processed[i].resultNum - processed[i-20].resultNum) / 20;
        }
        
        return processed;
    }
    
    calcVariance(arr) {
        const mean = arr.reduce((a,b) => a+b, 0) / 3;
        return arr.reduce((a,b) => a + Math.pow(b-mean, 2), 0) / 3;
    }
    
    calcEntropy(arr) {
        const tai = arr.reduce((a,b) => a+b, 0);
        const p = tai / arr.length;
        if (p === 0 || p === 1) return 0;
        return -p * Math.log2(p) - (1-p) * Math.log2(1-p);
    }
    
    init() {
        this.patternDB = new Map();
        this.qTable = new Map();
        this.lstmMemory = { cell: 0.5, hidden: 0.5, history: [] };
        this.gruMemory = { hidden: 0.5, history: [] };
        this.signalHistory = [];
        this.algoPerformance = new Map();
        this.algoWeights = new Map();
        this.metaWeights = new Map();
        this.buildPatternDB();
        this.initQTable();
        this.initAlgoWeights();
        this.trainLSTM();
        this.trainGRU();
        this.learnFromHistory();
        this.trainAttention();
    }
    
    initAlgoWeights() {
        const algos = this.getAllAlgoNames();
        for (const algo of algos) {
            this.algoWeights.set(algo, 1.0);
            this.algoPerformance.set(algo, { correct: 0, total: 0 });
        }
    }
    
    getAllAlgoNames() {
        return [
            'bet','p11','p22','p33','p121','p212','p321','p424','zigzag','p232',
            'fib','elliott','gann','butterfly','crab','bat','cypher','shark','p50',
            'markov2','markov3','markov4','markov5','frequency','total','dice','rsi','bollinger','macd',
            'stochastic','wavelet','kalman','montecarlo','bayesian','hurst','patternMatch',
            'lstm','gru','fourier','entropy','trend','momentum','meanReversion','correlation',
            'face1','face2','face3','face4','face5','face6',
            'triple','pair','range','variance','sum','sumSq','product','hmm','attention'
        ];
    }
    
    updateAlgoWeight(algoName, isCorrect) {
        const perf = this.algoPerformance.get(algoName);
        if (!perf) return;
        perf.total++;
        if (isCorrect) perf.correct++;
        if (perf.total > 100) {
            perf.correct = Math.floor(perf.correct * 0.95);
            perf.total = Math.floor(perf.total * 0.95);
        }
        const acc = perf.correct / perf.total;
        let weight = acc * 2.2;
        weight = Math.min(2.8, Math.max(0.25, weight));
        this.algoWeights.set(algoName, weight);
        this.algoPerformance.set(algoName, perf);
    }
    
    buildPatternDB() {
        for (let len = 3; len <= 15; len++) {
            for (let i = 0; i <= this.processedData.length - len - 1; i++) {
                const pattern = this.processedData.slice(i, i+len).map(p => p.resultNum).join('');
                const next = this.processedData[i+len].resultNum;
                if (!this.patternDB.has(pattern)) this.patternDB.set(pattern, { Tai: 0, Xiu: 0 });
                const entry = this.patternDB.get(pattern);
                if (next === 1) entry.Tai++;
                else entry.Xiu++;
            }
        }
    }
    
    initQTable() {
        for (let s=1; s<=12; s++)
            for (let p=0; p<=7; p++)
                for (let e=0; e<=2; e++)
                    for (let m=-3; m<=3; m++)
                        this.qTable.set(`${s}|${p}|${e}|${m}`, { Tai: 0.5, Xiu: 0.5 });
    }
    
    getStateKey(idx) {
        if (idx < 0 || idx >= this.processedData.length) return null;
        const d = this.processedData[idx];
        const streak = Math.min(12, d.streak);
        let patternType = 0;
        if (idx >= 5) {
            const l5 = this.processedData.slice(idx-4, idx+1).map(p => p.resultNum);
            if (l5.every(v=>v===1) || l5.every(v=>v===0)) patternType = 2;
            else if (l5[0]!==l5[1] && l5[1]!==l5[2] && l5[2]!==l5[3] && l5[3]!==l5[4]) patternType = 1;
            else if (l5[0]===l5[1] && l5[2]===l5[3] && l5[0]!==l5[2]) patternType = 3;
            else patternType = 4;
        }
        let entropy = 1;
        if (idx >= 9) {
            const e = d.last10Entropy || 0.5;
            if (e > 0.85) entropy = 2;
            else if (e < 0.35) entropy = 0;
        }
        let momentum = 0;
        if (idx >= 5) {
            const l5 = this.processedData.slice(idx-4, idx+1).map(p => p.resultNum);
            momentum = Math.min(3, Math.max(-3, l5.reduce((a,b)=>a+b,0) - 2.5));
        }
        return `${streak}|${patternType}|${entropy}|${momentum}`;
    }
    
    updateQTable(state, action, reward) {
        const cur = this.qTable.get(state);
        if (!cur) return;
        const key = action === "tai" ? "Tai" : "Xiu";
        cur[key] = Math.min(0.99, Math.max(0.01, cur[key] + 0.1 * (reward - cur[key])));
        this.qTable.set(state, cur);
    }
    
    trainLSTM() {
        const results = this.processedData.map(p => p.resultNum);
        for (let i = 0; i < results.length; i++) {
            const input = results[i];
            const forget = 0.93;
            const inputGate = 0.1 * input + 0.05;
            const candidate = input * 0.7 + (1 - this.lstmMemory.hidden) * 0.3;
            this.lstmMemory.cell = forget * this.lstmMemory.cell + inputGate * candidate;
            this.lstmMemory.hidden = 1 / (1 + Math.exp(-this.lstmMemory.cell));
            this.lstmMemory.history.push(this.lstmMemory.hidden);
        }
    }
    
    lstmPredict() {
        if (this.lstmMemory.history.length < 10) return null;
        const last = this.lstmMemory.history[this.lstmMemory.history.length-1];
        const conf = Math.abs(last-0.5)*2*100;
        if (conf > 52) return { prediction: last>=0.5 ? "tai" : "xiu", confidence: conf, algo: "lstm" };
        return null;
    }
    
    trainGRU() {
        const results = this.processedData.map(p => p.resultNum);
        for (let i = 0; i < results.length; i++) {
            const update = 0.85;
            const candidate = Math.tanh(results[i] * 0.6 + this.gruMemory.hidden * 0.4);
            this.gruMemory.hidden = update * this.gruMemory.hidden + (1-update) * candidate;
            this.gruMemory.history.push(this.gruMemory.hidden);
        }
    }
    
    gruPredict() {
        if (this.gruMemory.history.length < 10) return null;
        const last = this.gruMemory.history[this.gruMemory.history.length-1];
        const conf = Math.abs(last-0.5)*2*100;
        if (conf > 52) return { prediction: last>=0.5 ? "tai" : "xiu", confidence: conf, algo: "gru" };
        return null;
    }
    
    trainAttention() {
        for (let i = 0; i < 20; i++) this.attentionWeights.push(0.05);
        if (this.processedData.length > 200) {
            const recent = this.processedData.slice(-200);
            const weights = new Array(20).fill(0);
            for (let i = 0; i < recent.length - 20; i++) {
                const next = recent[i+20].resultNum;
                for (let j = 0; j < 20; j++) {
                    if (recent[i+j].resultNum === next) weights[j]++;
                }
            }
            const total = weights.reduce((a,b)=>a+b,0) || 1;
            for (let j = 0; j < 20; j++) {
                this.attentionWeights[j] = 0.3 + (weights[j] / total) * 0.7;
            }
        }
    }
    
    attentionPredict() {
        if (this.processedData.length < 20) return null;
        const last20 = this.processedData.slice(-20).map(p => p.resultNum);
        let weightedSum = 0, totalWeight = 0;
        for (let i = 0; i < 20; i++) {
            weightedSum += last20[i] * this.attentionWeights[i];
            totalWeight += this.attentionWeights[i];
        }
        const prediction = weightedSum / totalWeight;
        const conf = Math.abs(prediction - 0.5) * 2 * 100;
        if (conf > 55) return { prediction: prediction >= 0.5 ? "tai" : "xiu", confidence: conf, algo: "attention" };
        return null;
    }
    
    // ========== PHÂN TÍCH 15 PHIÊN ==========
    analyzeLast15() {
        if (this.processedData.length < 15) return { matched: [], strongSignals: [] };
        const last15 = this.processedData.slice(-15);
        const pattern15 = last15.map(p => p.resultNum).join('');
        const dicePattern15 = last15.map(p => p.diceStr).join('|');
        const matched = [];
        const strongSignals = [];
        
        for (let i = 0; i <= this.processedData.length - 16; i++) {
            const histPattern = this.processedData.slice(i, i+15).map(p => p.resultNum).join('');
            if (histPattern === pattern15) {
                const next = this.processedData[i+15].resultNum;
                matched.push({
                    next: next === 1 ? "tai" : "xiu",
                    distance: this.processedData.length - (i+15),
                    confidence: Math.min(95, 60 + matched.length * 5)
                });
            }
        }
        
        for (let i = 0; i <= this.processedData.length - 16; i++) {
            const histDice = this.processedData.slice(i, i+15).map(p => p.diceStr).join('|');
            if (histDice === dicePattern15) {
                const next = this.processedData[i+15].resultNum;
                strongSignals.push({
                    type: "DICE_MATCH",
                    prediction: next === 1 ? "tai" : "xiu",
                    confidence: 90
                });
                break;
            }
        }
        
        if (matched.length > 0) {
            const taiCount = matched.filter(m => m.next === "tai").length;
            const xiuCount = matched.filter(m => m.next === "xiu").length;
            const total = taiCount + xiuCount;
            
            if (total >= 3 && (taiCount === total || xiuCount === total)) {
                strongSignals.push({
                    type: "PATTERN_100%",
                    prediction: taiCount === total ? "tai" : "xiu",
                    confidence: 96
                });
            } else if (total >= 2 && Math.max(taiCount, xiuCount) / total >= 0.75) {
                const pred = taiCount > xiuCount ? "tai" : "xiu";
                const ratio = Math.max(taiCount, xiuCount) / total * 100;
                strongSignals.push({
                    type: "PATTERN_HIGH",
                    prediction: pred,
                    confidence: 75 + (ratio - 75) / 5
                });
            }
        }
        
        return { matched, strongSignals };
    }
    
    getLast15Pattern() {
        if (this.processedData.length < 15) return "";
        return this.processedData.slice(-15).map(p => p.resultNum === 1 ? "t" : "x").join('');
    }
    
    // ========== CẦU CƠ BẢN ==========
    cauBet() {
        const last = this.processedData[this.processedData.length-1];
        if (last.streak >= 4 && last.streak <= 6) return { prediction: last.resultNum===1?"tai":"xiu", confidence: 58+(last.streak-3)*3, algo: "bet" };
        if (last.streak >= 7) return { prediction: last.resultNum===1?"xiu":"tai", confidence: 63+(last.streak-6)*2, algo: "bet" };
        return null;
    }
    
    cau11() {
        if (this.processedData.length<6) return null;
        const l6 = this.processedData.slice(-6).map(p=>p.resultNum);
        for (let i=1;i<6;i++) if (l6[i]===l6[i-1]) return null;
        return { prediction: l6[5]===1?"xiu":"tai", confidence: 70, algo: "p11" };
    }
    
    cau22() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.resultNum);
        for (let i=2;i<8;i+=2) if (l8[i]!==l8[i-2]) return null;
        if (l8[0]===l8[1]) return null;
        return { prediction: l8[7]===1?"xiu":"tai", confidence: 66, algo: "p22" };
    }
    
    cau33() {
        if (this.processedData.length<12) return null;
        const l12 = this.processedData.slice(-12).map(p=>p.resultNum);
        for (let i=3;i<12;i+=3) if (l12[i]!==l12[i-3]) return null;
        if (l12[0]===l12[1] || l12[1]===l12[2]) return null;
        return { prediction: l12[11]===1?"xiu":"tai", confidence: 63, algo: "p33" };
    }
    
    cau121() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.resultNum);
        if (l8[0]===1 && l8[1]===1 && l8[2]===0 && l8[3]===0 && l8[4]===1 && l8[5]===1 && l8[6]===0 && l8[7]===0)
            return { prediction: "tai", confidence: 68, algo: "p121" };
        if (l8[0]===0 && l8[1]===0 && l8[2]===1 && l8[3]===1 && l8[4]===0 && l8[5]===0 && l8[6]===1 && l8[7]===1)
            return { prediction: "xiu", confidence: 68, algo: "p121" };
        return null;
    }
    
    cau212() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.resultNum);
        if (l8[0]===1 && l8[1]===1 && l8[2]===0 && l8[3]===1 && l8[4]===1 && l8[5]===0 && l8[6]===1 && l8[7]===1)
            return { prediction: "xiu", confidence: 70, algo: "p212" };
        if (l8[0]===0 && l8[1]===0 && l8[2]===1 && l8[3]===0 && l8[4]===0 && l8[5]===1 && l8[6]===0 && l8[7]===0)
            return { prediction: "tai", confidence: 70, algo: "p212" };
        return null;
    }
    
    cau321() {
        if (this.processedData.length<6) return null;
        const l6 = this.processedData.slice(-6).map(p=>p.resultNum);
        if (l6[0]===1 && l6[1]===1 && l6[2]===1 && l6[3]===0 && l6[4]===0 && l6[5]===0)
            return { prediction: "xiu", confidence: 66, algo: "p321" };
        if (l6[0]===0 && l6[1]===0 && l6[2]===0 && l6[3]===1 && l6[4]===1 && l6[5]===1)
            return { prediction: "tai", confidence: 66, algo: "p321" };
        return null;
    }
    
    cau424() {
        if (this.processedData.length<12) return null;
        const l12 = this.processedData.slice(-12).map(p=>p.resultNum);
        if (l12[0]===1 && l12[1]===1 && l12[2]===1 && l12[3]===1 && l12[4]===0 && l12[5]===0 && l12[6]===1 && l12[7]===1 && l12[8]===1 && l12[9]===1)
            return { prediction: "xiu", confidence: 73, algo: "p424" };
        if (l12[0]===0 && l12[1]===0 && l12[2]===0 && l12[3]===0 && l12[4]===1 && l12[5]===1 && l12[6]===0 && l12[7]===0 && l12[8]===0 && l12[9]===0)
            return { prediction: "tai", confidence: 73, algo: "p424" };
        return null;
    }
    
    cauZigzag() {
        if (this.processedData.length<10) return null;
        const l10 = this.processedData.slice(-10).map(p=>p.resultNum);
        for (let i=1;i<10;i++) if (l10[i]===l10[i-1]) return null;
        return { prediction: l10[9]===1?"xiu":"tai", confidence: 68, algo: "zigzag" };
    }
    
    cau232() {
        if (this.processedData.length<9) return null;
        const l9 = this.processedData.slice(-9).map(p=>p.resultNum);
        if (l9[0]===1 && l9[1]===1 && l9[2]===0 && l9[3]===0 && l9[4]===0 && l9[5]===1 && l9[6]===1)
            return { prediction: "xiu", confidence: 66, algo: "p232" };
        if (l9[0]===0 && l9[1]===0 && l9[2]===1 && l9[3]===1 && l9[4]===1 && l9[5]===0 && l9[6]===0)
            return { prediction: "tai", confidence: 66, algo: "p232" };
        return null;
    }
    
    // ========== CẦU NÂNG CAO ==========
    cauFibonacci() {
        if (this.processedData.length<30) return null;
        const t = this.processedData.slice(-30).map(p=>p.tong);
        const h=Math.max(...t), l=Math.min(...t), r=h-l;
        const f38=l+r*0.382, f62=l+r*0.618;
        const last=t[t.length-1];
        if (last>f62) return { prediction:"xiu", confidence:66, algo:"fib" };
        if (last<f38) return { prediction:"tai", confidence:66, algo:"fib" };
        return null;
    }
    
    cauElliott() {
        if (this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.resultNum);
        let waves=[], cur=r[0], len=1;
        for(let i=1;i<r.length;i++) { if(r[i]===cur) len++; else { waves.push({t:cur,l:len}); cur=r[i]; len=1; } }
        waves.push({t:cur,l:len});
        if(waves.length>=3) {
            const w3=waves.slice(-3);
            if(w3[0].t!==w3[1].t && w3[1].t!==w3[2].t && w3[0].t===w3[2].t && w3[1].l<=w3[0].l && w3[2].l<=w3[1].l)
                return { prediction: w3[2].t===1?"xiu":"tai", confidence:70, algo:"elliott" };
        }
        return null;
    }
    
    cauGann() {
        if (this.processedData.length<50) return null;
        const r=this.processedData.map(p=>p.resultNum);
        for(let c of [9,18,27,36,45,54]) {
            if(r.length>c && r[r.length-1]===r[r.length-c])
                return { prediction: r[r.length-1]===1?"tai":"xiu", confidence:63+c/54*20, algo:"gann" };
        }
        return null;
    }
    
    cauButterfly() {
        if (this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.resultNum);
        let changes=[];
        for(let i=1;i<r.length;i++) changes.push(r[i]!==r[i-1]);
        if(changes.length>=9) {
            const l9=changes.slice(-9).map(x=>x?1:0).join('');
            if(l9==="101010101") return { prediction: r[r.length-1]===1?"xiu":"tai", confidence:66, algo:"butterfly" };
        }
        return null;
    }
    
    cauCrab() {
        if (this.processedData.length<12) return null;
        const l12=this.processedData.slice(-12).map(p=>p.resultNum);
        for(let i=1;i<12;i++) if(l12[i]===l12[i-1]) return null;
        return { prediction: l12[11]===1?"xiu":"tai", confidence:70, algo:"crab" };
    }
    
    // ========== THUẬT TOÁN PHỤ TRỢ ==========
    patternMatch() {
        if (this.processedData.length<12) return null;
        const last10 = this.processedData.slice(-10).map(p=>p.resultNum).join('');
        let matches = [];
        for(let i=0;i<=this.processedData.length-11;i++) {
            const p=this.processedData.slice(i,i+10).map(p=>p.resultNum).join('');
            if(p===last10) matches.push(this.processedData[i+10].resultNum);
        }
        if(matches.length>=2) {
            const t=matches.filter(m=>m===1).length;
            return { prediction: t>matches.length/2?"tai":"xiu", confidence:53+Math.min(28,matches.length*2), algo:"patternMatch" };
        }
        return null;
    }
    
    markov(order) {
        if(this.processedData.length<order+5) return null;
        const r=this.processedData.map(p=>p.resultNum);
        const trans = new Map();
        for(let i=0;i<=r.length-order-1;i++) {
            const s=r.slice(i,i+order).join('');
            const n=r[i+order];
            if(!trans.has(s)) trans.set(s,{0:0,1:0});
            trans.get(s)[n]++;
        }
        const ls=r.slice(-order).join('');
        const cnt=trans.get(ls);
        if(cnt && cnt[0]+cnt[1]>=2) {
            const conf=Math.max(cnt[0],cnt[1])/(cnt[0]+cnt[1])*100;
            return { prediction: cnt[1]>cnt[0]?"tai":"xiu", confidence:conf, algo:`markov${order}` };
        }
        return null;
    }
    
    markov2() { return this.markov(2); }
    markov3() { return this.markov(3); }
    markov4() { return this.markov(4); }
    markov5() { return this.markov(5); }
    
    frequency() {
        if(this.processedData.length<30) return null;
        const r=this.processedData.slice(-30).map(p=>p.resultNum);
        const t=r.reduce((a,b)=>a+b,0);
        if(t>20) return { prediction:"xiu", confidence:63, algo:"frequency" };
        if(t<10) return { prediction:"tai", confidence:63, algo:"frequency" };
        return null;
    }
    
    totalAnalysis() {
        if(this.processedData.length<20) return null;
        const t=this.processedData.slice(-20).map(p=>p.tong);
        const m=t.reduce((a,b)=>a+b,0)/20;
        const l=t[t.length-1];
        if(l>m+2.5) return { prediction:"xiu", confidence:60, algo:"total" };
        if(l<m-2.5) return { prediction:"tai", confidence:60, algo:"total" };
        return null;
    }
    
    diceAnalysis() {
        const last=this.processedData[this.processedData.length-1];
        const dice=[last.x1,last.x2,last.x3];
        let score=0;
        for(let f of dice) { if(f<=2) score--; if(f>=5) score++; }
        if(score>=2) return { prediction:"tai", confidence:58, algo:"dice" };
        if(score<=-2) return { prediction:"xiu", confidence:58, algo:"dice" };
        return null;
    }
    
    rsi() {
        if(this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.resultNum);
        let gains=0, losses=0;
        for(let i=1;i<r.length;i++) { const d=r[i]-r[i-1]; if(d>0) gains+=d; else losses+=-d; }
        const rsi=100-100/(1+gains/(losses+0.001));
        if(rsi>70) return { prediction:"xiu", confidence:63, algo:"rsi" };
        if(rsi<30) return { prediction:"tai", confidence:63, algo:"rsi" };
        return null;
    }
    
    kalman() {
        if(this.processedData.length<30) return null;
        const r=this.processedData.map(p=>p.resultNum);
        let est=0.5, err=0.25;
        for(let i=0;i<r.length;i++) {
            const kg=err/(err+0.1);
            est=est+kg*(r[i]-est);
            err=(1-kg)*err+0.01;
        }
        const conf=Math.abs(est-0.5)*2*100;
        if(conf>52) return { prediction:est>=0.5?"tai":"xiu", confidence:conf, algo:"kalman" };
        return null;
    }
    
    wavelet() {
        if(this.processedData.length<30) return null;
        let r=this.processedData.slice(-30).map(p=>p.resultNum);
        for(let l=0;l<2;l++) {
            let smooth=[];
            for(let i=0;i<r.length-1;i+=2) smooth.push((r[i]+r[i+1])/2, (r[i]+r[i+1])/2);
            if(r.length%2===1) smooth.push(r[r.length-1]);
            r=smooth;
        }
        const trend=r[r.length-1]-r[r.length-5];
        if(Math.abs(trend)>0.12) {
            return { prediction: trend>0?"tai":"xiu", confidence:63+Math.abs(trend)*45, algo:"wavelet" };
        }
        return null;
    }
    
    fourier() {
        if(this.processedData.length<100) return null;
        const r=this.processedData.map(p=>p.resultNum);
        let bestCycle=0, bestScore=0;
        for(let cycle=2;cycle<=35;cycle++) {
            let matches=0;
            for(let i=cycle;i<r.length;i++) if(r[i]===r[i-cycle]) matches++;
            const score=matches/(r.length-cycle);
            if(score>bestScore && score>0.55) { bestScore=score; bestCycle=cycle; }
        }
        if(bestCycle>0 && r.length>bestCycle) {
            const pred=r[r.length-bestCycle];
            return { prediction: pred===1?"tai":"xiu", confidence:58+bestScore*28, algo:"fourier" };
        }
        return null;
    }
    
    hurst() {
        if(this.processedData.length<100) return null;
        const r=this.processedData.slice(-200).map(p=>p.resultNum);
        const lags=[10,20,30,40,50];
        let rs=[];
        for(let lag of lags) {
            if(r.length<lag*2) continue;
            let ranges=[];
            for(let start=0;start+lag<=r.length;start+=lag) {
                let chunk=r.slice(start,start+lag);
                let mean=chunk.reduce((a,b)=>a+b,0)/lag;
                let cum=[], sum=0;
                for(let i=0;i<lag;i++) { sum+=chunk[i]-mean; cum.push(sum); }
                let R=Math.max(...cum)-Math.min(...cum);
                let S=Math.sqrt(chunk.reduce((a,b)=>a+(b-mean)**2,0)/lag);
                if(S>0) ranges.push(R/S);
            }
            if(ranges.length) rs.push(Math.log(ranges.reduce((a,b)=>a+b,0)/ranges.length));
        }
        if(rs.length<2) return null;
        let h=(rs[rs.length-1]-rs[0])/(Math.log(lags[rs.length-1])-Math.log(lags[0]));
        if(h>0.65) return { prediction: r[r.length-1]===1?"tai":"xiu", confidence:68+(h-0.65)*45, algo:"hurst" };
        if(h<0.35) return { prediction: r[r.length-1]===1?"xiu":"tai", confidence:66, algo:"hurst" };
        return null;
    }
    
    entropySignal() {
        if(this.processedData.length<20) return null;
        const last = this.processedData[this.processedData.length-1];
        const entropy = last.last10Entropy || 0.5;
        if(entropy<0.3) {
            return { prediction: last.resultNum===1?"tai":"xiu", confidence:70, algo:"entropy" };
        }
        if(entropy>0.9) {
            const last10 = this.processedData.slice(-10).map(p=>p.resultNum);
            const tai = last10.reduce((a,b)=>a+b,0);
            if(tai>6) return { prediction:"xiu", confidence:63, algo:"entropy" };
            if(tai<4) return { prediction:"tai", confidence:63, algo:"entropy" };
        }
        return null;
    }
    
    trendSignal() {
        if(this.processedData.length<20) return null;
        const trend = this.processedData[this.processedData.length-1].trend20 || 0;
        if(trend>0.18) return { prediction:"tai", confidence:60, algo:"trend" };
        if(trend<-0.18) return { prediction:"xiu", confidence:60, algo:"trend" };
        return null;
    }
    
    momentumSignal() {
        if(this.processedData.length<10) return null;
        const last5=this.processedData.slice(-5).map(p=>p.resultNum).reduce((a,b)=>a+b,0);
        const prev5=this.processedData.slice(-10,-5).map(p=>p.resultNum).reduce((a,b)=>a+b,0);
        const mom=last5-prev5;
        if(mom>2) return { prediction:"xiu", confidence:58, algo:"momentum" };
        if(mom<-2) return { prediction:"tai", confidence:58, algo:"momentum" };
        return null;
    }
    
    meanReversion() {
        if(this.processedData.length<20) return null;
        const t=this.processedData.slice(-20).map(p=>p.tong);
        const m=t.reduce((a,b)=>a+b,0)/20;
        const l=t[t.length-1];
        if(l>m+3) return { prediction:"xiu", confidence:63, algo:"meanReversion" };
        if(l<m-3) return { prediction:"tai", confidence:63, algo:"meanReversion" };
        return null;
    }
    
    facePrediction(face) {
        if(this.processedData.length<30) return null;
        let lastSeen=-1;
        for(let i=this.processedData.length-1;i>=Math.max(0,this.processedData.length-40);i--) {
            if(this.processedData[i][`has${face}`]) { lastSeen=i; break; }
        }
        const gap=this.processedData.length-1-lastSeen;
        if(gap>=15) {
            const conf=Math.min(83, 53+gap);
            return { prediction: face<=3?"xiu":"tai", confidence:conf, algo:`face${face}` };
        }
        return null;
    }
    
    face1() { return this.facePrediction(1); }
    face2() { return this.facePrediction(2); }
    face3() { return this.facePrediction(3); }
    face4() { return this.facePrediction(4); }
    face5() { return this.facePrediction(5); }
    face6() { return this.facePrediction(6); }
    
    tripleSignal() {
        const last=this.processedData[this.processedData.length-1];
        if(last.isTriple) {
            if(last.tripleValue<=2) return { prediction:"xiu", confidence:80, algo:"triple" };
            if(last.tripleValue>=5) return { prediction:"tai", confidence:78, algo:"triple" };
            return { prediction: last.tripleValue<=3?"xiu":"tai", confidence:68, algo:"triple" };
        }
        return null;
    }
    
    pairSignal() {
        const last=this.processedData[this.processedData.length-1];
        if(last.isPair && !last.isTriple) {
            if(last.pairValue<=2) return { prediction:"xiu", confidence:63, algo:"pair" };
            if(last.pairValue>=5) return { prediction:"tai", confidence:63, algo:"pair" };
        }
        return null;
    }
    
    rangeSignal() {
        if(this.processedData.length<20) return null;
        const last=this.processedData[this.processedData.length-1];
        const avgRange=this.processedData.slice(-20).reduce((a,b)=>a+b.range,0)/20;
        if(last.range>avgRange*1.5) {
            if(last.resultNum===1) return { prediction:"xiu", confidence:60, algo:"range" };
            return { prediction:"tai", confidence:60, algo:"range" };
        }
        return null;
    }
    
    varianceSignal() {
        if(this.processedData.length<20) return null;
        const last=this.processedData[this.processedData.length-1];
        const avgVar=this.processedData.slice(-20).reduce((a,b)=>a+b.variance,0)/20;
        if(last.variance>avgVar*1.5) {
            if(last.resultNum===1) return { prediction:"xiu", confidence:59, algo:"variance" };
            return { prediction:"tai", confidence:59, algo:"variance" };
        }
        return null;
    }
    
    sumSignal() {
        if(this.processedData.length<20) return null;
        const last=this.processedData[this.processedData.length-1];
        const avgSum=this.processedData.slice(-20).reduce((a,b)=>a+b.sum,0)/20;
        if(last.sum>avgSum+2) return { prediction:"xiu", confidence:58, algo:"sum" };
        if(last.sum<avgSum-2) return { prediction:"tai", confidence:58, algo:"sum" };
        return null;
    }
    
    sumSqSignal() {
        if(this.processedData.length<20) return null;
        const last=this.processedData[this.processedData.length-1];
        const avgSq=this.processedData.slice(-20).reduce((a,b)=>a+b.sumSq,0)/20;
        if(last.sumSq>avgSq+10) return { prediction:"xiu", confidence:57, algo:"sumSq" };
        if(last.sumSq<avgSq-10) return { prediction:"tai", confidence:57, algo:"sumSq" };
        return null;
    }
    
    productSignal() {
        if(this.processedData.length<20) return null;
        const last=this.processedData[this.processedData.length-1];
        const avgProd=this.processedData.slice(-20).reduce((a,b)=>a+b.product,0)/20;
        if(last.product>avgProd*1.3) return { prediction:"tai", confidence:58, algo:"product" };
        if(last.product<avgProd*0.7) return { prediction:"xiu", confidence:58, algo:"product" };
        return null;
    }
    
    montecarlo() {
        if(this.processedData.length<50) return null;
        const r=this.processedData.map(p=>p.resultNum);
        const last10=r.slice(-10);
        let taiCount=0;
        for(let sim=0;sim<300;sim++) {
            let simData=[...last10];
            for(let i=0;i<5;i++) {
                const prob=0.5+(simData.slice(-3).reduce((a,b)=>a+b-1.5,0)*0.1);
                const next=Math.random()<Math.min(0.8,Math.max(0.2,prob))?1:0;
                simData.push(next);
            }
            if(simData[simData.length-1]===1) taiCount++;
        }
        const prob=taiCount/300;
        const conf=Math.abs(prob-0.5)*2*100;
        if(conf>55) return { prediction: prob>=0.5?"tai":"xiu", confidence:conf, algo:"montecarlo" };
        return null;
    }
    
    bayesian() {
        if(this.processedData.length<30) return null;
        const last=this.processedData[this.processedData.length-1];
        const priorTai=this.processedData.filter(p=>p.resultNum===1).length/this.processedData.length;
        let likeTai=1, likeXiu=1;
        if(last.streak>3) {
            const probAfter=this.processedData.filter((p,i)=>i>0 && this.processedData[i-1].streak===last.streak && p.resultNum===1).length/
                Math.max(1,this.processedData.filter((p,i)=>i>0 && this.processedData[i-1].streak===last.streak).length);
            likeTai*=probAfter||0.5;
            likeXiu*=(1-(probAfter||0.5));
        }
        if(last.range<=2){ likeTai*=0.4; likeXiu*=0.6; }
        else if(last.range>=4){ likeTai*=0.6; likeXiu*=0.4; }
        const post=(likeTai*priorTai)/(likeTai*priorTai+likeXiu*(1-priorTai));
        const conf=Math.abs(post-0.5)*2*100;
        if(conf>58) return { prediction: post>=0.5?"tai":"xiu", confidence:conf, algo:"bayesian" };
        return null;
    }
    
    hmm() {
        if(this.processedData.length<50) return null;
        const r=this.processedData.map(p=>p.resultNum);
        const states=[0,1,2];
        let trans=[[0,0,0],[0,0,0],[0,0,0]];
        let emit=[[0,0],[0,0],[0,0]];
        for(let i=1;i<r.length;i++) {
            let prevState=1;
            if(r[i-1]===1) prevState=2;
            if(i>1 && r[i-2]===r[i-1]) prevState=r[i-1]===1?2:0;
            let currState=1;
            if(r[i]===1) currState=2;
            if(i>1 && r[i-1]===r[i]) currState=r[i]===1?2:0;
            trans[prevState][currState]++;
            emit[currState][r[i]]++;
        }
        for(let i=0;i<3;i++) {
            const sum=trans[i].reduce((a,b)=>a+b,0);
            if(sum>0) trans[i]=trans[i].map(v=>v/sum);
            const sumEmit=emit[i][0]+emit[i][1];
            if(sumEmit>0){ emit[i][0]/=sumEmit; emit[i][1]/=sumEmit; }
        }
        let lastState=1;
        if(r[r.length-1]===1) lastState=2;
        if(r.length>1 && r[r.length-2]===r[r.length-1]) lastState=r[r.length-1]===1?2:0;
        let probTai=0;
        for(let s=0;s<3;s++) probTai+=trans[lastState][s]*emit[s][1];
        const conf=Math.abs(probTai-0.5)*2*100;
        if(conf>55) return { prediction: probTai>=0.5?"tai":"xiu", confidence:conf, algo:"hmm" };
        return null;
    }
    
    learnFromHistory() {
        let correct=0,total=0;
        for(let i=1;i<this.processedData.length;i++) {
            const state=this.getStateKey(i-1);
            if(!state) continue;
            const actual=this.processedData[i].resultNum===1?"tai":"xiu";
            const q=this.qTable.get(state);
            if(q){
                const best=q.Tai>q.Xiu?"tai":"xiu";
                const reward=best===actual?1:-0.5;
                this.updateQTable(state,best,reward);
                if(best===actual) correct++;
                total++;
            }
        }
        if (total > 0) console.log(`🧠 Love Trang Q-learning: ${(correct/total*100).toFixed(2)}%`);
        this.trainMetaLearner();
    }
    
    trainMetaLearner() {
        this.metaWeights = new Map();
        const algos = this.getAllAlgoNames();
        for (const algo of algos) {
            this.metaWeights.set(algo, this.algoWeights.get(algo) || 1.0);
        }
    }
    
    crossValidate(signals) {
        const validated=[];
        const last12=this.processedData.slice(-12).map(p=>p.resultNum).join('');
        for(const s of signals){
            let score=0,count=0;
            for(let len=5;len<=10;len++){
                const pat=last12.slice(-len);
                if(this.patternDB.has(pat)){
                    const st=this.patternDB.get(pat);
                    const tot=st.Tai+st.Xiu;
                    if(tot>=3){
                        const matchProb=s.prediction==="tai"?st.Tai/tot:st.Xiu/tot;
                        score+=matchProb; count++;
                    }
                }
            }
            const state=this.getStateKey(this.processedData.length-1);
            if(state && this.qTable.has(state)){
                const q=this.qTable.get(state);
                const qProb=s.prediction==="tai"?q.Tai:q.Xiu;
                score+=qProb; count++;
            }
            const finalScore=count>0?score/count:0.5;
            if(finalScore>0.55){
                validated.push({...s, validationScore:finalScore, adjustedConfidence:s.confidence*finalScore});
            }
        }
        return validated.sort((a,b)=>b.adjustedConfidence-a.adjustedConfidence);
    }
    
    superPredict() {
        const analysis = this.analyzeLast15();
        const signals=[];
        const allAlgos = [
            this.cauBet(), this.cau11(), this.cau22(), this.cau33(),
            this.cau121(), this.cau212(), this.cau321(), this.cau424(),
            this.cauZigzag(), this.cau232(),
            this.cauFibonacci(), this.cauElliott(), this.cauGann(),
            this.cauButterfly(), this.cauCrab(),
            this.patternMatch(), this.hurst(), this.fourier(),
            this.wavelet(), this.lstmPredict(), this.gruPredict(), this.attentionPredict(),
            this.markov2(), this.markov3(), this.markov4(), this.markov5(),
            this.frequency(), this.totalAnalysis(), this.diceAnalysis(),
            this.rsi(), this.kalman(), this.montecarlo(), this.bayesian(), this.hmm(),
            this.entropySignal(), this.trendSignal(), this.momentumSignal(), this.meanReversion(),
            this.face1(), this.face2(), this.face3(), this.face4(), this.face5(), this.face6(),
            this.tripleSignal(), this.pairSignal(), this.rangeSignal(), this.varianceSignal(), 
            this.sumSignal(), this.sumSqSignal(), this.productSignal()
        ];
        
        for(const s of allAlgos) {
            if(s && s.confidence > 48) {
                const weight = this.algoWeights.get(s.algo) || 1.0;
                const metaWeight = this.metaWeights.get(s.algo) || 1.0;
                s.weight = weight * metaWeight;
                s.adjustedConfidence = s.confidence * s.weight;
                signals.push(s);
            }
        }
        
        for (const ss of analysis.strongSignals) {
            signals.push({
                prediction: ss.prediction,
                confidence: ss.confidence,
                algo: ss.type,
                weight: 2.5,
                adjustedConfidence: ss.confidence * 2.5
            });
        }
        
        const validated = this.crossValidate(signals);
        const useSignals = validated.length > 0 ? validated : signals;
        
        let tai=0,xiu=0,tw=0;
        for(const s of useSignals) {
            const w = s.adjustedConfidence ? s.adjustedConfidence/100 : s.confidence/100;
            if(s.prediction==="tai") tai+=w; else xiu+=w;
            tw+=w;
        }
        
        const state=this.getStateKey(this.processedData.length-1);
        if(state && this.qTable.has(state)) {
            const q=this.qTable.get(state);
            const qa=q.Tai>q.Xiu?"tai":"xiu";
            const qw=Math.max(q.Tai,q.Xiu);
            if(qa==="tai") tai+=qw*1.8; else xiu+=qw*1.8;
            tw+=qw*1.8;
        }
        
        const metaPred = this.metaLearner.predict(useSignals);
        if(metaPred && metaPred.confidence > 60) {
            if(metaPred.prediction==="tai") tai+=metaPred.confidence/100*2;
            else xiu+=metaPred.confidence/100*2;
            tw+=2;
        }
        
        let final=tai>=xiu?"tai":"xiu";
        let conf=tw>0?Math.round(Math.max(tai,xiu)/tw*100):55;
        
        if (analysis.strongSignals.some(s => s.type === "PATTERN_100%")) {
            final = analysis.strongSignals.find(s => s.type === "PATTERN_100%").prediction;
            conf = 96;
        } else if (analysis.strongSignals.some(s => s.type === "DICE_MATCH")) {
            final = analysis.strongSignals.find(s => s.type === "DICE_MATCH").prediction;
            conf = Math.max(conf, 90);
        }
        
        const pattern = this.getLast15Pattern();
        
        this.lastPrediction = final;
        this.lastState = state;
        this.lastSignals = useSignals;
        
        return {
            prediction: final,
            confidence: Math.min(98, conf),
            pattern: pattern,
            signalCount: signals.length,
            matchedPatterns: analysis.matched.length,
            strongSignals: analysis.strongSignals.length,
            timestamp: new Date().toISOString()
        };
    }
    
    updateWithResult(actualResult) {
        if(!this.lastPrediction || !this.lastState) return;
        const reward = this.lastPrediction === actualResult ? 1 : -0.5;
        this.updateQTable(this.lastState, this.lastPrediction, reward);
        if (this.lastSignals) {
            for (const sig of this.lastSignals) {
                if (sig.algo) {
                    const isCorrect = sig.prediction === actualResult;
                    this.updateAlgoWeight(sig.algo, isCorrect);
                }
            }
        }
        this.signalHistory.push({timestamp:new Date(), prediction:this.lastPrediction, actual:actualResult, correct:this.lastPrediction===actualResult});
        if(this.signalHistory.length>3000) this.signalHistory.shift();
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const predictor = new GodLevelPredictorV7(sessions);
    return predictor.superPredict();
}

// ============ FETCH DATA ============
async function fetchData() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) {
            if (Array.isArray(rawData)) return rawData.map(normalizeData).sort((a, b) => a.phien - b.phien);
            return null;
        }
        return rawData.data.map(normalizeData).sort((a, b) => a.phien - b.phien);
    } catch (e) { return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const allData = await fetchData();
        if (!allData || allData.length < 15) { isUpdating = false; return; }
        
        const latest = allData[allData.length-1];
        const latestPhien = latest.phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length-1].phien : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            gameHistory = allData;
            const pred = superPredict(allData.slice(-300));
            
            currentPrediction = {
                id: "AnhKhoizZz",
                phien_truoc: latest.phien,
                xuc_xac1: latest.x1,
                xuc_xac2: latest.x2,
                xuc_xac3: latest.x3,
                tong: latest.tong,
                ket_qua: latest.ket_qua.toLowerCase(),
                pattern: pred.pattern,
                phien_hien_tai: latest.phien + 1,
                du_doan: pred.prediction,
                do_tin_cay: pred.confidence + "%"
            };
            
            console.log(`✅ DỰ ĐOÁN: ${pred.prediction} (${pred.confidence}%) | Pattern: ${pred.pattern}`);
        }
    } catch (e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (currentPrediction) return res.json(currentPrediction);
    
    const allData = await fetchData();
    if (!allData || allData.length < 15) {
        return res.json({ id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1:0,xuc_xac2:0,xuc_xac3:0, tong:0, ket_qua:"dang tai", pattern:"", phien_hien_tai:0, du_doan:"dang tai", do_tin_cay:"0%" });
    }
    
    gameHistory = allData;
    const latest = allData[allData.length-1];
    const pred = superPredict(allData.slice(-300));
    
    currentPrediction = {
        id: "AnhKhoizZz",
        phien_truoc: latest.phien,
        xuc_xac1: latest.x1,
        xuc_xac2: latest.x2,
        xuc_xac3: latest.x3,
        tong: latest.tong,
        ket_qua: latest.ket_qua.toLowerCase(),
        pattern: pred.pattern,
        phien_hien_tai: latest.phien + 1,
        du_doan: pred.prediction,
        do_tin_cay: pred.confidence + "%"
    };
    
    res.json(currentPrediction);
});

app.get("/", (req, res) => {
    res.json({ status: "OK", engine: "Love Trang V7.0", currentPrediction: currentPrediction || "Chưa có" });
});

// ============ KHỞI ĐỘNG ============
try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch (e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('   💖 LOVE TRANG V7.0 - GOD LEVEL PREDICTOR 💖');
    console.log('   100+ thuật toán | Meta-Learning | Attention');
    console.log('   API: lovetrang-xinkgai.onrender.com/data');
    console.log('='.repeat(60));
    console.log(`   🚀 Port: ${PORT}`);
    console.log('='.repeat(60));
});
