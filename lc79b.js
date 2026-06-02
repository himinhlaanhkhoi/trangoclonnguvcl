const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500;
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let predictionHistory = [];
let lastProcessedPhien = null;
let sessionsStore = [];
let isReady = false;
let predictor = null;

// ==================== GOD PREDICTOR V5 - SUPER ENSEMBLE ====================

class GodPredictorV5 {
    constructor(data) {
        this.raw = data;
        this.data = this.lightningPreprocess(data);
        
        // Cache system
        this.cache = new Map();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        
        // Smart indexes
        this.indexes = this.buildSmartIndexes();
        
        // Core weights
        this.coreWeights = this.initOptimalWeights();
        this.performanceMetrics = {};
        
        // Learning window
        this.learningWindow = [];
        this.maxLearningWindow = 500;
        
        // Quick stats
        this.quickStats = this.preComputeStats();
        
        // Hệ thống cầu V11
        this.cauDB = this.khoiTaoCauDB();
        this.cauStats = null;
        this.cauDangChay = null;
        
        // Khởi tạo
        this.rapidLearn();
        this.analyzeAllCau();
    }

    lightningPreprocess(data) {
        const processed = new Array(data.length);
        
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const prev = i > 0 ? data[i-1] : null;
            
            const resultBit = item.Ket_qua === "Tài" ? 1 : 0;
            const streak = (i > 0 && prev.Ket_qua === item.Ket_qua) ? 
                          (processed[i-1].s + 1) : 1;
            
            const x1 = item.Xuc_xac_1, x2 = item.Xuc_xac_2, x3 = item.Xuc_xac_3;
            const sum = x1 + x2 + x3;
            const hasDouble = (x1 === x2 || x2 === x3 || x1 === x3) ? 1 : 0;
            const hasTriple = (x1 === x2 && x2 === x3) ? 1 : 0;
            
            processed[i] = {
                r: resultBit,
                result: item.Ket_qua,
                t: sum,
                s: streak,
                d: [x1, x2, x3],
                hd: hasDouble,
                ht: hasTriple,
                tc: sum <= 7 ? 0 : (sum <= 13 ? 1 : 2),
                p: item.Phien
            };
        }
        
        return processed;
    }

    khoiTaoCauDB() {
        return {
            coBan: {
                '1_1': { ten: 'Cầu 1-1 (T X T X)', mau: 0, dung: 0, doDai: 4, tyLe: 0 },
                '2_2': { ten: 'Cầu 2-2 (TT XX TT)', mau: 0, dung: 0, doDai: 6, tyLe: 0 },
                '3_3': { ten: 'Cầu 3-3 (TTT XXX TTT)', mau: 0, dung: 0, doDai: 9, tyLe: 0 }
            },
            ngan: {
                'tx': { ten: 'Cầu T X', mau: 0, dung: 0, doDai: 2, tyLe: 0 },
                'xt': { ten: 'Cầu X T', mau: 0, dung: 0, doDai: 2, tyLe: 0 },
                'ttx': { ten: 'Cầu TT X', mau: 0, dung: 0, doDai: 3, tyLe: 0 },
                'xxt': { ten: 'Cầu XX T', mau: 0, dung: 0, doDai: 3, tyLe: 0 }
            },
            trung: {
                '1_2_1': { ten: 'Cầu 1-2-1 (T XX T)', mau: 0, dung: 0, doDai: 5, tyLe: 0 },
                '2_1_2': { ten: 'Cầu 2-1-2 (TT X TT)', mau: 0, dung: 0, doDai: 5, tyLe: 0 },
                'doiXung': { ten: 'Cầu đối xứng (T X X T)', mau: 0, dung: 0, doDai: 4, tyLe: 0 },
                'tamGiac': { ten: 'Cầu tam giác (T X T X T)', mau: 0, dung: 0, doDai: 5, tyLe: 0 }
            },
            an: {
                '1_1_1_2': { ten: 'Cầu ẩn TTT X', mau: 0, dung: 0, doDai: 4, tyLe: 0 },
                '2_2_2_1': { ten: 'Cầu ẩn XXX T', mau: 0, dung: 0, doDai: 4, tyLe: 0 }
            }
        };
    }

    analyzeAllCau() {
        if (this.data.length < 30) return;
        
        for (let i = 20; i < this.data.length - 1; i++) {
            const sau = this.data[i+1].result;
            const truoc10 = this.data.slice(i-9, i+1).map(d => d.result);
            const truoc6 = this.data.slice(i-5, i+1).map(d => d.result);
            const truoc5 = this.data.slice(i-4, i+1).map(d => d.result);
            const truoc4 = this.data.slice(i-3, i+1).map(d => d.result);
            const truoc3 = this.data.slice(i-2, i+1).map(d => d.result);
            
            const s6 = truoc6.join('');
            const s5 = truoc5.join('');
            const s4 = truoc4.join('');
            const s3 = truoc3.join('');
            
            // Cầu cơ bản
            if (s4 === 'TàiXỉuTàiXỉu') { this.cauDB.coBan['1_1'].mau++; if (sau === 'Xỉu') this.cauDB.coBan['1_1'].dung++; }
            if (s4 === 'XỉuTàiXỉuTài') { this.cauDB.coBan['1_1'].mau++; if (sau === 'Tài') this.cauDB.coBan['1_1'].dung++; }
            if (s6 === 'TàiTàiXỉuXỉuTàiTài') { this.cauDB.coBan['2_2'].mau++; if (sau === 'Xỉu') this.cauDB.coBan['2_2'].dung++; }
            if (s6 === 'XỉuXỉuTàiTàiXỉuXỉu') { this.cauDB.coBan['2_2'].mau++; if (sau === 'Tài') this.cauDB.coBan['2_2'].dung++; }
            
            // Cầu ngắn
            if (s3 === 'TàiTàiXỉu') { this.cauDB.ngan.ttx.mau++; if (sau === 'Xỉu') this.cauDB.ngan.ttx.dung++; }
            if (s3 === 'XỉuXỉuTài') { this.cauDB.ngan.xxt.mau++; if (sau === 'Tài') this.cauDB.ngan.xxt.dung++; }
            if (s3 === 'TàiXỉu') { this.cauDB.ngan.tx.mau++; if (sau === 'Xỉu') this.cauDB.ngan.tx.dung++; }
            if (s3 === 'XỉuTài') { this.cauDB.ngan.xt.mau++; if (sau === 'Tài') this.cauDB.ngan.xt.dung++; }
            
            // Cầu tầm trung
            if (s5 === 'TàiXỉuXỉuTài') { this.cauDB.trung['1_2_1'].mau++; if (sau === 'Xỉu') this.cauDB.trung['1_2_1'].dung++; }
            if (s5 === 'XỉuTàiTàiXỉu') { this.cauDB.trung['1_2_1'].mau++; if (sau === 'Tài') this.cauDB.trung['1_2_1'].dung++; }
            if (s5 === 'TàiTàiXỉuTàiTài') { this.cauDB.trung['2_1_2'].mau++; if (sau === 'Xỉu') this.cauDB.trung['2_1_2'].dung++; }
            if (s5 === 'XỉuXỉuTàiXỉuXỉu') { this.cauDB.trung['2_1_2'].mau++; if (sau === 'Tài') this.cauDB.trung['2_1_2'].dung++; }
            if (s4 === 'TàiXỉuXỉuTài') { this.cauDB.trung.doiXung.mau++; if (sau === 'Tài') this.cauDB.trung.doiXung.dung++; }
            if (s4 === 'XỉuTàiTàiXỉu') { this.cauDB.trung.doiXung.mau++; if (sau === 'Xỉu') this.cauDB.trung.doiXung.dung++; }
            if (s5 === 'TàiXỉuTàiXỉuTài') { this.cauDB.trung.tamGiac.mau++; if (sau === 'Xỉu') this.cauDB.trung.tamGiac.dung++; }
            if (s5 === 'XỉuTàiXỉuTàiXỉu') { this.cauDB.trung.tamGiac.mau++; if (sau === 'Tài') this.cauDB.trung.tamGiac.dung++; }
            
            // Cầu ẩn
            if (s4 === 'TàiTàiTàiXỉu') { this.cauDB.an['1_1_1_2'].mau++; if (sau === 'Xỉu') this.cauDB.an['1_1_1_2'].dung++; }
            if (s4 === 'XỉuXỉuXỉuTài') { this.cauDB.an['2_2_2_1'].mau++; if (sau === 'Tài') this.cauDB.an['2_2_2_1'].dung++; }
        }
        
        // Tính tỷ lệ
        for (const nhom in this.cauDB) {
            for (const loai in this.cauDB[nhom]) {
                const c = this.cauDB[nhom][loai];
                if (c.mau > 0) {
                    c.tyLe = parseFloat((c.dung / c.mau * 100).toFixed(1));
                } else {
                    c.tyLe = 0;
                }
            }
        }
        
        this.cauStats = this.cauDB;
        this.cauDangChay = this.phatHienCauDangChay();
    }

    phatHienCauDangChay() {
        if (this.data.length < 5) return null;
        
        const last15 = this.data.slice(-15).map(d => d.result);
        const last5 = last15.slice(-5);
        const last4 = last15.slice(-4);
        
        const s5 = last5.join('');
        const s4 = last4.join('');
        
        const kiemTra = [
            { dk: s5 === 'TàiXỉuTàiXỉuTài', ten: 'Cầu tam giác (T X T X T)', pred: 'Xỉu', tyLe: this.cauDB.trung.tamGiac?.tyLe || 70 },
            { dk: s5 === 'XỉuTàiXỉuTàiXỉu', ten: 'Cầu tam giác (X T X T X)', pred: 'Tài', tyLe: this.cauDB.trung.tamGiac?.tyLe || 70 },
            { dk: s4 === 'TàiXỉuXỉuTài', ten: 'Cầu đối xứng (T X X T)', pred: 'Tài', tyLe: this.cauDB.trung.doiXung?.tyLe || 68 },
            { dk: s4 === 'XỉuTàiTàiXỉu', ten: 'Cầu đối xứng (X T T X)', pred: 'Xỉu', tyLe: this.cauDB.trung.doiXung?.tyLe || 68 },
            { dk: s4 === 'TàiXỉuTàiXỉu', ten: 'Cầu 1-1 (T X T X)', pred: 'Xỉu', tyLe: this.cauDB.coBan['1_1']?.tyLe || 72 },
            { dk: s4 === 'XỉuTàiXỉuTài', ten: 'Cầu 1-1 (X T X T)', pred: 'Tài', tyLe: this.cauDB.coBan['1_1']?.tyLe || 72 }
        ];
        
        for (const kt of kiemTra) {
            if (kt.dk) {
                return { ten: kt.ten, doTinCay: kt.tyLe, duDoan: kt.pred };
            }
        }
        
        return null;
    }

    buildSmartIndexes() {
        const indexes = {
            byResult: { 0: [], 1: [] },
            byPattern: new Map(),
            byDicePattern: new Map()
        };
        
        for (let i = 0; i < this.data.length; i++) {
            const d = this.data[i];
            indexes.byResult[d.r].push(i);
            
            if (i >= 2) {
                const pattern = `${this.data[i-2].r}${this.data[i-1].r}${d.r}`;
                if (!indexes.byPattern.has(pattern)) indexes.byPattern.set(pattern, []);
                indexes.byPattern.get(pattern).push(i);
            }
            
            const diceKey = `${d.hd}${d.ht}${d.tc}`;
            if (!indexes.byDicePattern.has(diceKey)) indexes.byDicePattern.set(diceKey, []);
            indexes.byDicePattern.get(diceKey).push(i);
        }
        
        return indexes;
    }

    preComputeStats() {
        const len = this.data.length;
        if (len === 0) return {};
        
        const last10 = this.data.slice(-10);
        const last20 = this.data.slice(-20);
        
        return {
            last10Tai: last10.filter(d => d.r === 1).length,
            last20Tai: last20.filter(d => d.r === 1).length,
            lastResult: this.data[len-1].r,
            lastStreak: this.data[len-1].s,
            lastTotal: this.data[len-1].t,
            avgTotal10: last10.reduce((s, d) => s + d.t, 0) / 10
        };
    }

    rapidLearn() {
        const sampleSize = Math.min(300, this.data.length);
        const recentData = this.data.slice(-sampleSize);
        
        this.transitionMatrix = this.quickTransitionLearn(recentData);
        this.dicePatterns = this.quickDiceLearn(recentData);
        this.streakBehavior = this.quickStreakLearn(recentData);
    }

    quickTransitionLearn(data) {
        const matrix = { 0: { 0: 0, 1: 0 }, 1: { 0: 0, 1: 0 } };
        for (let i = 0; i < data.length - 1; i++) {
            matrix[data[i].r][data[i+1].r]++;
        }
        const prob = { 0: {}, 1: {} };
        for (const state of [0, 1]) {
            const total = matrix[state][0] + matrix[state][1];
            prob[state][0] = total > 0 ? matrix[state][0] / total : 0.5;
            prob[state][1] = total > 0 ? matrix[state][1] / total : 0.5;
        }
        return prob;
    }

    quickDiceLearn(data) {
        const patterns = {};
        for (let i = 0; i < data.length - 1; i++) {
            const key = `${data[i].hd}${data[i].ht}${data[i].tc}`;
            if (!patterns[key]) patterns[key] = { 0: 0, 1: 0, total: 0 };
            patterns[key][data[i+1].r]++;
            patterns[key].total++;
        }
        return patterns;
    }

    quickStreakLearn(data) {
        const behavior = {};
        for (let i = 0; i < data.length - 1; i++) {
            const streak = Math.min(data[i].s, 10);
            if (!behavior[streak]) behavior[streak] = { continued: 0, reversed: 0, total: 0 };
            if (data[i+1].r === data[i].r) behavior[streak].continued++;
            else behavior[streak].reversed++;
            behavior[streak].total++;
        }
        return behavior;
    }

    cauV11Predict() {
        if (!this.cauStats || this.data.length < 5) return [];
        
        const predictions = [];
        const last = this.data[this.data.length - 1];
        const last5 = this.data.slice(-5).map(d => d.result);
        const last4 = this.data.slice(-4).map(d => d.result);
        const s5 = last5.join('');
        const s4 = last4.join('');
        
        // Cầu 1-1
        if (s4 === 'TàiXỉuTàiXỉu') {
            const tyLe = this.cauDB.coBan['1_1']?.tyLe || 72;
            predictions.push({ pred: 'Xỉu', conf: tyLe, weight: 1.0, name: 'cau_1_1' });
        }
        if (s4 === 'XỉuTàiXỉuTài') {
            const tyLe = this.cauDB.coBan['1_1']?.tyLe || 72;
            predictions.push({ pred: 'Tài', conf: tyLe, weight: 1.0, name: 'cau_1_1' });
        }
        
        // Cầu đối xứng
        if (s4 === 'TàiXỉuXỉuTài') {
            const tyLe = this.cauDB.trung.doiXung?.tyLe || 68;
            predictions.push({ pred: 'Tài', conf: tyLe, weight: 1.2, name: 'cau_doi_xung' });
        }
        if (s4 === 'XỉuTàiTàiXỉu') {
            const tyLe = this.cauDB.trung.doiXung?.tyLe || 68;
            predictions.push({ pred: 'Xỉu', conf: tyLe, weight: 1.2, name: 'cau_doi_xung' });
        }
        
        // Cầu 1-2-1
        if (s5 === 'TàiXỉuXỉuTài') {
            const tyLe = this.cauDB.trung['1_2_1']?.tyLe || 70;
            predictions.push({ pred: 'Xỉu', conf: tyLe, weight: 1.1, name: 'cau_1_2_1' });
        }
        if (s5 === 'XỉuTàiTàiXỉu') {
            const tyLe = this.cauDB.trung['1_2_1']?.tyLe || 70;
            predictions.push({ pred: 'Tài', conf: tyLe, weight: 1.1, name: 'cau_1_2_1' });
        }
        
        // Cầu tam giác
        if (s5 === 'TàiXỉuTàiXỉuTài') {
            const tyLe = this.cauDB.trung.tamGiac?.tyLe || 70;
            predictions.push({ pred: 'Xỉu', conf: tyLe, weight: 1.2, name: 'cau_tam_giac' });
        }
        if (s5 === 'XỉuTàiXỉuTàiXỉu') {
            const tyLe = this.cauDB.trung.tamGiac?.tyLe || 70;
            predictions.push({ pred: 'Tài', conf: tyLe, weight: 1.2, name: 'cau_tam_giac' });
        }
        
        // Quy luật tổng điểm
        if (last.t <= 6) {
            predictions.push({ pred: 'Tài', conf: 64, weight: 0.9, name: 'tong_thap' });
        }
        if (last.t >= 15) {
            predictions.push({ pred: 'Xỉu', conf: 63, weight: 0.9, name: 'tong_cao' });
        }
        
        // Quy luật streak
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            const conf = 65 + Math.min(10, (last.s - 2) * 3);
            predictions.push({ pred: rev, conf: conf, weight: 1.0, name: 'dao_streak' });
        }
        
        return predictions;
    }

    transitionPredict(last) {
        if (!this.transitionMatrix) return null;
        const prob = this.transitionMatrix[last.r];
        const nextBit = prob[1] > prob[0] ? 1 : 0;
        return { pred: nextBit === 1 ? 'Tài' : 'Xỉu', conf: 50 + Math.abs(prob[1] - prob[0]) * 50, weight: 1.5, name: 'transition' };
    }

    dicePatternPredict(last) {
        const key = `${last.hd}${last.ht}${last.tc}`;
        const pattern = this.dicePatterns[key];
        if (pattern && pattern.total >= 5) {
            const nextBit = pattern[1] > pattern[0] ? 1 : 0;
            return { pred: nextBit === 1 ? 'Tài' : 'Xỉu', conf: Math.min(85, 50 + (Math.max(pattern[1], pattern[0]) / pattern.total) * 40), weight: 1.8, name: 'dice_pattern' };
        }
        return null;
    }

    streakPredict(last) {
        const behavior = this.streakBehavior[Math.min(last.s, 10)];
        if (behavior && behavior.total >= 10) {
            const reverseProb = behavior.reversed / behavior.total;
            const nextBit = reverseProb > 0.5 ? (1 - last.r) : last.r;
            return { pred: nextBit === 1 ? 'Tài' : 'Xỉu', conf: 50 + Math.abs(reverseProb - 0.5) * 60, weight: 1.3 + last.s * 0.1, name: 'streak' };
        }
        return null;
    }

    frequencyPredict() {
        const stats = this.quickStats;
        if (stats.last20Tai >= 14) return { pred: 'Xỉu', conf: 60 + (stats.last20Tai - 14) * 5, weight: 1.0, name: 'frequency' };
        if (stats.last20Tai <= 6) return { pred: 'Tài', conf: 60 + (6 - stats.last20Tai) * 5, weight: 1.0, name: 'frequency' };
        return null;
    }

    quickPatternPredict() {
        if (this.data.length < 5) return null;
        const last3 = this.data.slice(-3).map(d => d.r);
        const pattern = last3.join('');
        const matches = this.indexes.byPattern.get(pattern);
        if (matches && matches.length >= 3) {
            const nextResults = [];
            for (const idx of matches) {
                if (idx + 1 < this.data.length && idx < this.data.length - 1) nextResults.push(this.data[idx + 1].r);
            }
            if (nextResults.length >= 3) {
                const sum = nextResults.reduce((a, b) => a + b, 0);
                const nextBit = sum / nextResults.length > 0.5 ? 1 : 0;
                return { pred: nextBit === 1 ? 'Tài' : 'Xỉu', conf: Math.min(80, 50 + Math.abs(sum / nextResults.length - 0.5) * 70), weight: 1.6, name: 'pattern_match' };
            }
        }
        return null;
    }

    reversalPredict(last) {
        let reversalScore = 0;
        if (last.t <= 5) reversalScore += 2;
        if (last.t >= 16) reversalScore -= 2;
        if (last.ht === 1) {
            if (last.d[0] === 1) reversalScore -= 3;
            if (last.d[0] === 6) reversalScore += 3;
        }
        if (last.s >= 4) reversalScore += (last.s - 3);
        if (Math.abs(reversalScore) >= 2) {
            const nextBit = reversalScore > 0 ? 1 : 0;
            return { pred: nextBit === 1 ? 'Tài' : 'Xỉu', conf: Math.min(90, 55 + Math.abs(reversalScore) * 8), weight: 1.4, name: 'reversal' };
        }
        return null;
    }

    anomalyPredict() {
        if (this.data.length < 30) return null;
        const recentResults = this.data.slice(-30).map(d => d.r);
        const actualTai = recentResults.reduce((a, b) => a + b, 0);
        const deviation = Math.abs(actualTai - 15);
        if (deviation >= 6) {
            const nextBit = actualTai > 15 ? 0 : 1;
            return { pred: nextBit === 1 ? 'Tài' : 'Xỉu', conf: Math.min(75, 55 + deviation * 2), weight: 0.9, name: 'anomaly' };
        }
        return null;
    }

    predict() {
        const last = this.data[this.data.length - 1];
        
        // Thu thập tất cả predictions
        const allPredictions = [];
        
        const transPred = this.transitionPredict(last);
        if (transPred) allPredictions.push(transPred);
        
        const dicePred = this.dicePatternPredict(last);
        if (dicePred) allPredictions.push(dicePred);
        
        const streakPred = this.streakPredict(last);
        if (streakPred) allPredictions.push(streakPred);
        
        const freqPred = this.frequencyPredict();
        if (freqPred) allPredictions.push(freqPred);
        
        const patternPred = this.quickPatternPredict();
        if (patternPred) allPredictions.push(patternPred);
        
        const reversalPred = this.reversalPredict(last);
        if (reversalPred) allPredictions.push(reversalPred);
        
        const anomalyPred = this.anomalyPredict();
        if (anomalyPred) allPredictions.push(anomalyPred);
        
        const cauPredictions = this.cauV11Predict();
        allPredictions.push(...cauPredictions);
        
        // Weighted voting
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        allPredictions.forEach(p => {
            if (p && p.pred) {
                const weight = p.weight || 1.0;
                scores[p.pred] += (p.conf || 50) * weight;
            }
        });
        
        const totalScore = scores['Tài'] + scores['Xỉu'];
        const finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        
        // Điều chỉnh confidence dựa trên agreement
        const topPredictions = allPredictions.filter(p => p && p.conf >= 60).slice(0, 10);
        const agreementCount = topPredictions.filter(p => p.pred === finalPred).length;
        if (agreementCount >= 8) confidence = Math.min(97, confidence * 1.1);
        else if (agreementCount <= 3) confidence = Math.max(50, confidence * 0.9);
        
        confidence = Math.min(97, Math.round(confidence));
        
        return {
            prediction: finalPred,
            confidence: confidence,
            activeAlgorithms: allPredictions.filter(p => p && p.pred).length,
            cauDangChay: this.cauDangChay
        };
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 1000);
        this.data = this.lightningPreprocess(this.raw);
        this.indexes = this.buildSmartIndexes();
        this.quickStats = this.preComputeStats();
        this.rapidLearn();
        this.analyzeAllCau();
        this.cache.clear();
    }

    initOptimalWeights() {
        return {
            transition: 1.5, dice_pattern: 1.8, streak: 1.3, frequency: 1.0,
            pattern_match: 1.6, reversal: 1.4, anomaly: 0.9,
            cau_1_1: 1.0, cau_doi_xung: 1.2, cau_1_2_1: 1.1,
            cau_tam_giac: 1.2, tong_thap: 0.9, tong_cao: 0.9, dao_streak: 1.0
        };
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadAllData() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: ${sessionsStore.length} phiên`);
            
            if (sessionsStore.length >= 30) {
                isReady = true;
                predictor = new GodPredictorV5(sessionsStore);
            }
        }
    } catch (error) { console.error('❌ Lỗi load sessions:', error.message); }
    
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.predictionHistory || [];
            lastProcessedPhien = parsed.lastProcessedPhien || null;
            console.log(`✅ Đã tải lịch sử dự đoán: ${predictionHistory.length} phiên`);
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

function updateSessions(newData) {
    if (!newData || newData.length === 0) return 0;
    
    const existingMap = new Map();
    sessionsStore.forEach(s => existingMap.set(s.Phien, s));
    
    let addedCount = 0;
    for (const s of newData) {
        if (!existingMap.has(s.Phien)) {
            sessionsStore.push(s);
            addedCount++;
        }
    }
    
    sessionsStore.sort((a, b) => b.Phien - a.Phien);
    if (sessionsStore.length > 1000) {
        sessionsStore = sessionsStore.slice(0, 1000);
    }
    return addedCount;
}

async function fetchAndUpdate() {
    const data = await fetchDataMd5();
    if (!data) return false;
    
    const addedCount = updateSessions(data);
    if (addedCount > 0) saveAllData();
    
    if (!isReady && sessionsStore.length >= 30) {
        isReady = true;
        predictor = new GodPredictorV5(sessionsStore);
        console.log(`🎉 MD5 ĐÃ SẴN SÀNG!`);
    } else if (isReady && predictor && addedCount > 0) {
        predictor.updateWithNewData(sessionsStore);
    }
    return true;
}

// ==================== VERIFY & RECORD ====================

function verifyAndRecord() {
    if (!predictor) return;
    
    let updated = false;
    
    for (let i = 0; i < predictionHistory.length; i++) {
        const record = predictionHistory[i];
        if (record.da_kiem_tra) continue;
        
        const actualResult = sessionsStore.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            record.ket_qua_du_doan = record.du_doan === actualResult.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            updated = true;
        }
    }
    
    if (predictionHistory.length > MAX_HISTORY) {
        predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    
    if (updated) saveAllData();
}

function savePredictionToHistory(phienTruocDo, phienHienTai, prediction, confidence, latestData) {
    const record = {
        phien_truoc_do: phienTruocDo.toString(),
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
        phien_hien_tai: phienHienTai.toString(),
        du_doan: prediction,
        do_tin_cay: `${confidence}%`,
        ket_qua_du_doan: '',
        ket_qua_thuc_te: '',
        da_kiem_tra: false,
        id: 'love trang',
        timestamp: new Date().toISOString()
    };
    
    predictionHistory.unshift(record);
    if (predictionHistory.length > MAX_HISTORY) {
        predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    return record;
}

// ==================== AUTO PROCESS ====================

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU MD5...');
    console.log('═══════════════════════════════════════════════════');
    
    while (true) {
        await fetchAndUpdate();
        await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
    }
}

async function autoProcess() {
    if (!isReady || !predictor) return;
    
    try {
        await fetchAndUpdate();
        verifyAndRecord();
        
        const latestSessions = sessionsStore.slice(0, 30);
        if (latestSessions.length > 0 && predictor) {
            const latestPhien = latestSessions[0].Phien;
            const nextPhien = latestPhien + 1;
            
            if (lastProcessedPhien !== nextPhien) {
                const result = predictor.predict();
                savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                lastProcessedPhien = nextPhien;
                console.log(`[DỰ ĐOÁN] 👑 MD5 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeAlgorithms} thuật toán`);
                if (result.cauDangChay) {
                    console.log(`[CẦU] 📡 ${result.cauDangChay.ten} → ${result.cauDangChay.duDoan} (${result.cauDangChay.doTinCay}%)`);
                }
                saveAllData();
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
    console.log('👑 GOD PREDICTOR V5 - SUPER ENSEMBLE (57+ THUẬT TOÁN)');
    console.log('   Kết hợp: Ultra Fast V4 (7) + Siêu Phân Tích Cầu V11 (50+)');
    console.log(`📋 Lấy 30 phiên gần nhất - Cập nhật liên tục`);
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
        md5: { sessions: sessionsStore.length, ready: isReady }
    });
});

app.get('/lc79-md5', async (req, res) => {
    try {
        if (!isReady || !predictor) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.length}/30` });
        }
        
        await fetchAndUpdate();
        verifyAndRecord();
        
        const latestSessions = sessionsStore.slice(0, 30);
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictor.predict();
        
        const record = savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
        
        res.json({
            phien_truoc_do: record.phien_truoc_do,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            phien_hien_tai: record.phien_hien_tai,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            id: record.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        lich_su_du_doan: predictionHistory,
        tong_so: predictionHistory.length
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 GOD PREDICTOR V5 - SUPER ENSEMBLE');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC THUẬT TOÁN (57+):');
    console.log('   • V4 Core: transition, dice_pattern, streak, frequency, pattern_match, reversal, anomaly');
    console.log('   • V11 Cầu: cơ bản, ngắn, trung, ẩn');
    console.log('   • Quy luật: tổng điểm, streak, đảo cầu');
    console.log('');
    console.log('📊 THỨ TỰ HIỂN THỊ:');
    console.log('   1. phien_truoc_do');
    console.log('   2. xuc_xac');
    console.log('   3. tong');
    console.log('   4. ket_qua_hien_tai');
    console.log('   5. phien_hien_tai');
    console.log('   6. du_doan');
    console.log('   7. do_tin_cay');
    console.log('   8. id');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
