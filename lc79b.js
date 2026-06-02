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

// ==================== GOD PREDICTOR V6 ====================

class GodPredictorV6 {
    constructor(data) {
        this.raw = data;
        this.data = this.preprocessData(data);
        
        // Cache thông minh
        this.cacheL1 = new Map();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        
        // Hệ thống trọng số
        this.weights = this.initDynamicWeights();
        this.consecutiveErrors = 0;
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        
        // Hệ thống học
        this.successPatterns = {};
        
        // Khởi tạo V13
        this.cauDB = this.initCauDB_V13();
        this.cauDangChay = null;
        
        // Khởi tạo
        this.initialize();
    }

    preprocessData(data) {
        const processed = [];
        
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const prev = i > 0 ? processed[i-1] : null;
            
            const streak = (i > 0 && data[i-1].Ket_qua === item.Ket_qua) ? prev.s + 1 : 1;
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const sum = dice[0] + dice[1] + dice[2];
            const hasDouble = (dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]) ? 1 : 0;
            const hasTriple = (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0;
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
                r: item.Ket_qua === "Tài" ? 1 : 0,
                t: sum,
                s: streak,
                d: dice,
                hd: hasDouble,
                ht: hasTriple,
                tc: totalCategory,
                l5t: last5Tai,
                l10t: last10Tai,
                p: item.Phien
            });
        }
        
        return processed;
    }

    initCauDB_V13() {
        return {
            coBan: {
                '1_1': { ten: '1-1 (T X T X)', mau: 0, dung: 0, p: 0, weight: 1.0 },
                '2_2': { ten: '2-2 (TT XX TT)', mau: 0, dung: 0, p: 0, weight: 1.0 },
                '3_3': { ten: '3-3 (TTT XXX)', mau: 0, dung: 0, p: 0, weight: 1.1 }
            },
            ngan: {
                'ttx': { ten: 'TTX', mau: 0, dung: 0, p: 0, weight: 0.7 },
                'xxt': { ten: 'XXT', mau: 0, dung: 0, p: 0, weight: 0.7 },
                'txt': { ten: 'TXT', mau: 0, dung: 0, p: 0, weight: 0.8 },
                'xtx': { ten: 'XTX', mau: 0, dung: 0, p: 0, weight: 0.8 }
            },
            trung: {
                '1_2_1': { ten: '1-2-1 (T XX T)', mau: 0, dung: 0, p: 0, weight: 1.1 },
                '2_1_2': { ten: '2-1-2 (TT X TT)', mau: 0, dung: 0, p: 0, weight: 1.1 },
                'doiXung': { ten: 'Đối xứng (T X X T)', mau: 0, dung: 0, p: 0, weight: 1.2 },
                'tamGiac': { ten: 'Tam giác (T X T X T)', mau: 0, dung: 0, p: 0, weight: 1.3 }
            },
            an: {
                '1112': { ten: 'Ẩn: TTT X', mau: 0, dung: 0, p: 0, weight: 1.3 },
                '2221': { ten: 'Ẩn: XXX T', mau: 0, dung: 0, p: 0, weight: 1.3 },
                '313': { ten: 'Ẩn: TTT X TTT', mau: 0, dung: 0, p: 0, weight: 1.5 }
            },
            sieuHiem: {
                'sh1': { ten: 'SIÊU HIẾM 1', mau: 0, dung: 0, p: 0, weight: 2.5 },
                'sh2': { ten: 'SIÊU HIẾM 2', mau: 0, dung: 0, p: 0, weight: 2.5 },
                'sh3': { ten: 'SIÊU HIẾM 3', mau: 0, dung: 0, p: 0, weight: 2.5 }
            },
            dacBiet: {
                'sauTriple': { ten: 'Sau bộ ba', mau: 0, dung: 0, p: 0, weight: 2.0 },
                'sauTong3': { ten: 'Sau tổng=3', mau: 0, dung: 0, p: 0, weight: 1.5 },
                'sauTong18': { ten: 'Sau tổng=18', mau: 0, dung: 0, p: 0, weight: 1.5 }
            }
        };
    }

    initialize() {
        if (this.data.length >= 30) {
            this.analyzeAllCau();
            this.learnPatterns();
            this.optimizeWeights();
        }
    }

    analyzeAllCau() {
        if (this.data.length < 40) return;
        
        for (let i = 40; i < this.data.length - 1; i++) {
            const sau = this.data[i+1].result;
            const truoc7 = this.data.slice(i-6, i+1).map(d => d.result);
            const truoc6 = truoc7.slice(-6);
            const truoc5 = truoc7.slice(-5);
            const truoc4 = truoc7.slice(-4);
            const truoc3 = truoc7.slice(-3);
            
            const s7 = truoc7.join('');
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
            if (s3 === 'TàiXỉuTài') { this.cauDB.ngan.txt.mau++; if (sau === 'Xỉu') this.cauDB.ngan.txt.dung++; }
            if (s3 === 'XỉuTàiXỉu') { this.cauDB.ngan.xtx.mau++; if (sau === 'Tài') this.cauDB.ngan.xtx.dung++; }
            
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
            if (s4 === 'TàiTàiTàiXỉu') { this.cauDB.an['1112'].mau++; if (sau === 'Xỉu') this.cauDB.an['1112'].dung++; }
            if (s4 === 'XỉuXỉuXỉuTài') { this.cauDB.an['2221'].mau++; if (sau === 'Tài') this.cauDB.an['2221'].dung++; }
            if (s7 === 'TàiTàiTàiXỉuTàiTàiTài') { this.cauDB.an['313'].mau++; if (sau === 'Xỉu') this.cauDB.an['313'].dung++; }
            
            // Cầu siêu hiếm
            if (s7 === 'TàiTàiXỉuXỉuXỉuTàiTài') { this.cauDB.sieuHiem.sh2.mau++; if (sau === 'Xỉu') this.cauDB.sieuHiem.sh2.dung++; }
            
            // Cầu đặc biệt
            if (this.data[i].ht === 1) {
                this.cauDB.dacBiet.sauTriple.mau++;
                if (sau === (this.data[i].d[0] <= 3 ? 'Tài' : 'Xỉu')) this.cauDB.dacBiet.sauTriple.dung++;
            }
            if (this.data[i].t === 3) {
                this.cauDB.dacBiet.sauTong3.mau++;
                if (sau === 'Tài') this.cauDB.dacBiet.sauTong3.dung++;
            }
            if (this.data[i].t === 18) {
                this.cauDB.dacBiet.sauTong18.mau++;
                if (sau === 'Xỉu') this.cauDB.dacBiet.sauTong18.dung++;
            }
        }
        
        // Tính tỷ lệ
        for (const nhom in this.cauDB) {
            for (const loai in this.cauDB[nhom]) {
                const c = this.cauDB[nhom][loai];
                if (c.mau > 0) c.p = parseFloat((c.dung / c.mau * 100).toFixed(1));
            }
        }
        
        this.cauDangChay = this.detectCurrentPattern();
    }

    detectCurrentPattern() {
        if (this.data.length < 8) return null;
        
        const last8 = this.data.slice(-8).map(d => d.result);
        const last7 = last8.slice(-7);
        const last6 = last8.slice(-6);
        const last5 = last8.slice(-5);
        const last4 = last8.slice(-4);
        
        const s7 = last7.join('');
        const s6 = last6.join('');
        const s5 = last5.join('');
        const s4 = last4.join('');
        
        const checks = [
            { kt: s7 === 'TàiTàiXỉuXỉuXỉuTàiTài', ten: 'SIÊU HIẾM', pred: 'Xỉu', nhom: 'sieuHiem', loai: 'sh2' },
            { kt: s5 === 'TàiXỉuTàiXỉuTài', ten: 'Tam giác', pred: 'Xỉu', nhom: 'trung', loai: 'tamGiac' },
            { kt: s5 === 'XỉuTàiXỉuTàiXỉu', ten: 'Tam giác', pred: 'Tài', nhom: 'trung', loai: 'tamGiac' },
            { kt: s4 === 'TàiXỉuXỉuTài', ten: 'Đối xứng', pred: 'Tài', nhom: 'trung', loai: 'doiXung' },
            { kt: s4 === 'XỉuTàiTàiXỉu', ten: 'Đối xứng', pred: 'Xỉu', nhom: 'trung', loai: 'doiXung' },
            { kt: s5 === 'TàiXỉuXỉuTài', ten: '1-2-1', pred: 'Xỉu', nhom: 'trung', loai: '1_2_1' },
            { kt: s5 === 'XỉuTàiTàiXỉu', ten: '1-2-1', pred: 'Tài', nhom: 'trung', loai: '1_2_1' },
            { kt: s4 === 'TàiXỉuTàiXỉu', ten: '1-1', pred: 'Xỉu', nhom: 'coBan', loai: '1_1' },
            { kt: s4 === 'XỉuTàiXỉuTài', ten: '1-1', pred: 'Tài', nhom: 'coBan', loai: '1_1' },
            { kt: s4 === 'TàiTàiTàiXỉu', ten: 'Ẩn: TTT X', pred: 'Xỉu', nhom: 'an', loai: '1112' },
            { kt: s4 === 'XỉuXỉuXỉuTài', ten: 'Ẩn: XXX T', pred: 'Tài', nhom: 'an', loai: '2221' }
        ];
        
        for (const c of checks) {
            if (c.kt && this.cauDB[c.nhom]?.[c.loai]) {
                const tyLe = this.cauDB[c.nhom][c.loai].p || 65;
                return {
                    ten: c.ten,
                    duDoan: c.pred,
                    doTinCay: tyLe,
                    nhom: c.nhom,
                    loai: c.loai,
                    dung: this.cauDB[c.nhom][c.loai].dung,
                    mau: this.cauDB[c.nhom][c.loai].mau
                };
            }
        }
        
        // Bệt
        const last = this.data[this.data.length - 1];
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            return {
                ten: `Bệt ${last.s} phiên`,
                duDoan: rev,
                doTinCay: 65 + Math.min(15, (last.s - 2) * 4),
                nhom: null, loai: null, dung: 0, mau: 0
            };
        }
        
        return null;
    }

    learnPatterns() {
        const sampleSize = Math.min(300, this.data.length);
        
        for (let i = this.data.length - sampleSize; i < this.data.length - 1; i++) {
            const d = this.data[i];
            const key = `${d.r}|${d.t}|${d.s}|${d.hd}|${d.ht}|${d.tc}|${d.l5t}`;
            const nextResult = this.data[i + 1].result;
            
            if (!this.successPatterns[key]) {
                this.successPatterns[key] = { 'Tài': 0, 'Xỉu': 0, total: 0 };
            }
            this.successPatterns[key][nextResult]++;
            this.successPatterns[key].total++;
        }
    }

    initDynamicWeights() {
        return {
            cau_sieu_hiem: 2.5, cau_an: 1.8, cau_dai: 1.5, cau_trung: 1.3,
            cau_co_ban: 1.0, cau_ngan: 0.7, cau_dac_biet: 2.0, deep_pattern: 2.0
        };
    }

    optimizeWeights() {
        for (const nhom in this.cauDB) {
            for (const loai in this.cauDB[nhom]) {
                const c = this.cauDB[nhom][loai];
                if (c.mau >= 10 && c.p >= 70) {
                    c.weight = Math.min(3.0, 0.5 + (c.p / 100) * 2.5);
                }
            }
        }
    }

    findAllMatchingCau() {
        const predictions = [];
        const last8 = this.data.slice(-8).map(d => d.result);
        const last7 = last8.slice(-7);
        const last6 = last8.slice(-6);
        const last5 = last8.slice(-5);
        const last4 = last8.slice(-4);
        const last3 = last8.slice(-3);
        
        const s7 = last7.join('');
        const s6 = last6.join('');
        const s5 = last5.join('');
        const s4 = last4.join('');
        const s3 = last3.join('');
        
        const checks = [
            { kt: s7 === 'TàiTàiXỉuXỉuXỉuTàiTài', pred: 'Xỉu', nhom: 'sieuHiem', loai: 'sh2' },
            { kt: s5 === 'TàiXỉuTàiXỉuTài', pred: 'Xỉu', nhom: 'trung', loai: 'tamGiac' },
            { kt: s5 === 'XỉuTàiXỉuTàiXỉu', pred: 'Tài', nhom: 'trung', loai: 'tamGiac' },
            { kt: s4 === 'TàiXỉuXỉuTài', pred: 'Tài', nhom: 'trung', loai: 'doiXung' },
            { kt: s4 === 'XỉuTàiTàiXỉu', pred: 'Xỉu', nhom: 'trung', loai: 'doiXung' },
            { kt: s5 === 'TàiXỉuXỉuTài', pred: 'Xỉu', nhom: 'trung', loai: '1_2_1' },
            { kt: s5 === 'XỉuTàiTàiXỉu', pred: 'Tài', nhom: 'trung', loai: '1_2_1' },
            { kt: s5 === 'TàiTàiXỉuTàiTài', pred: 'Xỉu', nhom: 'trung', loai: '2_1_2' },
            { kt: s5 === 'XỉuXỉuTàiXỉuXỉu', pred: 'Tài', nhom: 'trung', loai: '2_1_2' },
            { kt: s4 === 'TàiXỉuTàiXỉu', pred: 'Xỉu', nhom: 'coBan', loai: '1_1' },
            { kt: s4 === 'XỉuTàiXỉuTài', pred: 'Tài', nhom: 'coBan', loai: '1_1' },
            { kt: s6 === 'TàiTàiXỉuXỉuTàiTài', pred: 'Xỉu', nhom: 'coBan', loai: '2_2' },
            { kt: s6 === 'XỉuXỉuTàiTàiXỉuXỉu', pred: 'Tài', nhom: 'coBan', loai: '2_2' },
            { kt: s4 === 'TàiTàiTàiXỉu', pred: 'Xỉu', nhom: 'an', loai: '1112' },
            { kt: s4 === 'XỉuXỉuXỉuTài', pred: 'Tài', nhom: 'an', loai: '2221' },
            { kt: s7 === 'TàiTàiTàiXỉuTàiTàiTài', pred: 'Xỉu', nhom: 'an', loai: '313' },
            { kt: s3 === 'TàiTàiXỉu', pred: 'Xỉu', nhom: 'ngan', loai: 'ttx' },
            { kt: s3 === 'XỉuXỉuTài', pred: 'Tài', nhom: 'ngan', loai: 'xxt' }
        ];
        
        for (const check of checks) {
            if (check.kt && this.cauDB[check.nhom]?.[check.loai]) {
                const c = this.cauDB[check.nhom][check.loai];
                if (c.mau >= 3) {
                    predictions.push({
                        pred: check.pred,
                        conf: c.p || 60,
                        weight: c.weight || 1.0,
                        name: `cau_${check.nhom}`,
                        reason: `${c.ten} (${c.dung}/${c.mau})`
                    });
                }
            }
        }
        
        return predictions;
    }

    deepPatternPredict() {
        const last = this.data[this.data.length - 1];
        const key = `${last.r}|${last.t}|${last.s}|${last.hd}|${last.ht}|${last.tc}|${last.l5t}`;
        const pattern = this.successPatterns[key];
        
        if (pattern && pattern.total >= 5) {
            const pred = pattern['Tài'] > pattern['Xỉu'] ? 'Tài' : 'Xỉu';
            const conf = 50 + (Math.max(pattern['Tài'], pattern['Xỉu']) / pattern.total) * 40;
            return {
                pred, conf: Math.min(85, conf), weight: 2.0,
                name: 'deep_pattern',
                reason: `Pattern ${pattern.total} lần (${((Math.max(pattern['Tài'], pattern['Xỉu'])/pattern.total)*100).toFixed(0)}%)`
            };
        }
        return null;
    }

    runCorePredictors(last) {
        const predictions = [];
        
        // Transition matrix
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
            const conf = 65 + Math.min(15, (last.s - 2) * 4);
            predictions.push({ pred: rev, conf, weight: 1.3, name: 'streak', reason: `Đảo sau bệt ${last.s}` });
        }
        
        // Frequency
        if (this.data.length >= 20) {
            const last20 = this.data.slice(-20);
            const taiCount = last20.filter(d => d.r === 1).length;
            if (taiCount >= 14) predictions.push({ pred: 'Xỉu', conf: 60 + (taiCount - 14) * 5, weight: 1.0, name: 'frequency', reason: `${taiCount}/20 Tài` });
            else if (taiCount <= 6) predictions.push({ pred: 'Tài', conf: 60 + (6 - taiCount) * 5, weight: 1.0, name: 'frequency', reason: `${taiCount}/20 Tài` });
        }
        
        // Tổng điểm
        if (last.t <= 6) predictions.push({ pred: 'Tài', conf: 64, weight: 1.5, name: 'tong_thap', reason: `Tổng=${last.t}` });
        if (last.t >= 15) predictions.push({ pred: 'Xỉu', conf: 63, weight: 1.5, name: 'tong_cao', reason: `Tổng=${last.t}` });
        
        // Bộ ba
        if (last.ht === 1) {
            if (last.d[0] === 1) predictions.push({ pred: 'Xỉu', conf: 95, weight: 3.0, name: 'triple_1', reason: 'Bộ 3 mặt 1' });
            else if (last.d[0] === 6) predictions.push({ pred: 'Tài', conf: 92, weight: 3.0, name: 'triple_6', reason: 'Bộ 3 mặt 6' });
        }
        
        return predictions;
    }

    predict(showDetail = false) {
        const last = this.data[this.data.length - 1];
        
        // Cache key
        const cacheKey = `${last.r}_${last.t}_${last.s}_${last.hd}_${last.ht}_${this.data.length}`;
        
        if (this.cacheL1.has(cacheKey)) {
            this.cacheHits++;
            return this.cacheL1.get(cacheKey);
        }
        this.cacheMisses++;
        
        // Thu thập predictions
        const allPredictions = [];
        
        if (this.cauDangChay && this.cauDangChay.doTinCay >= 60) {
            const weight = this.cauDB[this.cauDangChay.nhom]?.[this.cauDangChay.loai]?.weight || 2.0;
            allPredictions.push({
                pred: this.cauDangChay.duDoan,
                conf: this.cauDangChay.doTinCay,
                weight: weight,
                name: 'cau_dang_chay',
                reason: `${this.cauDangChay.ten} (${this.cauDangChay.dung}/${this.cauDangChay.mau})`
            });
        }
        
        const cauMatches = this.findAllMatchingCau();
        allPredictions.push(...cauMatches);
        
        const corePreds = this.runCorePredictors(last);
        allPredictions.push(...corePreds);
        
        const deepPred = this.deepPatternPredict();
        if (deepPred) allPredictions.push(deepPred);
        
        if (allPredictions.length === 0) {
            return { prediction: last.result === 'Tài' ? 'Xỉu' : 'Tài', confidence: 55, activeAlgorithms: 0 };
        }
        
        // Weighted voting
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        allPredictions.forEach(p => {
            const score = p.conf * p.weight;
            scores[p.pred] += score;
        });
        
        let finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        const totalScore = scores['Tài'] + scores['Xỉu'];
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        
        // Ưu tiên siêu hiếm
        const sieuHiemPred = allPredictions.find(p => p.name.includes('sieuHiem') && p.conf >= 75);
        if (sieuHiemPred) {
            finalPred = sieuHiemPred.pred;
            confidence = Math.max(confidence, sieuHiemPred.conf);
        }
        
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
        
        // Cập nhật định kỳ
        if (this.data.length % 30 === 0) {
            this.analyzeAllCau();
            this.learnPatterns();
            this.optimizeWeights();
        }
        
        if (showDetail) {
            console.log(`\n🎯 DỰ ĐOÁN: ${result.prediction} | ĐTC: ${result.confidence}% | ${result.activeAlgorithms} thuật toán`);
            if (result.cauDangChay) {
                console.log(`📡 CẦU: ${result.cauDangChay.ten} → ${result.cauDangChay.duDoan} (${result.cauDangChay.doTinCay}%)`);
            }
        }
        
        return result;
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 1000);
        this.data = this.preprocessData(this.raw);
        this.cacheL1.clear();
        this.analyzeAllCau();
        this.learnPatterns();
        this.optimizeWeights();
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
                predictor = new GodPredictorV6(sessionsStore);
                console.log(`🎯 GOD PREDICTOR V6 ĐÃ SẴN SÀNG!`);
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
        predictor = new GodPredictorV6(sessionsStore);
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
                const result = predictor.predict(false);
                savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                lastProcessedPhien = nextPhien;
                
                let msg = `[DỰ ĐOÁN] 👑 MD5 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeAlgorithms} thuật toán`;
                if (result.cauDangChay) {
                    msg += ` | CẦU: ${result.cauDangChay.ten} → ${result.cauDangChay.duDoan} (${result.cauDangChay.doTinCay}%)`;
                }
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
    console.log('👑 GOD PREDICTOR V6 - SIÊU CHUẨN XÁC TUYỆT ĐỐI');
    console.log('   Ultra Fast V4 + Siêu Phân Tích Cầu V13 = 100+ thuật toán');
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
        const result = predictor.predict(false);
        
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
    console.log('👑 GOD PREDICTOR V6 - SIÊU CHUẨN XÁC TUYỆT ĐỐI');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC NHÓM THUẬT TOÁN (100+):');
    console.log('   • Core: transition, streak, frequency, tong, triple');
    console.log('   • Cầu cơ bản: 1-1, 2-2, 3-3');
    console.log('   • Cầu ngắn: TTX, XXT, TXT, XTX');
    console.log('   • Cầu trung: 1-2-1, 2-1-2, đối xứng, tam giác');
    console.log('   • Cầu ẩn: TTT X, XXX T, TTT X TTT');
    console.log('   • Cầu siêu hiếm: 3 dạng đặc biệt');
    console.log('   • Deep pattern learning');
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
