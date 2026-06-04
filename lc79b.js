const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let predictor = null;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const getPhien = item => item.Phien ?? item.phien ?? 0;
const getKetQua = item => (item.Ket_qua ?? item.ket_qua ?? '').toLowerCase();
const getTong = item => item.Tong ?? item.tong ?? 0;
const getX1 = item => item.Xuc_xac_1 ?? item.xuc_xac_1 ?? 0;
const getX2 = item => item.Xuc_xac_2 ?? item.xuc_xac_2 ?? 0;
const getX3 = item => item.Xuc_xac_3 ?? item.xuc_xac_3 ?? 0;

const normalize = item => ({
    ket_qua: getKetQua(item),
    tong: getTong(item),
    xuc_xac_1: getX1(item),
    xuc_xac_2: getX2(item),
    xuc_xac_3: getX3(item),
    phien: getPhien(item),
});

// ============ LOAD/SAVE HISTORY ============
function loadHistory() {
    try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); }
    catch (e) { verifiedResults = []; }
}
function saveHistory() {
    try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); }
    catch (e) {}
}
function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const isCorrect = duDoan === ketQua;
    verifiedResults.unshift({ phien, du_doan: duDoan, ket_qua: ketQua, danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay, timestamp: new Date().toISOString() });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const std = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(x => Math.pow(x - m, 2)))); };
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ============================================================
// HE THONG DU DOAN TAI XIU - PHIEN BAN 14.0
// 50+ Mẫu Cầu | Thuật Toán Dài Hạn | Fix All Lỗi
// ============================================================

class DuDoanTaiXiu {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.prevVan = this.processed.length >= 2 ? this.processed[this.processed.length - 2] : {};
        this.trongSo = { cap1: 2.0, cap2: 1.6, cauCB: 1.0, cauNC: 1.3, phuTro: 1.2, thongKe: 1.1, daiHan: 1.4 };
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            const kq = item.ket_qua;
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            return {
                phien: item.phien, result: r, resultStr: kq, total: item.tong,
                x1: item.xuc_xac_1, x2: item.xuc_xac_2, x3: item.xuc_xac_3,
                dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                isPair: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2]),
                coBa: (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0,
                soLan1: dice.filter(x => x === 1).length,
                soLan2: dice.filter(x => x === 2).length,
                soLan3: dice.filter(x => x === 3).length,
                soLan4: dice.filter(x => x === 4).length,
                soLan5: dice.filter(x => x === 5).length,
                soLan6: dice.filter(x => x === 6).length,
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    // ==================== QUY LUẬT CẤP 1 (95-100%) ====================
    bao_1() { if (this.lastVan.coBa && this.lastVan.tripleVal === 1) return { pred: "xỉu", conf: 100 }; return null; }
    bao_6() { if (this.lastVan.coBa && this.lastVan.tripleVal === 6) return { pred: "tài", conf: 100 }; return null; }
    tong_3() { if (this.lastVan.total === 3) return { pred: "xỉu", conf: 100 }; return null; }
    tong_18() { if (this.lastVan.total === 18) return { pred: "tài", conf: 100 }; return null; }
    tong_4() { if (this.lastVan.total === 4) return { pred: "xỉu", conf: 98 }; return null; }
    tong_17() { if (this.lastVan.total === 17) return { pred: "tài", conf: 97 }; return null; }
    tong_5() { if (this.lastVan.total === 5) return { pred: "xỉu", conf: 96 }; return null; }
    tong_16() { if (this.lastVan.total === 16) return { pred: "tài", conf: 94 }; return null; }
    hai_mat_1() { if (this.lastVan.soLan1 >= 2) return { pred: "xỉu", conf: 94 }; return null; }
    hai_mat_6() { if (this.lastVan.soLan6 >= 2) return { pred: "tài", conf: 93 }; return null; }
    ba_mat_le() { if (this.lastVan.soLan1 + this.lastVan.soLan3 + this.lastVan.soLan5 === 3) return { pred: "xỉu", conf: 91 }; return null; }
    ba_mat_chan() { if (this.lastVan.soLan2 + this.lastVan.soLan4 + this.lastVan.soLan6 === 3) return { pred: "tài", conf: 92 }; return null; }

    // ==================== QUY LUẬT CẤP 2 (85-94%) ====================
    bet_tai_5() { if (this.kqSeq.length >= 5 && this.kqSeq.slice(-5).every(x => x === 1)) return { pred: "xỉu", conf: 92 }; return null; }
    bet_xiu_5() { if (this.kqSeq.length >= 5 && this.kqSeq.slice(-5).every(x => x === 0)) return { pred: "tài", conf: 92 }; return null; }
    bet_tai_6() { if (this.kqSeq.length >= 6 && this.kqSeq.slice(-6).every(x => x === 1)) return { pred: "xỉu", conf: 94 }; return null; }
    bet_xiu_6() { if (this.kqSeq.length >= 6 && this.kqSeq.slice(-6).every(x => x === 0)) return { pred: "tài", conf: 94 }; return null; }
    sau_bao_1() { if (this.prevVan.coBa && this.prevVan.tripleVal === 1) return { pred: "xỉu", conf: 94 }; return null; }
    sau_bao_6() { if (this.prevVan.coBa && this.prevVan.tripleVal === 6) return { pred: "tài", conf: 93 }; return null; }
    mat_1_va_2() { if (this.lastVan.soLan1 >= 1 && this.lastVan.soLan2 >= 1) return { pred: "xỉu", conf: 85 }; return null; }
    mat_5_va_6() { if (this.lastVan.soLan5 >= 1 && this.lastVan.soLan6 >= 1) return { pred: "tài", conf: 84 }; return null; }

    // ==================== MẪU CẦU CƠ BẢN ====================
    cau_1_1() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0) return {pred:"tài",conf:72}; if (l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1) return {pred:"xỉu",conf:72}; return null; }
    cau_2_2() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0) return {pred:"tài",conf:68}; if (l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1) return {pred:"xỉu",conf:68}; return null; }
    cau_3_3() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0) return {pred:"tài",conf:70}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1) return {pred:"xỉu",conf:70}; return null; }
    cau_4_4() { if (this.kqSeq.length < 8) return null; const l = this.kqSeq.slice(-8); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0&&l[6]===0&&l[7]===0) return {pred:"tài",conf:75}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1&&l[6]===1&&l[7]===1) return {pred:"xỉu",conf:75}; return null; }
    cau_1_2_1() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1) return {pred:"tài",conf:70}; if (l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0) return {pred:"xỉu",conf:70}; return null; }
    cau_2_1_2() { if (this.kqSeq.length < 5) return null; const l = this.kqSeq.slice(-5); if (l[0]===1&&l[1]===1&&l[2]===0&&l[3]===1&&l[4]===1) return {pred:"xỉu",conf:70}; if (l[0]===0&&l[1]===0&&l[2]===1&&l[3]===0&&l[4]===0) return {pred:"tài",conf:70}; return null; }
    cau_doi_xung_4() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1) return {pred:"tài",conf:72}; if (l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0) return {pred:"xỉu",conf:72}; return null; }
    cau_doi_xung_6() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1) return {pred:"tài",conf:74}; if (l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0) return {pred:"xỉu",conf:74}; return null; }
    cau_dot_bien_5() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===1&&l[4]===1&&l[5]===0) return {pred:"xỉu",conf:85}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===0&&l[4]===0&&l[5]===1) return {pred:"tài",conf:85}; return null; }
    cau_zigzag_5() { if (this.kqSeq.length < 9) return null; const l = this.kqSeq.slice(-9); for (let i=1;i<9;i++) if(l[i]===l[i-1]) return null; return {pred:l[8]===1?"xỉu":"tài",conf:75}; }
    cau_nguoc_chieu() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===1&&l[2]===1) return {pred:"xỉu",conf:75}; if (l[0]===0&&l[1]===0&&l[2]===0) return {pred:"tài",conf:75}; return null; }
    cau_vong_lap_3() { if (this.kqSeq.length < 6) return null; const a=this.kqSeq.slice(-3),b=this.kqSeq.slice(-6,-3); if(JSON.stringify(a)===JSON.stringify(b)) return {pred:a[2]===1?"tài":"xỉu",conf:72}; return null; }
    cau_vong_lap_4() { if (this.kqSeq.length < 8) return null; const a=this.kqSeq.slice(-4),b=this.kqSeq.slice(-8,-4); if(JSON.stringify(a)===JSON.stringify(b)) return {pred:a[3]===1?"tài":"xỉu",conf:74}; return null; }
    cau_thang_tang() { let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===1;i--) s++; if(s>=4) return {pred:"xỉu",conf:Math.min(85,70+s)}; return null; }
    cau_thang_giam() { let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===0;i--) s++; if(s>=4) return {pred:"tài",conf:Math.min(85,70+s)}; return null; }

    // ==================== THUẬT TOÁN PHỤ TRỢ ====================
    markov_bac_2() { if (this.kqSeq.length < 10) return null; const trans = {}; for (let i = 2; i < this.kqSeq.length - 1; i++) { const k = `${this.kqSeq[i-2]},${this.kqSeq[i-1]}`; if (!trans[k]) trans[k] = { 0: 0, 1: 0 }; trans[k][this.kqSeq[i]]++; } const lk = `${this.kqSeq[this.kqSeq.length-2]},${this.kqSeq[this.kqSeq.length-1]}`; if (trans[lk]) { const t = trans[lk][0] + trans[lk][1]; if (t >= 3) return trans[lk][1] > trans[lk][0] ? { pred: "tài", conf: 50 + (trans[lk][1] / t) * 35 } : { pred: "xỉu", conf: 50 + (trans[lk][0] / t) * 35 }; } return null; }
    markov_bac_3() { if (this.kqSeq.length < 15) return null; const trans = {}; for (let i = 3; i < this.kqSeq.length - 1; i++) { const k = `${this.kqSeq[i-3]},${this.kqSeq[i-2]},${this.kqSeq[i-1]}`; if (!trans[k]) trans[k] = { 0: 0, 1: 0 }; trans[k][this.kqSeq[i]]++; } const lk = `${this.kqSeq[this.kqSeq.length-3]},${this.kqSeq[this.kqSeq.length-2]},${this.kqSeq[this.kqSeq.length-1]}`; if (trans[lk]) { const t = trans[lk][0] + trans[lk][1]; if (t >= 2) return trans[lk][1] > trans[lk][0] ? { pred: "tài", conf: 50 + (trans[lk][1] / t) * 40 } : { pred: "xỉu", conf: 50 + (trans[lk][0] / t) * 40 }; } return null; }
    knn_simple(k = 5) { if (this.kqSeq.length < 30) return null; const l5 = this.kqSeq.slice(-5); const matches = []; for (let i = 0; i < this.kqSeq.length - 6; i++) { const w = this.kqSeq.slice(i, i + 5); let sim = 0; for (let j = 0; j < 5; j++) if (w[j] === l5[j]) sim++; matches.push({ sim, idx: i }); } matches.sort((a, b) => b.sim - a.sim); const top = matches.slice(0, k); const preds = top.map(m => this.kqSeq[m.idx + 5]).filter(p => p !== undefined); if (preds.length > 0) { const pred = sum(preds) > preds.length / 2 ? 1 : 0; return { pred: pred === 1 ? "tài" : "xỉu", conf: 50 + Math.abs(sum(preds) - preds.length / 2) / preds.length * 30 }; } return null; }
    rsi_signal() { if (this.kqSeq.length < 20) return null; const changes = []; for (let i = this.kqSeq.length - 19; i < this.kqSeq.length; i++) changes.push(this.kqSeq[i] - this.kqSeq[i - 1]); const gains = changes.filter(c => c > 0), losses = changes.filter(c => c < 0).map(c => -c); const avgG = avg(gains) || 0, avgL = avg(losses) || 1e-10; const rs = avgG / avgL; const rsi = 100 - (100 / (1 + rs)); if (rsi > 70) return { pred: "xỉu", conf: 70 }; if (rsi < 30) return { pred: "tài", conf: 70 }; return null; }
    monte_carlo(nSim = 500) { if (this.kqSeq.length < 30) return null; const trans = { 0: { 0: 0, 1: 0 }, 1: { 0: 0, 1: 0 } }; for (let i = 1; i < this.kqSeq.length; i++) trans[this.kqSeq[i - 1]][this.kqSeq[i]]++; for (const s of [0, 1]) { const t = trans[s][0] + trans[s][1]; if (t > 0) { trans[s][0] /= t; trans[s][1] /= t; } } let taiCount = 0; for (let sim = 0; sim < nSim; sim++) { let cur = this.kqSeq[this.kqSeq.length - 1]; for (let step = 0; step < 3; step++) cur = Math.random() < trans[cur][0] ? 0 : 1; if (cur === 1) taiCount++; } const pTai = taiCount / nSim; if (pTai > 0.6) return { pred: "xỉu", conf: 55 + pTai * 25 }; if (pTai < 0.4) return { pred: "tài", conf: 55 + (1 - pTai) * 25 }; return null; }

    // ==================== THỐNG KÊ ====================
    ty_le_tai_cao() { if (this.kqSeq.length < 20) return null; const tl = sum(this.kqSeq.slice(-20)) / 20; if (tl > 0.7) return { pred: "xỉu", conf: 70 }; if (tl < 0.3) return { pred: "tài", conf: 70 }; return null; }
    ty_le_tai_cuc_cao() { if (this.kqSeq.length < 30) return null; const tl = sum(this.kqSeq.slice(-30)) / 30; if (tl > 0.8) return { pred: "xỉu", conf: 75 }; if (tl < 0.2) return { pred: "tài", conf: 75 }; return null; }
    can_bang_15() { if (this.kqSeq.length < 15) return null; const tai = sum(this.kqSeq.slice(-15)), xiu = 15 - tai; if (tai >= 11) return { pred: "xỉu", conf: 85 }; if (xiu >= 11) return { pred: "tài", conf: 85 }; return null; }
    can_bang_30() { if (this.kqSeq.length < 30) return null; const tai = sum(this.kqSeq.slice(-30)); if (tai >= 18) return { pred: "xỉu", conf: 80 }; if (tai <= 12) return { pred: "tài", conf: 80 }; return null; }
    can_bang_50() { if (this.kqSeq.length < 50) return null; const tai = sum(this.kqSeq.slice(-50)); if (tai >= 30) return { pred: "xỉu", conf: 85 }; if (tai <= 20) return { pred: "tài", conf: 85 }; return null; }
    trung_binh_tong() { if (this.tongSeq.length < 20) return null; const m = avg(this.tongSeq.slice(-20)); const last = this.tongSeq[this.tongSeq.length - 1]; if (last > m + 2) return { pred: "xỉu", conf: 64 }; if (last < m - 2) return { pred: "tài", conf: 64 }; return null; }

    // ==================== THUẬT TOÁN DÀI HẠN ====================
    xu_huong_dai_han(window = 100) { if (this.kqSeq.length < window) return null; const tl = sum(this.kqSeq.slice(-window)) / window; if (tl > 0.55) return { pred: "xỉu", conf: 55 + (tl - 0.5) * 100 }; if (tl < 0.45) return { pred: "tài", conf: 55 + (0.5 - tl) * 100 }; return null; }
    chu_ky_dai_han() { if (this.kqSeq.length < 200) return null; let bestPeriod = null, bestScore = 0; for (let period = 10; period <= 50; period++) { let matches = 0; for (let i = period; i < Math.min(200, this.kqSeq.length); i++) { if (this.kqSeq[this.kqSeq.length - i] === this.kqSeq[this.kqSeq.length - i - period]) matches++; } const score = matches / (Math.min(200, this.kqSeq.length) - period); if (score > bestScore && score > 0.6) { bestScore = score; bestPeriod = period; } } if (bestPeriod && this.kqSeq.length >= bestPeriod) { const pred = this.kqSeq[this.kqSeq.length - bestPeriod]; return { pred: pred === 1 ? "tài" : "xỉu", conf: 60 + bestScore * 30 }; } return null; }
    hoi_quy_tuyen_tinh() { if (this.kqSeq.length < 30) return null; const y = this.kqSeq.slice(-30); const x = Array.from({ length: 30 }, (_, i) => i); const n = 30; const sx = sum(x), sy = sum(y), sxy = sum(x.map((v, i) => v * y[i])), sx2 = sum(x.map(v => v * v)); const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx); if (slope > 0.02) return { pred: "xỉu", conf: 60 + slope * 200 }; if (slope < -0.02) return { pred: "tài", conf: 60 + Math.abs(slope) * 200 }; return null; }
    trung_binh_dong(maNgan = 10, maDai = 30) { if (this.kqSeq.length < maDai) return null; const maN = avg(this.kqSeq.slice(-maNgan)); const maD = avg(this.kqSeq.slice(-maDai)); if (maN > maD + 0.1) return { pred: "xỉu", conf: 65 }; if (maN < maD - 0.1) return { pred: "tài", conf: 65 }; return null; }

    // ==================== DỰ ĐOÁN CHÍNH ====================
    predict() {
        const signals = [];
        const add = (s, type) => { if (s) signals.push({ ...s, weight: this.trongSo[type] || 1.0, type }); };

        // Cấp 1
        add(this.bao_1(), 'cap1'); add(this.bao_6(), 'cap1'); add(this.tong_3(), 'cap1'); add(this.tong_18(), 'cap1');
        add(this.tong_4(), 'cap1'); add(this.tong_17(), 'cap1'); add(this.tong_5(), 'cap1'); add(this.tong_16(), 'cap1');
        add(this.hai_mat_1(), 'cap1'); add(this.hai_mat_6(), 'cap1'); add(this.ba_mat_le(), 'cap1'); add(this.ba_mat_chan(), 'cap1');

        // Cấp 2
        add(this.bet_tai_5(), 'cap2'); add(this.bet_xiu_5(), 'cap2'); add(this.bet_tai_6(), 'cap2'); add(this.bet_xiu_6(), 'cap2');
        add(this.sau_bao_1(), 'cap2'); add(this.sau_bao_6(), 'cap2'); add(this.mat_1_va_2(), 'cap2'); add(this.mat_5_va_6(), 'cap2');

        // Cầu cơ bản
        add(this.cau_1_1(), 'cauCB'); add(this.cau_2_2(), 'cauCB'); add(this.cau_3_3(), 'cauCB'); add(this.cau_4_4(), 'cauCB');
        add(this.cau_1_2_1(), 'cauCB'); add(this.cau_2_1_2(), 'cauCB');

        // Cầu nâng cao
        add(this.cau_doi_xung_4(), 'cauNC'); add(this.cau_doi_xung_6(), 'cauNC');
        add(this.cau_dot_bien_5(), 'cauNC'); add(this.cau_zigzag_5(), 'cauNC'); add(this.cau_nguoc_chieu(), 'cauNC');
        add(this.cau_vong_lap_3(), 'cauNC'); add(this.cau_vong_lap_4(), 'cauNC');
        add(this.cau_thang_tang(), 'cauNC'); add(this.cau_thang_giam(), 'cauNC');

        // Phụ trợ
        add(this.markov_bac_2(), 'phuTro'); add(this.markov_bac_3(), 'phuTro');
        add(this.knn_simple(), 'phuTro'); add(this.rsi_signal(), 'phuTro'); add(this.monte_carlo(), 'phuTro');

        // Thống kê
        add(this.ty_le_tai_cao(), 'thongKe'); add(this.ty_le_tai_cuc_cao(), 'thongKe');
        add(this.can_bang_15(), 'thongKe'); add(this.can_bang_30(), 'thongKe'); add(this.can_bang_50(), 'thongKe');
        add(this.trung_binh_tong(), 'thongKe');

        // Dài hạn
        add(this.xu_huong_dai_han(), 'daiHan'); add(this.chu_ky_dai_han(), 'daiHan');
        add(this.hoi_quy_tuyen_tinh(), 'daiHan'); add(this.trung_binh_dong(), 'daiHan');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last10 = this.kqSeq.slice(-10);
            const taiCount = sum(last10);
            const pred = taiCount >= 7 ? "xỉu" : (taiCount <= 3 ? "tài" : (Math.random() > 0.5 ? "tài" : "xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = (s.weight / 100) * (s.conf / 100); if (s.pred === "tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "tài" : "xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;

        const hasCap1 = validSignals.some(s => s.type === 'cap1');
        if (hasCap1) confidence = Math.min(99, confidence + 8);
        if (validSignals.length >= 15) confidence = Math.min(98, confidence + 5);
        else if (validSignals.length <= 3) confidence = Math.max(50, confidence - 10);

        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf - a.conf), fallback: false };
    }
}

// ============ FETCH ============
async function fetchData() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const raw = res.data;
            let arr = null;
            if (raw?.data && Array.isArray(raw.data)) arr = raw.data;
            else if (Array.isArray(raw)) arr = raw;
            if (arr && arr.length >= 15) return arr.map(normalize).sort((a, b) => a.phien - b.phien);
            await new Promise(r => setTimeout(r, 2000));
        } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
    return gameHistory.length >= 15 ? gameHistory : null;
}

// ============ UPDATE ============
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 15) { isUpdating = false; return; }

        const latest = data[data.length - 1];
        const latestPhien = latest.phien;
        if (gameHistory.length > 0 && latestPhien === gameHistory[gameHistory.length - 1].phien && currentPrediction) { isUpdating = false; return; }

        if (currentPrediction && currentPrediction.phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const isCorrect = addToHistory(predictedPhien, currentPrediction.du_doan, actual.ket_qua, currentPrediction.do_tin_cay);
                if (isCorrect !== null) console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.du_doan} vs ${actual.ket_qua} | ${isCorrect ? '✅' : '❌'}`);
            }
        }

        gameHistory = data;
        predictor = new DuDoanTaiXiu(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 15); i < data.length; i++) pattern += data[i].ket_qua === "tài" ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1,
            Xuc_xac_2: latest.xuc_xac_2,
            Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua === "tài" ? "Tài" : "Xỉu",
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction === "tài" ? "Tài" : "Xỉu",
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal,
            So_tin_hieu: pred.signals.length,
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signals.length} tín hiệu | Tổng ~${predTotal} | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({
            ...currentPrediction,
            Lich_su: { Tong_phien: verifiedResults.length, Thang: winCount, Thua: verifiedResults.length - winCount, Ty_le_thang: winRate + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải", Do_tin_cay: "0%", Tong_du_doan: 0, So_tin_hieu: 0, timestamp: Date.now(), Lich_su: { Tong_phien: 0, Thang: 0, Thua: 0, Ty_le_thang: "0%" }, Bang_thang_thua: [] });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(60));
console.log('   🎯 HE THONG DU DOAN TAI XIU V14.0 🎯');
console.log('   50+ Mẫu Cầu | Thuật Toán Dài Hạn | Fix All Lỗi');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`);
    console.log('='.repeat(60));
});
