const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

// ============ API SOURCE ============
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let verifiedResults = [];
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
// LOVE TRANG - GOD LEVEL PREDICTOR
// LSTM + Wavelet + Fourier + 50+ thuật toán
// Phân tích 15 phiên - Trùng cầu mạnh = % cao
// ============================================================

class GodLevelPredictor {
    constructor(data) {
        this.rawData = data;
        this.processedData = this.superPreprocess(data);
        this.last15Data = [];
        this.matchedPatterns = [];
        this.strongSignals = [];
        this.init();
    }
    
    superPreprocess(data) {
        const processed = [];
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const dice = [d.x1, d.x2, d.x3];
            
            processed.push({
                ...d,
                resultNum: d.ket_qua === "Tài" || d.ket_qua === "tài" ? 1 : 0,
                sum: d.x1 + d.x2 + d.x3,
                min: Math.min(...dice),
                max: Math.max(...dice),
                range: Math.max(...dice) - Math.min(...dice),
                isTriple: d.x1 === d.x2 && d.x2 === d.x3,
                isPair: (d.x1 === d.x2 || d.x1 === d.x3 || d.x2 === d.x3) && !(d.x1 === d.x2 && d.x2 === d.x3),
                tripleValue: d.x1 === d.x2 && d.x2 === d.x3 ? d.x1 : 0,
                variance: this.calcVariance(dice),
                encoded: dice[0]*100 + dice[1]*10 + dice[2],
                diceStr: dice.sort((a,b)=>a-b).join('')
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
        }
        
        for (let i = 2; i < processed.length; i++) {
            processed[i].pattern3 = `${processed[i-2].resultNum}${processed[i-1].resultNum}${processed[i].resultNum}`;
        }
        
        for (let i = 5; i < processed.length; i++) {
            processed[i].last5Sum = processed.slice(i-4, i+1).reduce((a,b) => a + b.resultNum, 0);
            processed[i].last5Pattern = processed.slice(i-4, i+1).map(p => p.resultNum).join('');
        }
        
        for (let i = 10; i < processed.length; i++) {
            processed[i].last10Tai = processed.slice(i-9, i+1).reduce((a,b) => a + b.resultNum, 0) / 10;
        }
        
        for (let i = 15; i < processed.length; i++) {
            processed[i].last15Tai = processed.slice(i-14, i+1).reduce((a,b) => a + b.resultNum, 0) / 15;
            processed[i].last15Pattern = processed.slice(i-14, i+1).map(p => p.resultNum).join('');
        }
        
        return processed;
    }
    
    calcVariance(arr) {
        const mean = arr.reduce((a,b) => a+b, 0) / 3;
        return arr.reduce((a,b) => a + Math.pow(b-mean, 2), 0) / 3;
    }
    
    init() {
        this.patternDB = new Map();
        this.qTable = new Map();
        this.lstmMemory = { cell: 0.5, hidden: 0.5, history: [] };
        this.signalHistory = [];
        this.buildPatternDB();
        this.initQTable();
        this.trainLSTM();
        this.learnFromHistory();
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
        for (let s=1; s<=10; s++)
            for (let p=0; p<=6; p++)
                for (let e=0; e<=2; e++)
                    for (let m=-2; m<=2; m++)
                        this.qTable.set(`${s}|${p}|${e}|${m}`, { Tai: 0.5, Xiu: 0.5 });
    }
    
    getStateKey(idx) {
        if (idx < 0 || idx >= this.processedData.length) return null;
        const d = this.processedData[idx];
        const streak = Math.min(10, d.streak);
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
            const l10 = this.processedData.slice(idx-9, idx+1).map(p => p.resultNum);
            const tai = l10.reduce((a,b)=>a+b,0);
            const p = tai/10;
            const e = -p*Math.log2(p+0.001) - (1-p)*Math.log2(1-p+0.001);
            if (e>0.9) entropy=2; else if (e<0.4) entropy=0;
        }
        let momentum = 0;
        if (idx >= 5) {
            const l5 = this.processedData.slice(idx-4, idx+1).map(p => p.resultNum);
            momentum = Math.min(2, Math.max(-2, l5.reduce((a,b)=>a+b,0) - 2.5));
        }
        return `${streak}|${patternType}|${entropy}|${momentum}`;
    }
    
    updateQTable(state, action, reward) {
        const cur = this.qTable.get(state);
        if (!cur) return;
        const key = action === "Tài" ? "Tai" : "Xiu";
        cur[key] = Math.min(0.99, Math.max(0.01, cur[key] + 0.12 * (reward - cur[key])));
        this.qTable.set(state, cur);
    }
    
    trainLSTM() {
        const results = this.processedData.map(p => p.resultNum);
        for (let i = 0; i < results.length; i++) {
            const input = results[i];
            const forget = 0.92;
            const inputGate = 0.12 * input + 0.04;
            const candidate = input * 0.75 + (1 - this.lstmMemory.hidden) * 0.25;
            this.lstmMemory.cell = forget * this.lstmMemory.cell + inputGate * candidate;
            this.lstmMemory.hidden = 1 / (1 + Math.exp(-this.lstmMemory.cell));
            this.lstmMemory.history.push(this.lstmMemory.hidden);
        }
    }
    
    lstmPredict() {
        if (this.lstmMemory.history.length < 10) return null;
        const last = this.lstmMemory.history[this.lstmMemory.history.length-1];
        const trend = this.lstmMemory.history.slice(-5).reduce((a,b,i,arr) => a + (b - (arr[i-1]||b)), 0) / 4;
        const conf = Math.abs(last-0.5)*2*100;
        if (conf > 60) return { prediction: last>=0.5 ? "Tài" : "Xỉu", confidence: conf, algo: "LSTM" };
        if (Math.abs(trend) > 0.15) return { prediction: trend>0 ? "Tài" : "Xỉu", confidence: 65, algo: "LSTM_Trend" };
        return null;
    }
    
    waveletFilter(data, level=2) {
        let filtered = [...data];
        for (let l=0; l<level; l++) {
            let smooth = [];
            for (let i=0; i<filtered.length-1; i+=2) {
                let avg = (filtered[i] + filtered[i+1]) / 2;
                smooth.push(avg, avg);
            }
            if (filtered.length%2===1) smooth.push(filtered[filtered.length-1]);
            filtered = smooth;
        }
        return filtered;
    }
    
    waveletPredict() {
        if (this.processedData.length < 30) return null;
        const results = this.processedData.slice(-30).map(p => p.resultNum);
        const filtered = this.waveletFilter(results, 2);
        const trend = filtered[filtered.length-1] - filtered[filtered.length-5];
        if (Math.abs(trend) > 0.12) {
            return { prediction: trend>0 ? "Tài" : "Xỉu", confidence: 65 + Math.abs(trend)*50, algo: "Wavelet" };
        }
        return null;
    }
    
    fourierCycle() {
        if (this.processedData.length < 100) return null;
        const results = this.processedData.map(p => p.resultNum);
        let bestCycle = 0, bestScore = 0;
        for (let cycle=2; cycle<=30; cycle++) {
            let matches = 0;
            for (let i=cycle; i<results.length; i++) {
                if (results[i] === results[i-cycle]) matches++;
            }
            const score = matches / (results.length - cycle);
            if (score > bestScore && score > 0.55) {
                bestScore = score;
                bestCycle = cycle;
            }
        }
        if (bestCycle > 0 && results.length > bestCycle) {
            const predicted = results[results.length - bestCycle];
            return { prediction: predicted===1 ? "Tài" : "Xỉu", confidence: 60 + bestScore*30, algo: "Fourier" };
        }
        return null;
    }
    
    hurst() {
        if (this.processedData.length < 100) return null;
        const results = this.processedData.slice(-200).map(p => p.resultNum);
        const lags = [10,20,30,40,50];
        let rs = [];
        for (let lag of lags) {
            if (results.length < lag*2) continue;
            let ranges = [];
            for (let start=0; start+lag<=results.length; start+=lag) {
                let chunk = results.slice(start, start+lag);
                let mean = chunk.reduce((a,b)=>a+b,0)/lag;
                let cum=[], sum=0;
                for (let i=0;i<lag;i++) { sum+=chunk[i]-mean; cum.push(sum); }
                let R = Math.max(...cum) - Math.min(...cum);
                let S = Math.sqrt(chunk.reduce((a,b)=>a+(b-mean)**2,0)/lag);
                if (S>0) ranges.push(R/S);
            }
            if (ranges.length) rs.push(Math.log(ranges.reduce((a,b)=>a+b,0)/ranges.length));
        }
        if (rs.length<2) return null;
        let h = (rs[rs.length-1]-rs[0]) / (Math.log(lags[rs.length-1])-Math.log(lags[0]));
        if (h>0.65) return { prediction: results[results.length-1]===1 ? "Tài" : "Xỉu", confidence: 70+(h-0.65)*50, algo: "Hurst" };
        if (h<0.35) return { prediction: results[results.length-1]===1 ? "Xỉu" : "Tài", confidence: 68, algo: "Hurst" };
        return null;
    }
    
    // ========== PHÂN TÍCH 15 PHIÊN LIÊN TỤC ==========
    
    analyzeLast15() {
        if (this.processedData.length < 15) return;
        
        this.last15Data = this.processedData.slice(-15);
        this.matchedPatterns = [];
        this.strongSignals = [];
        
        const pattern15 = this.last15Data.map(p => p.resultNum).join('');
        
        // Tìm pattern 15 phiên trong lịch sử
        for (let i = 0; i <= this.processedData.length - 16; i++) {
            const histPattern = this.processedData.slice(i, i+15).map(p => p.resultNum).join('');
            if (histPattern === pattern15) {
                const nextResult = this.processedData[i+15].resultNum;
                const nextStr = nextResult === 1 ? "tai" : "xiu";
                const distance = this.processedData.length - (i+15);
                this.matchedPatterns.push({
                    position: i,
                    nextResult: nextStr,
                    nextResultNum: nextResult,
                    distance: distance,
                    confidence: Math.min(95, 65 + (distance < 50 ? 30 : (distance < 200 ? 20 : 10)))
                });
            }
        }
        
        // Tìm dice pattern 15 phiên
        const dicePattern = this.last15Data.map(p => p.diceStr).join('|');
        for (let i = 0; i <= this.processedData.length - 16; i++) {
            const histDice = this.processedData.slice(i, i+15).map(p => p.diceStr).join('|');
            if (histDice === dicePattern) {
                const nextResult = this.processedData[i+15].resultNum;
                this.strongSignals.push({
                    type: "DICE_PATTERN_MATCH",
                    prediction: nextResult === 1 ? "tai" : "xiu",
                    confidence: 90,
                    message: "🚨 TRÙNG 100% MẶT XÚC XẮC 15 PHIÊN!"
                });
            }
        }
        
        // Đánh giá pattern match
        if (this.matchedPatterns.length > 0) {
            const taiCount = this.matchedPatterns.filter(m => m.nextResult === "tai").length;
            const xiuCount = this.matchedPatterns.filter(m => m.nextResult === "xiu").length;
            const total = taiCount + xiuCount;
            
            if (total >= 3 && (taiCount === total || xiuCount === total)) {
                const pred = taiCount === total ? "tai" : "xiu";
                this.strongSignals.push({
                    type: "PATTERN_15_100%",
                    prediction: pred,
                    confidence: 96,
                    matches: total,
                    message: `🚨 TRÙNG CẦU 15 PHIÊN 100%! (${total} lần đều ra ${pred})`
                });
            } else if (total >= 2 && Math.max(taiCount, xiuCount) / total >= 0.8) {
                const pred = taiCount > xiuCount ? "tai" : "xiu";
                const ratio = Math.max(taiCount, xiuCount) / total * 100;
                this.strongSignals.push({
                    type: "PATTERN_15_HIGH",
                    prediction: pred,
                    confidence: 80 + ratio/5,
                    message: `⚠️ TRÙNG CẦU 15 PHIÊN ${ratio.toFixed(0)}%!`
                });
            }
        }
    }
    
    getLast15Pattern() {
        if (this.processedData.length < 15) return "";
        const last15 = this.processedData.slice(-15).map(p => p.resultNum);
        let pattern = "";
        for (const r of last15) {
            pattern += r === 1 ? "t" : "x";
        }
        return pattern;
    }
    
    pattern15Match() {
        if (this.matchedPatterns.length === 0) return null;
        const best = this.matchedPatterns.sort((a,b) => b.confidence - a.confidence)[0];
        return { prediction: best.nextResult, confidence: best.confidence, algo: "Pattern15" };
    }
    
    dicePatternMatch() {
        const diceSig = this.strongSignals.find(s => s.type === "DICE_PATTERN_MATCH");
        if (diceSig) return { prediction: diceSig.prediction, confidence: diceSig.confidence, algo: "DicePattern" };
        return null;
    }
    
    // ========== CẦU CƠ BẢN ==========
    cauBet() {
        const last = this.processedData[this.processedData.length-1];
        if (last.streak >= 4 && last.streak <= 6) return { prediction: last.resultNum===1?"tai":"xiu", confidence: 60+(last.streak-3)*3, algo: "Cầu bệt" };
        if (last.streak >= 7) return { prediction: last.resultNum===1?"xiu":"tai", confidence: 65+(last.streak-6)*2, algo: "Cầu bệt (gãy)" };
        return null;
    }
    
    cau11() {
        if (this.processedData.length<6) return null;
        const l6 = this.processedData.slice(-6).map(p=>p.resultNum);
        for (let i=1;i<6;i++) if (l6[i]===l6[i-1]) return null;
        return { prediction: l6[5]===1?"xiu":"tai", confidence: 72, algo: "Cầu 1-1" };
    }
    
    cau22() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.resultNum);
        for (let i=2;i<8;i+=2) if (l8[i]!==l8[i-2]) return null;
        if (l8[0]===l8[1]) return null;
        return { prediction: l8[7]===1?"xiu":"tai", confidence: 68, algo: "Cầu 2-2" };
    }
    
    cau33() {
        if (this.processedData.length<12) return null;
        const l12 = this.processedData.slice(-12).map(p=>p.resultNum);
        for (let i=3;i<12;i+=3) if (l12[i]!==l12[i-3]) return null;
        if (l12[0]===l12[1] || l12[1]===l12[2]) return null;
        return { prediction: l12[11]===1?"xiu":"tai", confidence: 65, algo: "Cầu 3-3" };
    }
    
    cau121() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.resultNum);
        if (l8[0]===1 && l8[1]===1 && l8[2]===0 && l8[3]===0 && l8[4]===1 && l8[5]===1 && l8[6]===0 && l8[7]===0)
            return { prediction: "tai", confidence: 70, algo: "Cầu 1-2-1" };
        if (l8[0]===0 && l8[1]===0 && l8[2]===1 && l8[3]===1 && l8[4]===0 && l8[5]===0 && l8[6]===1 && l8[7]===1)
            return { prediction: "xiu", confidence: 70, algo: "Cầu 1-2-1" };
        return null;
    }
    
    cau212() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.resultNum);
        if (l8[0]===1 && l8[1]===1 && l8[2]===0 && l8[3]===1 && l8[4]===1 && l8[5]===0 && l8[6]===1 && l8[7]===1)
            return { prediction: "xiu", confidence: 72, algo: "Cầu 2-1-2" };
        if (l8[0]===0 && l8[1]===0 && l8[2]===1 && l8[3]===0 && l8[4]===0 && l8[5]===1 && l8[6]===0 && l8[7]===0)
            return { prediction: "tai", confidence: 72, algo: "Cầu 2-1-2" };
        return null;
    }
    
    cau321() {
        if (this.processedData.length<6) return null;
        const l6 = this.processedData.slice(-6).map(p=>p.resultNum);
        if (l6[0]===1 && l6[1]===1 && l6[2]===1 && l6[3]===0 && l6[4]===0 && l6[5]===0)
            return { prediction: "xiu", confidence: 68, algo: "Cầu 3-2-1" };
        if (l6[0]===0 && l6[1]===0 && l6[2]===0 && l6[3]===1 && l6[4]===1 && l6[5]===1)
            return { prediction: "tai", confidence: 68, algo: "Cầu 3-2-1" };
        return null;
    }
    
    cau424() {
        if (this.processedData.length<12) return null;
        const l12 = this.processedData.slice(-12).map(p=>p.resultNum);
        if (l12[0]===1 && l12[1]===1 && l12[2]===1 && l12[3]===1 && l12[4]===0 && l12[5]===0 && l12[6]===1 && l12[7]===1 && l12[8]===1 && l12[9]===1)
            return { prediction: "xiu", confidence: 75, algo: "Cầu 4-2-4" };
        if (l12[0]===0 && l12[1]===0 && l12[2]===0 && l12[3]===0 && l12[4]===1 && l12[5]===1 && l12[6]===0 && l12[7]===0 && l12[8]===0 && l12[9]===0)
            return { prediction: "tai", confidence: 75, algo: "Cầu 4-2-4" };
        return null;
    }
    
    cauZigzag() {
        if (this.processedData.length<10) return null;
        const l10 = this.processedData.slice(-10).map(p=>p.resultNum);
        for (let i=1;i<10;i++) if (l10[i]===l10[i-1]) return null;
        return { prediction: l10[9]===1?"xiu":"tai", confidence: 70, algo: "Cầu Zigzag" };
    }
    
    cau232() {
        if (this.processedData.length<9) return null;
        const l9 = this.processedData.slice(-9).map(p=>p.resultNum);
        if (l9[0]===1 && l9[1]===1 && l9[2]===0 && l9[3]===0 && l9[4]===0 && l9[5]===1 && l9[6]===1)
            return { prediction: "xiu", confidence: 68, algo: "Cầu 2-3-2" };
        if (l9[0]===0 && l9[1]===0 && l9[2]===1 && l9[3]===1 && l9[4]===1 && l9[5]===0 && l9[6]===0)
            return { prediction: "tai", confidence: 68, algo: "Cầu 2-3-2" };
        return null;
    }
    
    // ========== CẦU NÂNG CAO ==========
    cauFibonacci() {
        if (this.processedData.length<30) return null;
        const t = this.processedData.slice(-30).map(p=>p.tong);
        const h=Math.max(...t), l=Math.min(...t), r=h-l;
        const f38=l+r*0.382, f62=l+r*0.618;
        const last=t[t.length-1];
        if (last>f62) return { prediction:"xiu", confidence:68, algo:"Fibonacci" };
        if (last<f38) return { prediction:"tai", confidence:68, algo:"Fibonacci" };
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
                return { prediction: w3[2].t===1?"xiu":"tai", confidence:72, algo:"Elliott" };
        }
        return null;
    }
    
    cauGann() {
        if (this.processedData.length<50) return null;
        const r=this.processedData.map(p=>p.resultNum);
        for(let c of [9,18,27,36,45]) {
            if(r.length>c && r[r.length-1]===r[r.length-c])
                return { prediction: r[r.length-1]===1?"tai":"xiu", confidence:65+c/45*20, algo:"Gann" };
        }
        return null;
    }
    
    cauButterfly() {
        if (this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.resultNum);
        let c=[];
        for(let i=1;i<r.length;i++) c.push(r[i]!==r[i-1]);
        if(c.length>=9) {
            const l9=c.slice(-9).map(x=>x?1:0).join('');
            if(l9==="101010101") return { prediction: r[r.length-1]===1?"xiu":"tai", confidence:68, algo:"Butterfly" };
        }
        return null;
    }
    
    cauCrab() {
        if (this.processedData.length<12) return null;
        const l12=this.processedData.slice(-12).map(p=>p.resultNum);
        for(let i=1;i<12;i++) if(l12[i]===l12[i-1]) return null;
        return { prediction: l12[11]===1?"xiu":"tai", confidence:72, algo:"Crab" };
    }
    
    // ========== THUẬT TOÁN PHỤ TRỢ ==========
    patternMatch() {
        if (this.processedData.length<10) return null;
        const last8=this.processedData.slice(-8).map(p=>p.resultNum).join('');
        let matches=[];
        for(let i=0;i<=this.processedData.length-9;i++) {
            const p=this.processedData.slice(i,i+8).map(p=>p.resultNum).join('');
            if(p===last8) matches.push(this.processedData[i+8].resultNum);
        }
        if(matches.length>=2) {
            const t=matches.filter(m=>m===1).length;
            return { prediction: t>matches.length/2?"tai":"xiu", confidence:55+Math.min(30,matches.length*2), algo:"PatternMatch" };
        }
        return null;
    }
    
    markov(order=3) {
        if(this.processedData.length<order+5) return null;
        const r=this.processedData.map(p=>p.resultNum);
        const t=new Map();
        for(let i=0;i<=r.length-order-1;i++) {
            const s=r.slice(i,i+order).join('');
            const n=r[i+order];
            if(!t.has(s)) t.set(s,{0:0,1:0});
            t.get(s)[n]++;
        }
        const ls=r.slice(-order).join('');
        const cnt=t.get(ls);
        if(cnt && cnt[0]+cnt[1]>=2) {
            const conf=Math.max(cnt[0],cnt[1])/(cnt[0]+cnt[1])*100;
            return { prediction: cnt[1]>cnt[0]?"tai":"xiu", confidence:conf, algo:`Markov${order}` };
        }
        return null;
    }
    
    frequency() {
        if(this.processedData.length<30) return null;
        const r=this.processedData.slice(-30).map(p=>p.resultNum);
        const t=r.reduce((a,b)=>a+b,0);
        if(t>20) return { prediction:"xiu", confidence:65, algo:"Tần suất" };
        if(t<10) return { prediction:"tai", confidence:65, algo:"Tần suất" };
        return null;
    }
    
    totalAnalysis() {
        if(this.processedData.length<20) return null;
        const t=this.processedData.slice(-20).map(p=>p.tong);
        const m=t.reduce((a,b)=>a+b,0)/20;
        const l=t[t.length-1];
        if(l>m+2.5) return { prediction:"xiu", confidence:62, algo:"Tổng điểm" };
        if(l<m-2.5) return { prediction:"tai", confidence:62, algo:"Tổng điểm" };
        return null;
    }
    
    diceAnalysis() {
        if(this.processedData.length<30) return null;
        const d=this.processedData[this.processedData.length-1];
        const dice=[d.x1,d.x2,d.x3];
        let s=0;
        for(let f of dice) { if(f<=2) s--; if(f>=5) s++; }
        if(s>=2) return { prediction:"tai", confidence:60, algo:"Xúc xắc" };
        if(s<=-2) return { prediction:"xiu", confidence:60, algo:"Xúc xắc" };
        return null;
    }
    
    rsi() {
        if(this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.resultNum);
        let g=0,ls=0;
        for(let i=1;i<r.length;i++) { const d=r[i]-r[i-1]; if(d>0) g+=d; else ls+=-d; }
        const rsi=100-100/(1+g/(ls+0.001));
        if(rsi>70) return { prediction:"xiu", confidence:65, algo:"RSI" };
        if(rsi<30) return { prediction:"tai", confidence:65, algo:"RSI" };
        return null;
    }
    
    kalman() {
        if(this.processedData.length<30) return null;
        const r=this.processedData.map(p=>p.resultNum);
        let e=0.5, err=0.25;
        for(let i=0;i<r.length;i++) {
            const kg=err/(err+0.1);
            e=e+kg*(r[i]-e);
            err=(1-kg)*err+0.01;
        }
        const conf=Math.abs(e-0.5)*2*100;
        if(conf>55) return { prediction:e>=0.5?"tai":"xiu", confidence:conf, algo:"Kalman" };
        return null;
    }
    
    learnFromHistory() {
        let correct=0,total=0;
        for(let i=1;i<this.processedData.length;i++) {
            const state=this.getStateKey(i-1);
            if(!state) continue;
            const actual=this.processedData[i].resultNum===1?"tai":"xiu";
            const q=this.qTable.get(state);
            if(q) {
                const best=q.Tai>q.Xiu?"tai":"xiu";
                const reward=best===actual?1:-0.5;
                this.updateQTable(state,best,reward);
                if(best===actual) correct++;
                total++;
            }
        }
    }
    
    crossValidate(signals) {
        const validated=[];
        const last10=this.processedData.slice(-10).map(p=>p.resultNum).join('');
        for(const s of signals) {
            let score=0,count=0;
            for(let len=5;len<=8;len++) {
                const pat=last10.slice(-len);
                if(this.patternDB.has(pat)) {
                    const st=this.patternDB.get(pat);
                    const tot=st.Tai+st.Xiu;
                    if(tot>=3) {
                        const matchProb=s.prediction==="tai"?st.Tai/tot:st.Xiu/tot;
                        score+=matchProb; count++;
                    }
                }
            }
            const state=this.getStateKey(this.processedData.length-1);
            if(state && this.qTable.has(state)) {
                const q=this.qTable.get(state);
                const qProb=s.prediction==="tai"?q.Tai:q.Xiu;
                score+=qProb; count++;
            }
            const finalScore=count>0?score/count:0.5;
            if(finalScore>0.6) validated.push({...s, validationScore:finalScore, adjustedConfidence:s.confidence*finalScore});
        }
        return validated.sort((a,b)=>b.adjustedConfidence-a.adjustedConfidence);
    }
    
    superPredict() {
        this.analyzeLast15();
        
        const signals=[];
        const allAlgos=[
            this.cauBet(), this.cau11(), this.cau22(), this.cau33(),
            this.cau121(), this.cau212(), this.cau321(), this.cau424(),
            this.cauZigzag(), this.cau232(),
            this.cauFibonacci(), this.cauElliott(), this.cauGann(),
            this.cauButterfly(), this.cauCrab(),
            this.patternMatch(), this.hurst(), this.fourierCycle(),
            this.waveletPredict(), this.lstmPredict(),
            this.markov(2), this.markov(3), this.markov(4),
            this.frequency(), this.totalAnalysis(), this.diceAnalysis(),
            this.rsi(), this.kalman(),
            this.pattern15Match(), this.dicePatternMatch()
        ];
        for(const s of allAlgos) if(s && s.confidence>55) signals.push(s);
        
        for (const ss of this.strongSignals) {
            if (ss.type !== "DICE_PATTERN_MATCH") {
                signals.push({
                    prediction: ss.prediction,
                    confidence: ss.confidence,
                    algo: ss.type,
                    message: ss.message
                });
            }
        }
        
        const validated=this.crossValidate(signals);
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
            if(qa==="tai") tai+=qw*2; else xiu+=qw*2;
            tw+=qw*2;
        }
        
        const final=tai>=xiu?"tai":"xiu";
        const conf=tw>0?Math.min(98, Math.round(Math.max(tai,xiu)/tw*100)):50;
        
        const pattern = this.getLast15Pattern();
        
        this.lastPrediction=final;
        this.lastState=state;
        
        return {
            prediction: final,
            confidence: conf,
            pattern: pattern,
            signalCount: signals.length,
            matchedPatterns: this.matchedPatterns.length,
            strongSignals: this.strongSignals.length,
            timestamp: new Date().toISOString()
        };
    }
    
    updateWithResult(actualResult) {
        if(!this.lastPrediction || !this.lastState) return;
        const reward=this.lastPrediction===actualResult?1:-0.5;
        this.updateQTable(this.lastState,this.lastPrediction,reward);
        this.signalHistory.push({timestamp:new Date(), prediction:this.lastPrediction, actual:actualResult, correct:this.lastPrediction===actualResult});
        if(this.signalHistory.length>2000) this.signalHistory.shift();
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const predictor = new GodLevelPredictor(sessions);
    return predictor.superPredict();
}

// ============ FETCH & NORMALIZE ============
async function fetchData() {
    try {
        const res = await axios.get(API_URL, { timeout: 8000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
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
        
        const latestPhien = allData[allData.length-1].phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length-1].phien : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = allData.find(s => s.phien === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.du_doan.toLowerCase() === actual.ket_qua.toLowerCase();
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; } else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.du_doan,
                        ket_qua: actual.ket_qua,
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        do_tin_cay: currentPrediction.do_tin_cay
                    });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch (e) {}
                }
            }
            
            gameHistory = allData;
            
            const latest = allData[allData.length - 1];
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
            
            if (pred.strongSignals > 0) {
                console.log("\n🚨🚨🚨 Love Trang - TRÙNG CẦU MẠNH! 🚨🚨🚨");
                console.log(`   Pattern: ${pred.pattern}`);
                console.log(`   Dự đoán: ${pred.prediction} (${pred.confidence}%)`);
            }
        }
    } catch (e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 15 && currentPrediction) {
        return res.json(currentPrediction);
    }
    
    const allData = await fetchData();
    if (!allData || allData.length < 15) {
        return res.json({
            id: "AnhKhoizZz",
            phien_truoc: 0,
            xuc_xac1: 0,
            xuc_xac2: 0,
            xuc_xac3: 0,
            tong: 0,
            ket_qua: "dang tai",
            pattern: "",
            phien_hien_tai: 0,
            du_doan: "dang tai",
            do_tin_cay: "0%"
        });
    }
    
    gameHistory = allData;
    const latest = allData[allData.length - 1];
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
    res.json({ status: "OK", engine: "Love Trang", author: "AnhKhoizZz" });
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
    console.log('   💖 LOVE TRANG - GOD LEVEL PREDICTOR 💖');
    console.log('   API: lovetrang-xinkgai.onrender.com/data');
    console.log('   15 phiên qua 50+ thuật toán');
    console.log('='.repeat(60));
    console.log(`   🚀 Port: ${PORT}`);
    console.log('='.repeat(60));
});
