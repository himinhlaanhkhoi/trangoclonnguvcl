const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 1 : 0,
        tong: item.point || 0,
        x1: (item.dices && item.dices[0]) || 0,
        x2: (item.dices && item.dices[1]) || 0,
        x3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

// ============ HISTORY ============
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY);
        }
    } catch (e) { verifiedResults = []; }
}

function saveHistory() {
    try {
        verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2));
    } catch (e) {}
}

function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const d = duDoan.toLowerCase().trim();
    const k = ketQua.toLowerCase().trim();
    const isCorrect = d === k;
    verifiedResults.unshift({
        phien,
        du_doan: duDoan,
        ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua',
        do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ============================================================
// SIÊU HỆ THỐNG BẮT BỆT & TẤT CẢ CẦU
// 68+ Thuật toán - 7 Bộ phát hiện
// ============================================================

class HeThongBatCauSieuChinhXac {
    constructor() {
        this.data = [];
        this.cauDaPhatHien = [];
        this.lichSuBet = [];
        this.thongKe = { tongCau: 0, cauDung: 0, cauSai: 0 };
    }

    phanTich(arr) {
        this.data = arr;
        const n = arr.length;
        if (n < 10) return { ok: false, msg: 'Cần ít nhất 10 phiên' };

        const data = this._chuanHoa(arr);
        const ketQua = {
            batBet: this._boBatBet(data),
            batDoiXung: this._boBatDoiXung(data),
            batNhip: this._boBatNhip(data),
            batBacThang: this._boBatBacThang(data),
            batDacBiet: this._boBatDacBiet(data),
            batKetHop: this._boBatKetHop(data),
            betChuyenSau: this._boBetChuyenSau(data)
        };

        const tatCaCau = this._tongHopTatCaCau(ketQua);
        this.cauDaPhatHien = tatCaCau;
        const phanTichCheo = this._phanTichCheo(tatCaCau, data);
        const quyetDinh = this._raQuyetDinh(tatCaCau, phanTichCheo, data);
        this.thongKe.tongCau++;

        return {
            ok: true,
            ...quyetDinh,
            tongSoCau: tatCaCau.length,
            topCau: tatCaCau.slice(0, 10),
            phanTichCheo,
            thongKe: this.thongKe
        };
    }

    _chuanHoa(arr) {
        return arr.map((v, i) => ({
            goc: v.tong,
            so: v.tong >= 11 ? 1 : 0,
            loai: v.tong >= 11 ? 'T' : 'X',
            manh: v.tong >= 15 ? 4 : v.tong >= 13 ? 3 : v.tong >= 11 ? 2 :
                  v.tong <= 4 ? -4 : v.tong <= 6 ? -3 : v.tong <= 8 ? -2 : 0,
            viTri: i
        }));
    }

    // ============ A. BỘ BẮT BỆT ============
    _boBatBet(data) {
        const n = data.length;
        const so = data.map(d => d.so);
        const manh = data.map(d => d.manh);
        const ketQua = [];
        const last = so[n - 1];
        let doDai = 0;
        for (let i = n - 1; i >= 0; i--) { if (so[i] === last) doDai++; else break; }

        if (doDai >= 12) ketQua.push({ ten: 'SIÊU BỆT ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 98, doDai, moTa: `Bệt ${doDai} phiên` });
        else if (doDai >= 9) ketQua.push({ ten: 'ĐẠI BỆT ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 94, doDai, moTa: `Bệt ${doDai} phiên` });
        else if (doDai >= 7) ketQua.push({ ten: 'BỆT DÀI ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 89, doDai, moTa: `Bệt ${doDai} phiên` });
        else if (doDai >= 5) ketQua.push({ ten: 'BỆT VỪA ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 82, doDai, moTa: `Bệt ${doDai} phiên` });
        else if (doDai >= 3) ketQua.push({ ten: 'BỆT NGẮN ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 72, doDai, moTa: `Bệt ${doDai} phiên` });
        else if (doDai === 2) ketQua.push({ ten: 'BỆT MINI ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 62, doDai, moTa: 'Bệt 2 phiên' });

        const doManhTB = manh.slice(-doDai).reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / doDai;
        if (doDai >= 4 && doManhTB >= 3) {
            ketQua.push({ ten: 'BỆT MẠNH ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: Math.min(96, 80 + doManhTB * 5), doDai, moTa: `Bệt mạnh (${doManhTB.toFixed(1)})` });
        }
        if (doDai >= 5 && doManhTB <= 1.5) {
            ketQua.push({ ten: 'BỆT YẾU ' + (last === 1 ? 'TÀI' : 'XỈU'), loai: 'BỆT', duDoan: last === 1 ? 'Xỉu' : 'Tài', doTinCay: 75, doDai, moTa: 'Bệt yếu - sắp gãy' });
        }

        if (n >= 8) {
            const last8 = so.slice(-8);
            if (last8.join('') === '11001100') ketQua.push({ ten: 'BỆT KÉP 2-2 TÀI', loai: 'BỆT KÉP', duDoan: 'Tài', doTinCay: 88 });
            if (last8.join('') === '00110011') ketQua.push({ ten: 'BỆT KÉP 2-2 XỈU', loai: 'BỆT KÉP', duDoan: 'Xỉu', doTinCay: 88 });
        }
        if (n >= 12) {
            const last12 = so.slice(-12);
            if (last12.join('') === '111000111000') ketQua.push({ ten: 'BỆT KÉP 3-3 TÀI', loai: 'BỆT KÉP', duDoan: 'Tài', doTinCay: 91 });
            if (last12.join('') === '000111000111') ketQua.push({ ten: 'BỆT KÉP 3-3 XỈU', loai: 'BỆT KÉP', duDoan: 'Xỉu', doTinCay: 91 });
        }

        if (doDai >= 3) this.lichSuBet.push({ doDai, loai: last, thoiGian: new Date() });
        return ketQua;
    }

    // ============ B. BỘ BẮT CẦU ĐỐI XỨNG ============
    _boBatDoiXung(data) {
        const n = data.length;
        const so = data.map(d => d.so);
        const ketQua = [];

        if (n >= 10) {
            let hoanHao = true;
            for (let i = n - 1; i > n - 10; i--) { if (so[i] === so[i - 1]) { hoanHao = false; break; } }
            if (hoanHao) ketQua.push({ ten: '1-1 HOÀN HẢO 10', loai: '1-1', duDoan: so[n - 1] === 1 ? 'Xỉu' : 'Tài', doTinCay: 95, moTa: 'Xen kẽ hoàn hảo 10 phiên' });
        }
        if (n >= 8) {
            let hoanHao8 = true;
            for (let i = n - 1; i > n - 8; i--) { if (so[i] === so[i - 1]) { hoanHao8 = false; break; } }
            if (hoanHao8) ketQua.push({ ten: '1-1 HOÀN HẢO 8', loai: '1-1', duDoan: so[n - 1] === 1 ? 'Xỉu' : 'Tài', doTinCay: 90, moTa: 'Xen kẽ hoàn hảo 8 phiên' });
        }
        if (n >= 6) {
            const last6 = so.slice(-6);
            if (last6.join('') === '110110') ketQua.push({ ten: '2-1 TÀI CHUẨN', loai: '2-1', duDoan: 'Tài', doTinCay: 88 });
            if (last6.join('') === '001001') ketQua.push({ ten: '2-1 XỈU CHUẨN', loai: '2-1', duDoan: 'Xỉu', doTinCay: 88 });
        }
        if (n >= 8) {
            const last8 = so.slice(-8);
            if (last8.join('') === '11101110') ketQua.push({ ten: '3-1 TÀI CHUẨN', loai: '3-1', duDoan: 'Tài', doTinCay: 91 });
            if (last8.join('') === '00010001') ketQua.push({ ten: '3-1 XỈU CHUẨN', loai: '3-1', duDoan: 'Xỉu', doTinCay: 91 });
        }
        if (n >= 5) {
            const last5 = so.slice(-5);
            if (last5.join('') === '10101') ketQua.push({ ten: 'CẦU 5 SAO', loai: 'ĐẶC BIỆT', duDoan: 'Xỉu', doTinCay: 86 });
            if (last5.join('') === '01010') ketQua.push({ ten: 'CẦU 5 SAO', loai: 'ĐẶC BIỆT', duDoan: 'Tài', doTinCay: 86 });
        }

        return ketQua;
    }

    // ============ C. BỘ BẮT CẦU NHỊP ============
    _boBatNhip(data) {
        const n = data.length;
        const so = data.map(d => d.so);
        const ketQua = [];

        for (let ck = 2; ck <= Math.min(15, Math.floor(n / 2)); ck++) {
            let trungKhop = 0;
            const soSanh = Math.min(ck * 3, n - ck);
            for (let i = n - 1; i >= n - soSanh && i - ck >= 0; i--) {
                if (so[i] === so[i - ck]) trungKhop++;
            }
            const tyLe = trungKhop / soSanh;
            if (tyLe >= 0.9) {
                ketQua.push({ ten: `NHỊP ${ck} HOÀN HẢO`, loai: 'NHỊP', duDoan: so[n - ck] === 1 ? 'Tài' : 'Xỉu', doTinCay: Math.min(93, 65 + tyLe * 30), chuKy: ck });
            } else if (tyLe >= 0.8) {
                ketQua.push({ ten: `NHỊP ${ck} MẠNH`, loai: 'NHỊP', duDoan: so[n - ck] === 1 ? 'Tài' : 'Xỉu', doTinCay: Math.min(85, 55 + tyLe * 35), chuKy: ck });
            }
        }
        return ketQua;
    }

    // ============ D. BỘ BẮT CẦU BẬC THANG ============
    _boBatBacThang(data) {
        const n = data.length;
        const so = data.map(d => d.so);
        const ketQua = [];
        const nhom3 = [];
        for (let i = Math.max(0, n - 9); i < n; i += 3) {
            nhom3.push(so.slice(i, Math.min(i + 3, n)).reduce((a, b) => a + b, 0));
        }
        if (nhom3.length >= 3) {
            if (nhom3[0] <= nhom3[1] && nhom3[1] <= nhom3[2]) ketQua.push({ ten: 'THANG TĂNG', loai: 'THANG', duDoan: 'Tài', doTinCay: 80 });
            if (nhom3[0] >= nhom3[1] && nhom3[1] >= nhom3[2]) ketQua.push({ ten: 'THANG GIẢM', loai: 'THANG', duDoan: 'Xỉu', doTinCay: 80 });
        }
        return ketQua;
    }

    // ============ E. BỘ BẮT CẦU ĐẶC BIỆT ============
    _boBatDacBiet(data) {
        const n = data.length;
        const so = data.map(d => d.so);
        const ketQua = [];
        const tais20 = so.slice(-20).reduce((a, b) => a + b, 0);
        if (tais20 >= 16) ketQua.push({ ten: 'CẦU VUA TÀI', loai: 'ĐẶC BIỆT', duDoan: 'Tài', doTinCay: 92 });
        if (tais20 <= 4) ketQua.push({ ten: 'CẦU VUA XỈU', loai: 'ĐẶC BIỆT', duDoan: 'Xỉu', doTinCay: 92 });

        if (n >= 6) {
            const last6 = so.slice(-6);
            if (last6.slice(0, 5).every(s => s === 0) && last6[5] === 1) ketQua.push({ ten: 'CẦU NẾN BẬT', loai: 'ĐẶC BIỆT', duDoan: 'Tài', doTinCay: 80 });
            if (last6.slice(0, 5).every(s => s === 1) && last6[5] === 0) ketQua.push({ ten: 'CẦU NẾN TẮT', loai: 'ĐẶC BIỆT', duDoan: 'Xỉu', doTinCay: 80 });
        }
        if (n >= 9) {
            let ziczac = true;
            for (let i = n - 1; i > n - 7; i -= 2) { if (so[i] !== so[i - 2]) { ziczac = false; break; } }
            if (ziczac) ketQua.push({ ten: 'CẦU ZICZAC', loai: 'ĐẶC BIỆT', duDoan: so[n - 2] === 1 ? 'Tài' : 'Xỉu', doTinCay: 82 });
        }
        return ketQua;
    }

    // ============ F. BỘ BẮT CẦU KẾT HỢP ============
    _boBatKetHop(data) {
        const ketQua = [];
        const allCau = [
            ...this._boBatBet(data),
            ...this._boBatDoiXung(data),
            ...this._boBatNhip(data),
            ...this._boBatBacThang(data),
            ...this._boBatDacBiet(data)
        ];
        const dongThuanTAI = allCau.filter(c => c.duDoan === 'Tài' && c.doTinCay >= 70);
        const dongThuanXIU = allCau.filter(c => c.duDoan === 'Xỉu' && c.doTinCay >= 70);

        if (dongThuanTAI.length >= 5) ketQua.push({ ten: 'ĐỒNG THUẬN TÀI MẠNH', loai: 'KẾT HỢP', duDoan: 'Tài', doTinCay: Math.min(97, 70 + dongThuanTAI.length * 4) });
        if (dongThuanXIU.length >= 5) ketQua.push({ ten: 'ĐỒNG THUẬN XỈU MẠNH', loai: 'KẾT HỢP', duDoan: 'Xỉu', doTinCay: Math.min(97, 70 + dongThuanXIU.length * 4) });

        const allTypes = [...new Set(allCau.map(c => c.loai))];
        if (allTypes.length >= 3) {
            const tais = allCau.filter(c => c.duDoan === 'Tài').length;
            ketQua.push({ ten: 'SIÊU KẾT HỢP', loai: 'KẾT HỢP', duDoan: tais >= allCau.length / 2 ? 'Tài' : 'Xỉu', doTinCay: 86 });
        }
        return ketQua;
    }

    // ============ G. BỘ BỆT CHUYÊN SÂU ============
    _boBetChuyenSau(data) {
        const n = data.length;
        const so = data.map(d => d.so);
        const manh = data.map(d => d.manh);
        const ketQua = [];
        const last = so[n - 1];
        let doDai = 0;
        for (let i = n - 1; i >= 0; i--) { if (so[i] === last) doDai++; else break; }

        if (doDai >= 5) {
            const nuaDau = manh.slice(-doDai, -Math.floor(doDai / 2));
            const nuaSau = manh.slice(-Math.floor(doDai / 2));
            const tbDau = nuaDau.reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / nuaDau.length;
            const tbSau = nuaSau.reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / nuaSau.length;
            if (tbSau > tbDau * 1.3) ketQua.push({ ten: 'BỆT TĂNG TỐC', loai: 'BỆT CS', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 90 });
            if (tbSau < tbDau * 0.7) ketQua.push({ ten: 'BỆT GIẢM TỐC', loai: 'BỆT CS', duDoan: last === 1 ? 'Xỉu' : 'Tài', doTinCay: 82 });
        }

        let maxBet = 0, currBet = 1;
        for (let i = 1; i < n; i++) { if (so[i] === so[i - 1]) currBet++; else { maxBet = Math.max(maxBet, currBet); currBet = 1; } }
        maxBet = Math.max(maxBet, currBet);
        if (doDai >= maxBet && doDai >= 5) ketQua.push({ ten: 'BỆT KỶ LỤC', loai: 'BỆT CS', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 92 });
        if (doDai === maxBet - 1 && maxBet >= 5) ketQua.push({ ten: 'BỆT SẮP ĐỦ', loai: 'BỆT CS', duDoan: last === 1 ? 'Xỉu' : 'Tài', doTinCay: 78 });

        const tongTais = so.reduce((a, b) => a + b, 0);
        const tyLeChung = tongTais / n;
        if ((last === 1 && tyLeChung < 0.4) || (last === 0 && tyLeChung > 0.6)) ketQua.push({ ten: 'BỆT NGƯỢC DÒNG', loai: 'BỆT CS', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 85 });
        if ((last === 1 && tyLeChung > 0.6) || (last === 0 && tyLeChung < 0.4)) ketQua.push({ ten: 'BỆT THUẬN DÒNG', loai: 'BỆT CS', duDoan: last === 1 ? 'Tài' : 'Xỉu', doTinCay: 88 });

        return ketQua;
    }

    _tongHopTatCaCau(ketQua) {
        const tatCa = [];
        Object.values(ketQua).forEach(arr => { if (Array.isArray(arr)) tatCa.push(...arr); });
        return tatCa.sort((a, b) => b.doTinCay - a.doTinCay);
    }

    _phanTichCheo(tatCaCau, data) {
        const dongYTAI = tatCaCau.filter(c => c.duDoan === 'Tài').length;
        const dongYXIU = tatCaCau.filter(c => c.duDoan === 'Xỉu').length;
        const tong = dongYTAI + dongYXIU;
        const tyLeDongThuan = tong > 0 ? Math.max(dongYTAI, dongYXIU) / tong : 0;
        return {
            dongYTAI,
            dongYXIU,
            tyLeDongThuan: (tyLeDongThuan * 100).toFixed(0) + '%',
            dongThuanCao: tyLeDongThuan >= 0.7,
            soCauPhatHien: tatCaCau.length
        };
    }

    _raQuyetDinh(tatCaCau, cheo, data) {
        const so = data.map(d => d.so);
        const last = so[data.length - 1];
        let ketQua, doTinCay, lyDo;

        if (tatCaCau.length === 0) {
            ketQua = last === 1 ? 'Tài' : 'Xỉu';
            doTinCay = 50;
            lyDo = 'Không phát hiện cầu rõ ràng';
        } else if (cheo.dongThuanCao) {
            const cauTop = tatCaCau[0];
            ketQua = cauTop.duDoan;
            doTinCay = cauTop.doTinCay;
            lyDo = `${cauTop.ten} - ${cheo.tyLeDongThuan} đồng thuận`;
        } else {
            let diemTAI = 0, diemXIU = 0;
            tatCaCau.slice(0, 10).forEach(c => {
                if (c.duDoan === 'Tài') diemTAI += c.doTinCay;
                else diemXIU += c.doTinCay;
            });
            ketQua = diemTAI >= diemXIU ? 'Tài' : 'Xỉu';
            doTinCay = Math.max(diemTAI, diemXIU) / (diemTAI + diemXIU) * 100;
            lyDo = `Bình chọn từ ${Math.min(10, tatCaCau.length)} cầu`;
        }

        return {
            ketQua,
            doTinCay: parseFloat(doTinCay.toFixed(1)),
            lyDo,
            xepHang: doTinCay >= 90 ? '⭐⭐⭐⭐⭐ SIÊU CHUẨN' :
                     doTinCay >= 80 ? '⭐⭐⭐⭐ RẤT CAO' :
                     doTinCay >= 70 ? '⭐⭐⭐ CAO' :
                     doTinCay >= 60 ? '⭐⭐ KHÁ' : '⭐ THẤP'
        };
    }
}

// ============ FETCH DATA ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') {
                for (const key of Object.keys(raw)) {
                    if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; }
                }
            }
            if (arr && arr.length >= 20) {
                const n = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                return n;
            }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { if (attempt < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return gameHistory.length >= 20 ? gameHistory : null;
}

// ============ UPDATE ============
let engine = null;
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 20) { isUpdating = false; return; }

        const latest = data[data.length - 1];
        const latestPhien = latest.phien;
        const oldPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 1 ? 'Tài' : 'Xỉu';
                addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr}`);
            }
        }

        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        engine = new HeThongBatCauSieuChinhXac();
        const pred = engine.phanTich(data.slice(-100));

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) {
            pattern += data[i].ket_qua === 1 ? "t" : "x";
        }

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: last.x1,
            Xuc_xac_2: last.x2,
            Xuc_xac_3: last.x3,
            Tong: last.tong,
            Ket_qua: last.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.ketQua,
            Do_tin_cay: pred.doTinCay + "%",
            Tong_du_doan: predTotal,
            So_cau: pred.tongSoCau,
            Xep_hang: pred.xepHang,
            Ly_do: pred.lyDo,
            Dong_thuan: pred.phanTichCheo?.tyLeDongThuan,
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.ketQua} (${pred.doTinCay}%) | ${pred.tongSoCau} cầu | ${pred.xepHang} | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({
            ...currentPrediction,
            Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({
        id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0,
        Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...",
        Do_tin_cay: "0%", Tong_du_doan: 0, So_cau: 0, Xep_hang: "", Ly_do: "",
        Dong_thuan: "0%", timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   👑 SIÊU HỆ THỐNG BẮT BỆT & TẤT CẢ CẦU 👑');
console.log('   68+ Thuật Toán | 7 Bộ Phát Hiện');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions');
console.log('='.repeat(70));

(async () => { const data = await fetchData(); if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`   🚀 Port: ${PORT} | /taixiu`); console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`); console.log('='.repeat(70)); });
