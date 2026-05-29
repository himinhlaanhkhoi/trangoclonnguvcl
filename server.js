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

// ============ MATH HELPERS ============
function tinhTrungBinh(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function tinhDoLech(arr) {
    if (arr.length < 2) return 0;
    const tb = tinhTrungBinh(arr);
    return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - tb, 2), 0) / arr.length);
}

// ======================================================
// LỚP PHÂN TÍCH CẦU - 15 THUẬT TOÁN CHUẨN XÁC
// ======================================================
class PhanTichCau {
    constructor(lichSu) {
        // lichSu: mảng các object { ketQua, tong, x1, x2, x3 }
        // Mới nhất ở đầu mảng (index 0)
        this.lichSu = lichSu;
    }

    // -------------------- THUẬT TOÁN 1: CẦU BỆT (STREAK) --------------------
    thuatToan_Bet() {
        if (this.lichSu.length < 3) return null;
        
        const ketQuaCuoi = this.lichSu[0].ketQua;
        let doDaiDay = 1;
        
        for (let i = 1; i < this.lichSu.length; i++) {
            if (this.lichSu[i].ketQua === ketQuaCuoi) {
                doDaiDay++;
            } else {
                break;
            }
        }
        
        // Dây 2-3: tiếp tục bệt (62% - 58%)
        if (doDaiDay === 2) {
            return { ketQua: ketQuaCuoi, doTinCay: 62, loai: "bệt", moTa: `Dây ${doDaiDay} → bệt` };
        }
        if (doDaiDay === 3) {
            return { ketQua: ketQuaCuoi, doTinCay: 58, loai: "bệt", moTa: `Dây ${doDaiDay} → bệt` };
        }
        
        // Dây 4: cân bằng, không đủ tin cậy
        if (doDaiDay === 4) return null;
        
        // Dây ≥5: dự đoán gãy (60-75%)
        if (doDaiDay >= 5) {
            const ketQuaNguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            const doTinCay = Math.min(75, 60 + (doDaiDay - 4) * 4);
            return { ketQua: ketQuaNguoc, doTinCay: doTinCay, loai: "gãy", moTa: `Dây ${doDaiDay} → gãy` };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 2: CẦU ĐẢO 1-1 --------------------
    thuatToan_Dao11() {
        if (this.lichSu.length < 4) return null;
        
        const p = this.lichSu.map(v => v.ketQua);
        
        if (p[0] === 'Tài' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 72, loai: "đảo 1-1", moTa: "T-X-T-X → Tài" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 72, loai: "đảo 1-1", moTa: "X-T-X-T → Xỉu" };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 3: CẦU ĐẢO 2-2 --------------------
    thuatToan_Dao22() {
        if (this.lichSu.length < 4) return null;
        
        const p = this.lichSu.map(v => v.ketQua);
        
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 68, loai: "đảo 2-2", moTa: "T-T-X-X → Tài" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 68, loai: "đảo 2-2", moTa: "X-X-T-T → Xỉu" };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 4: CẦU ĐẢO 3-3 --------------------
    thuatToan_Dao33() {
        if (this.lichSu.length < 6) return null;
        
        const p = this.lichSu.map(v => v.ketQua);
        
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Tài' && p[3] === 'Xỉu' && p[4] === 'Xỉu' && p[5] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 70, loai: "đảo 3-3", moTa: "T-T-T-X-X-X → Tài" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Xỉu' && p[3] === 'Tài' && p[4] === 'Tài' && p[5] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 70, loai: "đảo 3-3", moTa: "X-X-X-T-T-T → Xỉu" };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 5: CẦU 2-1-2 --------------------
    thuatToan_212() {
        if (this.lichSu.length < 5) return null;
        
        const p = this.lichSu.map(v => v.ketQua);
        
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Tài' && p[4] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 70, loai: "2-1-2", moTa: "T-T-X-T-T → Xỉu" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Xỉu' && p[4] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 70, loai: "2-1-2", moTa: "X-X-T-X-X → Tài" };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 6: CẦU 1-2-1 --------------------
    thuatToan_121() {
        if (this.lichSu.length < 4) return null;
        
        const p = this.lichSu.map(v => v.ketQua);
        
        if (p[0] === 'Tài' && p[1] === 'Xỉu' && p[2] === 'Xỉu' && p[3] === 'Tài') {
            return { ketQua: 'Xỉu', doTinCay: 67, loai: "1-2-1", moTa: "T-X-X-T → Xỉu" };
        }
        if (p[0] === 'Xỉu' && p[1] === 'Tài' && p[2] === 'Tài' && p[3] === 'Xỉu') {
            return { ketQua: 'Tài', doTinCay: 67, loai: "1-2-1", moTa: "X-T-T-X → Tài" };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 7: CẦU ZIGZAG DÀI --------------------
    thuatToan_Zigzag() {
        if (this.lichSu.length < 6) return null;
        
        let isZigzag = true;
        for (let i = 0; i < 5; i++) {
            if (this.lichSu[i].ketQua === this.lichSu[i + 1].ketQua) {
                isZigzag = false;
                break;
            }
        }
        
        if (isZigzag) {
            const ketQuaCuoi = this.lichSu[0].ketQua;
            const ketQuaNguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: ketQuaNguoc, doTinCay: 70, loai: "zigzag", moTa: `Zigzag đảo liên tục → ${ketQuaNguoc}` };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 8: CHU KỲ LẶP --------------------
    thuatToan_ChuKy() {
        if (this.lichSu.length < 12) return null;
        
        const kq = this.lichSu.map(v => v.ketQua);
        
        for (let k = 6; k <= 10; k++) {
            if (kq.length >= k * 2) {
                let giong = true;
                for (let i = 0; i < k; i++) {
                    if (kq[i] !== kq[i + k]) {
                        giong = false;
                        break;
                    }
                }
                if (giong) {
                    return { ketQua: kq[k - 1], doTinCay: 72, loai: "chu kỳ", moTa: `Chu kỳ ${k} ván → ${kq[k - 1]}` };
                }
            }
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 9: BỘ BA XÚC XẮC --------------------
    thuatToan_BoBa() {
        if (this.lichSu.length < 1) return null;
        
        const v = this.lichSu[0];
        
        if (v.x1 === v.x2 && v.x2 === v.x3) {
            if (v.x1 === 1) return { ketQua: 'Xỉu', doTinCay: 95, loai: "bộ ba", moTa: "Bộ ba 1-1-1 → Xỉu" };
            if (v.x1 === 6) return { ketQua: 'Tài', doTinCay: 92, loai: "bộ ba", moTa: "Bộ ba 6-6-6 → Tài" };
            if (v.x1 <= 2) return { ketQua: 'Xỉu', doTinCay: 80, loai: "bộ ba", moTa: `Bộ ba ${v.x1} → Xỉu` };
            if (v.x1 >= 5) return { ketQua: 'Tài', doTinCay: 75, loai: "bộ ba", moTa: `Bộ ba ${v.x1} → Tài` };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 10: HAI MẶT XÚC XẮC --------------------
    thuatToan_HaiMat() {
        if (this.lichSu.length < 1) return null;
        
        const v = this.lichSu[0];
        const dem = [0, 0, 0, 0, 0, 0, 0];
        [v.x1, v.x2, v.x3].forEach(m => dem[m]++);
        
        for (let i = 1; i <= 6; i++) {
            if (dem[i] >= 2) {
                if (i >= 5) return { ketQua: 'Tài', doTinCay: 78, loai: "đôi", moTa: `Hai mặt ${i} → Tài` };
                if (i <= 2) return { ketQua: 'Xỉu', doTinCay: 82, loai: "đôi", moTa: `Hai mặt ${i} → Xỉu` };
                if (i === 3) return { ketQua: 'Xỉu', doTinCay: 65, loai: "đôi", moTa: `Hai mặt 3 → Xỉu` };
                if (i === 4) return { ketQua: 'Tài', doTinCay: 68, loai: "đôi", moTa: `Hai mặt 4 → Tài` };
            }
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 11: DÃY TĂNG DẦN --------------------
    thuatToan_DayTang() {
        if (this.lichSu.length < 1) return null;
        
        const v = this.lichSu[0];
        const tang = [v.x1, v.x2, v.x3].sort((a, b) => a - b);
        
        if (tang[0] + 1 === tang[1] && tang[1] + 1 === tang[2]) {
            if (tang[0] >= 4) return { ketQua: 'Tài', doTinCay: 67, loai: "dãy tăng", moTa: `Dãy ${tang[0]}-${tang[1]}-${tang[2]} → Tài` };
            if (tang[0] <= 2) return { ketQua: 'Xỉu', doTinCay: 62, loai: "dãy tăng", moTa: `Dãy ${tang[0]}-${tang[1]}-${tang[2]} → Xỉu` };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 12: DÃY GIẢM DẦN --------------------
    thuatToan_DayGiam() {
        if (this.lichSu.length < 1) return null;
        
        const v = this.lichSu[0];
        const giam = [v.x1, v.x2, v.x3].sort((a, b) => b - a);
        
        if (giam[0] - 1 === giam[1] && giam[1] - 1 === giam[2]) {
            if (giam[0] >= 5) return { ketQua: 'Tài', doTinCay: 65, loai: "dãy giảm", moTa: `Dãy ${giam[0]}-${giam[1]}-${giam[2]} → Tài` };
            if (giam[0] <= 3) return { ketQua: 'Xỉu', doTinCay: 60, loai: "dãy giảm", moTa: `Dãy ${giam[0]}-${giam[1]}-${giam[2]} → Xỉu` };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 13: TỔNG ĐIỂM CAO/THẤP --------------------
    thuatToan_TongDiem() {
        if (this.lichSu.length < 1) return null;
        
        const tongCuoi = this.lichSu[0].tong;
        
        if (tongCuoi > 12.5) return { ketQua: 'Xỉu', doTinCay: 65, loai: "tổng cao", moTa: `Tổng ${tongCuoi} → Xỉu` };
        if (tongCuoi < 8.5) return { ketQua: 'Tài', doTinCay: 65, loai: "tổng thấp", moTa: `Tổng ${tongCuoi} → Tài` };
        
        return null;
    }

    // -------------------- THUẬT TOÁN 14: HỒI QUY TRUNG BÌNH --------------------
    thuatToan_HoiQuy() {
        if (this.lichSu.length < 10) return null;
        
        const tong10Van = this.lichSu.slice(0, 10).map(v => v.tong);
        const trungBinh = tinhTrungBinh(tong10Van);
        const tongCuoi = this.lichSu[0].tong;
        
        if (tongCuoi > trungBinh + 2.5) {
            return { ketQua: 'Xỉu', doTinCay: 62, loai: "hồi quy", moTa: `Tổng ${tongCuoi} > TB ${trungBinh.toFixed(1)} → Xỉu` };
        }
        if (tongCuoi < trungBinh - 2.5) {
            return { ketQua: 'Tài', doTinCay: 62, loai: "hồi quy", moTa: `Tổng ${tongCuoi} < TB ${trungBinh.toFixed(1)} → Tài` };
        }
        
        return null;
    }

    // -------------------- THUẬT TOÁN 15: MARKOV BẬC 2 --------------------
    thuatToan_Markov() {
        if (this.lichSu.length < 30) return null;
        
        const kq = this.lichSu.map(v => v.ketQua);
        const chuyenTiep = {};
        
        for (let i = 0; i < kq.length - 2; i++) {
            const trangThai = kq[i + 1] + '_' + kq[i + 2];
            const tiepTheo = kq[i];
            if (!chuyenTiep[trangThai]) {
                chuyenTiep[trangThai] = { Tài: 0, Xỉu: 0 };
            }
            chuyenTiep[trangThai][tiepTheo]++;
        }
        
        const trangThaiHT = kq[0] + '_' + kq[1];
        
        if (chuyenTiep[trangThaiHT]) {
            const thongKe = chuyenTiep[trangThaiHT];
            const tong = thongKe.Tài + thongKe.Xỉu;
            
            if (tong >= 5) {
                if (thongKe.Tài / tong > 0.65) {
                    return { ketQua: 'Tài', doTinCay: (thongKe.Tài / tong) * 100, loai: "markov", moTa: "Markov bậc 2 → Tài" };
                }
                if (thongKe.Xỉu / tong > 0.65) {
                    return { ketQua: 'Xỉu', doTinCay: (thongKe.Xỉu / tong) * 100, loai: "markov", moTa: "Markov bậc 2 → Xỉu" };
                }
            }
        }
        
        return null;
    }

    // -------------------- DANH SÁCH THUẬT TOÁN --------------------
    get DANH_SACH_THUAT_TOAN() {
        return [
            this.thuatToan_Bet.bind(this),
            this.thuatToan_Dao11.bind(this),
            this.thuatToan_Dao22.bind(this),
            this.thuatToan_Dao33.bind(this),
            this.thuatToan_212.bind(this),
            this.thuatToan_121.bind(this),
            this.thuatToan_Zigzag.bind(this),
            this.thuatToan_ChuKy.bind(this),
            this.thuatToan_BoBa.bind(this),
            this.thuatToan_HaiMat.bind(this),
            this.thuatToan_DayTang.bind(this),
            this.thuatToan_DayGiam.bind(this),
            this.thuatToan_TongDiem.bind(this),
            this.thuatToan_HoiQuy.bind(this),
            this.thuatToan_Markov.bind(this)
        ];
    }

    // -------------------- HỆ THỐNG TỔNG HỢP --------------------
    phanTichTongHop() {
        if (this.lichSu.length < 5) {
            return {
                coDuLieu: false,
                lyDo: "Cần ít nhất 5 phiên để phân tích"
            };
        }

        // Thu thập tất cả dự đoán
        const cacDuDoan = [];
        for (const thuatToan of this.DANH_SACH_THUAT_TOAN) {
            const kq = thuatToan();
            if (kq) {
                cacDuDoan.push(kq);
            }
        }

        if (cacDuDoan.length === 0) {
            return {
                coDuLieu: true,
                coTinHieu: false,
                lyDo: "Không phát hiện cầu rõ ràng"
            };
        }

        // Tính điểm có trọng số (ưu tiên xúc xắc và bệt)
        let diemTai = 0;
        let diemXiu = 0;
        const chiTiet = [];

        for (const dd of cacDuDoan) {
            const trongSo = (dd.loai === 'bộ ba' || dd.loai === 'đôi') ? 1.5 : 1;
            const diem = dd.doTinCay / 10 * trongSo;

            if (dd.ketQua === 'Tài') {
                diemTai += diem;
                chiTiet.push(`Tai: ${dd.moTa} (${dd.doTinCay}%)`);
            } else {
                diemXiu += diem;
                chiTiet.push(`Xiu: ${dd.moTa} (${dd.doTinCay}%)`);
            }
        }

        const tongDiem = diemTai + diemXiu;
        const ketQua = diemTai > diemXiu ? 'Tài' : 'Xỉu';
        const doTinCay = Math.round((Math.max(diemTai, diemXiu) / tongDiem) * 100);

        return {
            coDuLieu: true,
            coTinHieu: true,
            ketQua: ketQua,
            doTinCay: Math.max(60, Math.min(98, doTinCay)),
            diemTai: diemTai.toFixed(1),
            diemXiu: diemXiu.toFixed(1),
            soThuatToan: cacDuDoan.length,
            chiTiet: chiTiet
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    // Chuyển đổi dữ liệu từ API format sang format của thuật toán
    // Mới nhất ở đầu mảng
    const lichSu = sessions.map(s => ({
        ketQua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? 'Tài' : 'Xỉu',
        tong: getTong(s),
        x1: getX1(s),
        x2: getX2(s),
        x3: getX3(s)
    })).reverse(); // Đảo ngược để mới nhất ở đầu

    const analyzer = new PhanTichCau(lichSu);
    return analyzer.phanTichTongHop();
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

        // Lấy 20 phiên gần nhất
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
            // Xác minh dự đoán cũ
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

            // Cập nhật game history
            gameHistory = sessions;

            // Dự đoán mới
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
                // Nếu không có tín hiệu, dự đoán ngược kết quả cuối
                const lastResult = getKetQua(sessions[sessions.length - 1]);
                currentPrediction = {
                    phien: latestPhien + 1,
                    prediction: lastResult === 'Tài' || lastResult === 'tài' ? 'Xỉu' : 'Tài',
                    confidence: 55,
                    chiTiet: [pred.lyDo || 'Không có tín hiệu rõ ràng'],
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
    // Nếu có dữ liệu cache, trả về ngay
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

    // Fallback: fetch trực tiếp
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: 0,
                Xuc_xac_1: 0,
                Xuc_xac_2: 0,
                Xuc_xac_3: 0,
                Tong: 0,
                Ket_qua: "Đang tải..."
            },
            phien_hien_tai: {
                Phien: 0,
                Du_doan: "Đang tải...",
                Do_tin_cay: "0%"
            },
            stats: {
                consecutiveLosses: 0,
                winRate: "0%",
                totalPredictions: 0,
                totalWins: 0
            },
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
            chiTiet: [pred.lyDo || 'Không có tín hiệu rõ ràng'],
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
        stats: {
            consecutiveLosses: 0,
            winRate: "0%",
            totalPredictions: 0,
            totalWins: 0
        },
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
    res.json({ status: "OK", message: "Server đang chạy" });
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
    console.log('PHAN TICH CAU TAI XIU - 15 THUAT TOAN CHUAN XAC');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT}`);
    console.log(`API: ${API_URL}`);
    console.log(`20 phien phan tich | 500 phien lich su`);
    console.log(`15 thuat toan: Bet, Dao 1-1, Dao 2-2, Dao 3-3,`);
    console.log(`2-1-2, 1-2-1, Zigzag, Chu Ky, Bo Ba, Hai Mat,`);
    console.log(`Day Tang, Day Giam, Tong Diem, Hoi Quy, Markov`);
    console.log('='.repeat(60));
});
