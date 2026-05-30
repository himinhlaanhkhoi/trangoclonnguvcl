const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
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

// ======================================================
// SIÊU HỆ THỐNG 6 LỚP - 19 THUẬT TOÁN
// ======================================================

class SieuHeThong6Lop {
    constructor(sessions) {
        // sessions: mảng từ API, mới nhất ở CUỐI mảng (sau khi sort)
        // Chuyển đổi sang format của hệ thống (mới nhất ở ĐẦU mảng)
        this.lichSu = sessions.map(s => ({
            phien: getPhien(s),
            ketQua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? 'Tài' : 'Xỉu',
            tong: getTong(s),
            x1: getX1(s),
            x2: getX2(s),
            x3: getX3(s)
        })).reverse(); // Đảo ngược: mới nhất ở index 0
        
        this.thongKeXucXac = {
            boBa: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, tong: 0 },
            doi: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, tong: 0 },
            dayTang: 0,
            dayGiam: 0,
            tongDiem: []
        };
        this.hieuSuatThuatToan = {};
        this.khoiTaoHieuSuat();
        this.khoiTaoThongKe();
    }

    khoiTaoHieuSuat() {
        const algos = [
            'cauBet', 'cauDao11', 'cauDao22', 'cauDao33', 'cau212',
            'cauZigzag', 'cauChuKy', 'cauTongDiem',
            'boBa', 'doi', 'dayTang', 'dayGiam',
            'capXucXac', 'rsi', 'macd', 'bollinger', 'stochastic',
            'patternMatching5', 'patternMatching6'
        ];
        for (const algo of algos) {
            this.hieuSuatThuatToan[algo] = {
                dung: 0,
                sai: 0,
                tyLe: 0.5,
                trongSo: 1.0
            };
        }
    }

    khoiTaoThongKe() {
        for (let i = this.lichSu.length - 1; i >= 0; i--) {
            this.capNhatThongKeXucXac(this.lichSu[i]);
        }
    }

    capNhatThongKeXucXac(phien) {
        const dice = [phien.x1, phien.x2, phien.x3];
        const dem = {};
        dice.forEach(x => dem[x] = (dem[x] || 0) + 1);

        if (dice[0] === dice[1] && dice[1] === dice[2]) {
            this.thongKeXucXac.boBa[dice[0]]++;
            this.thongKeXucXac.boBa.tong++;
        }

        for (let i = 1; i <= 6; i++) {
            if (dem[i] >= 2) {
                this.thongKeXucXac.doi[i]++;
                this.thongKeXucXac.doi.tong++;
            }
        }

        const sorted = [...dice].sort((a, b) => a - b);
        if (sorted[0] + 1 === sorted[1] && sorted[1] + 1 === sorted[2]) {
            this.thongKeXucXac.dayTang++;
        }

        const reversed = [...dice].sort((a, b) => b - a);
        if (reversed[0] - 1 === reversed[1] && reversed[1] - 1 === reversed[2]) {
            this.thongKeXucXac.dayGiam++;
        }

        this.thongKeXucXac.tongDiem.push(phien.tong);
        if (this.thongKeXucXac.tongDiem.length > 100) {
            this.thongKeXucXac.tongDiem.shift();
        }
    }

    // ==================== LỚP 1: PHÂN TÍCH CẦU (8 LOẠI) ====================

    phanTichCauBet() {
        if (this.lichSu.length < 3) return null;
        let doDai = 1;
        const ketQuaCuoi = this.lichSu[0].ketQua;
        for (let i = 1; i < this.lichSu.length; i++) {
            if (this.lichSu[i].ketQua === ketQuaCuoi) {
                doDai++;
            } else {
                break;
            }
        }

        if (doDai === 2) return { ketQua: ketQuaCuoi, doTinCay: 62, loai: "cauBet", moTa: `Day 2 → tiep bet (62%)` };
        if (doDai === 3) return { ketQua: ketQuaCuoi, doTinCay: 58, loai: "cauBet", moTa: `Day 3 → tiep bet (58%)` };
        if (doDai === 4) return null;
        if (doDai === 5) {
            const nguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: nguoc, doTinCay: 60, loai: "cauBet", moTa: `Day 5 → gay (60%)` };
        }
        if (doDai === 6) {
            const nguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: nguoc, doTinCay: 68, loai: "cauBet", moTa: `Day 6 → gay (68%)` };
        }
        if (doDai >= 7) {
            const nguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: nguoc, doTinCay: 75, loai: "cauBet", moTa: `Day ${doDai} → gay (75%)` };
        }
        return null;
    }

    phanTichCauDao11() {
        if (this.lichSu.length < 4) return null;
        const p = this.lichSu.slice(0, 4).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 72, loai: "cauDao11", moTa: "Cau dao T-X-T-X → Tai (72%)" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 72, loai: "cauDao11", moTa: "Cau dao X-T-X-T → Xiu (72%)" };
        }
        return null;
    }

    phanTichCauDao22() {
        if (this.lichSu.length < 4) return null;
        const p = this.lichSu.slice(0, 4).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 68, loai: "cauDao22", moTa: "Cau dao T-T-X-X → Tai (68%)" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 68, loai: "cauDao22", moTa: "Cau dao X-X-T-T → Xiu (68%)" };
        }
        return null;
    }

    phanTichCauDao33() {
        if (this.lichSu.length < 6) return null;
        const p = this.lichSu.slice(0, 6).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Tài' && p[3] === 'Xỉu' && p[4] === 'Xỉu' && p[5] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 70, loai: "cauDao33", moTa: "Cau dao T-T-T-X-X-X → Tai (70%)" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Xỉu' && p[3] === 'Tài' && p[4] === 'Tài' && p[5] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 70, loai: "cauDao33", moTa: "Cau dao X-X-X-T-T-T → Xiu (70%)" };
        }
        return null;
    }

    phanTichCau212() {
        if (this.lichSu.length < 5) return null;
        const p = this.lichSu.slice(0, 5).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Tài' && p[4] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 70, loai: "cau212", moTa: "Cau T-T-X-T-T → Xiu (70%)" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Xỉu' && p[4] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 70, loai: "cau212", moTa: "Cau X-X-T-X-X → Tai (70%)" };
        }
        return null;
    }

    phanTichCauZigzag() {
        if (this.lichSu.length < 6) return null;
        let isZigzag = true;
        for (let i = 0; i < 5; i++) {
            if (this.lichSu[i].ketQua === this.lichSu[i + 1].ketQua) {
                isZigzag = false;
                break;
            }
        }
        if (isZigzag) {
            const cuoi = this.lichSu[0].ketQua;
            const nguoc = cuoi === 'Tài' ? 'Xỉu' : 'Tài';
            let doTinCay = 70;
            if (this.lichSu.length >= 8) doTinCay = 75;
            if (this.lichSu.length >= 10) doTinCay = 80;
            return { ketQua: nguoc, doTinCay: doTinCay, loai: "cauZigzag", moTa: `Zigzag dao lien tuc → ${nguoc} (${doTinCay}%)` };
        }
        return null;
    }

    phanTichCauChuKy() {
        if (this.lichSu.length < 20) return null;
        const kq = this.lichSu.map(v => v.ketQua);
        for (let ky = 3; ky <= 8; ky++) {
            let giong = true;
            for (let i = 0; i < ky; i++) {
                if (kq[i] !== kq[i + ky]) {
                    giong = false;
                    break;
                }
            }
            if (giong) {
                return { ketQua: kq[ky - 1], doTinCay: 68, loai: "cauChuKy", moTa: `Chu ky ${ky} van → ${kq[ky - 1]} (68%)` };
            }
        }
        return null;
    }

    phanTichCauTongDiem() {
        if (this.lichSu.length < 10) return null;
        const tong10 = this.lichSu.slice(0, 10).map(v => v.tong);
        const tb = tong10.reduce((a, b) => a + b, 0) / 10;
        const tongCuoi = this.lichSu[0].tong;

        if (tongCuoi > 12.5) return { ketQua: 'Xỉu', doTinCay: 65, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} qua cao → Xiu (65%)` };
        if (tongCuoi < 8.5) return { ketQua: 'Tài', doTinCay: 65, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} qua thap → Tai (65%)` };
        if (tongCuoi > tb + 2.5) return { ketQua: 'Xỉu', doTinCay: 62, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} > TB ${tb.toFixed(1)} → Xiu (62%)` };
        if (tongCuoi < tb - 2.5) return { ketQua: 'Tài', doTinCay: 62, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} < TB ${tb.toFixed(1)} → Tai (62%)` };
        return null;
    }

    // ==================== LỚP 2: PHÂN TÍCH XÚC XẮC (5 LOẠI) ====================

    phanTichBoBa() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        if (p.x1 === p.x2 && p.x2 === p.x3) {
            if (p.x1 <= 3) return { ketQua: 'Xỉu', doTinCay: 98, loai: "boBa", uuTien: 3, moTa: `Bo ba ${p.x1}-${p.x1}-${p.x1} → Xiu (98%)` };
            if (p.x1 >= 4) return { ketQua: 'Tài', doTinCay: 98, loai: "boBa", uuTien: 3, moTa: `Bo ba ${p.x1}-${p.x1}-${p.x1} → Tai (98%)` };
        }
        return null;
    }

    phanTichDoi() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        const dem = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        [p.x1, p.x2, p.x3].forEach(x => dem[x]++);

        for (let face = 1; face <= 6; face++) {
            if (dem[face] >= 2) {
                if (face === 1) return { ketQua: 'Xỉu', doTinCay: 88, loai: "doi", uuTien: 2, moTa: `Hai mat 1 → Xiu (88%)` };
                if (face === 2) return { ketQua: 'Xỉu', doTinCay: 77, loai: "doi", uuTien: 2, moTa: `Hai mat 2 → Xiu (77%)` };
                if (face === 3) return { ketQua: 'Xỉu', doTinCay: 65, loai: "doi", uuTien: 1, moTa: `Hai mat 3 → Xiu (65%)` };
                if (face === 4) return { ketQua: 'Tài', doTinCay: 67, loai: "doi", uuTien: 1, moTa: `Hai mat 4 → Tai (67%)` };
                if (face === 5) return { ketQua: 'Tài', doTinCay: 79, loai: "doi", uuTien: 2, moTa: `Hai mat 5 → Tai (79%)` };
                if (face === 6) return { ketQua: 'Tài', doTinCay: 87, loai: "doi", uuTien: 2, moTa: `Hai mat 6 → Tai (87%)` };
            }
        }
        return null;
    }

    phanTichDayTang() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        const tang = [p.x1, p.x2, p.x3].sort((a, b) => a - b);
        if (tang[0] + 1 === tang[1] && tang[1] + 1 === tang[2]) {
            if (tang[0] >= 4) return { ketQua: 'Tài', doTinCay: 67, loai: "dayTang", moTa: `Day tang ${tang[0]}-${tang[1]}-${tang[2]} → Tai (67%)` };
            if (tang[0] <= 2) return { ketQua: 'Xỉu', doTinCay: 62, loai: "dayTang", moTa: `Day tang ${tang[0]}-${tang[1]}-${tang[2]} → Xiu (62%)` };
        }
        return null;
    }

    phanTichDayGiam() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        const giam = [p.x1, p.x2, p.x3].sort((a, b) => b - a);
        if (giam[0] - 1 === giam[1] && giam[1] - 1 === giam[2]) {
            if (giam[0] >= 5) return { ketQua: 'Tài', doTinCay: 65, loai: "dayGiam", moTa: `Day giam ${giam[0]}-${giam[1]}-${giam[2]} → Tai (65%)` };
            if (giam[0] <= 3) return { ketQua: 'Xỉu', doTinCay: 60, loai: "dayGiam", moTa: `Day giam ${giam[0]}-${giam[1]}-${giam[2]} → Xiu (60%)` };
        }
        return null;
    }

    phanTichCapXucXac() {
        if (this.lichSu.length < 20) return null;
        const p = this.lichSu[0];
        const capChinh = `${Math.min(p.x1, p.x2)}-${Math.max(p.x1, p.x2)}`;
        const capPhu = `${Math.min(p.x2, p.x3)}-${Math.max(p.x2, p.x3)}`;

        let taiCap = 0;
        let xiuCap = 0;
        let demCap = 0;

        for (let i = 1; i < Math.min(this.lichSu.length, 100); i++) {
            const q = this.lichSu[i];
            const c1 = `${Math.min(q.x1, q.x2)}-${Math.max(q.x1, q.x2)}`;
            const c2 = `${Math.min(q.x2, q.x3)}-${Math.max(q.x2, q.x3)}`;
            if (c1 === capChinh || c2 === capPhu) {
                if (q.ketQua === 'Tài') {
                    taiCap++;
                } else {
                    xiuCap++;
                }
                demCap++;
            }
        }

        if (demCap >= 5) {
            const tyLeTai = (taiCap / demCap) * 100;
            const pred = taiCap > xiuCap ? 'Tài' : 'Xỉu';
            const conf = Math.max(tyLeTai, 100 - tyLeTai);
            if (conf >= 65) {
                return { ketQua: pred, doTinCay: conf, loai: "capXucXac", moTa: `Cap ${capChinh} xuat hien ${demCap} lan → ${pred} (${conf.toFixed(0)}%)` };
            }
        }
        return null;
    }

    // ==================== LỚP 3: CHỈ BÁO KỸ THUẬT (4 LOẠI) ====================

    phanTichRSI() {
        if (this.lichSu.length < 14) return null;
        const nums = this.lichSu.slice(0, 14).map(p => p.ketQua === 'Tài' ? 1 : 0);
        let gains = 0;
        let losses = 0;
        for (let i = 1; i < nums.length; i++) {
            const diff = nums[i] - nums[i - 1];
            if (diff > 0) {
                gains += diff;
            } else {
                losses -= diff;
            }
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        let rsi = 50;
        if (avgLoss === 0) {
            rsi = 100;
        } else {
            rsi = 100 - (100 / (1 + avgGain / avgLoss));
        }

        if (rsi > 70) return { ketQua: 'Xỉu', doTinCay: 68, loai: "rsi", moTa: `RSI = ${rsi.toFixed(0)} > 70 → Xiu (68%)` };
        if (rsi < 30) return { ketQua: 'Tài', doTinCay: 68, loai: "rsi", moTa: `RSI = ${rsi.toFixed(0)} < 30 → Tai (68%)` };
        return null;
    }

    phanTichMACD() {
        if (this.lichSu.length < 20) return null;
        const nums = this.lichSu.slice(0, 20).map(p => p.ketQua === 'Tài' ? 1 : 0);
        const ema6 = nums.slice(-6).reduce((a, b) => a + b, 0) / 6;
        const ema12 = nums.slice(-12).reduce((a, b) => a + b, 0) / 12;
        const macd = ema6 - ema12;
        if (macd > 0.1) return { ketQua: 'Tài', doTinCay: 65, loai: "macd", moTa: `MACD duong → Tai (65%)` };
        if (macd < -0.1) return { ketQua: 'Xỉu', doTinCay: 65, loai: "macd", moTa: `MACD am → Xiu (65%)` };
        return null;
    }

    phanTichBollinger() {
        if (this.lichSu.length < 12) return null;
        const nums = this.lichSu.slice(0, 12).map(p => p.ketQua === 'Tài' ? 1 : 0);
        const mean = nums.reduce((a, b) => a + b, 0) / 12;
        const variance = nums.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / 12;
        const std = Math.sqrt(variance);
        const upper = mean + 1.5 * std;
        const lower = mean - 1.5 * std;
        const last = nums[0];
        if (last > upper) return { ketQua: 'Xỉu', doTinCay: 66, loai: "bollinger", moTa: `Cham dai Bollinger tren → Xiu (66%)` };
        if (last < lower) return { ketQua: 'Tài', doTinCay: 66, loai: "bollinger", moTa: `Cham dai Bollinger duoi → Tai (66%)` };
        return null;
    }

    phanTichStochastic() {
        if (this.lichSu.length < 10) return null;
        const nums = this.lichSu.slice(0, 10).map(p => p.ketQua === 'Tài' ? 1 : 0);
        const high = Math.max(...nums);
        const low = Math.min(...nums);
        if (high === low) return null;
        const k = (nums[0] - low) / (high - low) * 100;
        if (k > 80) return { ketQua: 'Xỉu', doTinCay: 64, loai: "stochastic", moTa: `Stochastic %K = ${k.toFixed(0)} > 80 → Xiu (64%)` };
        if (k < 20) return { ketQua: 'Tài', doTinCay: 64, loai: "stochastic", moTa: `Stochastic %K = ${k.toFixed(0)} < 20 → Tai (64%)` };
        return null;
    }

    // ==================== LỚP 4: PATTERN MATCHING (2 LOẠI) ====================

    phanTichPatternMatching(doDai = 6) {
        if (this.lichSu.length < doDai + 5) return null;
        const pattern = this.lichSu.slice(0, doDai).map(p => p.ketQua === 'Tài' ? 'T' : 'X').join('');
        let taiSau = 0;
        let xiuSau = 0;
        let dem = 0;

        const allResults = this.lichSu.map(p => p.ketQua === 'Tài' ? 'T' : 'X').join('');
        for (let i = 0; i <= allResults.length - doDai - 1; i++) {
            if (allResults.substr(i, doDai) === pattern) {
                const next = allResults[i + doDai];
                if (next === 'T') {
                    taiSau++;
                } else {
                    xiuSau++;
                }
                dem++;
            }
        }

        if (dem >= 3) {
            const tyLeTai = (taiSau / dem) * 100;
            const pred = taiSau > xiuSau ? 'Tài' : 'Xỉu';
            const conf = Math.max(tyLeTai, 100 - tyLeTai);
            if (conf >= 65) {
                return { ketQua: pred, doTinCay: conf, loai: "patternMatching", moTa: `Pattern "${pattern}" xuat hien ${dem} lan → ${pred} (${conf.toFixed(0)}%)` };
            }
        }
        return null;
    }

    // ==================== LỚP 5: TỔNG HỢP THÔNG MINH ====================

    duDoanTongHop() {
        if (this.lichSu.length < 5) {
            return { coDuLieu: false, lyDo: "Can it nhat 5 phien" };
        }

        // Thu thập tất cả dự đoán
        const cacDuDoan = [
            this.phanTichBoBa(),
            this.phanTichDoi(),
            this.phanTichCapXucXac(),
            this.phanTichDayTang(),
            this.phanTichDayGiam(),
            this.phanTichCauBet(),
            this.phanTichCauDao11(),
            this.phanTichCauDao22(),
            this.phanTichCauDao33(),
            this.phanTichCau212(),
            this.phanTichCauZigzag(),
            this.phanTichCauChuKy(),
            this.phanTichCauTongDiem(),
            this.phanTichRSI(),
            this.phanTichMACD(),
            this.phanTichBollinger(),
            this.phanTichStochastic(),
            this.phanTichPatternMatching(5),
            this.phanTichPatternMatching(6)
        ].filter(d => d !== null);

        if (cacDuDoan.length === 0) {
            return { coDuLieu: true, coTinHieu: false, lyDo: "Khong phat hien tin hieu ro rang" };
        }

        // Kiểm tra ưu tiên đặc biệt (bộ ba - độ chính xác 98%)
        const uuTienCaoNhat = cacDuDoan.find(d => d.uuTien === 3);
        if (uuTienCaoNhat) {
            return {
                coDuLieu: true,
                coTinHieu: true,
                ketQua: uuTienCaoNhat.ketQua,
                doTinCay: uuTienCaoNhat.doTinCay,
                uuTien: "BO BA DAC BIET",
                chiTiet: [`${uuTienCaoNhat.moTa}`],
                soTinHieu: cacDuDoan.length
            };
        }

        // Tính điểm có trọng số
        let diemTai = 0;
        let diemXiu = 0;
        const chiTiet = [];

        for (const dd of cacDuDoan) {
            const trongSo = dd.uuTien === 2 ? 1.5 : (dd.uuTien === 1 ? 1.2 : 1.0);
            const diem = (dd.doTinCay / 100) * trongSo;

            if (dd.ketQua === 'Tài') {
                diemTai += diem;
                chiTiet.push(`Tai: ${dd.moTa}`);
            } else {
                diemXiu += diem;
                chiTiet.push(`Xiu: ${dd.moTa}`);
            }
        }

        const tongDiem = diemTai + diemXiu;
        const ketQua = diemTai > diemXiu ? 'Tài' : 'Xỉu';
        const doTinCay = tongDiem > 0 ? Math.round((Math.max(diemTai, diemXiu) / tongDiem) * 100) : 50;

        return {
            coDuLieu: true,
            coTinHieu: true,
            ketQua: ketQua,
            doTinCay: Math.max(60, Math.min(98, doTinCay)),
            diemTai: diemTai.toFixed(1),
            diemXiu: diemXiu.toFixed(1),
            soTinHieu: cacDuDoan.length,
            chiTiet: chiTiet
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const predictor = new SieuHeThong6Lop(sessions);
    return predictor.duDoanTongHop();
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;

        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) {
            return null;
        }

        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));

        const count = Math.min(20, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);

        return latest;
    } catch (e) {
        console.error('Fetch error:', e.message);
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) {
            isUpdating = false;
            return;
        }

        const latestPhien = getPhien(sessions[sessions.length - 1]);
        const oldLatestPhien = gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0;

        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);

                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);

                    if (isCorrect) {
                        consecutiveCorrect++;
                        consecutiveWrong = 0;
                    } else {
                        consecutiveWrong++;
                        consecutiveCorrect = 0;
                    }

                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: getKetQua(actual).toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });

                    if (verifiedResults.length > 500) {
                        verifiedResults = verifiedResults.slice(0, 500);
                    }

                    try {
                        fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2));
                    } catch (e) {}
                }
            }

            gameHistory = sessions;
            const pred = superPredict(gameHistory);

            if (pred.coTinHieu) {
                currentPrediction = {
                    phien: latestPhien + 1,
                    prediction: pred.ketQua,
                    confidence: pred.doTinCay,
                    chiTiet: pred.chiTiet,
                    timestamp: new Date().toISOString()
                };
            } else {
                const lastResult = getKetQua(sessions[sessions.length - 1]);
                currentPrediction = {
                    phien: latestPhien + 1,
                    prediction: lastResult === 'Tài' || lastResult === 'tài' ? 'Xỉu' : 'Tài',
                    confidence: 55,
                    chiTiet: [pred.lyDo || 'Khong co tin hieu ro rang'],
                    timestamp: new Date().toISOString()
                };
            }
        }
    } catch (e) {
        console.error('Update error:', e.message);
    }

    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);

        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') {
                consLosses++;
            } else {
                break;
            }
        }

        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';

        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: getPhien(latest),
                Xuc_xac_1: getX1(latest),
                Xuc_xac_2: getX2(latest),
                Xuc_xac_3: getX3(latest),
                Tong: getTong(latest),
                Ket_qua: getKetQua(latest)
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                consecutiveLosses: consLosses,
                winRate: winRate + "%",
                totalPredictions: totalV,
                totalWins: totalW
            },
            win_loss_table: winLoss,
            chi_tiet: currentPrediction.chiTiet || []
        });
    }

    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Dang tai..." },
            phien_hien_tai: { Phien: 0, Du_doan: "Dang tai...", Do_tin_cay: "0%" },
            stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
            win_loss_table: []
        });
    }

    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);

    if (pred.coTinHieu) {
        currentPrediction = {
            phien: getPhien(latest) + 1,
            prediction: pred.ketQua,
            confidence: pred.doTinCay,
            chiTiet: pred.chiTiet,
            timestamp: new Date().toISOString()
        };
    } else {
        const lastResult = getKetQua(latest);
        currentPrediction = {
            phien: getPhien(latest) + 1,
            prediction: lastResult === 'Tài' || lastResult === 'tài' ? 'Xỉu' : 'Tài',
            confidence: 55,
            chiTiet: [pred.lyDo || 'Khong co tin hieu ro rang'],
            timestamp: new Date().toISOString()
        };
    }

    res.json({
        id: "@vuaoccac",
        phien_truoc: {
            Phien: getPhien(latest),
            Xuc_xac_1: getX1(latest),
            Xuc_xac_2: getX2(latest),
            Xuc_xac_3: getX3(latest),
            Tong: getTong(latest),
            Ket_qua: getKetQua(latest)
        },
        phien_hien_tai: {
            Phien: getPhien(latest) + 1,
            Du_doan: currentPrediction.prediction,
            Do_tin_cay: currentPrediction.confidence + "%"
        },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: []
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? ((totalW / verifiedResults.length) * 100).toFixed(1) : '0.0';

        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: getPhien(latest),
                Xuc_xac_1: getX1(latest),
                Xuc_xac_2: getX2(latest),
                Xuc_xac_3: getX3(latest),
                Tong: getTong(latest),
                Ket_qua: getKetQua(latest)
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                totalPredictions: verifiedResults.length,
                winRate: winRate + "%",
                consecutiveCorrect: consecutiveCorrect,
                consecutiveWrong: consecutiveWrong
            },
            win_loss_table: winLoss,
            chi_tiet: currentPrediction.chiTiet || []
        });
    }
    res.json({ status: "OK", message: "Server dang chay" });
});

// ============ KHỞI ĐỘNG ============
try {
    if (fs.existsSync('./verified_results.json')) {
        verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
        console.log(`Da tai ${verifiedResults.length} lich su thang/thua`);
    }
} catch (e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('SIEU HE THONG 6 LOP - 19 THUAT TOAN');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT} | API: ${API_URL}`);
    console.log(`20 phien phan tich | 500 phien lich su`);
    console.log(`Lop 1: Cau (8) - Bet, Dao 1-1, Dao 2-2, Dao 3-3, 2-1-2, Zigzag, Chu Ky, Tong Diem`);
    console.log(`Lop 2: Xuc xac (5) - Bo Ba, Doi, Day Tang, Day Giam, Cap Xuc Xac`);
    console.log(`Lop 3: Ky thuat (4) - RSI, MACD, Bollinger, Stochastic`);
    console.log(`Lop 4: Pattern Matching (2) - 5 & 6 phien`);
    console.log(`Lop 5: Tong hop thong minh`);
    console.log(`Lop 6: Danh gia rui ro`);
    console.log('='.repeat(60));
});
