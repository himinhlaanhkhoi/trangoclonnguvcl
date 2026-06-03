const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL = 'https://lovetrang-xinkgai.onrender.com/data';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';
const THANGTHUA_FILE = 'bang_thang_thua.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500;
const MAX_SESSIONS = 30;
const FETCH_INTERVAL = 5000;
const AUTO_SAVE_INTERVAL = 10000;

let bangThangThua = [];
let predictionHistory = [];
let lastProcessedPhien = null;
let sessionsStore = [];
let isReady = false;
let predictor = null;
let lastTrainCount = 0;

// ==================== GOD PREDICTOR V9 - KẾT HỢP V8 + V22 ====================

class GodPredictorV9 {
    constructor(data) {
        this.raw = data;
        this.data = this.preprocessData(data);
        
        // Cache đa tầng
        this.cacheL1 = new Map();
        this.cacheHits = 0;
        this.cacheTotal = 0;
        
        // Hệ thống học thích ứng
        this.learningRate = 0.01;
        this.patternDB = {};
        this.patternWeights = {};
        this.learnedPatterns = 0;
        
        // Hệ thống trọng số động
        this.algoWeights = this.initAlgoWeights();
        this.algoPerformance = {};
        this.weightDecay = 0.995;
        
        // ===== V8 CẦU DB (GIỮ NGUYÊN) =====
        this.cauDB_V8 = this.initCauDB_V8();
        this.cauStats_V8 = null;
        this.cauDangChay_V8 = null;
        
        // ===== V22 INTEGRATION =====
        this.betStats = {};        // Thống kê bệt 12 cấp
        this.faceStats = {};       // Thống kê xúc xắc 6 mặt
        this.cauDangChay_V22 = null;
        
        // Thống kê hiệu suất
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.consecutiveErrors = 0;
        this.fallbackMode = false;
        
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
            const sortedDice = [...dice].sort((a, b) => a - b);
            const sum = item.Tong;
            const hasDouble = (dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]) ? 1 : 0;
            const hasTriple = (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0;
            const doubleValue = hasDouble ? this.findDoubleValue(dice) : 0;
            const diceRange = sortedDice[2] - sortedDice[0];
            
            // === V22: Khoảng cách từng mặt ===
            const faceGaps = {};
            for (let f = 1; f <= 6; f++) {
                let lastIdx = -1;
                for (let j = i; j >= 0; j--) {
                    const prevDice = [data[j].Xuc_xac_1, data[j].Xuc_xac_2, data[j].Xuc_xac_3];
                    if (prevDice.includes(f)) { lastIdx = j; break; }
                }
                faceGaps[f] = lastIdx === -1 ? i + 1 : i - lastIdx;
            }
            
            // === V22: Streak từng mặt ===
            const faceStreaks = {};
            for (let f = 1; f <= 6; f++) {
                let s = 0;
                for (let j = i; j >= 0; j--) {
                    const prevDice = [data[j].Xuc_xac_1, data[j].Xuc_xac_2, data[j].Xuc_xac_3];
                    if (prevDice.includes(f)) s++; else break;
                }
                faceStreaks[f] = s;
            }
            
            const totalCategory = sum <= 5 ? -2 : sum <= 7 ? -1 : sum <= 10 ? 0 : sum <= 13 ? 1 : 2;
            const isEven = sum % 2 === 0 ? 1 : 0;
            
            let last3Tai = 0, last5Tai = 0, last10Tai = 0, last20Tai = 0;
            if (i >= 2) last3Tai = data.slice(i-2, i+1).filter(d => d.Ket_qua === "Tài").length;
            if (i >= 4) last5Tai = data.slice(i-4, i+1).filter(d => d.Ket_qua === "Tài").length;
            if (i >= 9) last10Tai = data.slice(i-9, i+1).filter(d => d.Ket_qua === "Tài").length;
            if (i >= 19) last20Tai = data.slice(i-19, i+1).filter(d => d.Ket_qua === "Tài").length;
            
            let entropy = 0;
            if (i >= 9) {
                const p = Math.max(0.001, Math.min(0.999, last10Tai / 10));
                entropy = -(p * Math.log2(p) + (1-p) * Math.log2(1-p));
            }
            
            let volatility = 0;
            if (i >= 4) {
                const totals = data.slice(i-4, i+1).map(d => d.Tong);
                const mean = totals.reduce((a, b) => a + b, 0) / 5;
                volatility = Math.sqrt(totals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 5);
            }
            
            processed.push({
                result: item.Ket_qua, r: resultBit, t: sum, s: streak,
                d: dice, sd: sortedDice, p: item.Phien,
                hd: hasDouble, ht: hasTriple, dv: doubleValue, dr: diceRange,
                tc: totalCategory, ie: isEven,
                l3t: last3Tai, l5t: last5Tai, l10t: last10Tai, l20t: last20Tai,
                ent: entropy, vol: volatility,
                faceGaps: faceGaps, faceStreaks: faceStreaks,
                smr: i > 0 ? (item.Ket_qua === data[i-1].Ket_qua ? 1 : 0) : 0
            });
        }
        
        return processed;
    }

    findDoubleValue(dice) {
        if (dice[0] === dice[1] || dice[0] === dice[2]) return dice[0];
        return dice[1];
    }

    initCauDB_V8() {
        return {
            coBan: {
                '1_1': { ten: '1-1 (T X T X)', mau: 0, dung: 0, doDai: 4, p: 0, w: 1.0 },
                '2_2': { ten: '2-2 (TT XX TT)', mau: 0, dung: 0, doDai: 6, p: 0, w: 1.0 },
                '3_3': { ten: '3-3 (TTT XXX)', mau: 0, dung: 0, doDai: 6, p: 0, w: 1.1 },
                '1_2': { ten: '1-2 (T XX)', mau: 0, dung: 0, doDai: 3, p: 0, w: 0.9 },
                '2_1': { ten: '2-1 (TT X)', mau: 0, dung: 0, doDai: 3, p: 0, w: 0.9 }
            },
            ngan: {
                'TX': { ten: 'TX', mau: 0, dung: 0, doDai: 2, p: 0, w: 0.6 },
                'XT': { ten: 'XT', mau: 0, dung: 0, doDai: 2, p: 0, w: 0.6 },
                'TTX': { ten: 'TTX', mau: 0, dung: 0, doDai: 3, p: 0, w: 0.7 },
                'XXT': { ten: 'XXT', mau: 0, dung: 0, doDai: 3, p: 0, w: 0.7 },
                'TXT': { ten: 'TXT', mau: 0, dung: 0, doDai: 3, p: 0, w: 0.8 },
                'XTX': { ten: 'XTX', mau: 0, dung: 0, doDai: 3, p: 0, w: 0.8 }
            },
            trung: {
                'TXXT': { ten: 'Đối xứng (T X X T)', mau: 0, dung: 0, doDai: 4, p: 0, w: 1.2 },
                'XTTX': { ten: 'Đối xứng (X T T X)', mau: 0, dung: 0, doDai: 4, p: 0, w: 1.2 },
                'TXTXT': { ten: 'Tam giác (T X T X T)', mau: 0, dung: 0, doDai: 5, p: 0, w: 1.3 },
                'XTXTX': { ten: 'Tam giác (X T X T X)', mau: 0, dung: 0, doDai: 5, p: 0, w: 1.3 },
                'TTXTT': { ten: '2-1-2 (TT X TT)', mau: 0, dung: 0, doDai: 5, p: 0, w: 1.1 },
                'XXTXX': { ten: '2-1-2 (XX T XX)', mau: 0, dung: 0, doDai: 5, p: 0, w: 1.1 }
            },
            an: {
                '1112': { ten: 'Ẩn: TTT X', mau: 0, dung: 0, doDai: 4, p: 0, w: 1.3 },
                '2221': { ten: 'Ẩn: XXX T', mau: 0, dung: 0, doDai: 4, p: 0, w: 1.3 },
                '313': { ten: 'Ẩn: TTT X TTT', mau: 0, dung: 0, doDai: 7, p: 0, w: 1.5 }
            },
            sieuHiem: {
                'sh1': { ten: 'SH1: TTXXXTT', mau: 0, dung: 0, doDai: 7, p: 0, w: 2.0 },
                'sh2': { ten: 'SH2: TXXTTXXT', mau: 0, dung: 0, doDai: 8, p: 0, w: 2.0 }
            },
            dacBiet: {
                'sauTriple': { ten: 'Sau bộ ba', mau: 0, dung: 0, doDai: 1, p: 0, w: 2.0 },
                'sauTong3': { ten: 'Sau tổng 3', mau: 0, dung: 0, doDai: 1, p: 0, w: 1.5 },
                'sauTong18': { ten: 'Sau tổng 18', mau: 0, dung: 0, doDai: 1, p: 0, w: 1.5 }
            },
            moPhong: {
                'tongTang': { ten: 'Tổng tăng', mau: 0, dung: 0, doDai: 5, p: 0, w: 0.9 },
                'tongGiam': { ten: 'Tổng giảm', mau: 0, dung: 0, doDai: 5, p: 0, w: 0.9 },
                'streakDai': { ten: 'Streak >=5', mau: 0, dung: 0, doDai: 5, p: 0, w: 1.2 }
            }
        };
    }

    initialize() {
        if (this.data.length >= 10) {
            this.analyzeCau_V8();
            this.analyzeBet_V22();
            this.analyzeXucXac_V22();
            this.deepLearn();
            this.optimizeWeights();
        }
    }

    analyzeCau_V8() {
        if (this.data.length < 30) return;
        
        for (let i = 25; i < this.data.length - 1; i++) {
            const sau = this.data[i+1].result;
            const truoc10 = this.data.slice(i-9, i+1).map(d => d.result);
            const s7 = truoc10.slice(-7).join('');
            const s6 = truoc10.slice(-6).join('');
            const s5 = truoc10.slice(-5).join('');
            const s4 = truoc10.slice(-4).join('');
            const s3 = truoc10.slice(-3).join('');
            
            if (s4 === 'TàiXỉuTàiXỉu') { this.incV8('coBan', '1_1'); if (sau === 'Xỉu') this.incDV8('coBan', '1_1'); }
            if (s4 === 'XỉuTàiXỉuTài') { this.incV8('coBan', '1_1'); if (sau === 'Tài') this.incDV8('coBan', '1_1'); }
            if (s6 === 'TàiTàiXỉuXỉuTàiTài') { this.incV8('coBan', '2_2'); if (sau === 'Xỉu') this.incDV8('coBan', '2_2'); }
            if (s6 === 'XỉuXỉuTàiTàiXỉuXỉu') { this.incV8('coBan', '2_2'); if (sau === 'Tài') this.incDV8('coBan', '2_2'); }
            if (s3 === 'TàiXỉu') { this.incV8('ngan', 'TX'); if (sau === 'Xỉu') this.incDV8('ngan', 'TX'); }
            if (s3 === 'XỉuTài') { this.incV8('ngan', 'XT'); if (sau === 'Tài') this.incDV8('ngan', 'XT'); }
            if (s4 === 'TàiXỉuXỉuTài') { this.incV8('trung', 'TXXT'); if (sau === 'Tài') this.incDV8('trung', 'TXXT'); }
            if (s4 === 'XỉuTàiTàiXỉu') { this.incV8('trung', 'XTTX'); if (sau === 'Xỉu') this.incDV8('trung', 'XTTX'); }
            if (s5 === 'TàiXỉuTàiXỉuTài') { this.incV8('trung', 'TXTXT'); if (sau === 'Xỉu') this.incDV8('trung', 'TXTXT'); }
            if (s5 === 'XỉuTàiXỉuTàiXỉu') { this.incV8('trung', 'XTXTX'); if (sau === 'Tài') this.incDV8('trung', 'XTXTX'); }
            if (s4 === 'TàiTàiTàiXỉu') { this.incV8('an', '1112'); if (sau === 'Xỉu') this.incDV8('an', '1112'); }
            if (s4 === 'XỉuXỉuXỉuTài') { this.incV8('an', '2221'); if (sau === 'Tài') this.incDV8('an', '2221'); }
            if (this.data[i].s >= 5) { this.incV8('moPhong', 'streakDai'); if (sau !== this.data[i].result) this.incDV8('moPhong', 'streakDai'); }
            if (this.data[i].ht === 1) { this.incV8('dacBiet', 'sauTriple'); if (sau === (this.data[i].d[0] <= 3 ? 'Tài' : 'Xỉu')) this.incDV8('dacBiet', 'sauTriple'); }
        }
        
        for (const nhom in this.cauDB_V8) {
            for (const loai in this.cauDB_V8[nhom]) {
                const c = this.cauDB_V8[nhom][loai];
                if (c.mau > 0) c.p = parseFloat((c.dung / c.mau * 100).toFixed(1));
                else c.p = 60;
            }
        }
        
        this.cauStats_V8 = this.cauDB_V8;
        this.cauDangChay_V8 = this.detectCurrentCau_V8();
    }

    incV8(nhom, loai) { if (this.cauDB_V8[nhom]?.[loai]) this.cauDB_V8[nhom][loai].mau++; }
    incDV8(nhom, loai) { if (this.cauDB_V8[nhom]?.[loai]) this.cauDB_V8[nhom][loai].dung++; }

    detectCurrentCau_V8() {
        if (this.data.length < 8) return null;
        
        const last8 = this.data.slice(-8).map(d => d.result);
        const s5 = last8.slice(-5).join('');
        const s4 = last8.slice(-4).join('');
        
        const checks = [
            { kt: s5 === 'TàiXỉuTàiXỉuTài', ten: 'Tam giác', pred: 'Xỉu', nhom: 'trung', loai: 'TXTXT' },
            { kt: s5 === 'XỉuTàiXỉuTàiXỉu', ten: 'Tam giác', pred: 'Tài', nhom: 'trung', loai: 'XTXTX' },
            { kt: s4 === 'TàiXỉuXỉuTài', ten: 'Đối xứng', pred: 'Tài', nhom: 'trung', loai: 'TXXT' },
            { kt: s4 === 'XỉuTàiTàiXỉu', ten: 'Đối xứng', pred: 'Xỉu', nhom: 'trung', loai: 'XTTX' },
            { kt: s4 === 'TàiXỉuTàiXỉu', ten: '1-1', pred: 'Xỉu', nhom: 'coBan', loai: '1_1' },
            { kt: s4 === 'XỉuTàiXỉuTài', ten: '1-1', pred: 'Tài', nhom: 'coBan', loai: '1_1' }
        ];
        
        for (const c of checks) {
            if (c.kt && this.cauDB_V8[c.nhom]?.[c.loai]) {
                const tyLe = this.cauDB_V8[c.nhom][c.loai].p || 65;
                return { ten: c.ten, duDoan: c.pred, doTinCay: tyLe, nhom: c.nhom, loai: c.loai, mau: this.cauDB_V8[c.nhom][c.loai].mau, dung: this.cauDB_V8[c.nhom][c.loai].dung, weight: this.cauDB_V8[c.nhom][c.loai].w };
            }
        }
        
        const last = this.data[this.data.length - 1];
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            return { ten: `Bệt ${last.s} phiên`, duDoan: rev, doTinCay: 65 + Math.min(15, (last.s - 2) * 4), nhom: 'moPhong', loai: 'streakDai', mau: 0, dung: 0, weight: 1.2 };
        }
        return null;
    }

    analyzeBet_V22() {
        this.betStats = {};
        for (let s = 2; s <= 12; s++) {
            this.betStats[`bet${s}`] = { tiep: 0, dao: 0, mau: 0 };
            this.betStats[`dao${s}`] = { dung: 0, mau: 0, p: 0 };
        }
        
        for (let i = 2; i < this.data.length - 1; i++) {
            const curStreak = this.data[i-1].s;
            const nextResult = this.data[i+1].result;
            const curResult = this.data[i-1].result;
            
            if (curStreak >= 2 && curStreak <= 12) {
                const key = `bet${curStreak}`;
                this.betStats[key].mau++;
                if (nextResult === curResult) this.betStats[key].tiep++;
                else this.betStats[key].dao++;
            }
        }
        
        for (let s = 2; s <= 12; s++) {
            const key = `dao${s}`;
            const total = this.betStats[`bet${s}`].dao;
            const totalMau = this.betStats[`bet${s}`].mau;
            if (totalMau > 5) {
                this.betStats[key].mau = totalMau;
                this.betStats[key].dung = total;
                this.betStats[key].p = parseFloat((total / totalMau * 100).toFixed(1));
            }
        }
    }

    phanTichBet_V22() {
        const last = this.data[this.data.length - 1];
        const curStreak = last.s;
        if (curStreak < 2) return null;
        
        const daoKey = `dao${curStreak}`;
        const tiepRate = curStreak <= 3 ? 0.65 : (curStreak <= 5 ? 0.55 : 0.45);
        const daoRate = (this.betStats[daoKey]?.p || 65) / 100;
        
        if (curStreak <= 3) {
            return { action: "theo", pred: last.result, conf: tiepRate * 100, type: "batBet", reason: `Bắt bệt ${curStreak} phiên` };
        }
        if (curStreak <= 5) {
            return { action: "theo", pred: last.result, conf: tiepRate * 100 * 0.9, type: "batBet", reason: `Bắt bệt ${curStreak} phiên (cảnh giác)` };
        }
        if (curStreak >= 6) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            return { action: "be", pred: rev, conf: daoRate * 100, type: "beBet", reason: `Bẻ bệt sau ${curStreak} phiên` };
        }
        return null;
    }

    analyzeXucXac_V22() {
        this.faceStats = {};
        for (let f = 1; f <= 6; f++) {
            this.faceStats[f] = { xuatHien: 0, taiSau: 0, xiuSau: 0 };
        }
        this.faceStats.boBa = { mau: 0, dung: 0, p: 0 };
        this.faceStats.capDoi = { mau: 0, dung: 0, p: 0 };
        
        for (let i = 1; i < this.data.length; i++) {
            const truoc = this.data[i-1];
            const sau = this.data[i];
            
            for (let f = 1; f <= 6; f++) {
                if (truoc.d.includes(f)) {
                    this.faceStats[f].xuatHien++;
                    if (sau.result === "Tài") this.faceStats[f].taiSau++;
                    else this.faceStats[f].xiuSau++;
                }
            }
            
            if (truoc.ht === 1) {
                this.faceStats.boBa.mau++;
                if (sau.result === (truoc.d[0] <= 3 ? "Tài" : "Xỉu")) this.faceStats.boBa.dung++;
            }
            
            if (truoc.hd === 1 && truoc.ht === 0) {
                this.faceStats.capDoi.mau++;
                const pairVal = truoc.dv;
                const pred = pairVal <= 2 ? "Xỉu" : (pairVal >= 5 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
                if (sau.result === pred) this.faceStats.capDoi.dung++;
            }
        }
        
        if (this.faceStats.boBa.mau > 0) this.faceStats.boBa.p = parseFloat((this.faceStats.boBa.dung / this.faceStats.boBa.mau * 100).toFixed(1));
        if (this.faceStats.capDoi.mau > 0) this.faceStats.capDoi.p = parseFloat((this.faceStats.capDoi.dung / this.faceStats.capDoi.mau * 100).toFixed(1));
    }

    duDoanXucXac_V22() {
        const last = this.data[this.data.length - 1];
        const predictions = [];
        
        if (last.ht === 1) {
            const pred = last.d[0] <= 3 ? "Tài" : "Xỉu";
            const conf = this.faceStats.boBa.p || 68.5;
            predictions.push({ pred, conf, weight: 2.5, name: 'bo_ba', reason: `Bộ ba ${last.d[0]} → ${pred}` });
        }
        
        if (last.hd === 1) {
            const pairVal = last.dv;
            if (pairVal <= 2 || pairVal >= 5) {
                const pred = pairVal <= 2 ? "Xỉu" : "Tài";
                predictions.push({ pred, conf: 65, weight: 1.5, name: 'cap_dac_biet', reason: `Cặp ${pairVal} → ${pred}` });
            }
        }
        
        for (let f = 1; f <= 6; f++) {
            if (last.faceGaps[f] >= 8) {
                const pred = f <= 3 ? "Tài" : "Xỉu";
                const conf = 68 + Math.min(10, (last.faceGaps[f] - 8) * 2);
                predictions.push({ pred, conf, weight: 1.3, name: 'mat_vang', reason: `Mặt ${f} vắng ${last.faceGaps[f]}p → ${pred}` });
                break;
            }
        }
        
        return predictions;
    }

    deepLearn() {
        const startIdx = Math.max(0, this.data.length - 300);
        for (let i = startIdx; i < this.data.length - 1; i++) {
            const d = this.data[i];
            const key = `${d.r}|${d.t}|${d.s}|${d.hd}|${d.ht}|${d.tc}|${d.dr}|${d.l3t}|${d.l5t}|${d.l10t}`;
            const nextResult = this.data[i + 1].result;
            
            if (!this.patternDB[key]) this.patternDB[key] = { 'Tài': 0, 'Xỉu': 0, total: 0 };
            this.patternDB[key][nextResult]++;
            this.patternDB[key].total++;
        }
        
        this.learnedPatterns = Object.keys(this.patternDB).length;
        for (const key in this.patternDB) {
            const p = this.patternDB[key];
            if (p.total >= 5) this.patternWeights[key] = Math.min(3.0, 0.5 + (Math.max(p['Tài'], p['Xỉu']) / p.total) * 3.0);
        }
    }

    initAlgoWeights() {
        return {
            cau_dang_chay_V8: 2.5, sieu_hiem: 2.0, trung: 1.3, co_ban: 1.0,
            ngan: 0.7, an: 1.6, dac_biet: 1.8, mo_phong: 0.9,
            bet_V22: 2.0, bo_ba: 2.5, cap_dac_biet: 1.5, mat_vang: 1.3,
            deep_pattern: 2.0, transition: 1.5, streak: 1.3,
            frequency: 1.0, tong_thap: 1.5, tong_cao: 1.5,
            triple: 2.0, adaptive_boost: 1.8
        };
    }

    optimizeWeights() {
        for (const nhom in this.cauDB_V8) {
            for (const loai in this.cauDB_V8[nhom]) {
                const c = this.cauDB_V8[nhom][loai];
                if (c.mau >= 10 && c.p >= 70) c.w = Math.min(3.0, 0.5 + (c.p / 100) * 3.5);
            }
        }
    }

    findAllMatchingCau_V8() {
        const predictions = [];
        const last10 = this.data.slice(-10).map(d => d.result);
        const s5 = last10.slice(-5).join('');
        const s4 = last10.slice(-4).join('');
        
        const checks = [
            { kt: s5 === 'TàiXỉuTàiXỉuTài', p: 'Xỉu', n: 'trung', l: 'TXTXT' },
            { kt: s5 === 'XỉuTàiXỉuTàiXỉu', p: 'Tài', n: 'trung', l: 'XTXTX' },
            { kt: s4 === 'TàiXỉuXỉuTài', p: 'Tài', n: 'trung', l: 'TXXT' },
            { kt: s4 === 'XỉuTàiTàiXỉu', p: 'Xỉu', n: 'trung', l: 'XTTX' },
            { kt: s4 === 'TàiXỉuTàiXỉu', p: 'Xỉu', n: 'coBan', l: '1_1' },
            { kt: s4 === 'XỉuTàiXỉuTài', p: 'Tài', n: 'coBan', l: '1_1' }
        ];
        
        for (const check of checks) {
            if (check.kt && this.cauDB_V8[check.n]?.[check.l]) {
                const c = this.cauDB_V8[check.n][check.l];
                if (c.mau >= 3) predictions.push({ pred: check.p, conf: c.p || 60, weight: c.w || 1.0, name: `cau_${check.n}`, reason: `${c.ten} (${c.dung}/${c.mau})` });
            }
        }
        return predictions;
    }

    deepPatternPredict() {
        const last = this.data[this.data.length - 1];
        const key = `${last.r}|${last.t}|${last.s}|${last.hd}|${last.ht}|${last.tc}|${last.dr}|${last.l3t}|${last.l5t}|${last.l10t}`;
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
        
        const matrix = { 0: { 0: 0, 1: 0 }, 1: { 0: 0, 1: 0 } };
        for (let i = 0; i < this.data.length - 1; i++) matrix[this.data[i].r][this.data[i+1].r]++;
        const total = matrix[last.r][0] + matrix[last.r][1];
        if (total > 0) {
            const probTai = matrix[last.r][1] / total;
            if (probTai > 0.65) predictions.push({ pred: 'Tài', conf: probTai * 100, weight: 1.5, name: 'transition', reason: `P(T)=${(probTai*100).toFixed(0)}%` });
            else if (probTai < 0.35) predictions.push({ pred: 'Xỉu', conf: (1 - probTai) * 100, weight: 1.5, name: 'transition', reason: `P(T)=${(probTai*100).toFixed(0)}%` });
        }
        
        if (last.s >= 3) predictions.push({ pred: last.result === 'Tài' ? 'Xỉu' : 'Tài', conf: 65 + Math.min(15, (last.s - 2) * 4), weight: 1.3, name: 'streak', reason: `Đảo sau bệt ${last.s}` });
        
        return predictions;
    }

    runSpecialPredictors(last) {
        const predictions = [];
        if (last.t <= 6) predictions.push({ pred: 'Tài', conf: 64, weight: 1.5, name: 'tong_thap', reason: `Tổng=${last.t}` });
        if (last.t >= 15) predictions.push({ pred: 'Xỉu', conf: 63, weight: 1.5, name: 'tong_cao', reason: `Tổng=${last.t}` });
        if (last.ht === 1) {
            if (last.d[0] === 1) predictions.push({ pred: 'Xỉu', conf: 95, weight: 3.0, name: 'triple', reason: 'Bộ 3 mặt 1' });
            else if (last.d[0] === 6) predictions.push({ pred: 'Tài', conf: 92, weight: 3.0, name: 'triple', reason: 'Bộ 3 mặt 6' });
        }
        return predictions;
    }

    adaptiveBoost(allPredictions) {
        const highAccPreds = allPredictions.filter(p => p && p.conf >= 75);
        if (highAccPreds.length >= 3) {
            const votes = { 'Tài': 0, 'Xỉu': 0 };
            highAccPreds.forEach(p => votes[p.pred] += p.conf * p.weight);
            return { pred: votes['Tài'] > votes['Xỉu'] ? 'Tài' : 'Xỉu', conf: Math.min(90, 60 + highAccPreds.length * 5), weight: 1.8, name: 'adaptive_boost', reason: `${highAccPreds.length} tín hiệu ĐTC cao` };
        }
        return null;
    }

    predict(showDetail = false) {
        const last = this.data[this.data.length - 1];
        const cacheKey = `${last.r}_${last.t}_${last.s}_${last.hd}_${last.ht}_${last.dr}_${this.data.length}`;
        
        this.cacheTotal++;
        if (this.cacheL1.has(cacheKey)) {
            this.cacheHits++;
            return this.cacheL1.get(cacheKey);
        }
        
        const allPredictions = [];
        
        if (this.cauDangChay_V8 && this.cauDangChay_V8.doTinCay >= 60) {
            allPredictions.push({ pred: this.cauDangChay_V8.duDoan, conf: this.cauDangChay_V8.doTinCay, weight: (this.cauDangChay_V8.weight || 1.0) * 2.5, name: 'cau_dang_chay_V8', reason: `${this.cauDangChay_V8.ten} (${this.cauDangChay_V8.dung}/${this.cauDangChay_V8.mau})` });
        }
        
        allPredictions.push(...this.findAllMatchingCau_V8());
        
        const betResult = this.phanTichBet_V22();
        if (betResult) allPredictions.push({ pred: betResult.pred, conf: betResult.conf, weight: 2.0, name: 'bet_V22', reason: betResult.reason });
        
        const xucXacPreds = this.duDoanXucXac_V22();
        allPredictions.push(...xucXacPreds);
        
        const deepPred = this.deepPatternPredict();
        if (deepPred) allPredictions.push(deepPred);
        
        allPredictions.push(...this.runCorePredictors(last));
        allPredictions.push(...this.runSpecialPredictors(last));
        
        const boostPred = this.adaptiveBoost(allPredictions);
        if (boostPred) allPredictions.push(boostPred);
        
        if (allPredictions.length === 0) {
            return { prediction: last.result === 'Tài' ? 'Xỉu' : 'Tài', confidence: 55, activeAlgorithms: 0 };
        }
        
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        allPredictions.forEach(p => { scores[p.pred] += p.conf * p.weight; });
        
        let finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        const totalScore = scores['Tài'] + scores['Xỉu'];
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        
        const superRare = allPredictions.find(p => (p.name.includes('sieuHiem') || p.name.includes('bo_ba')) && p.conf >= 75);
        if (superRare) { finalPred = superRare.pred; confidence = Math.max(confidence, superRare.conf); }
        
        confidence = Math.min(97, Math.round(confidence));
        const result = { prediction: finalPred, confidence: confidence, activeAlgorithms: allPredictions.length, cauDangChay_V8: this.cauDangChay_V8 };
        
        this.cacheL1.set(cacheKey, result);
        if (this.cacheL1.size > 500) { const firstKey = this.cacheL1.keys().next().value; this.cacheL1.delete(firstKey); }
        
        if (this.data.length % 30 === 0) {
            this.analyzeCau_V8();
            this.analyzeBet_V22();
            this.analyzeXucXac_V22();
            this.deepLearn();
            this.optimizeWeights();
        }
        
        if (showDetail) console.log(`🎯 DỰ ĐOÁN: ${result.prediction} | ĐTC: ${result.confidence}% | ${result.activeAlgorithms} thuật toán`);
        return result;
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 1000);
        this.data = this.preprocessData(this.raw);
        this.cacheL1.clear();
        this.analyzeCau_V8();
        this.analyzeBet_V22();
        this.analyzeXucXac_V22();
        this.deepLearn();
        this.optimizeWeights();
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadBangThangThua() {
    try {
        if (fs.existsSync(THANGTHUA_FILE)) {
            bangThangThua = JSON.parse(fs.readFileSync(THANGTHUA_FILE, 'utf8'));
            console.log(`✅ Đã tải bảng thắng thua: ${bangThangThua.length} phiên`);
        }
    } catch (error) { console.error('❌ Lỗi load thắng thua:', error.message); }
}

function saveBangThangThua() {
    try {
        if (bangThangThua.length > MAX_HISTORY) bangThangThua = bangThangThua.slice(0, MAX_HISTORY);
        fs.writeFileSync(THANGTHUA_FILE, JSON.stringify(bangThangThua, null, 2));
    } catch (error) { console.error('❌ Lỗi save thắng thua:', error.message); }
}

function loadAllData() {
    loadBangThangThua();
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            sessionsStore = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            console.log(`✅ Đã tải sessions: ${sessionsStore.length} phiên`);
        }
    } catch (error) { console.error('❌ Lỗi load sessions:', error.message); }
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            predictionHistory = parsed.predictionHistory || [];
            lastProcessedPhien = parsed.lastProcessedPhien || null;
            console.log(`✅ Đã tải lịch sử dự đoán: ${predictionHistory.length} phiên`);
        }
    } catch (error) { console.error('❌ Lỗi load dự đoán:', error.message); }
}

function saveAllData() {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsStore, null, 2)); } catch (error) {}
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify({ predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString() }, null, 2)); } catch (error) {}
}

// ==================== API DATA FETCHING ====================

async function fetchData() {
    try {
        console.log('🔄 Đang fetch dữ liệu từ API...');
        const response = await axios.get(API_URL, { 
            timeout: 15000,
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        
        if (response.data && response.data.data && Array.isArray(response.data.data)) {
            const rawData = response.data.data;
            console.log(`📥 Nhận được ${rawData.length} phiên từ API`);
            
            const converted = rawData.map(item => ({
                Phien: item.phien,
                Ket_qua: item.ket_qua,
                Xuc_xac_1: item.xuc_xac_1,
                Xuc_xac_2: item.xuc_xac_2,
                Xuc_xac_3: item.xuc_xac_3,
                Tong: item.tong,
                Thoi_gian: item.thoi_gian,
                Timestamp: item.timestamp
            }));
            
            converted.sort((a, b) => b.Phien - a.Phien);
            console.log(`✅ Chuyển đổi thành công, mới nhất: ${converted[0]?.Phien}`);
            return converted;
        }
        return null;
    } catch (error) {
        console.error('❌ Fetch error:', error.message);
        return null;
    }
}

function updateSessions(newData) {
    if (!newData?.length) return 0;
    
    const latestSessions = newData.slice(0, MAX_SESSIONS);
    let addedCount = 0;
    const existingPhien = new Set(sessionsStore.map(s => s.Phien));
    
    for (const s of latestSessions) {
        if (!existingPhien.has(s.Phien)) {
            sessionsStore.push(s);
            addedCount++;
        }
    }
    
    sessionsStore.sort((a, b) => b.Phien - a.Phien);
    if (sessionsStore.length > MAX_SESSIONS) sessionsStore = sessionsStore.slice(0, MAX_SESSIONS);
    return addedCount;
}

async function fetchAndUpdate() {
    const data = await fetchData();
    if (!data || data.length === 0) return false;
    
    const addedCount = updateSessions(data);
    if (addedCount > 0) {
        console.log(`📥 Thêm ${addedCount} phiên mới, tổng: ${sessionsStore.length}/${MAX_SESSIONS} phiên`);
        saveAllData();
        
        if (sessionsStore.length >= MAX_SESSIONS && sessionsStore.length !== lastTrainCount) {
            lastTrainCount = sessionsStore.length;
            console.log(`🔄 Đủ ${MAX_SESSIONS} phiên, huấn luyện lại model...`);
            if (predictor) predictor.updateWithNewData(sessionsStore);
            else predictor = new GodPredictorV9(sessionsStore);
            isReady = true;
            console.log(`✅ Model đã được huấn luyện lại với ${sessionsStore.length} phiên`);
        }
    }
    return true;
}

function verifyAndRecord() {
    if (!predictor) return;
    let updated = false;
    for (let i = 0; i < predictionHistory.length; i++) {
        const record = predictionHistory[i];
        if (record.da_kiem_tra) continue;
        const actualResult = sessionsStore.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            const duDoanChuan = record.du_doan === 'tài' ? 'tài' : 'xỉu';
            const ketQuaChuan = actualResult.Ket_qua.toLowerCase();
            const isCorrect = duDoanChuan === ketQuaChuan;
            record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            
            const existingIndex = bangThangThua.findIndex(item => item.phien === record.phien_du_doan);
            const thangThuaRecord = { phien: parseInt(record.phien_du_doan), du_doan: duDoanChuan, ket_qua: ketQuaChuan, danh_gia: isCorrect ? 'thắng' : 'thua', do_tin_cay: record.do_tin_cay, timestamp: record.timestamp || new Date().toISOString() };
            if (existingIndex !== -1) bangThangThua[existingIndex] = thangThuaRecord;
            else bangThangThua.unshift(thangThuaRecord);
            updated = true;
        }
    }
    if (bangThangThua.length > MAX_HISTORY) bangThangThua = bangThangThua.slice(0, MAX_HISTORY);
    if (predictionHistory.length > MAX_HISTORY) predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    if (updated) { saveBangThangThua(); saveAllData(); }
}

function tinhThongKeThangThua() {
    const thang = bangThangThua.filter(item => item.danh_gia === 'thắng').length;
    const thua = bangThangThua.filter(item => item.danh_gia === 'thua').length;
    const tong = thang + thua;
    return { thang, thua, tong, ty_le_thang: tong > 0 ? (thang / tong * 100).toFixed(1) : 0 };
}

function savePredictionToHistory(phienTruocDo, phienHienTai, prediction, confidence, latestData) {
    const existingIndex = predictionHistory.findIndex(r => r.phien_du_doan === phienHienTai.toString());
    const record = { 
        phien_truoc_do: phienTruocDo.toString(), 
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3], 
        tong: latestData.Tong, 
        ket_qua_hien_tai: latestData.Ket_qua, 
        phien_hien_tai: phienHienTai.toString(), 
        phien_du_doan: phienHienTai.toString(), 
        du_doan: prediction.toLowerCase(), 
        do_tin_cay: `${confidence}%`, 
        ket_qua_du_doan: '', 
        ket_qua_thuc_te: '', 
        da_kiem_tra: false, 
        id: 'love trang', 
        timestamp: new Date().toISOString() 
    };
    if (existingIndex !== -1) predictionHistory[existingIndex] = record;
    else predictionHistory.unshift(record);
    if (predictionHistory.length > MAX_HISTORY) predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    return record;
}

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU TỪ API...');
    console.log(`📋 Fetch mỗi ${FETCH_INTERVAL/1000} giây - Giữ ${MAX_SESSIONS} phiên gần nhất`);
    console.log('═══════════════════════════════════════════════════');
    
    await fetchAndUpdate();
    while (true) {
        await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
        await fetchAndUpdate();
    }
}

async function autoProcess() {
    if (!isReady || !predictor) return;
    try {
        await fetchAndUpdate();
        verifyAndRecord();
        
        if (sessionsStore.length >= 3 && predictor) {
            const latestPhien = sessionsStore[0].Phien;
            const nextPhien = latestPhien + 1;
            if (lastProcessedPhien !== nextPhien) {
                const result = predictor.predict(false);
                savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, sessionsStore[0]);
                lastProcessedPhien = nextPhien;
                const thongKe = tinhThongKeThangThua();
                console.log(`[DỰ ĐOÁN] 👑 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - 📊 TL: ${thongKe.ty_le_thang}% (${thongKe.thang}/${thongKe.tong})`);
                saveAllData();
            }
        }
    } catch (error) { console.error('[Auto] ❌ Error:', error.message); }
}

async function startup() {
    loadAllData();
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('👑 GOD PREDICTOR V9 - KẾT HỢP V8 + V22');
    console.log('   V8 (130+ cầu) + V22 (Bệt 12 cấp + Xúc xắc 6 mặt) = 350+ thuật toán');
    console.log(`📋 Lấy ${MAX_SESSIONS} phiên gần nhất - Lưu thắng thua ${MAX_HISTORY} phiên`);
    console.log('═══════════════════════════════════════════════════');
    
    fetchLoop();
    setTimeout(() => { setInterval(autoProcess, AUTO_SAVE_INTERVAL); }, 5000);
}

app.get('/', (req, res) => { 
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); 
    res.send('Tài Xỉu Predictor V9 - love trang'); 
});

app.get('/predict', async (req, res) => {
    try {
        if (sessionsStore.length === 0) await fetchAndUpdate();
        
        if (!isReady || !predictor || sessionsStore.length < 3) {
            return res.json({ status: 'loading', message: `Đang tải... ${sessionsStore.length}/${MAX_SESSIONS} phiên`, sessions: sessionsStore.length });
        }
        
        await fetchAndUpdate();
        verifyAndRecord();
        
        if (sessionsStore.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = sessionsStore[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictor.predict(false);
        const thongKe = tinhThongKeThangThua();
        const record = savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, sessionsStore[0]);
        
        res.json({
            phien_hien_tai: record.phien_truoc_do,
            phien_du_doan: record.phien_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            thong_ke: { tong_phien: thongKe.tong, thang: thongKe.thang, thua: thongKe.thua, ty_le_thang: `${thongKe.ty_le_thang}%` },
            bang_thang_thua: bangThangThua.slice(0, 30),
            id: record.id
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Lỗi server', detail: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 GOD PREDICTOR V9 - SIÊU CHUẨN XÁC KẾT HỢP V22');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 TỔNG: 350+ THUẬT TOÁN');
    console.log('   • V8: 130+ cầu (cơ bản, ngắn, trung, ẩn, đặc biệt)');
    console.log('   • V22: Bệt 12 cấp độ (bắt bệt + bẻ bệt)');
    console.log('   • V22: Xúc xắc 6 mặt (gap, streak, bộ ba, cặp đôi)');
    console.log('   • Core + Special + Deep Pattern');
    console.log('');
    console.log('📊 ENDPOINT: GET /predict');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
