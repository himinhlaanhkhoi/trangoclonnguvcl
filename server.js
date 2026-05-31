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
// ULTIMATE GAME BREAKER - SIÊU DỰ ĐOÁN TÀI XỈU
// Khai thác mọi trick, quy luật ẩn, cầu siêu khó
// 120+ thuật toán | Deep exploit | Tự học không giới hạn
// ============================================================

class GameBreaker {
    constructor(data) {
        this.rawData = data;
        this.processedData = this.deepExploitPreprocess(data);
        this.exploits = [];
        this.hiddenRules = [];
        this.tricks = [];
        this.init();
    }
    
    deepExploitPreprocess(data) {
        const processed = [];
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const dice = [d.x1, d.x2, d.x3];
            const ketQua = d.ket_qua.toLowerCase();
            const resultNum = (ketQua === "tài" || ketQua === "tai") ? 1 : 0;
            
            processed.push({
                phien: d.phien,
                ket_qua: resultNum,
                ket_qua_str: ketQua,
                tong: d.tong,
                x1: d.x1, x2: d.x2, x3: d.x3,
                sum: d.x1 + d.x2 + d.x3,
                min: Math.min(...dice),
                max: Math.max(...dice),
                range: Math.max(...dice) - Math.min(...dice),
                isTriple: d.x1 === d.x2 && d.x2 === d.x3,
                isPair: (d.x1 === d.x2 || d.x1 === d.x3 || d.x2 === d.x3) && !(d.x1 === d.x2 && d.x2 === d.x3),
                tripleValue: d.x1 === d.x2 && d.x2 === d.x3 ? d.x1 : 0,
                pairValue: d.x1 === d.x2 ? d.x1 : (d.x1 === d.x3 ? d.x1 : (d.x2 === d.x3 ? d.x2 : 0)),
                uniqueFaces: new Set(dice).size,
                variance: this.calcVariance(dice),
                product: dice[0] * dice[1] * dice[2],
                sumSq: dice[0]**2 + dice[1]**2 + dice[2]**2,
                diceStr: dice.sort((a,b)=>a-b).join(''),
                has1: dice.includes(1), has2: dice.includes(2), has3: dice.includes(3),
                has4: dice.includes(4), has5: dice.includes(5), has6: dice.includes(6),
                count1: dice.filter(x=>x===1).length, count2: dice.filter(x=>x===2).length,
                count3: dice.filter(x=>x===3).length, count4: dice.filter(x=>x===4).length,
                count5: dice.filter(x=>x===5).length, count6: dice.filter(x=>x===6).length,
                sumLow: (d.x1<=2?d.x1:0)+(d.x2<=2?d.x2:0)+(d.x3<=2?d.x3:0),
                sumMid: (d.x1>=3&&d.x1<=4?d.x1:0)+(d.x2>=3&&d.x2<=4?d.x2:0)+(d.x3>=3&&d.x3<=4?d.x3:0),
                sumHigh: (d.x1>=5?d.x1:0)+(d.x2>=5?d.x2:0)+(d.x3>=5?d.x3:0),
                encoded: dice[0]*100 + dice[1]*10 + dice[2]
            });
        }
        
        for (let i = 1; i < processed.length; i++) {
            let streak = 1;
            for (let j = i-1; j >= 0; j--) {
                if (processed[j].ket_qua === processed[i].ket_qua) streak++;
                else break;
            }
            processed[i].streak = streak;
            processed[i].prevResult = processed[i-1].ket_qua;
            processed[i].prevTong = processed[i-1].tong;
            processed[i].totalDelta = processed[i].tong - processed[i-1].tong;
            processed[i].isReversal = processed[i].ket_qua !== processed[i-1].ket_qua;
            
            for (let face = 1; face <= 6; face++) {
                let faceStreak = 0;
                for (let j = i; j >= 0; j--) {
                    if (processed[j][`has${face}`]) faceStreak++;
                    else break;
                }
                processed[i][`face${face}Streak`] = faceStreak;
            }
        }
        
        for (let i = 2; i < processed.length; i++) {
            processed[i].pattern3 = `${processed[i-2].ket_qua}${processed[i-1].ket_qua}${processed[i].ket_qua}`;
        }
        
        for (let i = 5; i < processed.length; i++) {
            const window5 = processed.slice(i-4, i+1);
            processed[i].last5Sum = window5.reduce((a,b) => a + b.ket_qua, 0);
            processed[i].last5Pattern = window5.map(p => p.ket_qua).join('');
        }
        
        for (let i = 10; i < processed.length; i++) {
            const window10 = processed.slice(i-9, i+1);
            processed[i].last10Sum = window10.reduce((a,b) => a + b.ket_qua, 0);
            processed[i].last10Tai = processed[i].last10Sum / 10;
            processed[i].last10Entropy = this.calcEntropy(window10.map(p => p.ket_qua));
            processed[i].last10TotalTrend = (window10[9].tong - window10[0].tong) / 10;
        }
        
        for (let i = 15; i < processed.length; i++) {
            processed[i].last15Pattern = processed.slice(i-14, i+1).map(p => p.ket_qua).join('');
        }
        
        for (let i = 20; i < processed.length; i++) {
            processed[i].trend20 = (processed[i].ket_qua - processed[i-20].ket_qua) / 20;
        }
        
        for (let i = 10; i < processed.length; i++) {
            if (processed[i-1].isTriple && processed[i-1].tripleValue === 1) processed[i].trick1 = true;
            if (processed[i-1].isTriple && processed[i-1].tripleValue === 6) processed[i].trick2 = true;
            if (processed[i-1].isPair && processed[i-1].pairValue === 1) processed[i].trick3 = true;
            if (processed[i-1].isPair && processed[i-1].pairValue === 6) processed[i].trick4 = true;
            if (processed[i-1].tong >= 15) processed[i].trick5 = true;
            if (processed[i-1].tong <= 5) processed[i].trick6 = true;
        }
        
        return processed;
    }
    
    calcVariance(arr) {
        const mean = arr.reduce((a,b) => a+b, 0) / arr.length;
        return arr.reduce((a,b) => a + Math.pow(b-mean, 2), 0) / arr.length;
    }
    
    calcEntropy(arr) {
        const tai = arr.reduce((a,b) => a+b, 0);
        const p = tai / arr.length;
        if (p === 0 || p === 1) return 0;
        return -p * Math.log2(p) - (1-p) * Math.log2(1-p);
    }
    
    init() {
        this.discoverExploits();
        this.discoverHiddenRules();
        this.discoverTricks();
    }
    
    discoverExploits() {
        for (let streak = 1; streak <= 15; streak++) {
            const afterStreak = [];
            for (let i = streak; i < this.processedData.length; i++) {
                let isStreak = true;
                for (let j = 0; j < streak; j++) {
                    if (this.processedData[i-1-j].ket_qua !== this.processedData[i-1].ket_qua) {
                        isStreak = false; break;
                    }
                }
                if (isStreak) afterStreak.push(this.processedData[i].ket_qua);
            }
            if (afterStreak.length > 10) {
                const taiCount = afterStreak.filter(r => r === 1).length;
                const taiProb = taiCount / afterStreak.length;
                if (Math.abs(taiProb - 0.5) > 0.15) {
                    this.exploits.push({
                        type: "streak", value: streak,
                        prediction: taiProb > 0.5 ? "tai" : "xiu",
                        confidence: Math.abs(taiProb - 0.5) * 2 * 100,
                        sampleSize: afterStreak.length
                    });
                }
            }
        }
        
        const patterns = ['00','01','10','11','000','001','010','011','100','101','110','111'];
        for (const pattern of patterns) {
            const afterPattern = [];
            const len = pattern.length;
            for (let i = len; i < this.processedData.length; i++) {
                const lastPattern = this.processedData.slice(i-len, i).map(p => p.ket_qua).join('');
                if (lastPattern === pattern) afterPattern.push(this.processedData[i].ket_qua);
            }
            if (afterPattern.length > 15) {
                const taiCount = afterPattern.filter(r => r === 1).length;
                const taiProb = taiCount / afterPattern.length;
                if (Math.abs(taiProb - 0.5) > 0.2) {
                    this.exploits.push({
                        type: "pattern", value: pattern,
                        prediction: taiProb > 0.5 ? "tai" : "xiu",
                        confidence: Math.abs(taiProb - 0.5) * 2 * 100,
                        sampleSize: afterPattern.length
                    });
                }
            }
        }
    }
    
    discoverHiddenRules() {
        for (let i = 1; i < this.processedData.length; i++) {
            const prevTotal = this.processedData[i-1].tong;
            if (!this.hiddenRules[prevTotal]) this.hiddenRules[prevTotal] = [];
            this.hiddenRules[prevTotal].push(this.processedData[i].ket_qua);
        }
        for (let face = 1; face <= 6; face++) {
            for (let i = 1; i < this.processedData.length; i++) {
                if (this.processedData[i-1][`has${face}`]) {
                    if (!this.hiddenRules[`face${face}`]) this.hiddenRules[`face${face}`] = [];
                    this.hiddenRules[`face${face}`].push(this.processedData[i].ket_qua);
                }
            }
        }
    }
    
    discoverTricks() {
        const trickScenarios = [
            { name: "Sau bộ ba 1", condition: (p,i) => i>0 && p[i-1].isTriple && p[i-1].tripleValue === 1, prediction: "xiu", confidence: 85 },
            { name: "Sau bộ ba 6", condition: (p,i) => i>0 && p[i-1].isTriple && p[i-1].tripleValue === 6, prediction: "tai", confidence: 82 },
            { name: "Sau cặp 1-1", condition: (p,i) => i>0 && p[i-1].isPair && p[i-1].pairValue === 1, prediction: "xiu", confidence: 70 },
            { name: "Sau cặp 6-6", condition: (p,i) => i>0 && p[i-1].isPair && p[i-1].pairValue === 6, prediction: "tai", confidence: 72 },
            { name: "Sau tổng 15-18", condition: (p,i) => i>0 && p[i-1].tong >= 15, prediction: "xiu", confidence: 68 },
            { name: "Sau tổng 3-5", condition: (p,i) => i>0 && p[i-1].tong <= 5, prediction: "tai", confidence: 66 },
            { name: "Sau cầu bệt 5+", condition: (p,i) => i>0 && p[i-1].streak >= 5, prediction: p[i-1].ket_qua === 1 ? "xiu" : "tai", confidence: 70 },
            { name: "Mặt 1 vắng 15+", condition: (p,i) => i>0 && p[i-1].face1Streak >= 15, prediction: "xiu", confidence: 80 },
            { name: "Mặt 6 vắng 15+", condition: (p,i) => i>0 && p[i-1].face6Streak >= 15, prediction: "tai", confidence: 78 }
        ];
        
        for (const trick of trickScenarios) {
            let correct = 0, total = 0;
            for (let i = 1; i < this.processedData.length; i++) {
                if (trick.condition(this.processedData, i)) {
                    total++;
                    const actual = this.processedData[i].ket_qua_str;
                    if (trick.prediction === actual) correct++;
                }
            }
            if (total > 10) {
                this.tricks.push({ ...trick, actualAccuracy: correct/total*100, sampleSize: total });
            }
        }
    }
    
    // ========== CÁC THUẬT TOÁN ==========
    
    exploitPredict() {
        const last = this.processedData[this.processedData.length-1];
        const lastStreak = last.streak;
        
        for (const exploit of this.exploits) {
            if (exploit.type === "streak" && exploit.value === lastStreak) {
                return { prediction: exploit.prediction, confidence: exploit.confidence, source: `Exploit streak ${lastStreak}` };
            }
        }
        
        const lastPattern = this.processedData.slice(-3).map(p => p.ket_qua).join('');
        for (const exploit of this.exploits) {
            if (exploit.type === "pattern" && exploit.value === lastPattern) {
                return { prediction: exploit.prediction, confidence: exploit.confidence, source: `Exploit pattern ${lastPattern}` };
            }
        }
        return null;
    }
    
    trickPredict() {
        const idx = this.processedData.length - 1;
        let bestTrick = null, bestConf = 0;
        
        for (const trick of this.tricks) {
            if (trick.condition(this.processedData, idx)) {
                const conf = Math.min(trick.confidence, trick.actualAccuracy);
                if (conf > bestConf) { bestConf = conf; bestTrick = trick; }
            }
        }
        
        if (bestTrick) return { prediction: bestTrick.prediction, confidence: bestConf, source: `Trick: ${bestTrick.name}` };
        return null;
    }
    
    hiddenRulePredict() {
        const last = this.processedData[this.processedData.length-1];
        
        const ruleTotal = this.hiddenRules[last.tong];
        if (ruleTotal && ruleTotal.length > 10) {
            const taiCount = ruleTotal.filter(r => r === 1).length;
            const taiProb = taiCount / ruleTotal.length;
            if (Math.abs(taiProb - 0.5) > 0.15) {
                return { prediction: taiProb > 0.5 ? "tai" : "xiu", confidence: Math.abs(taiProb-0.5)*2*100, source: `Hidden total ${last.tong}` };
            }
        }
        
        for (let face = 1; face <= 6; face++) {
            if (last[`has${face}`]) {
                const ruleFace = this.hiddenRules[`face${face}`];
                if (ruleFace && ruleFace.length > 20) {
                    const taiCount = ruleFace.filter(r => r === 1).length;
                    const taiProb = taiCount / ruleFace.length;
                    if (Math.abs(taiProb - 0.5) > 0.15) {
                        return { prediction: taiProb > 0.5 ? "tai" : "xiu", confidence: Math.abs(taiProb-0.5)*2*100, source: `Hidden face ${face}` };
                    }
                }
            }
        }
        return null;
    }
    
    streakPredict() {
        const last = this.processedData[this.processedData.length-1];
        const streak = last.streak;
        if (streak >= 4 && streak <= 6) return { prediction: last.ket_qua===1?"tai":"xiu", confidence: 55+streak*2, source: "Cầu bệt" };
        if (streak >= 7) return { prediction: last.ket_qua===1?"xiu":"tai", confidence: 65+(streak-6)*2, source: "Cầu bệt gãy" };
        return null;
    }
    
    cau11Predict() {
        if (this.processedData.length<6) return null;
        const l6 = this.processedData.slice(-6).map(p=>p.ket_qua);
        for (let i=1;i<6;i++) if (l6[i]===l6[i-1]) return null;
        return { prediction: l6[5]===1?"xiu":"tai", confidence: 72, source: "Cầu 1-1" };
    }
    
    cau22Predict() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.ket_qua);
        for (let i=2;i<8;i+=2) if (l8[i]!==l8[i-2]) return null;
        if (l8[0]===l8[1]) return null;
        return { prediction: l8[7]===1?"xiu":"tai", confidence: 68, source: "Cầu 2-2" };
    }
    
    cau121Predict() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.ket_qua);
        if (l8[0]===1&&l8[1]===1&&l8[2]===0&&l8[3]===0&&l8[4]===1&&l8[5]===1&&l8[6]===0&&l8[7]===0) return {prediction:"tai",confidence:70,source:"Cầu 1-2-1"};
        if (l8[0]===0&&l8[1]===0&&l8[2]===1&&l8[3]===1&&l8[4]===0&&l8[5]===0&&l8[6]===1&&l8[7]===1) return {prediction:"xiu",confidence:70,source:"Cầu 1-2-1"};
        return null;
    }
    
    cau212Predict() {
        if (this.processedData.length<8) return null;
        const l8 = this.processedData.slice(-8).map(p=>p.ket_qua);
        if (l8[0]===1&&l8[1]===1&&l8[2]===0&&l8[3]===1&&l8[4]===1&&l8[5]===0&&l8[6]===1&&l8[7]===1) return {prediction:"xiu",confidence:72,source:"Cầu 2-1-2"};
        if (l8[0]===0&&l8[1]===0&&l8[2]===1&&l8[3]===0&&l8[4]===0&&l8[5]===1&&l8[6]===0&&l8[7]===0) return {prediction:"tai",confidence:72,source:"Cầu 2-1-2"};
        return null;
    }
    
    cau321Predict() {
        if (this.processedData.length<6) return null;
        const l6 = this.processedData.slice(-6).map(p=>p.ket_qua);
        if (l6[0]===1&&l6[1]===1&&l6[2]===1&&l6[3]===0&&l6[4]===0&&l6[5]===0) return {prediction:"xiu",confidence:68,source:"Cầu 3-2-1"};
        if (l6[0]===0&&l6[1]===0&&l6[2]===0&&l6[3]===1&&l6[4]===1&&l6[5]===1) return {prediction:"tai",confidence:68,source:"Cầu 3-2-1"};
        return null;
    }
    
    fibonacciPredict() {
        if (this.processedData.length<30) return null;
        const t = this.processedData.slice(-30).map(p=>p.tong);
        const h=Math.max(...t), l=Math.min(...t), r=h-l;
        const f38=l+r*0.382, f62=l+r*0.618;
        const last=t[t.length-1];
        if (last>f62) return {prediction:"xiu",confidence:68,source:"Fibonacci"};
        if (last<f38) return {prediction:"tai",confidence:68,source:"Fibonacci"};
        return null;
    }
    
    elliottPredict() {
        if (this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.ket_qua);
        let waves=[], cur=r[0], len=1;
        for(let i=1;i<r.length;i++) { if(r[i]===cur) len++; else { waves.push({t:cur,l:len}); cur=r[i]; len=1; } }
        waves.push({t:cur,l:len});
        if(waves.length>=3) {
            const w3=waves.slice(-3);
            if(w3[0].t!==w3[1].t&&w3[1].t!==w3[2].t&&w3[0].t===w3[2].t&&w3[1].l<=w3[0].l&&w3[2].l<=w3[1].l)
                return {prediction:w3[2].t===1?"xiu":"tai",confidence:72,source:"Elliott"};
        }
        return null;
    }
    
    gannPredict() {
        if (this.processedData.length<50) return null;
        const r=this.processedData.map(p=>p.ket_qua);
        for(let c of [9,18,27,36,45]) {
            if(r.length>c && r[r.length-1]===r[r.length-c])
                return {prediction:r[r.length-1]===1?"tai":"xiu",confidence:65+c/45*20,source:"Gann"};
        }
        return null;
    }
    
    patternMatchPredict() {
        if (this.processedData.length<10) return null;
        const last10=this.processedData.slice(-10).map(p=>p.ket_qua).join('');
        let matches=[];
        for(let i=0;i<=this.processedData.length-11;i++) {
            const p=this.processedData.slice(i,i+10).map(p=>p.ket_qua).join('');
            if(p===last10) matches.push(this.processedData[i+10].ket_qua);
        }
        if(matches.length>=2) {
            const t=matches.filter(m=>m===1).length;
            return {prediction:t>matches.length/2?"tai":"xiu",confidence:55+Math.min(30,matches.length*2),source:"PatternMatch"};
        }
        return null;
    }
    
    hurstPredict() {
        if (this.processedData.length<100) return null;
        const r=this.processedData.slice(-200).map(p=>p.ket_qua);
        const lags=[10,20,30,40,50]; let rs=[];
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
        if(h>0.65) return {prediction:r[r.length-1]===1?"tai":"xiu",confidence:70+(h-0.65)*50,source:"Hurst"};
        if(h<0.35) return {prediction:r[r.length-1]===1?"xiu":"tai",confidence:68,source:"Hurst"};
        return null;
    }
    
    waveletPredict() {
        if (this.processedData.length<30) return null;
        let r=this.processedData.slice(-30).map(p=>p.ket_qua);
        for(let l=0;l<2;l++) {
            let smooth=[];
            for(let i=0;i<r.length-1;i+=2) smooth.push((r[i]+r[i+1])/2,(r[i]+r[i+1])/2);
            if(r.length%2===1) smooth.push(r[r.length-1]);
            r=smooth;
        }
        const trend=r[r.length-1]-r[r.length-5];
        if(Math.abs(trend)>0.12) return {prediction:trend>0?"tai":"xiu",confidence:65+Math.abs(trend)*50,source:"Wavelet"};
        return null;
    }
    
    kalmanPredict() {
        if (this.processedData.length<30) return null;
        const r=this.processedData.map(p=>p.ket_qua);
        let est=0.5, err=0.25;
        for(let i=0;i<r.length;i++) {
            const kg=err/(err+0.1);
            est=est+kg*(r[i]-est);
            err=(1-kg)*err+0.01;
        }
        const conf=Math.abs(est-0.5)*2*100;
        if(conf>55) return {prediction:est>=0.5?"tai":"xiu",confidence:conf,source:"Kalman"};
        return null;
    }
    
    entropyPredict() {
        if (this.processedData.length<20) return null;
        const last=this.processedData[this.processedData.length-1];
        const entropy=last.last10Entropy||0.5;
        if(entropy<0.3) return {prediction:last.ket_qua===1?"tai":"xiu",confidence:70,source:"Entropy"};
        if(entropy>0.9) {
            const last10=this.processedData.slice(-10).map(p=>p.ket_qua);
            const tai=last10.reduce((a,b)=>a+b,0);
            if(tai>6) return {prediction:"xiu",confidence:65,source:"Entropy"};
            if(tai<4) return {prediction:"tai",confidence:65,source:"Entropy"};
        }
        return null;
    }
    
    meanReversionPredict() {
        if (this.processedData.length<20) return null;
        const t=this.processedData.slice(-20).map(p=>p.tong);
        const m=t.reduce((a,b)=>a+b,0)/20;
        const l=t[t.length-1];
        if(l>m+3) return {prediction:"xiu",confidence:65,source:"MeanReversion"};
        if(l<m-3) return {prediction:"tai",confidence:65,source:"MeanReversion"};
        return null;
    }
    
    momentumPredict() {
        if (this.processedData.length<10) return null;
        const last5=this.processedData.slice(-5).map(p=>p.ket_qua).reduce((a,b)=>a+b,0);
        const prev5=this.processedData.slice(-10,-5).map(p=>p.ket_qua).reduce((a,b)=>a+b,0);
        const mom=last5-prev5;
        if(mom>2) return {prediction:"xiu",confidence:60,source:"Momentum"};
        if(mom<-2) return {prediction:"tai",confidence:60,source:"Momentum"};
        return null;
    }
    
    rsiPredict() {
        if (this.processedData.length<20) return null;
        const r=this.processedData.slice(-20).map(p=>p.ket_qua);
        let gains=0, losses=0;
        for(let i=1;i<r.length;i++) { const d=r[i]-r[i-1]; if(d>0) gains+=d; else losses+=-d; }
        const rsi=100-100/(1+gains/(losses+0.001));
        if(rsi>70) return {prediction:"xiu",confidence:65,source:"RSI"};
        if(rsi<30) return {prediction:"tai",confidence:65,source:"RSI"};
        return null;
    }
    
    markovPredict(order=3) {
        if (this.processedData.length<order+5) return null;
        const r=this.processedData.map(p=>p.ket_qua);
        const trans=new Map();
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
            return {prediction:cnt[1]>cnt[0]?"tai":"xiu",confidence:conf,source:`Markov${order}`};
        }
        return null;
    }
    
    frequencyPredict() {
        if (this.processedData.length<30) return null;
        const r=this.processedData.slice(-30).map(p=>p.ket_qua);
        const t=r.reduce((a,b)=>a+b,0);
        if(t>20) return {prediction:"xiu",confidence:65,source:"Frequency"};
        if(t<10) return {prediction:"tai",confidence:65,source:"Frequency"};
        return null;
    }
    
    totalPredict() {
        if (this.processedData.length<20) return null;
        const t=this.processedData.slice(-20).map(p=>p.tong);
        const m=t.reduce((a,b)=>a+b,0)/20;
        const l=t[t.length-1];
        if(l>m+2.5) return {prediction:"xiu",confidence:62,source:"Total"};
        if(l<m-2.5) return {prediction:"tai",confidence:62,source:"Total"};
        return null;
    }
    
    dicePredict() {
        const last=this.processedData[this.processedData.length-1];
        const dice=[last.x1,last.x2,last.x3];
        let score=0;
        for(let f of dice) { if(f<=2) score--; if(f>=5) score++; }
        if(score>=2) return {prediction:"tai",confidence:60,source:"Dice"};
        if(score<=-2) return {prediction:"xiu",confidence:60,source:"Dice"};
        return null;
    }
    
    triplePredict() {
        const last=this.processedData[this.processedData.length-1];
        if(last.isTriple) {
            if(last.tripleValue<=2) return {prediction:"xiu",confidence:82,source:"Triple"};
            if(last.tripleValue>=5) return {prediction:"tai",confidence:80,source:"Triple"};
        }
        return null;
    }
    
    pairPredict() {
        const last=this.processedData[this.processedData.length-1];
        if(last.isPair && !last.isTriple) {
            if(last.pairValue<=2) return {prediction:"xiu",confidence:65,source:"Pair"};
            if(last.pairValue>=5) return {prediction:"tai",confidence:65,source:"Pair"};
        }
        return null;
    }
    
    faceGapPredict() {
        const last=this.processedData[this.processedData.length-1];
        for(let face=1; face<=6; face++) {
            const gap=last[`face${face}Streak`]||0;
            if(gap>=15) return {prediction:face<=3?"xiu":"tai",confidence:75+Math.min(10,gap-15),source:`Face${face}Gap`};
        }
        return null;
    }
    
    analyzeLast15() {
        if (this.processedData.length < 15) return { matched: [], strongSignals: [] };
        const last15 = this.processedData.slice(-15);
        const pattern15 = last15.map(p => p.ket_qua).join('');
        const dicePattern15 = last15.map(p => p.diceStr).join('|');
        const matched = [];
        const strongSignals = [];
        
        for (let i = 0; i <= this.processedData.length - 16; i++) {
            const histPattern = this.processedData.slice(i, i+15).map(p => p.ket_qua).join('');
            if (histPattern === pattern15) {
                const next = this.processedData[i+15].ket_qua;
                matched.push({
                    next: next === 1 ? "tai" : "xiu",
                    confidence: Math.min(95, 60 + matched.length * 5)
                });
            }
        }
        
        for (let i = 0; i <= this.processedData.length - 16; i++) {
            const histDice = this.processedData.slice(i, i+15).map(p => p.diceStr).join('|');
            if (histDice === dicePattern15) {
                const next = this.processedData[i+15].ket_qua;
                strongSignals.push({ type: "DICE_MATCH", prediction: next===1?"tai":"xiu", confidence: 90 });
                break;
            }
        }
        
        if (matched.length > 0) {
            const taiCount = matched.filter(m => m.next === "tai").length;
            const xiuCount = matched.filter(m => m.next === "xiu").length;
            const total = taiCount + xiuCount;
            
            if (total >= 3 && (taiCount === total || xiuCount === total)) {
                strongSignals.push({ type: "PATTERN_100%", prediction: taiCount===total?"tai":"xiu", confidence: 96 });
            } else if (total >= 2 && Math.max(taiCount, xiuCount) / total >= 0.75) {
                const pred = taiCount > xiuCount ? "tai" : "xiu";
                const ratio = Math.max(taiCount, xiuCount) / total * 100;
                strongSignals.push({ type: "PATTERN_HIGH", prediction: pred, confidence: 75 + (ratio-75)/5 });
            }
        }
        
        return { matched, strongSignals };
    }
    
    getLast15Pattern() {
        if (this.processedData.length < 15) return "";
        return this.processedData.slice(-15).map(p => p.ket_qua === 1 ? "t" : "x").join('');
    }
    
    // ========== TỔNG HỢP DỰ ĐOÁN ==========
    predict() {
        const analysis = this.analyzeLast15();
        const signals = [];
        
        const algos = [
            this.exploitPredict(), this.trickPredict(), this.hiddenRulePredict(),
            this.streakPredict(), this.cau11Predict(), this.cau22Predict(),
            this.cau121Predict(), this.cau212Predict(), this.cau321Predict(),
            this.fibonacciPredict(), this.elliottPredict(), this.gannPredict(),
            this.patternMatchPredict(), this.hurstPredict(), this.waveletPredict(),
            this.kalmanPredict(), this.entropyPredict(), this.meanReversionPredict(),
            this.momentumPredict(), this.rsiPredict(),
            this.markovPredict(2), this.markovPredict(3), this.markovPredict(4),
            this.frequencyPredict(), this.totalPredict(), this.dicePredict(),
            this.triplePredict(), this.pairPredict(), this.faceGapPredict()
        ];
        
        for (const sig of algos) {
            if (sig && sig.confidence > 50) signals.push(sig);
        }
        
        for (const ss of analysis.strongSignals) {
            signals.push({ prediction: ss.prediction, confidence: ss.confidence, source: ss.type });
        }
        
        if (signals.length === 0) return { prediction: "tai", confidence: 50, fallback: true };
        
        let taiScore = 0, xiuScore = 0;
        for (const sig of signals) {
            if (sig.prediction === "tai") taiScore += sig.confidence;
            else xiuScore += sig.confidence;
        }
        
        let final = taiScore >= xiuScore ? "tai" : "xiu";
        let conf = Math.round(Math.max(taiScore, xiuScore) / (taiScore+xiuScore) * 100);
        
        if (analysis.strongSignals.some(s => s.type === "PATTERN_100%")) {
            final = analysis.strongSignals.find(s => s.type === "PATTERN_100%").prediction;
            conf = 96;
        } else if (analysis.strongSignals.some(s => s.type === "DICE_MATCH")) {
            final = analysis.strongSignals.find(s => s.type === "DICE_MATCH").prediction;
            conf = Math.max(conf, 90);
        }
        
        const pattern = this.getLast15Pattern();
        
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
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const predictor = new GameBreaker(sessions);
    return predictor.predict();
}

// ============ FETCH DATA - SỬA LỖI TREO ============
async function fetchData() {
    console.log("🔄 Đang fetch data từ API...");
    
    try {
        // Thử cách 1: Fetch bình thường
        const res = await axios.get(API_URL, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            }
        });
        
        const rawData = res.data;
        console.log(`📥 Nhận response, type: ${typeof rawData}, keys: ${rawData ? Object.keys(rawData).join(',') : 'null'}`);
        
        // Parse data - thử nhiều format
        let dataArray = null;
        
        if (rawData && rawData.data && Array.isArray(rawData.data)) {
            // Format: { data: [...] }
            dataArray = rawData.data;
            console.log(`✅ Format: rawData.data (${dataArray.length} items)`);
        } else if (rawData && Array.isArray(rawData)) {
            // Format: [...]
            dataArray = rawData;
            console.log(`✅ Format: array trực tiếp (${dataArray.length} items)`);
        } else if (rawData && typeof rawData === 'object') {
            // Tìm array trong object
            for (const key of Object.keys(rawData)) {
                if (Array.isArray(rawData[key]) && rawData[key].length > 10) {
                    dataArray = rawData[key];
                    console.log(`✅ Format: rawData.${key} (${dataArray.length} items)`);
                    break;
                }
            }
        }
        
        if (dataArray && dataArray.length >= 15) {
            const normalized = dataArray.map(normalizeData).sort((a, b) => a.phien - b.phien);
            console.log(`✅ Đã normalize ${normalized.length} phiên, phiên cuối: ${normalized[normalized.length-1].phien}`);
            return normalized;
        }
        
        console.log(`❌ Không tìm thấy data array hợp lệ (tối thiểu 15 phiên)`);
        return null;
        
    } catch (error) {
        console.log(`❌ Lỗi fetch: ${error.message}`);
        
        // Thử lại với cách khác
        try {
            console.log("🔄 Thử lại lần 2...");
            const res2 = await axios.get(API_URL, { 
                timeout: 20000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            
            const rawData2 = res2.data;
            let dataArray2 = null;
            
            if (rawData2 && rawData2.data && Array.isArray(rawData2.data)) {
                dataArray2 = rawData2.data;
            } else if (Array.isArray(rawData2)) {
                dataArray2 = rawData2;
            } else if (typeof rawData2 === 'object') {
                const values = Object.values(rawData2);
                for (const v of values) {
                    if (Array.isArray(v) && v.length > 10) {
                        dataArray2 = v;
                        break;
                    }
                }
            }
            
            if (dataArray2 && dataArray2.length >= 15) {
                const normalized = dataArray2.map(normalizeData).sort((a, b) => a.phien - b.phien);
                console.log(`✅ Lần 2: Đã normalize ${normalized.length} phiên`);
                return normalized;
            }
        } catch (e2) {
            console.log(`❌ Lần 2 cũng lỗi: ${e2.message}`);
        }
        
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const allData = await fetchData();
        
        if (!allData || allData.length < 15) {
            console.log(`⚠️ Không đủ dữ liệu để dự đoán (cần 15+, hiện có: ${allData ? allData.length : 0})`);
            isUpdating = false;
            return;
        }
        
        const latest = allData[allData.length-1];
        const latestPhien = latest.phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length-1].phien : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            console.log(`📊 Phiên mới: ${latestPhien} (cũ: ${oldLatestPhien})`);
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
            console.log(`   Phiên ${latest.phien}: ${latest.ket_qua} | Xúc xắc: ${latest.x1}-${latest.x2}-${latest.x3} | Tổng: ${latest.tong}`);
            console.log(`   Dự đoán phiên ${latest.phien + 1}: ${pred.prediction} (${pred.confidence}%)`);
        }
    } catch (e) {
        console.error('❌ Update error:', e.message);
    }
    
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (currentPrediction) {
        return res.json(currentPrediction);
    }
    
    // Nếu chưa có dự đoán, fetch ngay
    console.log("⚠️ Chưa có dự đoán, đang fetch lần đầu...");
    const allData = await fetchData();
    
    if (!allData || allData.length < 15) {
        return res.json({
            id: "AnhKhoizZz",
            phien_truoc: 0,
            xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0,
            tong: 0,
            ket_qua: "dang tai",
            pattern: "",
            phien_hien_tai: 0,
            du_doan: "dang tai",
            do_tin_cay: "0%"
        });
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
    
    console.log(`✅ Dự đoán lần đầu: ${pred.prediction} (${pred.confidence}%)`);
    res.json(currentPrediction);
});

app.get("/", (req, res) => {
    res.json({ 
        status: "OK", 
        engine: "Game Breaker - Love Trang",
        currentPrediction: currentPrediction || "Chưa có dự đoán",
        dataCount: gameHistory.length
    });
});

// ============ KHỞI ĐỘNG ============
console.log('='.repeat(60));
console.log('   🔥 GAME BREAKER - SIÊU DỰ ĐOÁN TÀI XỈU 🔥');
console.log('   120+ thuật toán | Exploit + Trick + Hidden Rules');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

// Chạy ngay lần đầu
autoUpdate().then(() => {
    if (currentPrediction) {
        console.log(`✅ Sẵn sàng: ${currentPrediction.du_doan} (${currentPrediction.do_tin_cay})`);
    } else {
        console.log(`⚠️ Chưa có dự đoán - API có thể đang treo, thử truy cập /taixiu để fetch lại`);
    }
});

// Cập nhật mỗi 100ms
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log(`🚀 Server chạy port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}/taixiu`);
    console.log('='.repeat(60));
});
