const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500;
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let sessionsStore = { hu: [], md5: [] };
let isReady = { hu: false, md5: false };
let predictors = { hu: null, md5: null };

// ==================== GOD PREDICTOR ULTIMATE ====================

class GodPredictorUltimate {
    constructor(data) {
        this.raw = data;
        this.data = this.preprocessData(data);
        this.weights = this.initWeights();
    }

    preprocessData(data) {
        return data.map((item, idx, arr) => {
            let streak = 1;
            if (idx > 0 && arr[idx-1].Ket_qua === item.Ket_qua) {
                streak = arr[idx-1].streak + 1;
            }
            
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const sum = item.Tong;
            
            return {
                result: item.Ket_qua,
                resultNum: item.Ket_qua === "Tài" ? 1 : 0,
                total: sum,
                streak: streak,
                dice: dice,
                phien: item.Phien,
                hasDouble: new Set(dice).size <= 2 ? 1 : 0,
                hasTriple: new Set(dice).size === 1 ? 1 : 0,
                isEven: sum % 2 === 0 ? 1 : 0,
                diceSum: dice[0] + dice[1] + dice[2],
                diceProduct: dice[0] * dice[1] * dice[2],
                maxDice: Math.max(...dice),
                minDice: Math.min(...dice),
                diffMaxMin: Math.max(...dice) - Math.min(...dice),
                totalChange: idx > 0 ? sum - arr[idx-1].Tong : 0,
                sameResult: idx > 0 ? (item.Ket_qua === arr[idx-1].Ket_qua ? 1 : 0) : 0
            };
        });
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_advanced: 1.2, alternating_1_1: 1.0,
            alternating_2_2: 1.0, alternating_3_3: 1.0, pattern_2_1_2: 1.0,
            pattern_3_2_1: 1.0, pattern_1_2_3: 1.0, zigzag_long: 1.1,
            pattern_2_nhip: 0.9, pattern_3_nhip: 1.0, frequency_10: 1.0,
            triple_special: 1.5, double_face_6: 1.3, double_face_1: 1.3,
            double_face_5: 1.0, double_face_2: 1.0, increasing_sequence: 1.0,
            decreasing_sequence: 1.0, has_1_and_6: 1.0,
            rsi_signal: 1.2, bollinger_signal: 1.2, macd_signal: 1.1,
            stochastic_signal: 1.0, williams_signal: 1.0, cci_signal: 1.0,
            ma_signal: 1.0, fibonacci_signal: 1.0, atr_signal: 0.8,
            entropy_signal: 1.0, markov_3: 1.3, markov_4: 1.3,
            markov_5: 1.2, pattern_matching: 1.4, cycle_detection: 1.1,
            frequency_5: 0.8, frequency_20: 1.0, bayesian: 1.0,
            mean_reversion: 1.0, momentum: 1.0, cau_doi_xung: 1.2,
            cau_tam_giac: 1.1, cau_bac_thang: 1.0, trend_line: 1.0
        };
    }

    // ========== NHÓM 1: CẦU CƠ BẢN ==========
    
    streak_basic() {
        if (this.data.length < 3) return null;
        const last = this.data[this.data.length - 1];
        if (last.streak >= 2) {
            return { pred: last.result, conf: Math.min(85, 55 + last.streak * 4), name: 'streak_basic' };
        }
        return null;
    }

    streak_advanced() {
        if (this.data.length < 3) return null;
        const last = this.data[this.data.length - 1];
        if (last.streak >= 3) {
            const rev = last.result === "Tài" ? "Xỉu" : "Tài";
            return { pred: rev, conf: Math.max(60, 85 - last.streak * 5), name: 'streak_advanced' };
        }
        return null;
    }

    alternating_1_1() {
        if (this.data.length < 4) return null;
        const last4 = this.data.slice(-4).map(d => d.result);
        if (last4.join('') === 'TàiXỉuTàiXỉu') return { pred: 'Tài', conf: 72, name: 'alternating_1_1' };
        if (last4.join('') === 'XỉuTàiXỉuTài') return { pred: 'Xỉu', conf: 72, name: 'alternating_1_1' };
        return null;
    }

    alternating_2_2() {
        if (this.data.length < 6) return null;
        const last6 = this.data.slice(-6).map(d => d.result);
        if (last6.join('') === 'TàiTàiXỉuXỉuTàiTài') return { pred: 'Xỉu', conf: 68, name: 'alternating_2_2' };
        if (last6.join('') === 'XỉuXỉuTàiTàiXỉuXỉu') return { pred: 'Tài', conf: 68, name: 'alternating_2_2' };
        return null;
    }

    alternating_3_3() {
        if (this.data.length < 6) return null;
        const last6 = this.data.slice(-6).map(d => d.result);
        if (last6.join('') === 'TàiTàiTàiXỉuXỉuXỉu') return { pred: 'Tài', conf: 70, name: 'alternating_3_3' };
        if (last6.join('') === 'XỉuXỉuXỉuTàiTàiTài') return { pred: 'Xỉu', conf: 70, name: 'alternating_3_3' };
        return null;
    }

    pattern_2_1_2() {
        if (this.data.length < 5) return null;
        const last5 = this.data.slice(-5).map(d => d.result);
        if (last5.join('') === 'TàiTàiXỉuTàiTài') return { pred: 'Xỉu', conf: 70, name: 'pattern_2_1_2' };
        if (last5.join('') === 'XỉuXỉuTàiXỉuXỉu') return { pred: 'Tài', conf: 70, name: 'pattern_2_1_2' };
        return null;
    }

    pattern_3_2_1() {
        if (this.data.length < 6) return null;
        const last6 = this.data.slice(-6).map(d => d.result);
        if (last6.join('') === 'TàiTàiTàiXỉuXỉuXỉu') return { pred: 'Xỉu', conf: 68, name: 'pattern_3_2_1' };
        if (last6.join('') === 'XỉuXỉuXỉuTàiTàiTài') return { pred: 'Tài', conf: 68, name: 'pattern_3_2_1' };
        return null;
    }

    pattern_1_2_3() {
        if (this.data.length < 6) return null;
        const last6 = this.data.slice(-6).map(d => d.result);
        if (last6.join('') === 'TàiXỉuXỉuTàiTàiTài') return { pred: 'Xỉu', conf: 65, name: 'pattern_1_2_3' };
        if (last6.join('') === 'XỉuTàiTàiXỉuXỉuXỉu') return { pred: 'Tài', conf: 65, name: 'pattern_1_2_3' };
        return null;
    }

    zigzag_long() {
        if (this.data.length < 7) return null;
        const last7 = this.data.slice(-7).map(d => d.result);
        const isZigzag = last7.every((val, i, arr) => i === 0 || val !== arr[i-1]);
        if (isZigzag) {
            return { pred: last7[6] === 'Tài' ? 'Xỉu' : 'Tài', conf: 70, name: 'zigzag_long' };
        }
        return null;
    }

    pattern_2_nhip() {
        if (this.data.length < 4) return null;
        const last4 = this.data.slice(-4).map(d => d.result);
        if (last4.join('') === 'TàiXỉuTàiXỉu') return { pred: 'Tài', conf: 65, name: 'pattern_2_nhip' };
        if (last4.join('') === 'XỉuTàiXỉuTài') return { pred: 'Xỉu', conf: 65, name: 'pattern_2_nhip' };
        return null;
    }

    pattern_3_nhip() {
        if (this.data.length < 6) return null;
        const last6 = this.data.slice(-6).map(d => d.result);
        if (last6.join('') === 'TàiXỉuTàiXỉuTàiXỉu') return { pred: 'Xỉu', conf: 68, name: 'pattern_3_nhip' };
        if (last6.join('') === 'XỉuTàiXỉuTàiXỉuTài') return { pred: 'Tài', conf: 68, name: 'pattern_3_nhip' };
        return null;
    }

    frequency_10() {
        if (this.data.length < 10) return null;
        const last10 = this.data.slice(-10);
        const taiCount = last10.filter(d => d.result === 'Tài').length;
        if (taiCount >= 7) return { pred: 'Xỉu', conf: 65, name: 'frequency_10' };
        if (taiCount <= 3) return { pred: 'Tài', conf: 65, name: 'frequency_10' };
        return null;
    }

    // ========== NHÓM 2: CẦU XÚC XẮC ==========

    triple_special() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.hasTriple) {
            if (last.dice[0] === 1) return { pred: 'Xỉu', conf: 95, name: 'triple_special' };
            if (last.dice[0] === 6) return { pred: 'Tài', conf: 92, name: 'triple_special' };
            if (last.dice[0] >= 4) return { pred: 'Tài', conf: 75, name: 'triple_special' };
            if (last.dice[0] <= 3) return { pred: 'Xỉu', conf: 75, name: 'triple_special' };
        }
        return null;
    }

    double_face_6() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.dice.filter(d => d === 6).length >= 2) return { pred: 'Tài', conf: 78, name: 'double_face_6' };
        return null;
    }

    double_face_1() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.dice.filter(d => d === 1).length >= 2) return { pred: 'Xỉu', conf: 82, name: 'double_face_1' };
        return null;
    }

    double_face_5() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.dice.filter(d => d === 5).length >= 2) return { pred: 'Tài', conf: 68, name: 'double_face_5' };
        return null;
    }

    double_face_2() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.dice.filter(d => d === 2).length >= 2) return { pred: 'Xỉu', conf: 65, name: 'double_face_2' };
        return null;
    }

    increasing_sequence() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        const sorted = [...last.dice].sort((a, b) => a - b);
        if (sorted[0] + 1 === sorted[1] && sorted[1] + 1 === sorted[2]) {
            if (sorted[0] >= 4) return { pred: 'Tài', conf: 67, name: 'increasing_sequence' };
            if (sorted[0] <= 2) return { pred: 'Xỉu', conf: 62, name: 'increasing_sequence' };
        }
        return null;
    }

    decreasing_sequence() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.dice[0] - 1 === last.dice[1] && last.dice[1] - 1 === last.dice[2]) {
            if (last.dice[0] >= 5) return { pred: 'Tài', conf: 65, name: 'decreasing_sequence' };
            if (last.dice[0] <= 3) return { pred: 'Xỉu', conf: 60, name: 'decreasing_sequence' };
        }
        return null;
    }

    has_1_and_6() {
        if (this.data.length < 1) return null;
        const last = this.data[this.data.length - 1];
        if (last.dice.includes(1) && last.dice.includes(6)) return { pred: 'Tài', conf: 62, name: 'has_1_and_6' };
        return null;
    }

    // ========== NHÓM 3: CHỈ BÁO KỸ THUẬT ==========

    calculateRSI(period = 14) {
        if (this.data.length < period + 1) return 50;
        const results = this.data.map(d => d.resultNum);
        let gains = 0, losses = 0;
        for (let i = results.length - period; i < results.length; i++) {
            const change = results[i] - results[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    rsi_signal() {
        if (this.data.length < 20) return null;
        const rsi = this.calculateRSI();
        if (rsi > 70) return { pred: 'Xỉu', conf: 70, name: 'rsi_signal' };
        if (rsi < 30) return { pred: 'Tài', conf: 70, name: 'rsi_signal' };
        return null;
    }

    bollinger_signal() {
        if (this.data.length < 20) return null;
        const last20 = this.data.slice(-20).map(d => d.resultNum);
        const sma = last20.reduce((a, b) => a + b, 0) / 20;
        const variance = last20.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / 20;
        const std = Math.sqrt(variance);
        const upperBand = sma + 2 * std;
        const lowerBand = sma - 2 * std;
        const current = this.data[this.data.length - 1].resultNum;
        if (current > upperBand) return { pred: 'Xỉu', conf: 68, name: 'bollinger_signal' };
        if (current < lowerBand) return { pred: 'Tài', conf: 68, name: 'bollinger_signal' };
        return null;
    }

    macd_signal() {
        if (this.data.length < 30) return null;
        const results = this.data.map(d => d.resultNum);
        const ema12 = this.calculateEMA(results, 12);
        const ema26 = this.calculateEMA(results, 26);
        if (ema12.length < 2 || ema26.length < 2) return null;
        const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
        const macdPrev = ema12[ema12.length - 2] - ema26[ema26.length - 2];
        if (macdPrev < 0 && macdLine > 0) return { pred: 'Tài', conf: 65, name: 'macd_signal' };
        if (macdPrev > 0 && macdLine < 0) return { pred: 'Xỉu', conf: 65, name: 'macd_signal' };
        return null;
    }

    calculateEMA(data, period) {
        const ema = [data[0]];
        const multiplier = 2 / (period + 1);
        for (let i = 1; i < data.length; i++) {
            ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
        }
        return ema;
    }

    stochastic_signal() {
        if (this.data.length < 20) return null;
        const last14 = this.data.slice(-14).map(d => d.resultNum);
        const highest = Math.max(...last14);
        const lowest = Math.min(...last14);
        const current = last14[last14.length - 1];
        const k = ((current - lowest) / (highest - lowest)) * 100;
        if (k > 80) return { pred: 'Xỉu', conf: 65, name: 'stochastic_signal' };
        if (k < 20) return { pred: 'Tài', conf: 65, name: 'stochastic_signal' };
        return null;
    }

    williams_signal() {
        if (this.data.length < 20) return null;
        const last14 = this.data.slice(-14).map(d => d.resultNum);
        const highest = Math.max(...last14);
        const lowest = Math.min(...last14);
        const current = last14[last14.length - 1];
        const wr = ((highest - current) / (highest - lowest)) * -100;
        if (wr > -20) return { pred: 'Xỉu', conf: 65, name: 'williams_signal' };
        if (wr < -80) return { pred: 'Tài', conf: 65, name: 'williams_signal' };
        return null;
    }

    cci_signal() {
        if (this.data.length < 20) return null;
        const last20 = this.data.slice(-20).map(d => d.total);
        const tp = last20[last20.length - 1];
        const sma = last20.reduce((a, b) => a + b, 0) / 20;
        const mad = last20.reduce((a, b) => a + Math.abs(b - sma), 0) / 20;
        const cci = (tp - sma) / (0.015 * mad);
        if (cci > 100) return { pred: 'Xỉu', conf: 65, name: 'cci_signal' };
        if (cci < -100) return { pred: 'Tài', conf: 65, name: 'cci_signal' };
        return null;
    }

    ma_signal() {
        if (this.data.length < 20) return null;
        const results = this.data.map(d => d.resultNum);
        const ma5 = results.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma20 = results.slice(-20).reduce((a, b) => a + b, 0) / 20;
        if (ma5 > ma20 + 0.1) return { pred: 'Tài', conf: 60, name: 'ma_signal' };
        if (ma5 < ma20 - 0.1) return { pred: 'Xỉu', conf: 60, name: 'ma_signal' };
        return null;
    }

    fibonacci_signal() {
        if (this.data.length < 20) return null;
        const totals = this.data.slice(-20).map(d => d.total);
        const high = Math.max(...totals);
        const low = Math.min(...totals);
        const fib618 = low + 0.618 * (high - low);
        const lastTotal = this.data[this.data.length - 1].total;
        if (lastTotal > fib618) return { pred: 'Xỉu', conf: 62, name: 'fibonacci_signal' };
        return null;
    }

    atr_signal() {
        if (this.data.length < 20) return null;
        let totalChange = 0;
        for (let i = this.data.length - 19; i < this.data.length; i++) {
            totalChange += Math.abs(this.data[i].total - this.data[i - 1].total);
        }
        const atr = totalChange / 19;
        if (atr > 3) return { pred: 'Xỉu', conf: 55, name: 'atr_signal' };
        return null;
    }

    entropy_signal() {
        if (this.data.length < 10) return null;
        const last10 = this.data.slice(-10).map(d => d.resultNum);
        const taiRatio = last10.reduce((a, b) => a + b, 0) / 10;
        if (taiRatio > 0.7) return { pred: 'Xỉu', conf: 60, name: 'entropy_signal' };
        if (taiRatio < 0.3) return { pred: 'Tài', conf: 60, name: 'entropy_signal' };
        return null;
    }

    // ========== NHÓM 4: MARKOV & PATTERN ==========

    markov_3() { return this.markovGeneric(3, 'markov_3'); }
    markov_4() { return this.markovGeneric(4, 'markov_4'); }
    markov_5() { return this.markovGeneric(5, 'markov_5'); }

    markovGeneric(order, name) {
        if (this.data.length < order + 1) return null;
        const model = {};
        for (let i = 0; i < this.data.length - order; i++) {
            const state = this.data.slice(i, i + order).map(d => d.result).join(',');
            const next = this.data[i + order].result;
            if (!model[state]) model[state] = { 'Tài': 0, 'Xỉu': 0 };
            model[state][next]++;
        }
        const currentState = this.data.slice(-order).map(d => d.result).join(',');
        if (model[currentState]) {
            const counts = model[currentState];
            const total = counts['Tài'] + counts['Xỉu'];
            const pred = counts['Tài'] > counts['Xỉu'] ? 'Tài' : 'Xỉu';
            const conf = (Math.max(counts['Tài'], counts['Xỉu']) / total) * 100;
            return { pred: pred, conf: conf, name: name };
        }
        return null;
    }

    pattern_matching() {
        if (this.data.length < 50) return null;
        const last10 = this.data.slice(-10).map(d => d.result);
        let bestMatch = null;
        let bestMatchCount = 0;
        for (let i = 0; i < this.data.length - 11; i++) {
            const window = this.data.slice(i, i + 10).map(d => d.result);
            if (window.join(',') === last10.join(',')) {
                if (i + 10 < this.data.length) {
                    const nextResult = this.data[i + 10].result;
                    if (bestMatch === null) {
                        bestMatch = nextResult;
                        bestMatchCount = 1;
                    } else if (nextResult === bestMatch) {
                        bestMatchCount++;
                    }
                }
            }
        }
        if (bestMatchCount >= 2) return { pred: bestMatch, conf: 75, name: 'pattern_matching' };
        return null;
    }

    cycle_detection() {
        if (this.data.length < 30) return null;
        const seq = this.data.slice(-30).map(d => d.result);
        for (let cycle = 3; cycle <= 10; cycle++) {
            if (seq.length >= cycle * 2) {
                const lastCycle = seq.slice(-cycle).join(',');
                const prevCycle = seq.slice(-2 * cycle, -cycle).join(',');
                if (lastCycle === prevCycle) {
                    return { pred: seq[seq.length - 1] === 'Tài' ? 'Tài' : 'Xỉu', conf: 70, name: 'cycle_detection' };
                }
            }
        }
        return null;
    }

    // ========== NHÓM 5: THỐNG KÊ NÂNG CAO ==========

    frequency_5() {
        if (this.data.length < 5) return null;
        const last5 = this.data.slice(-5).map(d => d.result);
        const taiCount = last5.filter(r => r === 'Tài').length;
        if (taiCount >= 4) return { pred: 'Xỉu', conf: 60, name: 'frequency_5' };
        if (taiCount <= 1) return { pred: 'Tài', conf: 60, name: 'frequency_5' };
        return null;
    }

    frequency_20() {
        if (this.data.length < 20) return null;
        const last20 = this.data.slice(-20).map(d => d.result);
        const taiCount = last20.filter(r => r === 'Tài').length;
        if (taiCount >= 14) return { pred: 'Xỉu', conf: 65, name: 'frequency_20' };
        if (taiCount <= 6) return { pred: 'Tài', conf: 65, name: 'frequency_20' };
        return null;
    }

    bayesian() {
        if (this.data.length < 20) return null;
        const prior = this.data.slice(-20).filter(d => d.result === 'Tài').length / 20;
        const last = this.data[this.data.length - 1].result;
        let sameAfterSame = 0, totalAfterSame = 0;
        for (let i = 1; i < this.data.length; i++) {
            if (this.data[i - 1].result === last) {
                totalAfterSame++;
                if (this.data[i].result === last) sameAfterSame++;
            }
        }
        if (totalAfterSame > 0) {
            const likelihood = sameAfterSame / totalAfterSame;
            const posterior = likelihood * prior;
            if (posterior > 0.6) return { pred: 'Tài', conf: 62, name: 'bayesian' };
            if (posterior < 0.4) return { pred: 'Xỉu', conf: 62, name: 'bayesian' };
        }
        return null;
    }

    mean_reversion() {
        if (this.data.length < 20) return null;
        const totals = this.data.slice(-20).map(d => d.total);
        const mean = totals.reduce((a, b) => a + b, 0) / 20;
        const lastTotal = this.data[this.data.length - 1].total;
        if (lastTotal > mean + 2) return { pred: 'Xỉu', conf: 65, name: 'mean_reversion' };
        if (lastTotal < mean - 2) return { pred: 'Tài', conf: 65, name: 'mean_reversion' };
        return null;
    }

    momentum() {
        if (this.data.length < 10) return null;
        const recent5 = this.data.slice(-5).map(d => d.resultNum);
        const prev5 = this.data.slice(-10, -5).map(d => d.resultNum);
        const momentum = recent5.reduce((a, b) => a + b, 0) - prev5.reduce((a, b) => a + b, 0);
        if (momentum > 2) return { pred: 'Xỉu', conf: 60, name: 'momentum' };
        if (momentum < -2) return { pred: 'Tài', conf: 60, name: 'momentum' };
        return null;
    }

    // ========== NHÓM 6: CẦU ĐẶC BIỆT ==========

    cau_doi_xung() {
        if (this.data.length < 4) return null;
        const last4 = this.data.slice(-4).map(d => d.result);
        if (last4.join('') === 'TàiXỉuXỉuTài') return { pred: 'Tài', conf: 68, name: 'cau_doi_xung' };
        if (last4.join('') === 'XỉuTàiTàiXỉu') return { pred: 'Xỉu', conf: 68, name: 'cau_doi_xung' };
        return null;
    }

    cau_tam_giac() {
        if (this.data.length < 5) return null;
        const last5 = this.data.slice(-5).map(d => d.result);
        if (last5.join('') === 'TàiXỉuTàiXỉuTài') return { pred: 'Xỉu', conf: 70, name: 'cau_tam_giac' };
        if (last5.join('') === 'XỉuTàiXỉuTàiXỉu') return { pred: 'Tài', conf: 70, name: 'cau_tam_giac' };
        return null;
    }

    cau_bac_thang() {
        if (this.data.length < 6) return null;
        const last6 = this.data.slice(-6).map(d => d.result);
        if (last6.join('') === 'TàiTàiXỉuXỉuXỉu') return { pred: 'Tài', conf: 64, name: 'cau_bac_thang' };
        if (last6.join('') === 'XỉuXỉuTàiTàiTài') return { pred: 'Xỉu', conf: 64, name: 'cau_bac_thang' };
        return null;
    }

    trend_line() {
        if (this.data.length < 10) return null;
        const totals = this.data.slice(-10).map(d => d.total);
        const x = Array.from({length: 10}, (_, i) => i);
        const n = 10;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = totals.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((a, b, i) => a + b * totals[i], 0);
        const sumX2 = x.reduce((a, b) => a + b * b, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        if (slope > 0.2) return { pred: 'Tài', conf: 60, name: 'trend_line' };
        if (slope < -0.2) return { pred: 'Xỉu', conf: 60, name: 'trend_line' };
        return null;
    }

    // ========== TỔNG HỢP DỰ ĐOÁN ==========

    getAllAlgorithms() {
        return [
            this.streak_basic.bind(this), this.streak_advanced.bind(this),
            this.alternating_1_1.bind(this), this.alternating_2_2.bind(this),
            this.alternating_3_3.bind(this), this.pattern_2_1_2.bind(this),
            this.pattern_3_2_1.bind(this), this.pattern_1_2_3.bind(this),
            this.zigzag_long.bind(this), this.pattern_2_nhip.bind(this),
            this.pattern_3_nhip.bind(this), this.frequency_10.bind(this),
            this.triple_special.bind(this), this.double_face_6.bind(this),
            this.double_face_1.bind(this), this.double_face_5.bind(this),
            this.double_face_2.bind(this), this.increasing_sequence.bind(this),
            this.decreasing_sequence.bind(this), this.has_1_and_6.bind(this),
            this.rsi_signal.bind(this), this.bollinger_signal.bind(this),
            this.macd_signal.bind(this), this.stochastic_signal.bind(this),
            this.williams_signal.bind(this), this.cci_signal.bind(this),
            this.ma_signal.bind(this), this.fibonacci_signal.bind(this),
            this.atr_signal.bind(this), this.entropy_signal.bind(this),
            this.markov_3.bind(this), this.markov_4.bind(this),
            this.markov_5.bind(this), this.pattern_matching.bind(this),
            this.cycle_detection.bind(this), this.frequency_5.bind(this),
            this.frequency_20.bind(this), this.bayesian.bind(this),
            this.mean_reversion.bind(this), this.momentum.bind(this),
            this.cau_doi_xung.bind(this), this.cau_tam_giac.bind(this),
            this.cau_bac_thang.bind(this), this.trend_line.bind(this)
        ];
    }

    predict() {
        const algorithms = this.getAllAlgorithms();
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        let activeAlgorithms = 0;
        
        algorithms.forEach(algo => {
            const result = algo();
            if (result) {
                const weight = this.weights[result.name] || 1.0;
                scores[result.pred] += result.conf * weight;
                activeAlgorithms++;
            }
        });
        
        // Điều chỉnh đặc biệt cho bộ 3
        if (this.data.length >= 1) {
            const last = this.data[this.data.length - 1];
            if (last.hasTriple) {
                if (last.dice[0] === 1) scores['Xỉu'] += 50;
                else if (last.dice[0] === 6) scores['Tài'] += 50;
            }
        }
        
        // Điều chỉnh cực đoan 20 phiên
        if (this.data.length >= 20) {
            const last20 = this.data.slice(-20);
            const taiRatio = last20.filter(d => d.result === 'Tài').length / 20;
            if (taiRatio >= 0.8) scores['Xỉu'] += 30;
            else if (taiRatio <= 0.2) scores['Tài'] += 30;
        }
        
        const finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        const totalScore = scores['Tài'] + scores['Xỉu'];
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        confidence = Math.min(99, Math.max(55, confidence));
        
        return {
            prediction: finalPred,
            confidence: Math.round(confidence),
            activeAlgorithms: activeAlgorithms,
            totalAlgorithms: algorithms.length
        };
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 500);
        this.data = this.preprocessData(this.raw);
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadAllData() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: HU=${sessionsStore.hu.length}, MD5=${sessionsStore.md5.length}`);
            
            if (sessionsStore.hu.length >= 30) {
                isReady.hu = true;
                predictors.hu = new GodPredictorUltimate(sessionsStore.hu);
            }
            if (sessionsStore.md5.length >= 30) {
                isReady.md5 = true;
                predictors.md5 = new GodPredictorUltimate(sessionsStore.md5);
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
        predictors[type] = new GodPredictorUltimate(sessionsStore[type]);
        console.log(`🎉 [${type.toUpperCase()}] ĐÃ SẴN SÀNG!`);
    } else if (isReady[type] && predictors[type] && addedCount > 0) {
        predictors[type].updateWithNewData(sessionsStore[type]);
    }
    return true;
}

// ==================== VERIFY & RECORD ====================

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
            updated = true;
        }
    }
    
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    
    if (updated) saveAllData();
}

function savePredictionToHistory(type, phienTruocDo, phienHienTai, prediction, confidence, latestData) {
    const record = {
        phien_truoc_do: phienTruocDo.toString(),
        phien_hien_tai: phienHienTai.toString(),
        du_doan: prediction,
        do_tin_cay: `${confidence}%`,
        ket_qua_du_doan: '',
        ket_qua_thuc_te: '',
        da_kiem_tra: false,
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
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
                    savePredictionToHistory('hu', latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                    lastProcessedPhien.hu = nextPhien;
                    console.log(`[DỰ ĐOÁN] 👑 HU Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeAlgorithms}/${result.totalAlgorithms} thuật toán`);
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
                    savePredictionToHistory('md5', latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                    lastProcessedPhien.md5 = nextPhien;
                    console.log(`[DỰ ĐOÁN] 👑 MD5 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeAlgorithms}/${result.totalAlgorithms} thuật toán`);
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
    console.log('👑 GOD PREDICTOR ULTIMATE - HỆ THỐNG DỰ ĐOÁN TÀI XỈU');
    console.log(`📋 Lưu tối đa ${MAX_HISTORY} phiên`);
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
    res.json({
        hu: { sessions: sessionsStore.hu.length, ready: isReady.hu },
        md5: { sessions: sessionsStore.md5.length, ready: isReady.md5 }
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
        
        const record = savePredictionToHistory('hu', latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
        
        res.json({
            phien_truoc_do: record.phien_truoc_do,
            phien_hien_tai: record.phien_hien_tai,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
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
        
        const record = savePredictionToHistory('md5', latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
        
        res.json({
            phien_truoc_do: record.phien_truoc_do,
            phien_hien_tai: record.phien_hien_tai,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
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
        tong_so: predictionHistory.hu.length
    });
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        lich_su_du_doan: predictionHistory.md5,
        tong_so: predictionHistory.md5.length
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 GOD PREDICTOR ULTIMATE - HỆ THỐNG DỰ ĐOÁN TÀI XỈU');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC NHÓM THUẬT TOÁN (45+ thuật toán):');
    console.log('   • Nhóm 1: Cầu cơ bản (12 thuật toán)');
    console.log('   • Nhóm 2: Cầu xúc xắc (8 thuật toán)');
    console.log('   • Nhóm 3: Chỉ báo kỹ thuật (10 thuật toán)');
    console.log('   • Nhóm 4: Markov & Pattern (5 thuật toán)');
    console.log('   • Nhóm 5: Thống kê nâng cao (5 thuật toán)');
    console.log('   • Nhóm 6: Cầu đặc biệt (4 thuật toán)');
    console.log('');
    console.log('📊 CẬP NHẬT:');
    console.log('   • Đã xóa phần thắng thua');
    console.log('   • Phiên hiện tại → phiên trước đó');
    console.log('   • Phiên dự đoán → phiên hiện tại');
    console.log('   • Response gọn gàng, không signals');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
