const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài' || s.ket_qua === 'Tài' || s.ket_qua === 'tài') ? 1 : 0); }
function getScores(h) { return h.map(s => s.Tong || s.tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || s.xuc_xac_1 || 0, s.Xuc_xac_2 || s.xuc_xac_2 || 0, s.Xuc_xac_3 || s.xuc_xac_3 || 0]); }
function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

// ============ ENHANCED DATA WITH FEATURES ============
function addFeatures(data) {
    const results = data.map(d => d.result);
    const totals = data.map(d => d.total);
    const dices = data.map(d => d.dice);
    
    for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const dice = dices[i];
        
        // Basic features
        d.uniqueCount = new Set(dice).size;
        d.hasPair = d.uniqueCount <= 2 ? 1 : 0;
        d.hasTriple = d.uniqueCount === 1 ? 1 : 0;
        d.highCount = dice.filter(x => x >= 4).length;
        d.lowCount = dice.filter(x => x <= 3).length;
        d.evenCount = dice.filter(x => x % 2 === 0).length;
        d.maxDice = Math.max(...dice);
        d.minDice = Math.min(...dice);
        d.diceRange = d.maxDice - d.minDice;
        d.diceSum = dice.reduce((a,b) => a+b, 0);
        d.totalEven = d.total % 2 === 0 ? 1 : 0;
        
        // Trend features
        if (i > 0) {
            d.scoreDiff = d.total - data[i-1].total;
            d.dice1Diff = dice[0] - dices[i-1][0];
            d.dice2Diff = dice[1] - dices[i-1][1];
            d.dice3Diff = dice[2] - dices[i-1][2];
            d.sameResult = d.result === data[i-1].result ? 1 : 0;
        } else {
            d.scoreDiff = 0;
            d.dice1Diff = d.dice2Diff = d.dice3Diff = 0;
            d.sameResult = 0;
        }
    }
    
    // Technical Indicators
    if (data.length >= 20) {
        const period = 14;
        
        // RSI
        let gains = 0, losses = 0;
        for (let i = data.length - period; i < data.length; i++) {
            const diff = data[i].result - data[i-1].result;
            if (diff > 0) gains += diff;
            else losses -= Math.abs(diff);
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        data[data.length-1].rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        
        // Bollinger
        const recentResults = results.slice(-20);
        const sma = recentResults.reduce((a,b) => a+b, 0) / 20;
        const std = Math.sqrt(recentResults.reduce((a,b) => a + Math.pow(b-sma, 2), 0) / 20);
        data[data.length-1].bbUpper = sma + 2 * std;
        data[data.length-1].bbLower = sma - 2 * std;
        
        // MACD
        const ema12 = recentResults.slice(-12).reduce((a,b) => a+b, 0) / 12;
        const ema26 = recentResults.reduce((a,b) => a+b, 0) / 20;
        data[data.length-1].macd = ema12 - ema26;
        
        // Stochastic
        const low14 = Math.min(...recentResults.slice(-14));
        const high14 = Math.max(...recentResults.slice(-14));
        data[data.length-1].stochK = high14 !== low14 ? 100 * (results[results.length-1] - low14) / (high14 - low14) : 50;
        
        // Williams %R
        data[data.length-1].williamsR = high14 !== low14 ? -100 * (high14 - results[results.length-1]) / (high14 - low14) : -50;
    }
    
    return data;
}

// ======================================================
// GOD PREDICTOR ALGORITHMS - 44 THUẬT TOÁN
// ======================================================

class GodPredictorAlgorithms {
    constructor(history) {
        this.h = history;
        this.n = history.length;
        this.r = history.map(d => d.result);
        this.sc = history.map(d => d.total);
        this.d = history.map(d => d.dice);
    }

    // ============ NHÓM 1: CẦU KẾT QUẢ (12) ============
    
    streak_basic() {
        if (this.n < 3) return null;
        let last = this.r[this.n - 1];
        let streak = 1;
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === last) streak++;
            else break;
        }
        if (streak >= 2) {
            const conf = Math.min(85, 55 + streak * 4);
            return { pred: last === 1 ? 'T' : 'X', conf, reason: `Streak ${streak} -> Tiep` };
        }
        return null;
    }

    streak_advanced() {
        if (this.n < 3) return null;
        let last = this.r[this.n - 1];
        let streak = 1;
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === last) streak++;
            else break;
        }
        if (streak >= 3) {
            const conf = Math.max(60, 85 - streak * 5);
            return { pred: last === 1 ? 'T' : 'X', conf, reason: `Streak ${streak} -> Be` };
        }
        return null;
    }

    alternating_1_1() {
        if (this.n < 4) return null;
        const last4 = this.r.slice(-4);
        if (last4.join(',') === '1,0,1,0') return { pred: 'T', conf: 72, reason: 'Cau 1-1 TXTX -> Tai' };
        if (last4.join(',') === '0,1,0,1') return { pred: 'X', conf: 72, reason: 'Cau 1-1 XTXT -> Xiu' };
        return null;
    }

    alternating_2_2() {
        if (this.n < 4) return null;
        const last4 = this.r.slice(-4);
        if (last4.join(',') === '1,1,0,0') return { pred: 'T', conf: 68, reason: 'Cau 2-2 TTXX -> Tai' };
        if (last4.join(',') === '0,0,1,1') return { pred: 'X', conf: 68, reason: 'Cau 2-2 XXTT -> Xiu' };
        return null;
    }

    alternating_3_3() {
        if (this.n < 6) return null;
        const last6 = this.r.slice(-6);
        if (last6.join(',') === '1,1,1,0,0,0') return { pred: 'T', conf: 70, reason: 'Cau 3-3 TTTXXX -> Tai' };
        if (last6.join(',') === '0,0,0,1,1,1') return { pred: 'X', conf: 70, reason: 'Cau 3-3 XXXTTT -> Xiu' };
        return null;
    }

    pattern_2_1_2() {
        if (this.n < 5) return null;
        const last5 = this.r.slice(-5);
        if (last5.join(',') === '1,1,0,1,1') return { pred: 'X', conf: 70, reason: '2-1-2 TTXTT -> Xiu' };
        if (last5.join(',') === '0,0,1,0,0') return { pred: 'T', conf: 70, reason: '2-1-2 XXTXX -> Tai' };
        return null;
    }

    pattern_3_2_1() {
        if (this.n < 6) return null;
        const last6 = this.r.slice(-6);
        if (last6.join(',') === '1,1,1,0,0,0') return { pred: 'X', conf: 68, reason: '3-2-1 TTTXXX -> Xiu' };
        if (last6.join(',') === '0,0,0,1,1,1') return { pred: 'T', conf: 68, reason: '3-2-1 XXXTTT -> Tai' };
        return null;
    }

    pattern_1_2_3() {
        if (this.n < 6) return null;
        const last6 = this.r.slice(-6);
        if (last6.join(',') === '1,0,0,1,1,1') return { pred: 'X', conf: 65, reason: '1-2-3 TXXTTT -> Xiu' };
        if (last6.join(',') === '0,1,1,0,0,0') return { pred: 'T', conf: 65, reason: '1-2-3 XTTXXX -> Tai' };
        return null;
    }

    zigzag_long() {
        if (this.n < 7) return null;
        const last7 = this.r.slice(-7);
        let isZigzag = true;
        for (let i = 0; i < 6; i++) { if (last7[i] === last7[i+1]) { isZigzag = false; break; } }
        if (isZigzag) return { pred: last7[6] === 0 ? 'T' : 'X', conf: 70, reason: 'Zigzag 7 -> Tiep dao' };
        return null;
    }

    pattern_2_nhip() {
        if (this.n < 4) return null;
        const last4 = this.r.slice(-4);
        if (last4.join(',') === '1,0,1,0') return { pred: 'T', conf: 65, reason: '2 nhip TX -> Tai' };
        if (last4.join(',') === '0,1,0,1') return { pred: 'X', conf: 65, reason: '2 nhip XT -> Xiu' };
        return null;
    }

    pattern_3_nhip() {
        if (this.n < 6) return null;
        const last6 = this.r.slice(-6);
        if (last6.join(',') === '1,0,1,0,1,0') return { pred: 'X', conf: 68, reason: '3 nhip TXTX -> Xiu' };
        if (last6.join(',') === '0,1,0,1,0,1') return { pred: 'T', conf: 68, reason: '3 nhip XTXT -> Tai' };
        return null;
    }

    frequency_10_hands() {
        if (this.n < 10) return null;
        const recent = this.r.slice(-10);
        const taiCount = recent.filter(r => r === 1).length;
        if (taiCount >= 7) return { pred: 'X', conf: 65, reason: `${taiCount}/10 Tai -> Xiu` };
        if (taiCount <= 3) return { pred: 'T', conf: 65, reason: `${10-taiCount}/10 Xiu -> Tai` };
        return null;
    }

    // ============ NHÓM 2: CẦU XÚC XẮC (8) ============
    
    triple_special() {
        const last = this.h[this.n - 1];
        if (last.hasTriple) {
            if (last.dice[0] === 1) return { pred: 'X', conf: 95, reason: 'Bo 3 so 1 -> Xiu (95%)' };
            if (last.dice[0] === 6) return { pred: 'T', conf: 92, reason: 'Bo 3 so 6 -> Tai (92%)' };
        }
        return null;
    }

    double_face_6() {
        const dice = this.d[this.n - 1];
        if (dice.filter(d => d === 6).length >= 2) return { pred: 'T', conf: 78, reason: '2 mat 6 -> Tai (78%)' };
        return null;
    }

    double_face_1() {
        const dice = this.d[this.n - 1];
        if (dice.filter(d => d === 1).length >= 2) return { pred: 'X', conf: 82, reason: '2 mat 1 -> Xiu (82%)' };
        return null;
    }

    double_face_5() {
        const dice = this.d[this.n - 1];
        if (dice.filter(d => d === 5).length >= 2) return { pred: 'T', conf: 68, reason: '2 mat 5 -> Tai (68%)' };
        return null;
    }

    double_face_2() {
        const dice = this.d[this.n - 1];
        if (dice.filter(d => d === 2).length >= 2) return { pred: 'X', conf: 65, reason: '2 mat 2 -> Xiu (65%)' };
        return null;
    }

    increasing_sequence() {
        const dice = [...this.d[this.n - 1]].sort((a,b) => a-b);
        if (dice[0]+1 === dice[1] && dice[1]+1 === dice[2]) {
            if (dice[0] >= 4) return { pred: 'T', conf: 67, reason: 'Day tang tu 4+ -> Tai' };
            if (dice[2] <= 3) return { pred: 'X', conf: 62, reason: 'Day tang tu 1-3 -> Xiu' };
        }
        return null;
    }

    decreasing_sequence() {
        const dice = this.d[this.n - 1];
        if (dice[0]-1 === dice[1] && dice[1]-1 === dice[2]) {
            if (dice[0] >= 5) return { pred: 'T', conf: 65, reason: 'Day giam tu 5+ -> Tai' };
            if (dice[0] <= 3) return { pred: 'X', conf: 60, reason: 'Day giam tu 1-3 -> Xiu' };
        }
        return null;
    }

    has_1_and_6() {
        const dice = this.d[this.n - 1];
        if (dice.includes(1) && dice.includes(6)) return { pred: 'T', conf: 62, reason: 'Co ca 1 va 6 -> Tai' };
        return null;
    }

    // ============ NHÓM 3: CHỈ BÁO KỸ THUẬT (10) ============
    
    rsi_signal() {
        if (this.n < 20) return null;
        const rsi = this.h[this.n-1].rsi || 50;
        if (rsi > 70) return { pred: 'X', conf: 70, reason: `RSI=${rsi.toFixed(0)} >70 -> Xiu` };
        if (rsi < 30) return { pred: 'T', conf: 70, reason: `RSI=${rsi.toFixed(0)} <30 -> Tai` };
        return null;
    }

    bollinger_signal() {
        if (this.n < 20) return null;
        const h = this.h[this.n-1];
        if (h.bbUpper && h.bbLower) {
            if (h.result > h.bbUpper) return { pred: 'X', conf: 68, reason: 'Bollinger: vuot dai tren -> Xiu' };
            if (h.result < h.bbLower) return { pred: 'T', conf: 68, reason: 'Bollinger: duoi dai duoi -> Tai' };
        }
        return null;
    }

    macd_signal() {
        if (this.n < 30) return null;
        const macd = this.h[this.n-1].macd || 0;
        const prevMacd = this.n >= 2 ? (this.h[this.n-2].macd || 0) : 0;
        if (prevMacd < 0 && macd > 0) return { pred: 'T', conf: 65, reason: 'MACD cat len -> Tai' };
        if (prevMacd > 0 && macd < 0) return { pred: 'X', conf: 65, reason: 'MACD cat xuong -> Xiu' };
        return null;
    }

    stochastic_signal() {
        if (this.n < 20) return null;
        const k = this.h[this.n-1].stochK || 50;
        if (k > 80) return { pred: 'X', conf: 65, reason: `Stoch K=${k.toFixed(0)} >80 -> Xiu` };
        if (k < 20) return { pred: 'T', conf: 65, reason: `Stoch K=${k.toFixed(0)} <20 -> Tai` };
        return null;
    }

    williams_signal() {
        if (this.n < 20) return null;
        const wr = this.h[this.n-1].williamsR || -50;
        if (wr > -20) return { pred: 'X', conf: 65, reason: `Williams %R=${wr.toFixed(0)} >-20 -> Xiu` };
        if (wr < -80) return { pred: 'T', conf: 65, reason: `Williams %R=${wr.toFixed(0)} <-80 -> Tai` };
        return null;
    }

    cci_signal() {
        if (this.n < 20) return null;
        const cci = this.h[this.n-1].cci || 0;
        if (cci > 100) return { pred: 'X', conf: 65, reason: `CCI=${cci.toFixed(0)} >100 -> Xiu` };
        if (cci < -100) return { pred: 'T', conf: 65, reason: `CCI=${cci.toFixed(0)} <-100 -> Tai` };
        return null;
    }

    moving_average_signal() {
        if (this.n < 20) return null;
        const results = this.r.slice(-20);
        const ma5 = results.slice(-5).reduce((a,b)=>a+b,0)/5;
        const ma20 = results.reduce((a,b)=>a+b,0)/20;
        if (ma5 > ma20 + 0.1) return { pred: 'T', conf: 60, reason: 'MA5 > MA20 -> Tai' };
        if (ma5 < ma20 - 0.1) return { pred: 'X', conf: 60, reason: 'MA5 < MA20 -> Xiu' };
        return null;
    }

    fibonacci_signal() {
        if (this.n < 20) return null;
        const totals = this.sc.slice(-20);
        const high = Math.max(...totals);
        const low = Math.min(...totals);
        const fib382 = low + 0.382 * (high - low);
        const fib618 = low + 0.618 * (high - low);
        const lastTotal = this.sc[this.n-1];
        if (lastTotal > fib618) return { pred: 'X', conf: 62, reason: 'Fibonacci: tren 61.8% -> Xiu' };
        if (lastTotal < fib382) return { pred: 'T', conf: 62, reason: 'Fibonacci: duoi 38.2% -> Tai' };
        return null;
    }

    atr_signal() {
        if (this.n < 20) return null;
        const totals = this.sc.slice(-20);
        let atr = 0;
        for (let i = 1; i < totals.length; i++) atr += Math.abs(totals[i] - totals[i-1]);
        atr /= (totals.length - 1);
        if (atr > 3) return { pred: 'X', conf: 55, reason: 'ATR cao -> can trong' };
        return null;
    }

    entropy_signal() {
        if (this.n < 10) return null;
        const recent = this.r.slice(-10);
        const pTai = recent.filter(r => r === 1).length / 10;
        if (pTai > 0.7) return { pred: 'X', conf: 60, reason: `Entropy: ${(pTai*100).toFixed(0)}% Tai -> Xiu` };
        if (pTai < 0.3) return { pred: 'T', conf: 60, reason: `Entropy: ${((1-pTai)*100).toFixed(0)}% Xiu -> Tai` };
        return null;
    }

    // ============ NHÓM 4: HỌC MÁY (5) ============
    
    markov_3() { return this.markovGeneric(3); }
    markov_4() { return this.markovGeneric(4); }
    markov_5() { return this.markovGeneric(5); }

    markovGeneric(order) {
        if (this.n < order + 1) return null;
        const seq = this.r;
        const trans = {};
        for (let i = 0; i <= seq.length - order - 1; i++) {
            const state = seq.slice(i, i + order).join(',');
            const next = seq[i + order];
            if (!trans[state]) trans[state] = { T: 0, X: 0 };
            trans[state][next === 1 ? 'T' : 'X']++;
        }
        const current = seq.slice(-order).join(',');
        if (trans[current]) {
            const t = trans[current];
            const total = t.T + t.X;
            const best = t.T > t.X ? 'T' : 'X';
            const conf = Math.round((Math.max(t.T, t.X) / total) * 100);
            return { pred: best, conf, reason: `Markov bac ${order}: ${best} (${conf}%)` };
        }
        return null;
    }

    knn_signal() {
        if (this.n < 50) return null;
        const X = [], y = [];
        for (let i = 10; i < this.n - 1; i++) {
            X.push([
                this.sc[i], this.r[i], this.d[i][0], this.d[i][1], this.d[i][2],
                this.h[i].rsi || 50, this.h[i].stochK || 50, this.h[i].williamsR || -50
            ]);
            y.push(this.r[i+1]);
        }
        if (X.length < 10) return null;
        
        // Simple KNN: find 7 nearest neighbors
        const lastX = [this.sc[this.n-1], this.r[this.n-1], this.d[this.n-1][0], this.d[this.n-1][1], this.d[this.n-1][2], this.h[this.n-1].rsi || 50, this.h[this.n-1].stochK || 50, this.h[this.n-1].williamsR || -50];
        
        const distances = X.map((x, i) => ({ dist: Math.sqrt(x.reduce((a,b,j) => a + Math.pow(b - lastX[j], 2), 0)), next: y[i] }));
        distances.sort((a,b) => a.dist - b.dist);
        const neighbors = distances.slice(0, 7);
        const taiCount = neighbors.filter(n => n.next === 1).length;
        const pred = taiCount >= 4 ? 'T' : 'X';
        const conf = Math.round((Math.max(taiCount, 7-taiCount) / 7) * 100);
        return { pred, conf, reason: `KNN: ${pred} (${conf}%)` };
    }

    random_forest_signal() {
        if (this.n < 50) return null;
        // Simplified Random Forest: majority vote of multiple decision stumps
        let votes = { T: 0, X: 0 };
        
        // Feature 1: Last total
        if (this.sc[this.n-1] >= 11) votes.T += 1; else votes.X += 1;
        // Feature 2: RSI
        if ((this.h[this.n-1].rsi || 50) > 50) votes.T += 1; else votes.X += 1;
        // Feature 3: Streak
        let streak = 1;
        for (let i = this.n-2; i >= 0 && this.r[i] === this.r[this.n-1]; i--) streak++;
        if (streak >= 3) votes[this.r[this.n-1] === 1 ? 'X' : 'T'] += 1;
        else votes[this.r[this.n-1] === 1 ? 'T' : 'X'] += 1;
        // Feature 4: Dice
        const dice = this.d[this.n-1];
        if (dice.filter(d => d >= 4).length >= 2) votes.T += 1; else votes.X += 1;
        // Feature 5: Has pair
        if (this.h[this.n-1].hasPair) votes[this.h[this.n-1].dice[0] >= 4 ? 'T' : 'X'] += 1;
        else votes[this.r[this.n-1] === 1 ? 'X' : 'T'] += 1;
        
        const pred = votes.T > votes.X ? 'T' : 'X';
        const conf = Math.round((Math.max(votes.T, votes.X) / 5) * 100);
        return { pred, conf, reason: `Random Forest: ${pred} (${conf}%)` };
    }

    // ============ NHÓM 5: THỐNG KÊ & XÁC SUẤT (5) ============
    
    frequency_5() {
        if (this.n < 5) return null;
        const recent = this.r.slice(-5);
        const taiCount = recent.filter(r => r === 1).length;
        if (taiCount >= 4) return { pred: 'X', conf: 60, reason: `${taiCount}/5 Tai -> Xiu` };
        if (taiCount <= 1) return { pred: 'T', conf: 60, reason: `${5-taiCount}/5 Xiu -> Tai` };
        return null;
    }

    frequency_20() {
        if (this.n < 20) return null;
        const recent = this.r.slice(-20);
        const taiCount = recent.filter(r => r === 1).length;
        if (taiCount >= 14) return { pred: 'X', conf: 65, reason: `${taiCount}/20 Tai -> Xiu` };
        if (taiCount <= 6) return { pred: 'T', conf: 65, reason: `${20-taiCount}/20 Xiu -> Tai` };
        return null;
    }

    bayesian() {
        if (this.n < 20) return null;
        const prior = this.r.filter(r => r === 1).length / this.n;
        const last = this.r[this.n-1];
        let taiAfterLast = 0, count = 0;
        for (let i = 1; i < this.n; i++) {
            if (this.r[i-1] === last) { count++; if (this.r[i] === last) taiAfterLast++; }
        }
        if (count > 0) {
            const likelihood = taiAfterLast / count;
            const posterior = likelihood * prior;
            if (posterior > 0.6) return { pred: 'T', conf: 62, reason: `Bayesian: posterior=${posterior.toFixed(2)} -> Tai` };
            if (posterior < 0.4) return { pred: 'X', conf: 62, reason: `Bayesian: posterior=${posterior.toFixed(2)} -> Xiu` };
        }
        return null;
    }

    cycle_detection() {
        if (this.n < 30) return null;
        const seq = this.r.slice(-30);
        for (let cycle = 3; cycle <= 10; cycle++) {
            if (seq.length >= cycle * 2) {
                if (seq.slice(-cycle).join(',') === seq.slice(-2*cycle, -cycle).join(',')) {
                    return { pred: seq[seq.length-1] === 1 ? 'T' : 'X', conf: 70, reason: `Chu ky ${cycle} phat hien` };
                }
            }
        }
        return null;
    }

    mean_reversion() {
        if (this.n < 20) return null;
        const meanTotal = this.sc.slice(-20).reduce((a,b)=>a+b,0)/20;
        const lastTotal = this.sc[this.n-1];
        if (lastTotal > meanTotal + 2) return { pred: 'X', conf: 65, reason: `Hoi quy TB: ${lastTotal} > ${meanTotal.toFixed(1)} -> Xiu` };
        if (lastTotal < meanTotal - 2) return { pred: 'T', conf: 65, reason: `Hoi quy TB: ${lastTotal} < ${meanTotal.toFixed(1)} -> Tai` };
        return null;
    }

    // ============ NHÓM 6: ĐẶC BIỆT (4) ============
    
    pattern_matching() {
        if (this.n < 50) return null;
        const last10 = this.r.slice(-10);
        let bestMatch = null, bestCount = 0;
        for (let i = 0; i < this.n - 11; i++) {
            const window = this.r.slice(i, i + 10);
            if (window.join(',') === last10.join(',')) {
                if (i + 10 < this.n) {
                    const next = this.r[i + 10];
                    if (bestMatch === null) { bestMatch = next; bestCount = 1; }
                    else if (next === bestMatch) bestCount++;
                }
            }
        }
        if (bestCount >= 2) return { pred: bestMatch === 1 ? 'T' : 'X', conf: 75, reason: `Pattern match: ${bestCount} matches` };
        return null;
    }

    trend_line() {
        if (this.n < 10) return null;
        const totals = this.sc.slice(-10);
        const x = Array.from({length: 10}, (_, i) => i);
        const sumX = 45, sumY = totals.reduce((a,b)=>a+b,0);
        const sumXY = x.reduce((s, xi, i) => s + xi * totals[i], 0);
        const sumX2 = x.reduce((s, xi) => s + xi*xi, 0);
        const slope = (10 * sumXY - sumX * sumY) / (10 * sumX2 - sumX * sumX);
        if (slope > 0.2) return { pred: 'T', conf: 60, reason: `Trend line: slope=${slope.toFixed(2)} > 0 -> Tai` };
        if (slope < -0.2) return { pred: 'X', conf: 60, reason: `Trend line: slope=${slope.toFixed(2)} < 0 -> Xiu` };
        return null;
    }

    momentum() {
        if (this.n < 10) return null;
        const recent5 = this.r.slice(-5).filter(r => r === 1).length;
        const prev5 = this.r.slice(-10, -5).filter(r => r === 1).length;
        const mom = recent5 - prev5;
        if (mom > 2) return { pred: 'X', conf: 60, reason: `Momentum +${mom} -> Xiu` };
        if (mom < -2) return { pred: 'T', conf: 60, reason: `Momentum ${mom} -> Tai` };
        return null;
    }

    pattern_3_2_special() {
        if (this.n < 5) return null;
        const last5 = this.r.slice(-5);
        if (last5.join(',') === '1,1,1,0,0') return { pred: 'X', conf: 73, reason: '3-2 TTTXX -> Xiu' };
        if (last5.join(',') === '0,0,0,1,1') return { pred: 'T', conf: 73, reason: '3-2 XXXTT -> Tai' };
        return null;
    }
}

// ======================================================
// GOD PREDICTOR SYSTEM
// ======================================================

class GodPredictor {
    constructor(sessions) {
        this.rawData = sessions.map(s => ({
            result: getResults([s])[0],
            total: getTong(s),
            dice: [getX1(s), getX2(s), getX3(s)],
            phien: getPhien(s)
        }));
        this.fullData = addFeatures(this.rawData);
        this.algo = new GodPredictorAlgorithms(this.fullData);
        this.weights = {
            streak_basic: 1.0, streak_advanced: 1.2, alternating_1_1: 1.0,
            alternating_2_2: 1.0, alternating_3_3: 1.0, pattern_2_1_2: 1.0,
            pattern_3_2_1: 1.0, pattern_1_2_3: 1.0, zigzag_long: 1.1,
            pattern_2_nhip: 0.9, pattern_3_nhip: 1.0, frequency_10_hands: 1.0,
            triple_special: 1.5, double_face_6: 1.3, double_face_1: 1.3,
            double_face_5: 1.0, double_face_2: 1.0, increasing_sequence: 1.0,
            decreasing_sequence: 1.0, has_1_and_6: 1.0,
            rsi_signal: 1.2, bollinger_signal: 1.2, macd_signal: 1.1,
            stochastic_signal: 1.0, williams_signal: 1.0, cci_signal: 1.0,
            moving_average_signal: 1.0, fibonacci_signal: 1.0, atr_signal: 0.8,
            entropy_signal: 1.0,
            markov_3: 1.3, markov_4: 1.3, markov_5: 1.2,
            knn_signal: 1.5, random_forest_signal: 1.8,
            frequency_5: 0.8, frequency_20: 1.0, bayesian: 1.0,
            cycle_detection: 1.1, mean_reversion: 1.0,
            pattern_matching: 1.4, trend_line: 1.0, momentum: 1.0,
            pattern_3_2_special: 1.2
        };
    }

    predict() {
        const algosList = [
            ['streak_basic', this.algo.streak_basic.bind(this.algo)],
            ['streak_advanced', this.algo.streak_advanced.bind(this.algo)],
            ['alternating_1_1', this.algo.alternating_1_1.bind(this.algo)],
            ['alternating_2_2', this.algo.alternating_2_2.bind(this.algo)],
            ['alternating_3_3', this.algo.alternating_3_3.bind(this.algo)],
            ['pattern_2_1_2', this.algo.pattern_2_1_2.bind(this.algo)],
            ['pattern_3_2_1', this.algo.pattern_3_2_1.bind(this.algo)],
            ['pattern_1_2_3', this.algo.pattern_1_2_3.bind(this.algo)],
            ['zigzag_long', this.algo.zigzag_long.bind(this.algo)],
            ['pattern_2_nhip', this.algo.pattern_2_nhip.bind(this.algo)],
            ['pattern_3_nhip', this.algo.pattern_3_nhip.bind(this.algo)],
            ['frequency_10_hands', this.algo.frequency_10_hands.bind(this.algo)],
            ['triple_special', this.algo.triple_special.bind(this.algo)],
            ['double_face_6', this.algo.double_face_6.bind(this.algo)],
            ['double_face_1', this.algo.double_face_1.bind(this.algo)],
            ['double_face_5', this.algo.double_face_5.bind(this.algo)],
            ['double_face_2', this.algo.double_face_2.bind(this.algo)],
            ['increasing_sequence', this.algo.increasing_sequence.bind(this.algo)],
            ['decreasing_sequence', this.algo.decreasing_sequence.bind(this.algo)],
            ['has_1_and_6', this.algo.has_1_and_6.bind(this.algo)],
            ['rsi_signal', this.algo.rsi_signal.bind(this.algo)],
            ['bollinger_signal', this.algo.bollinger_signal.bind(this.algo)],
            ['macd_signal', this.algo.macd_signal.bind(this.algo)],
            ['stochastic_signal', this.algo.stochastic_signal.bind(this.algo)],
            ['williams_signal', this.algo.williams_signal.bind(this.algo)],
            ['cci_signal', this.algo.cci_signal.bind(this.algo)],
            ['moving_average_signal', this.algo.moving_average_signal.bind(this.algo)],
            ['fibonacci_signal', this.algo.fibonacci_signal.bind(this.algo)],
            ['atr_signal', this.algo.atr_signal.bind(this.algo)],
            ['entropy_signal', this.algo.entropy_signal.bind(this.algo)],
            ['markov_3', this.algo.markov_3.bind(this.algo)],
            ['markov_4', this.algo.markov_4.bind(this.algo)],
            ['markov_5', this.algo.markov_5.bind(this.algo)],
            ['knn_signal', this.algo.knn_signal.bind(this.algo)],
            ['random_forest_signal', this.algo.random_forest_signal.bind(this.algo)],
            ['frequency_5', this.algo.frequency_5.bind(this.algo)],
            ['frequency_20', this.algo.frequency_20.bind(this.algo)],
            ['bayesian', this.algo.bayesian.bind(this.algo)],
            ['cycle_detection', this.algo.cycle_detection.bind(this.algo)],
            ['mean_reversion', this.algo.mean_reversion.bind(this.algo)],
            ['pattern_matching', this.algo.pattern_matching.bind(this.algo)],
            ['trend_line', this.algo.trend_line.bind(this.algo)],
            ['momentum', this.algo.momentum.bind(this.algo)],
            ['pattern_3_2_special', this.algo.pattern_3_2_special.bind(this.algo)],
        ];

        let scores = { T: 0, X: 0 };
        let activeCount = 0;

        for (const [name, func] of algosList) {
            const result = func();
            if (result && result.pred) {
                const weight = this.weights[name] || 1.0;
                const score = result.conf * weight;
                if (result.pred === 'T') scores.T += score;
                else scores.X += score;
                activeCount++;
            }
        }

        // Điều chỉnh cuối
        if (this.fullData.length >= 10) {
            const last10 = this.fullData.slice(-10).map(d => d.result);
            const taiRatio = last10.filter(r => r === 1).length / 10;
            if (taiRatio >= 0.8) scores.X += 50;
            else if (taiRatio <= 0.2) scores.T += 50;
        }

        const final = scores.T >= scores.X ? 'T' : 'X';
        const totalScore = scores.T + scores.X;
        const confidence = totalScore > 0 ? Math.round((Math.max(scores.T, scores.X) / totalScore) * 100) : 55;

        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            confidence: Math.max(60, Math.min(99, confidence)),
            activeAlgorithms: activeCount
        };
    }
}

function superPredict(sessions) { return new GodPredictor(sessions).predict(); }

async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));
        const count = Math.min(50, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);
        return latest;
    } catch (e) { return null; }
}

async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }
        const latestPhien = getPhien(sessions[sessions.length - 1]);
        if (latestPhien !== (gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0) || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({ phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(), ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua', confidence: currentPrediction.confidence });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: latestPhien + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
        }
    } catch(e) {}
    isUpdating = false;
}

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
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: getPhien(latest) + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
        phien_hien_tai: { Phien: getPhien(latest) + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: []
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { totalPredictions: verifiedResults.length, winRate: verifiedResults.length > 0 ? ((verifiedResults.filter(v=>v.danh_gia==='thang').length/verifiedResults.length)*100).toFixed(1)+"%" : "0%" }
        });
    }
    res.json({ status: "OK" });
});

try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`GOD PREDICTOR Server | Port: ${PORT} | API: ${API_URL}`));
