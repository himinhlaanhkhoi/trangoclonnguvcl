const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';
const THANGTHUA_FILE = 'bang_thang_thua.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500; // Lưu tối đa 500 phiên thắng thua
const MAX_SESSIONS = 15; // Chỉ lấy 15 phiên gần nhất để dự đoán
const FETCH_PER_REQUEST = 15;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let bangThangThua = [];
let predictionHistory = [];
let lastProcessedPhien = null;
let sessionsStore = [];
let isReady = false;
let predictor = null;

// ==================== GOD PREDICTOR V7 ====================

class GodPredictorV7 {
    constructor(data) {
        this.raw = data;
        this.data = this.preprocessData(data);
        
        // Cache
        this.cacheL1 = new Map();
        this.cacheHitRate = 0;
        this.cacheTotal = 0;
        
        // Hệ thống học
        this.patternDB = {};
        this.patternWeights = {};
        this.learnedPatterns = 0;
        
        // Hệ thống trọng số
        this.algoWeights = this.initAlgoWeights();
        
        // V14 Integration
        this.cauDB = this.initCauDB_V14();
        this.cauDangChay = null;
        
        // Thống kê
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.consecutiveErrors = 0;
        
        // Khởi tạo
        this.initialize();
    }

    preprocessData(data) {
        const processed = [];
        
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const prev = i > 0 ? processed[i-1] : null;
            
            const resultBit = item.Ket_qua === "Tài" ? 1 : 0;
            const streak = (i > 0 && data[i-1].Ket_qua === item.Ket_qua) ? prev.s + 1 : 1;
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const sum = dice[0] + dice[1] + dice[2];
            const hasDouble = (dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]) ? 1 : 0;
            const hasTriple = (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0;
            const diceRange = Math.max(...dice) - Math.min(...dice);
            const totalCategory = sum <= 7 ? 0 : (sum <= 13 ? 1 : 2);
            
            let last5Tai = 0, last10Tai = 0;
            if (i >= 4) {
                const last5 = data.slice(i-4, i+1);
                last5Tai = last5.filter(d => d.Ket_qua === "Tài").length;
            }
            if (i >= 9) {
                const last10 = data.slice(i-9, i+1);
                last10Tai = last10.filter(d => d.Ket_qua === "Tài").length;
            }
            
            processed.push({
                result: item.Ket_qua,
                r: resultBit,
                t: sum,
                s: streak,
                d: dice,
                hd: hasDouble,
                ht: hasTriple,
                dr: diceRange,
                tc: totalCategory,
                l5t: last5Tai,
                l10t: last10Tai,
                p: item.Phien
            });
        }
        
        return processed;
    }

    initCauDB_V14() {
        return {
            coBan: {
                '1_1': { ten: 'Cầu 1-1 (T X T X)', mau: 0, dung: 0, p: 0, w: 1.0 },
                '2_2': { ten: 'Cầu 2-2 (TT XX TT)', mau: 0, dung: 0, p: 0, w: 1.0 },
                '3_3': { ten: 'Cầu 3-3 (TTT XXX)', mau: 0, dung: 0, p: 0, w: 1.1 }
            },
            ngan: {
                'TTX': { ten: 'TTX', mau: 0, dung: 0, p: 0, w: 0.7 },
                'XXT': { ten: 'XXT', mau: 0, dung: 0, p: 0, w: 0.7 },
                'TXT': { ten: 'TXT', mau: 0, dung: 0, p: 0, w: 0.8 },
                'XTX': { ten: 'XTX', mau: 0, dung: 0, p: 0, w: 0.8 }
            },
            trung: {
                'TXXT': { ten: 'Đối xứng (T X X T)', mau: 0, dung: 0, p: 0, w: 1.2 },
                'XTTX': { ten: 'Đối xứng (X T T X)', mau: 0, dung: 0, p: 0, w: 1.2 },
                'TXTXT': { ten: 'Tam giác (T X T X T)', mau: 0, dung: 0, p: 0, w: 1.3 },
                'XTXTX': { ten: 'Tam giác (X T X T X)', mau: 0, dung: 0, p: 0, w: 1.3 },
                'TTXTT': { ten: '2-1-2 (TT X TT)', mau: 0, dung: 0, p: 0, w: 1.1 },
                'XXTXX': { ten: '2-1-2 (XX T XX)', mau: 0, dung: 0, p: 0, w: 1.1 }
            },
            an: {
                '1112': { ten: 'Ẩn: TTT X', mau: 0, dung: 0, p: 0, w: 1.3 },
                '2221': { ten: 'Ẩn: XXX T', mau: 0, dung: 0, p: 0, w: 1.3 },
                '313': { ten: 'Ẩn: TTT X TTT', mau: 0, dung: 0, p: 0, w: 1.5 }
            },
            sieuHiem: {
                'sh1': { ten: 'SIÊU HIẾM: TTXXXTT', mau: 0, dung: 0, p: 0, w: 2.0 },
                'sh2': { ten: 'SIÊU HIẾM: TXXTTXXT', mau: 0, dung: 0, p: 0, w: 2.0 }
            },
            dacBiet: {
                'sauTriple': { ten: 'Sau bộ ba', mau: 0, dung: 0, p: 0, w: 2.0 },
                'sauTong3': { ten: 'Sau tổng=3', mau: 0, dung: 0, p: 0, w: 1.5 },
                'sauTong18': { ten: 'Sau tổng=18', mau: 0, dung: 0, p: 0, w: 1.5 }
            }
        };
    }

    initialize() {
        if (this.data.length >= 15) {
            this.analyzeAllCau();
            this.deepLearn();
            this.optimizeWeights();
        }
    }

    analyzeAllCau() {
        if (this.data.length < 40) return;
        
        for (let i = 40; i < this.data.length - 1; i++) {
            const sau = this.data[i+1].result;
            const truoc7 = this.data.slice(i-6, i+1).map(d => d.result);
            const s7 = truoc7.join('');
            const s6 = truoc7.slice(-6).join('');
            const s5 = truoc7.slice(-5).join('');
            const s4 = truoc7.slice(-4).join('');
            const s3 = truoc7.slice(-3).join('');
            
            // Cầu cơ bản
            if (s4 === 'TàiXỉuTàiXỉu') { this.inc('coBan', '1_1'); if (sau === 'Xỉu') this.incD('coBan', '1_1'); }
            if (s4 === 'XỉuTàiXỉuTài') { this.inc('coBan', '1_1'); if (sau === 'Tài') this.incD('coBan', '1_1'); }
            if (s6 === 'TàiTàiXỉuXỉuTàiTài') { this.inc('coBan', '2_2'); if (sau === 'Xỉu') this.incD('coBan', '2_2'); }
            if (s6 === 'XỉuXỉuTàiTàiXỉuXỉu') { this.inc('coBan', '2_2'); if (sau === 'Tài') this.incD('coBan', '2_2'); }
            
            // Cầu ngắn
            if (s3 === 'TàiTàiXỉu') { this.inc('ngan', 'TTX'); if (sau === 'Xỉu') this.incD('ngan', 'TTX'); }
            if (s3 === 'XỉuXỉuTài') { this.inc('ngan', 'XXT'); if (sau === 'Tài') this.incD('ngan', 'XXT'); }
            if (s3 === 'TàiXỉuTài') { this.inc('ngan', 'TXT'); if (sau === 'Xỉu') this.incD('ngan', 'TXT'); }
            if (s3 === 'XỉuTàiXỉu') { this.inc('ngan', 'XTX'); if (sau === 'Tài') this.incD('ngan', 'XTX'); }
            
            // Cầu tầm trung
            if (s4 === 'TàiXỉuXỉuTài') { this.inc('trung', 'TXXT'); if (sau === 'Tài') this.incD('trung', 'TXXT'); }
            if (s4 === 'XỉuTàiTàiXỉu') { this.inc('trung', 'XTTX'); if (sau === 'Xỉu') this.incD('trung', 'XTTX'); }
            if (s5 === 'TàiXỉuTàiXỉuTài') { this.inc('trung', 'TXTXT'); if (sau === 'Xỉu') this.incD('trung', 'TXTXT'); }
            if (s5 === 'XỉuTàiXỉuTàiXỉu') { this.inc('trung', 'XTXTX'); if (sau === 'Tài') this.incD('trung', 'XTXTX'); }
            if (s5 === 'TàiTàiXỉuTàiTài') { this.inc('trung', 'TTXTT'); if (sau === 'Xỉu') this.incD('trung', 'TTXTT'); }
            if (s5 === 'XỉuXỉuTàiXỉuXỉu') { this.inc('trung', 'XXTXX'); if (sau === 'Tài') this.incD('trung', 'XXTXX'); }
            
            // Cầu ẩn
            if (s4 === 'TàiTàiTàiXỉu') { this.inc('an', '1112'); if (sau === 'Xỉu') this.incD('an', '1112'); }
            if (s4 === 'XỉuXỉuXỉuTài') { this.inc('an', '2221'); if (sau === 'Tài') this.incD('an', '2221'); }
            if (s7 === 'TàiTàiTàiXỉuTàiTàiTài') { this.inc('an', '313'); if (sau === 'Xỉu') this.incD('an', '313'); }
            
            // Cầu siêu hiếm
            if (s7 === 'TàiTàiXỉuXỉuXỉuTàiTài') { this.inc('sieuHiem', 'sh1'); if (sau === 'Xỉu') this.incD('sieuHiem', 'sh1'); }
            
            // Cầu đặc biệt
            if (this.data[i].ht === 1) {
                this.inc('dacBiet', 'sauTriple');
                if (sau === (this.data[i].d[0] <= 3 ? 'Tài' : 'Xỉu')) this.incD('dacBiet', 'sauTriple');
            }
            if (this.data[i].t === 3) {
                this.inc('dacBiet', 'sauTong3');
                if (sau === 'Tài') this.incD('dacBiet', 'sauTong3');
            }
            if (this.data[i].t === 18) {
                this.inc('dacBiet', 'sauTong18');
                if (sau === 'Xỉu') this.incD('dacBiet', 'sauTong18');
            }
        }
        
        // Tính tỷ lệ
        for (const nhom in this.cauDB) {
            for (const loai in this.cauDB[nhom]) {
                const c = this.cauDB[nhom][loai];
                if (c.mau > 0) c.p = parseFloat((c.dung / c.mau * 100).toFixed(1));
            }
        }
        
        this.cauDangChay = this.detectCurrentCau();
    }

    inc(nhom, loai) { if (this.cauDB[nhom]?.[loai]) this.cauDB[nhom][loai].mau++; }
    incD(nhom, loai) { if (this.cauDB[nhom]?.[loai]) this.cauDB[nhom][loai].dung++; }

    detectCurrentCau() {
        if (this.data.length < 8) return null;
        
        const last8 = this.data.slice(-8).map(d => d.result);
        const s7 = last8.slice(-7).join('');
        const s5 = last8.slice(-5).join('');
        const s4 = last8.slice(-4).join('');
        
        const checks = [
            { kt: s7 === 'TàiTàiXỉuXỉuXỉuTàiTài', ten: 'SIÊU HIẾM', pred: 'Xỉu', nhom: 'sieuHiem', loai: 'sh1' },
            { kt: s5 === 'TàiXỉuTàiXỉuTài', ten: 'Tam giác', pred: 'Xỉu', nhom: 'trung', loai: 'TXTXT' },
            { kt: s5 === 'XỉuTàiXỉuTàiXỉu', ten: 'Tam giác', pred: 'Tài', nhom: 'trung', loai: 'XTXTX' },
            { kt: s4 === 'TàiXỉuXỉuTài', ten: 'Đối xứng', pred: 'Tài', nhom: 'trung', loai: 'TXXT' },
            { kt: s4 === 'XỉuTàiTàiXỉu', ten: 'Đối xứng', pred: 'Xỉu', nhom: 'trung', loai: 'XTTX' },
            { kt: s4 === 'TàiXỉuTàiXỉu', ten: '1-1', pred: 'Xỉu', nhom: 'coBan', loai: '1_1' },
            { kt: s4 === 'XỉuTàiXỉuTài', ten: '1-1', pred: 'Tài', nhom: 'coBan', loai: '1_1' },
            { kt: s4 === 'TàiTàiTàiXỉu', ten: 'Ẩn: TTT X', pred: 'Xỉu', nhom: 'an', loai: '1112' },
            { kt: s4 === 'XỉuXỉuXỉuTài', ten: 'Ẩn: XXX T', pred: 'Tài', nhom: 'an', loai: '2221' }
        ];
        
        for (const c of checks) {
            if (c.kt && this.cauDB[c.nhom]?.[c.loai]) {
                const tyLe = this.cauDB[c.nhom][c.loai].p || 65;
                return { ten: c.ten, duDoan: c.pred, doTinCay: tyLe, nhom: c.nhom, loai: c.loai, mau: this.cauDB[c.nhom][c.loai].mau, dung: this.cauDB[c.nhom][c.loai].dung, weight: this.cauDB[c.nhom][c.loai].w };
            }
        }
        
        const last = this.data[this.data.length - 1];
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            return { ten: `Bệt ${last.s} phiên`, duDoan: rev, doTinCay: 65 + Math.min(15, (last.s - 2) * 4), nhom: null, loai: null, mau: 0, dung: 0, weight: 1.2 };
        }
        
        return null;
    }

    deepLearn() {
        const sampleSize = Math.min(400, this.data.length);
        const startIdx = Math.max(0, this.data.length - sampleSize);
        
        for (let i = startIdx; i < this.data.length - 1; i++) {
            const d = this.data[i];
            const key = `${d.r}|${d.t}|${d.s}|${d.hd}|${d.ht}|${d.tc}|${d.dr}|${d.l5t}|${d.l10t}`;
            const nextResult = this.data[i + 1].result;
            
            if (!this.patternDB[key]) {
                this.patternDB[key] = { 'Tài': 0, 'Xỉu': 0, total: 0 };
            }
            this.patternDB[key][nextResult]++;
            this.patternDB[key].total++;
        }
        
        this.learnedPatterns = Object.keys(this.patternDB).length;
        
        for (const key in this.patternDB) {
            const p = this.patternDB[key];
            if (p.total >= 5) {
                const accuracy = Math.max(p['Tài'], p['Xỉu']) / p.total;
                this.patternWeights[key] = Math.min(3.0, 0.5 + accuracy * 2.5);
            }
        }
    }

    initAlgoWeights() {
        return {
            cau_dang_chay: 2.5, sieu_hiem: 2.0, dai: 1.5, trung: 1.3,
            co_ban: 1.0, ngan: 0.7, an: 1.6, dac_biet: 1.8,
            deep_pattern: 2.0, transition: 1.5, streak: 1.3, frequency: 1.0,
            tong_thap: 1.5, tong_cao: 1.5, triple: 2.0, double: 1.5
        };
    }

    optimizeWeights() {
        for (const nhom in this.cauDB) {
            for (const loai in this.cauDB[nhom]) {
                const c = this.cauDB[nhom][loai];
                if (c.mau >= 10 && c.p >= 70) {
                    c.w = Math.min(3.0, 0.5 + (c.p / 100) * 3.0);
                }
            }
        }
    }

    findAllMatchingCau() {
        const predictions = [];
        const last8 = this.data.slice(-8).map(d => d.result);
        const s7 = last8.slice(-7).join('');
        const s5 = last8.slice(-5).join('');
        const s4 = last8.slice(-4).join('');
        const s3 = last8.slice(-3).join('');
        
        const checks = [
            { kt: s7 === 'TàiTàiXỉuXỉuXỉuTàiTài', p: 'Xỉu', n: 'sieuHiem', l: 'sh1' },
            { kt: s5 === 'TàiXỉuTàiXỉuTài', p: 'Xỉu', n: 'trung', l: 'TXTXT' },
            { kt: s5 === 'XỉuTàiXỉuTàiXỉu', p: 'Tài', n: 'trung', l: 'XTXTX' },
            { kt: s4 === 'TàiXỉuXỉuTài', p: 'Tài', n: 'trung', l: 'TXXT' },
            { kt: s4 === 'XỉuTàiTàiXỉu', p: 'Xỉu', n: 'trung', l: 'XTTX' },
            { kt: s5 === 'TàiTàiXỉuTàiTài', p: 'Xỉu', n: 'trung', l: 'TTXTT' },
            { kt: s5 === 'XỉuXỉuTàiXỉuXỉu', p: 'Tài', n: 'trung', l: 'XXTXX' },
            { kt: s4 === 'TàiXỉuTàiXỉu', p: 'Xỉu', n: 'coBan', l: '1_1' },
            { kt: s4 === 'XỉuTàiXỉuTài', p: 'Tài', n: 'coBan', l: '1_1' },
            { kt: s6 === 'TàiTàiXỉuXỉuTàiTài', p: 'Xỉu', n: 'coBan', l: '2_2' },
            { kt: s6 === 'XỉuXỉuTàiTàiXỉuXỉu', p: 'Tài', n: 'coBan', l: '2_2' },
            { kt: s4 === 'TàiTàiTàiXỉu', p: 'Xỉu', n: 'an', l: '1112' },
            { kt: s4 === 'XỉuXỉuXỉuTài', p: 'Tài', n: 'an', l: '2221' },
            { kt: s7 === 'TàiTàiTàiXỉuTàiTàiTài', p: 'Xỉu', n: 'an', l: '313' },
            { kt: s3 === 'TàiTàiXỉu', p: 'Xỉu', n: 'ngan', l: 'TTX' },
            { kt: s3 === 'XỉuXỉuTài', p: 'Tài', n: 'ngan', l: 'XXT' }
        ];
        
        for (const check of checks) {
            if (check.kt && this.cauDB[check.n]?.[check.l]) {
                const c = this.cauDB[check.n][check.l];
                if (c.mau >= 3) {
                    predictions.push({
                        pred: check.p,
                        conf: c.p || 60,
                        weight: c.w || 1.0,
                        name: `cau_${check.n}`,
                        reason: `${c.ten} (${c.dung}/${c.mau})`
                    });
                }
            }
        }
        
        return predictions;
    }

    deepPatternPredict() {
        const last = this.data[this.data.length - 1];
        const key = `${last.r}|${last.t}|${last.s}|${last.hd}|${last.ht}|${last.tc}|${last.dr}|${last.l5t}|${last.l10t}`;
        const pattern = this.patternDB[key];
        
        if (pattern && pattern.total >= 5) {
            const pred = pattern['Tài'] > pattern['Xỉu'] ? 'Tài' : 'Xỉu';
            const conf = 50 + (Math.max(pattern['Tài'], pattern['Xỉu']) / pattern.total) * 40;
            const weight = this.patternWeights[key] || 2.0;
            return { pred, conf: Math.min(85, conf), weight, name: 'deep_pattern', reason: `Pattern ${pattern.total} lần` };
        }
        return null;
    }

    runCorePredictors(last) {
        const predictions = [];
        
        // Transition
        const matrix = { 0: { 0: 0, 1: 0 }, 1: { 0: 0, 1: 0 } };
        for (let i = 0; i < this.data.length - 1; i++) {
            matrix[this.data[i].r][this.data[i+1].r]++;
        }
        const total = matrix[last.r][0] + matrix[last.r][1];
        if (total > 0) {
            const probTai = matrix[last.r][1] / total;
            if (probTai > 0.65) predictions.push({ pred: 'Tài', conf: probTai * 100, weight: 1.5, name: 'transition', reason: `P(T)=${(probTai*100).toFixed(0)}%` });
            else if (probTai < 0.35) predictions.push({ pred: 'Xỉu', conf: (1 - probTai) * 100, weight: 1.5, name: 'transition', reason: `P(T)=${(probTai*100).toFixed(0)}%` });
        }
        
        // Streak
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            predictions.push({ pred: rev, conf: 65 + Math.min(15, (last.s - 2) * 4), weight: 1.3, name: 'streak', reason: `Đảo sau bệt ${last.s}` });
        }
        
        // Frequency
        if (this.data.length >= 20) {
            const last20 = this.data.slice(-20);
            const taiCount = last20.filter(d => d.r === 1).length;
            if (taiCount >= 14) predictions.push({ pred: 'Xỉu', conf: 60 + (taiCount - 14) * 5, weight: 1.0, name: 'frequency', reason: `${taiCount}/20 Tài` });
            else if (taiCount <= 6) predictions.push({ pred: 'Tài', conf: 60 + (6 - taiCount) * 5, weight: 1.0, name: 'frequency', reason: `${taiCount}/20 Tài` });
        }
        
        return predictions;
    }

    runSpecialPredictors(last) {
        const predictions = [];
        
        if (last.t <= 6) predictions.push({ pred: 'Tài', conf: 64, weight: 1.5, name: 'tong_thap', reason: `Tổng=${last.t}` });
        if (last.t >= 15) predictions.push({ pred: 'Xỉu', conf: 63, weight: 1.5, name: 'tong_cao', reason: `Tổng=${last.t}` });
        
        if (last.ht === 1) {
            if (last.d[0] === 1) predictions.push({ pred: 'Xỉu', conf: 95, weight: 3.0, name: 'triple', reason: 'Bộ 3 mặt 1' });
            else if (last.d[0] === 6) predictions.push({ pred: 'Tài', conf: 92, weight: 3.0, name: 'triple', reason: 'Bộ 3 mặt 6' });
            else if (last.d[0] >= 4) predictions.push({ pred: 'Tài', conf: 75, weight: 2.0, name: 'triple', reason: `Bộ 3 mặt ${last.d[0]}` });
            else predictions.push({ pred: 'Xỉu', conf: 75, weight: 2.0, name: 'triple', reason: `Bộ 3 mặt ${last.d[0]}` });
        }
        
        if (last.hd === 1) {
            if (last.d[0] === last.d[1] && last.d[0] === 1) predictions.push({ pred: 'Xỉu', conf: 78, weight: 1.8, name: 'double', reason: 'Đôi 1' });
            if (last.d[0] === last.d[1] && last.d[0] === 6) predictions.push({ pred: 'Tài', conf: 75, weight: 1.8, name: 'double', reason: 'Đôi 6' });
        }
        
        return predictions;
    }

    predict(showDetail = false) {
        const last = this.data[this.data.length - 1];
        const cacheKey = `${last.r}_${last.t}_${last.s}_${last.hd}_${last.ht}_${last.dr}_${this.data.length}`;
        
        this.cacheTotal++;
        if (this.cacheL1.has(cacheKey)) {
            this.cacheHitRate = (this.cacheHitRate * (this.cacheTotal - 1) + 1) / this.cacheTotal;
            return this.cacheL1.get(cacheKey);
        }
        
        const allPredictions = [];
        
        if (this.cauDangChay && this.cauDangChay.doTinCay >= 60) {
            allPredictions.push({
                pred: this.cauDangChay.duDoan,
                conf: this.cauDangChay.doTinCay,
                weight: (this.cauDangChay.weight || 1.0) * 2.5,
                name: 'cau_dang_chay',
                reason: `${this.cauDangChay.ten} (${this.cauDangChay.dung}/${this.cauDangChay.mau})`
            });
        }
        
        const cauMatches = this.findAllMatchingCau();
        allPredictions.push(...cauMatches);
        
        const deepPred = this.deepPatternPredict();
        if (deepPred) allPredictions.push(deepPred);
        
        const corePreds = this.runCorePredictors(last);
        allPredictions.push(...corePreds);
        
        const specialPreds = this.runSpecialPredictors(last);
        allPredictions.push(...specialPreds);
        
        if (allPredictions.length === 0) {
            return { prediction: last.result === 'Tài' ? 'Xỉu' : 'Tài', confidence: 55, activeAlgorithms: 0 };
        }
        
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        allPredictions.forEach(p => { scores[p.pred] += p.conf * p.weight; });
        
        let finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        const totalScore = scores['Tài'] + scores['Xỉu'];
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        
        const sieuHiemPred = allPredictions.find(p => p.name.includes('sieuHiem') && p.conf >= 75);
        if (sieuHiemPred) { finalPred = sieuHiemPred.pred; confidence = Math.max(confidence, sieuHiemPred.conf); }
        
        confidence = Math.min(97, Math.round(confidence));
        
        const result = {
            prediction: finalPred,
            confidence: confidence,
            activeAlgorithms: allPredictions.length,
            cauDangChay: this.cauDangChay
        };
        
        this.cacheL1.set(cacheKey, result);
        if (this.cacheL1.size > 500) {
            const firstKey = this.cacheL1.keys().next().value;
            this.cacheL1.delete(firstKey);
        }
        
        if (this.data.length % 30 === 0) {
            this.analyzeAllCau();
            this.deepLearn();
            this.optimizeWeights();
        }
        
        if (showDetail) {
            console.log(`\n🎯 DỰ ĐOÁN: ${result.prediction} | ĐTC: ${result.confidence}% | ${result.activeAlgorithms} thuật toán`);
            if (result.cauDangChay) console.log(`📡 CẦU: ${result.cauDangChay.ten} → ${result.cauDangChay.duDoan} (${result.cauDangChay.doTinCay}%)`);
        }
        
        return result;
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 1000);
        this.data = this.preprocessData(this.raw);
        this.cacheL1.clear();
        this.analyzeAllCau();
        this.deepLearn();
        this.optimizeWeights();
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadBangThangThua() {
    try {
        if (fs.existsSync(THANGTHUA_FILE)) {
            const data = fs.readFileSync(THANGTHUA_FILE, 'utf8');
            bangThangThua = JSON.parse(data);
            console.log(`✅ Đã tải bảng thắng thua: ${bangThangThua.length} phiên`);
        }
    } catch (error) { console.error('❌ Lỗi load thắng thua:', error.message); }
}

function saveBangThangThua() {
    try {
        if (bangThangThua.length > MAX_HISTORY) {
            bangThangThua = bangThangThua.slice(0, MAX_HISTORY);
        }
        fs.writeFileSync(THANGTHUA_FILE, JSON.stringify(bangThangThua, null, 2));
    } catch (error) { console.error('❌ Lỗi save thắng thua:', error.message); }
}

function loadAllData() {
    loadBangThangThua();
    
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: ${sessionsStore.length} phiên`);
            
            if (sessionsStore.length >= MAX_SESSIONS) {
                isReady = true;
                predictor = new GodPredictorV7(sessionsStore.slice(0, MAX_SESSIONS * 2));
                console.log(`🎯 GOD PREDICTOR V7 ĐÃ SẴN SÀNG!`);
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
    if (sessionsStore.length > 200) {
        sessionsStore = sessionsStore.slice(0, 200);
    }
    return addedCount;
}

async function fetchAndUpdate() {
    const data = await fetchDataMd5();
    if (!data) return false;
    
    const addedCount = updateSessions(data);
    if (addedCount > 0) saveAllData();
    
    if (!isReady && sessionsStore.length >= MAX_SESSIONS) {
        isReady = true;
        predictor = new GodPredictorV7(sessionsStore.slice(0, MAX_SESSIONS * 2));
        console.log(`🎉 MD5 ĐÃ SẴN SÀNG!`);
    } else if (isReady && predictor && addedCount > 0) {
        const recentSessions = sessionsStore.slice(0, MAX_SESSIONS);
        predictor.updateWithNewData(recentSessions);
    }
    return true;
}

// ==================== VERIFY & RECORD (1 PHIÊN 1 BẢN GHI) ====================

function verifyAndRecord() {
    if (!predictor) return;
    
    let updated = false;
    
    for (let i = 0; i < predictionHistory.length; i++) {
        const record = predictionHistory[i];
        if (record.da_kiem_tra) continue;
        
        const actualResult = sessionsStore.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            const duDoanChuan = record.du_doan.toLowerCase() === 'tài' ? 'tài' : 'xỉu';
            const ketQuaChuan = actualResult.Ket_qua.toLowerCase() === 'tài' ? 'tài' : 'xỉu';
            const isCorrect = duDoanChuan === ketQuaChuan;
            const danhGia = isCorrect ? 'thắng' : 'thua';
            
            record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            
            // Thêm vào bảng thắng thua - chỉ 1 bản ghi mỗi phiên
            const existingIndex = bangThangThua.findIndex(item => item.phien === record.phien_du_doan);
            const thangThuaRecord = {
                phien: parseInt(record.phien_du_doan),
                du_doan: duDoanChuan,
                ket_qua: ketQuaChuan,
                danh_gia: danhGia,
                do_tin_cay: record.do_tin_cay,
                timestamp: record.timestamp || new Date().toISOString()
            };
            
            if (existingIndex !== -1) {
                bangThangThua[existingIndex] = thangThuaRecord;
            } else {
                bangThangThua.unshift(thangThuaRecord);
            }
            
            updated = true;
        }
    }
    
    if (bangThangThua.length > MAX_HISTORY) {
        bangThangThua = bangThangThua.slice(0, MAX_HISTORY);
    }
    if (predictionHistory.length > MAX_HISTORY) {
        predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    
    if (updated) {
        saveBangThangThua();
        saveAllData();
        const thongKe = tinhThongKeThangThua();
        console.log(`📊 THỐNG KÊ: Thắng=${thongKe.thang}, Thua=${thongKe.thua}, Tỉ lệ=${thongKe.ty_le_thang}%`);
    }
}

function tinhThongKeThangThua() {
    const thang = bangThangThua.filter(item => item.danh_gia === 'thắng').length;
    const thua = bangThangThua.filter(item => item.danh_gia === 'thua').length;
    const tong = thang + thua;
    const tyLe = tong > 0 ? (thang / tong * 100).toFixed(1) : 0;
    return { thang, thua, tong, ty_le_thang: tyLe };
}

function savePredictionToHistory(phienTruocDo, phienHienTai, prediction, confidence, latestData) {
    const existingIndex = predictionHistory.findIndex(r => r.phien_du_doan === phienHienTai.toString());
    const duDoanChuan = prediction.toLowerCase() === 'tài' ? 'tài' : 'xỉu';
    
    const record = {
        phien_truoc_do: phienTruocDo.toString(),
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
        phien_hien_tai: phienHienTai.toString(),
        phien_du_doan: phienHienTai.toString(),
        du_doan: duDoanChuan,
        do_tin_cay: `${confidence}%`,
        ket_qua_du_doan: '',
        ket_qua_thuc_te: '',
        da_kiem_tra: false,
        id: 'love trang',
        timestamp: new Date().toISOString()
    };
    
    if (existingIndex !== -1) {
        predictionHistory[existingIndex] = record;
    } else {
        predictionHistory.unshift(record);
    }
    
    if (predictionHistory.length > MAX_HISTORY) {
        predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    return record;
}

// ==================== AUTO PROCESS ====================

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU MD5...');
    console.log(`📋 Lấy ${FETCH_PER_REQUEST} phiên mỗi lần - Chỉ giữ ${MAX_SESSIONS} phiên gần nhất để dự đoán`);
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
        
        const latestSessions = sessionsStore.slice(0, MAX_SESSIONS);
        if (latestSessions.length >= MAX_SESSIONS && predictor) {
            const latestPhien = latestSessions[0].Phien;
            const nextPhien = latestPhien + 1;
            
            if (lastProcessedPhien !== nextPhien) {
                const result = predictor.predict(false);
                savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                lastProcessedPhien = nextPhien;
                
                const thongKe = tinhThongKeThangThua();
                let msg = `[DỰ ĐOÁN] 👑 MD5 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeAlgorithms} thuật toán`;
                if (result.cauDangChay) {
                    msg += ` | CẦU: ${result.cauDangChay.ten} → ${result.cauDangChay.duDoan} (${result.cauDangChay.doTinCay}%)`;
                }
                msg += ` | 📊 TL: ${thongKe.ty_le_thang}% (${thongKe.thang}/${thongKe.tong})`;
                console.log(msg);
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
    console.log('👑 GOD PREDICTOR V7 - SIÊU CHUẨN XÁC TUYỆT ĐỐI');
    console.log('   Ultra Fast V4 + Siêu Phân Tích Cầu V14 = 130+ thuật toán');
    console.log(`📋 Lấy ${MAX_SESSIONS} phiên gần nhất - Lưu thắng thua ${MAX_HISTORY} phiên`);
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
    const thongKe = tinhThongKeThangThua();
    res.json({
        md5: { sessions: sessionsStore.length, ready: isReady, so_phien_da_phan_tich: sessionsStore.length, so_phien_du_doan: bangThangThua.length },
        thong_ke: thongKe
    });
});

app.get('/lc79-md5', async (req, res) => {
    try {
        if (!isReady || !predictor) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.length}/${MAX_SESSIONS}` });
        }
        
        await fetchAndUpdate();
        verifyAndRecord();
        
        const latestSessions = sessionsStore.slice(0, MAX_SESSIONS);
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictor.predict(false);
        const thongKe = tinhThongKeThangThua();
        
        const record = savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
        
        res.json({
            phien_truoc_do: record.phien_truoc_do,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            phien_hien_tai: record.phien_hien_tai,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            thong_ke: {
                tong_phien: thongKe.tong,
                thang: thongKe.thang,
                thua: thongKe.thua,
                ty_le_thang: `${thongKe.ty_le_thang}%`
            },
            id: record.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-md5/lichsu', (req, res) => {
    const thongKe = tinhThongKeThangThua();
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        thong_ke: {
            tong_phien: thongKe.tong,
            thang: thongKe.thang,
            thua: thongKe.thua,
            ty_le_thang: `${thongKe.ty_le_thang}%`
        },
        bang_thang_thua: bangThangThua,
        lich_su_du_doan: predictionHistory,
        tong_so_du_doan: predictionHistory.length
    });
});

app.get('/lc79-md5/thongke', (req, res) => {
    const thongKe = tinhThongKeThangThua();
    res.json({
        type: 'MD5',
        thong_ke: {
            tong_phien: thongKe.tong,
            thang: thongKe.thang,
            thua: thongKe.thua,
            ty_le_thang: `${thongKe.ty_le_thang}%`
        },
        bang_thang_thua: bangThangThua.slice(0, 20)
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 GOD PREDICTOR V7 - SIÊU CHUẨN XÁC TUYỆT ĐỐI');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC NHÓM THUẬT TOÁN (130+):');
    console.log('   • Core: transition, streak, frequency');
    console.log('   • V14 Cầu: cơ bản, ngắn, trung, ẩn, siêu hiếm, đặc biệt');
    console.log('   • Deep learning pattern');
    console.log('   • Special: tổng điểm, bộ ba, đôi');
    console.log('');
    console.log('📊 CẤU HÌNH MỚI:');
    console.log(`   • Chỉ lấy ${MAX_SESSIONS} phiên gần nhất để dự đoán`);
    console.log(`   • Lưu thắng thua tối đa ${MAX_HISTORY} phiên`);
    console.log(`   • Tự động xóa khi quá ${MAX_HISTORY} phiên`);
    console.log('   • Mỗi phiên chỉ 1 bản ghi - không bị trùng');
    console.log('');
    console.log('📊 THỨ TỰ HIỂN THỊ:');
    console.log('   1. phien_truoc_do');
    console.log('   2. xuc_xac');
    console.log('   3. tong');
    console.log('   4. ket_qua_hien_tai');
    console.log('   5. phien_hien_tai');
    console.log('   6. du_doan');
    console.log('   7. do_tin_cay');
    console.log('   8. thong_ke (tổng, thắng, thua, tỉ lệ)');
    console.log('   9. id');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
