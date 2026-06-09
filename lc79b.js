const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 30000;
let wins = 0;
let losses = 0;
let predictorInstance = null;

const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 'Tài' : 'Xỉu',
        tong: item.point || 0,
        xuc_xac_1: (item.dices && item.dices[0]) || 0,
        xuc_xac_2: (item.dices && item.dices[1]) || 0,
        xuc_xac_3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

function loadHistory() {
    try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); }
    catch (e) { verifiedResults = []; }
}
function saveHistory() {
    try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); } catch (e) {}
}
function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const d = duDoan.toLowerCase().trim(), k = ketQua.toLowerCase().trim();
    const isCorrect = d === k;
    verifiedResults.unshift({
        phien, du_doan: duDoan, ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    if (predictorInstance && predictorInstance.capNhatKetQua) {
        predictorInstance.capNhatKetQua(ketQua);
    }
    return isCorrect;
}

class SieuCapBaoChua {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.allCau = this.phatHienTatCaCau();
        this.cauLa = {};
        
        this.stats = {
            trades: [], wins: 0, losses: 0, consecutiveLosses: 0, consecutiveWins: 0,
            last10Accuracy: 1.0, last20Accuracy: 1.0, adaptiveThreshold: 65
        };
        
        this.cauPerformance = {};
        this.beCauHistory = [];
        this.tonGiaoCau = [];
        this.cauHuyenThoai = {};
        
        for (let key in this.allCau) {
            this.cauPerformance[key] = { wins: 0, losses: 0, confidence: 75, lastUsed: 0, successRate: 0.75, totalUsed: 0 };
        }
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            
            let taiStreak = 0, xiuStreak = 0;
            if (item.ket_qua === "Tài") {
                taiStreak = idx > 0 && arr[idx - 1].ket_qua === "Tài" ? arr[idx - 1].taiStreak + 1 : 1;
                xiuStreak = 0;
            } else {
                xiuStreak = idx > 0 && arr[idx - 1].ket_qua === "Xỉu" ? arr[idx - 1].xiuStreak + 1 : 1;
                taiStreak = 0;
            }
            
            let face1Streak = 0, face2Streak = 0, face3Streak = 0, face4Streak = 0, face5Streak = 0, face6Streak = 0;
            for (let j = idx; j >= 0; j--) {
                const d = arr[j];
                if (d.xuc_xac_1 === 1 || d.xuc_xac_2 === 1 || d.xuc_xac_3 === 1) face1Streak++; else break;
            }
            for (let j = idx; j >= 0; j--) {
                const d = arr[j];
                if (d.xuc_xac_1 === 6 || d.xuc_xac_2 === 6 || d.xuc_xac_3 === 6) face6Streak++; else break;
            }
            
            return {
                phien: item.phien, result: item.ket_qua === "Tài" ? 1 : 0, resultStr: item.ket_qua,
                total: item.tong, streak: streak, taiStreak: taiStreak, xiuStreak: xiuStreak,
                face1Streak, face2Streak, face3Streak, face4Streak, face5Streak, face6Streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2], tripleVal: dice[0], sum: dice[0] + dice[1] + dice[2]
            };
        });
    }

    phatHienTatCaCau() {
        return {
            ...this.cauBetCoBan(),
            ...this.cauBeBetThongMinh(),
            ...this.cauBatBetSom(),
            ...this.cauXenKe(),
            ...this.cauCapDoi(),
            ...this.cauKetHop(),
            ...this.cauDacBiet(),
            ...this.cauHinhHoc(),
            ...this.cauToanHocCaoCap(),
            ...this.cauThongKeNangCao(),
            ...this.cauLichSu(),
            ...this.cauDuBao(),
            ...this.cauPhongThuy(),
            ...this.cauThanSoHoc(),
            ...this.cauThienVan(),
            ...this.cauNhapMon(),
            ...this.cauKinhDi()
        };
    }

    // ========== CAU BET CO BAN TU 2-20 ==========
    cauBetCoBan() {
        const obj = {};
        for (let i = 2; i <= 20; i++) {
            obj[`bet_${i}_tai`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if (last.every(r => r === 1)) {
                    let conf = Math.min(99, 75 + i);
                    if (i >= 15) conf = 99;
                    return { type: `bet_${i}_tai`, prediction: "Tài", confidence: conf, description: `Bệt Tài ${i}` };
                }
                return null;
            };
            obj[`bet_${i}_xiu`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if (last.every(r => r === 0)) {
                    let conf = Math.min(99, 75 + i);
                    if (i >= 15) conf = 99;
                    return { type: `bet_${i}_xiu`, prediction: "Xỉu", confidence: conf, description: `Bệt Xỉu ${i}` };
                }
                return null;
            };
        }
        return obj;
    }

    // ========== CAU BE BET THONG MINH ==========
    cauBeBetThongMinh() {
        return {
            be_cau_than_thoai: () => {
                const last12 = this.processed.slice(-12);
                let tai = 0, xiu = 0;
                for (let i of last12) if (i.result === 1) tai++; else xiu++;
                if (tai >= 10) return { type: "be_cau_than_thoai", prediction: "Xỉu", confidence: 94, description: "Bẻ cầu thần thoại - 10/12 Tài" };
                if (xiu >= 10) return { type: "be_cau_than_thoai", prediction: "Tài", confidence: 94, description: "Bẻ cầu thần thoại - 10/12 Xỉu" };
                return null;
            },
            be_cau_bao_nhiem: () => {
                const last8 = this.processed.slice(-8);
                let tai = 0;
                for (let i of last8) if (i.result === 1) tai++;
                if (tai === 8) return { type: "be_cau_bao_nhiem", prediction: "Xỉu", confidence: 96, description: "Bẻ cầu bão nhiệm - 8/8 Tài" };
                if (tai === 0) return { type: "be_cau_bao_nhiem", prediction: "Tài", confidence: 96, description: "Bẻ cầu bão nhiệm - 8/8 Xỉu" };
                return null;
            },
            be_cau_vu_tru: () => {
                const last10 = this.processed.slice(-10);
                let chang = 0;
                for (let i = 1; i < last10.length; i++) if (last10[i].result === last10[i-1].result) chang++;
                if (chang >= 8) {
                    const last = last10[last10.length-1].result;
                    return { type: "be_cau_vu_tru", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 88, description: "Bẻ cầu vũ trụ - trùng lặp quá nhiều" };
                }
                return null;
            },
            be_cau_than_chet: () => {
                if (this.stats.consecutiveLosses >= 3) {
                    return { type: "be_cau_than_chet", prediction: this.processed[this.processed.length-1].result === 1 ? "Xỉu" : "Tài", confidence: 85, description: "Bẻ cầu thần chết - sau 3 thua" };
                }
                return null;
            }
        };
    }

    // ========== CAU BAT BET SOM ==========
    cauBatBetSom() {
        const obj = {};
        for (let i = 2; i <= 5; i++) {
            obj[`bat_bet_som_tai_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if (last.every(r => r === 1)) {
                    let conf = 70 + i * 3;
                    return { type: `bat_bet_som_tai_${i}`, prediction: "Tài", confidence: Math.min(88, conf), description: `Bắt bệt Tài sớm - ${i} phiên` };
                }
                return null;
            };
            obj[`bat_bet_som_xiu_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if (last.every(r => r === 0)) {
                    let conf = 70 + i * 3;
                    return { type: `bat_bet_som_xiu_${i}`, prediction: "Xỉu", confidence: Math.min(88, conf), description: `Bắt bệt Xỉu sớm - ${i} phiên` };
                }
                return null;
            };
        }
        return obj;
    }

    // ========== CAU XEN KE ==========
    cauXenKe() {
        return {
            cau_1_1: () => { const last = this.processed.slice(-10).map(p => p.result); let alt = true; for (let i = 1; i < last.length; i++) if (last[i] === last[i-1]) alt = false; if (alt && last.length >= 6) return { type: "cau_1_1", prediction: last[last.length-1] === 1 ? "Xỉu" : "Tài", confidence: 88, description: "Cầu 1-1" }; return null; },
            cau_1_1_vip: () => { const last = this.processed.slice(-14).map(p => p.result); let alt = true; for (let i = 1; i < last.length; i++) if (last[i] === last[i-1]) alt = false; if (alt && last.length >= 10) return { type: "cau_1_1_vip", prediction: last[last.length-1] === 1 ? "Xỉu" : "Tài", confidence: 92, description: "Cầu 1-1 VIP - dài 10+" }; return null; },
            cau_2_1: () => { const last = this.processed.slice(-3).map(p => p.result); if (last[0] === last[1] && last[2] !== last[1]) return { type: "cau_2_1", prediction: last[2] === 1 ? "Xỉu" : "Tài", confidence: 82, description: "Cầu 2-1" }; return null; },
            cau_1_2: () => { const last = this.processed.slice(-3).map(p => p.result); if (last[0] !== last[1] && last[1] === last[2]) return { type: "cau_1_2", prediction: last[2] === 1 ? "Tài" : "Xỉu", confidence: 82, description: "Cầu 1-2" }; return null; },
            cau_3_1: () => { const last = this.processed.slice(-4).map(p => p.result); if (last[0]===1 && last[1]===1 && last[2]===1 && last[3]===0) return { type: "cau_3_1", prediction: "Xỉu", confidence: 87, description: "Cầu 3 Tài 1 Xỉu" }; if (last[0]===0 && last[1]===0 && last[2]===0 && last[3]===1) return { type: "cau_3_1", prediction: "Tài", confidence: 87, description: "Cầu 3 Xỉu 1 Tài" }; return null; },
            cau_1_3: () => { const last = this.processed.slice(-4).map(p => p.result); if (last[0]===1 && last[1]===0 && last[2]===0 && last[3]===0) return { type: "cau_1_3", prediction: "Xỉu", confidence: 86, description: "Cầu 1 Tài 3 Xỉu" }; if (last[0]===0 && last[1]===1 && last[2]===1 && last[3]===1) return { type: "cau_1_3", prediction: "Tài", confidence: 86, description: "Cầu 1 Xỉu 3 Tài" }; return null; }
        };
    }

    // ========== CAU CAP DOI ==========
    cauCapDoi() {
        return {
            cau_2_2: () => { const last = this.processed.slice(-4).map(p => p.result); if (last[0]===last[1] && last[2]===last[3] && last[0]!==last[2]) return { type: "cau_2_2", prediction: last[3]===1 ? "Xỉu" : "Tài", confidence: 86, description: "Cầu 2-2" }; return null; },
            cau_2_2_2: () => { const last = this.processed.slice(-6).map(p => p.result); if (last[0]===last[1] && last[2]===last[3] && last[4]===last[5] && last[0]!==last[2] && last[2]!==last[4]) return { type: "cau_2_2_2", prediction: last[5]===1 ? "Xỉu" : "Tài", confidence: 91, description: "Cầu 2-2-2" }; return null; },
            cau_2_2_2_2: () => { const last = this.processed.slice(-8).map(p => p.result); if (last[0]===last[1] && last[2]===last[3] && last[4]===last[5] && last[6]===last[7] && last[0]!==last[2] && last[2]!==last[4] && last[4]!==last[6]) return { type: "cau_2_2_2_2", prediction: last[7]===1 ? "Xỉu" : "Tài", confidence: 94, description: "Cầu 2-2-2-2" }; return null; },
            cau_3_3: () => { const last = this.processed.slice(-6).map(p => p.result); if (last[0]===1 && last[1]===1 && last[2]===1 && last[3]===0 && last[4]===0 && last[5]===0) return { type: "cau_3_3", prediction: "Tài", confidence: 89, description: "Cầu 3-3" }; if (last[0]===0 && last[1]===0 && last[2]===0 && last[3]===1 && last[4]===1 && last[5]===1) return { type: "cau_3_3", prediction: "Xỉu", confidence: 89, description: "Cầu 3-3" }; return null; },
            cau_3_3_3: () => { const last = this.processed.slice(-9).map(p => p.result); if (last[0]===1 && last[1]===1 && last[2]===1 && last[3]===0 && last[4]===0 && last[5]===0 && last[6]===1 && last[7]===1 && last[8]===1) return { type: "cau_3_3_3", prediction: "Xỉu", confidence: 93, description: "Cầu 3-3-3" }; if (last[0]===0 && last[1]===0 && last[2]===0 && last[3]===1 && last[4]===1 && last[5]===1 && last[6]===0 && last[7]===0 && last[8]===0) return { type: "cau_3_3_3", prediction: "Tài", confidence: 93, description: "Cầu 3-3-3" }; return null; },
            cau_4_4: () => { const last = this.processed.slice(-8).map(p => p.result); if (last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===0 && last[5]===0 && last[6]===0 && last[7]===0) return { type: "cau_4_4", prediction: "Tài", confidence: 91, description: "Cầu 4-4" }; if (last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===1 && last[5]===1 && last[6]===1 && last[7]===1) return { type: "cau_4_4", prediction: "Xỉu", confidence: 91, description: "Cầu 4-4" }; return null; },
            cau_4_4_4: () => { const last = this.processed.slice(-12).map(p => p.result); if (last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===0 && last[5]===0 && last[6]===0 && last[7]===0 && last[8]===1 && last[9]===1 && last[10]===1 && last[11]===1) return { type: "cau_4_4_4", prediction: "Xỉu", confidence: 95, description: "Cầu 4-4-4" }; if (last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===1 && last[5]===1 && last[6]===1 && last[7]===1 && last[8]===0 && last[9]===0 && last[10]===0 && last[11]===0) return { type: "cau_4_4_4", prediction: "Tài", confidence: 95, description: "Cầu 4-4-4" }; return null; }
        };
    }

    // ========== CAU KET HOP ==========
    cauKetHop() {
        return {
            cau_2_3: () => { const last = this.processed.slice(-5).map(p => p.result); if (last[0]===last[1] && last[2]===last[3] && last[4]!==last[3]) return { type: "cau_2_3", prediction: last[4]===1 ? "Xỉu" : "Tài", confidence: 85, description: "Cầu 2-3" }; return null; },
            cau_3_2: () => { const last = this.processed.slice(-5).map(p => p.result); if (last[0]===last[1] && last[1]===last[2] && last[3]===last[4] && last[2]!==last[3]) return { type: "cau_3_2", prediction: last[4]===1 ? "Xỉu" : "Tài", confidence: 86, description: "Cầu 3-2" }; return null; },
            cau_2_4: () => { const last = this.processed.slice(-6).map(p => p.result); if (last[0]===last[1] && last[2]===last[3] && last[4]===last[5] && last[0]!==last[2] && last[2]!==last[4]) return { type: "cau_2_4", prediction: last[5]===1 ? "Xỉu" : "Tài", confidence: 87, description: "Cầu 2-4" }; return null; },
            cau_4_2: () => { const last = this.processed.slice(-6).map(p => p.result); if (last[0]===last[1] && last[1]===last[2] && last[2]===last[3] && last[4]===last[5] && last[3]!==last[4]) return { type: "cau_4_2", prediction: last[5]===1 ? "Xỉu" : "Tài", confidence: 88, description: "Cầu 4-2" }; return null; }
        };
    }

    // ========== CAU DANG CAP - CAU LA ==========
    cauDacBiet() {
        return {
            cau_fibonacci: () => {
                const last = this.processed.slice(-21).map(p => p.result);
                const fib = [1,1,2,3,5,8,13];
                for (let i = 0; i < fib.length - 2; i++) {
                    const len = fib[i] + fib[i+1];
                    if (last.length >= len) {
                        let ok = true;
                        for (let j = 0; j < fib[i]; j++) if (last[last.length - len + j] !== 1) ok = false;
                        if (ok) for (let j = 0; j < fib[i+1]; j++) if (last[last.length - len + fib[i] + j] !== 0) ok = false;
                        if (ok) return { type: "cau_fibonacci", prediction: "Tài", confidence: 90, description: "Cầu Fibonacci" };
                    }
                }
                return null;
            },
            cau_fibonacci_nguoc: () => {
                const last = this.processed.slice(-21).map(p => p.result);
                const fib = [1,1,2,3,5,8,13];
                for (let i = 0; i < fib.length - 2; i++) {
                    const len = fib[i] + fib[i+1];
                    if (last.length >= len) {
                        let ok = true;
                        for (let j = 0; j < fib[i]; j++) if (last[last.length - len + j] !== 0) ok = false;
                        if (ok) for (let j = 0; j < fib[i+1]; j++) if (last[last.length - len + fib[i] + j] !== 1) ok = false;
                        if (ok) return { type: "cau_fibonacci_nguoc", prediction: "Xỉu", confidence: 89, description: "Cầu Fibonacci ngược" };
                    }
                }
                return null;
            },
            cau_so_hoc: () => {
                const last10 = this.processed.slice(-10).map(p => p.total);
                let diff = [];
                for (let i = 1; i < last10.length; i++) diff.push(last10[i] - last10[i-1]);
                let allSame = diff.every(d => d === diff[0]);
                if (allSame && diff[0] !== 0) {
                    const next = last10[last10.length-1] + diff[0];
                    const pred = next >= 11 ? "Tài" : "Xỉu";
                    return { type: "cau_so_hoc", prediction: pred, confidence: 84, description: `Cầu số học - cấp số cộng ${diff[0]}` };
                }
                return null;
            },
            cau_nhan_ban: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                if (last8[0] === last8[2] && last8[2] === last8[4] && last8[4] === last8[6] &&
                    last8[1] === last8[3] && last8[3] === last8[5] && last8[5] === last8[7] &&
                    last8[0] !== last8[1]) {
                    return { type: "cau_nhan_ban", prediction: last8[7] === 1 ? "Xỉu" : "Tài", confidence: 92, description: "Cầu nhân bản" };
                }
                return null;
            },
            cau_xoay_vong_hoan_hao: () => {
                const last12 = this.processed.slice(-12).map(p => p.result);
                const pattern = [1,0,1,0,1,0,1,0,1,0,1,0];
                let match = 0;
                for (let i = 0; i < 12; i++) if (last12[i] === pattern[i]) match++;
                if (match >= 10) return { type: "cau_xoay_vong_hoan_hao", prediction: "Xỉu", confidence: 93, description: "Cầu xoay vòng hoàn hảo" };
                const pattern2 = [0,1,0,1,0,1,0,1,0,1,0,1];
                match = 0;
                for (let i = 0; i < 12; i++) if (last12[i] === pattern2[i]) match++;
                if (match >= 10) return { type: "cau_xoay_vong_hoan_hao", prediction: "Tài", confidence: 93, description: "Cầu xoay vòng hoàn hảo" };
                return null;
            }
        };
    }

    // ========== CAU HINH HOC ==========
    cauHinhHoc() {
        return {
            cau_tam_giac_deu: () => {
                const last9 = this.processed.slice(-9).map(p => p.result);
                if (last9[0]===1 && last9[1]===1 && last9[2]===0 && last9[3]===1 && last9[4]===0 && last9[5]===1 && last9[6]===0 && last9[7]===1 && last9[8]===1) return { type: "cau_tam_giac_deu", prediction: "Xỉu", confidence: 89, description: "Cầu tam giác đều" };
                if (last9[0]===0 && last9[1]===0 && last9[2]===1 && last9[3]===0 && last9[4]===1 && last9[5]===0 && last9[6]===1 && last9[7]===0 && last9[8]===0) return { type: "cau_tam_giac_deu", prediction: "Tài", confidence: 89, description: "Cầu tam giác đều" };
                return null;
            },
            cau_hinh_thang_can: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                if (last8[0]===1 && last8[1]===1 && last8[2]===0 && last8[3]===0 && last8[4]===1 && last8[5]===1 && last8[6]===0 && last8[7]===0) return { type: "cau_hinh_thang_can", prediction: "Xỉu", confidence: 88, description: "Cầu hình thang cân" };
                if (last8[0]===0 && last8[1]===0 && last8[2]===1 && last8[3]===1 && last8[4]===0 && last8[5]===0 && last8[6]===1 && last8[7]===1) return { type: "cau_hinh_thang_can", prediction: "Tài", confidence: 88, description: "Cầu hình thang cân" };
                return null;
            },
            cau_hinh_vuong: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                if (last8[0]===1 && last8[1]===0 && last8[2]===0 && last8[3]===1 && last8[4]===1 && last8[5]===0 && last8[6]===0 && last8[7]===1) return { type: "cau_hinh_vuong", prediction: "Xỉu", confidence: 87, description: "Cầu hình vuông" };
                if (last8[0]===0 && last8[1]===1 && last8[2]===1 && last8[3]===0 && last8[4]===0 && last8[5]===1 && last8[6]===1 && last8[7]===0) return { type: "cau_hinh_vuong", prediction: "Tài", confidence: 87, description: "Cầu hình vuông" };
                return null;
            },
            cau_duong_cheo_vang: () => {
                const last10 = this.processed.slice(-10).map(p => p.result);
                const pos = [0,2,4,6,8];
                const vals = pos.map(p => last10[p]);
                if (vals.every(v => v === 1)) return { type: "cau_duong_cheo_vang", prediction: "Xỉu", confidence: 88, description: "Cầu đường chéo vàng" };
                if (vals.every(v => v === 0)) return { type: "cau_duong_cheo_vang", prediction: "Tài", confidence: 88, description: "Cầu đường chéo vàng" };
                return null;
            }
        };
    }

    // ========== CAU TOAN HOC CAO CAP ==========
    cauToanHocCaoCap() {
        return {
            cau_markov_bac_3: () => {
                const last3 = this.processed.slice(-3).map(p => p.result).join('');
                let trans = {};
                for (let i = 0; i < this.processed.length - 3; i++) {
                    const state = this.processed.slice(i, i+3).map(p => p.result).join('');
                    const next = this.processed[i+3].result;
                    if (!trans[state]) trans[state] = { tai: 0, xiu: 0 };
                    if (next === 1) trans[state].tai++; else trans[state].xiu++;
                }
                if (trans[last3] && trans[last3].tai + trans[last3].xiu >= 20) {
                    const pTai = trans[last3].tai / (trans[last3].tai + trans[last3].xiu);
                    if (pTai >= 0.7 || pTai <= 0.3) {
                        return { type: "cau_markov_bac_3", prediction: pTai >= 0.7 ? "Tài" : "Xỉu", confidence: 82 + Math.abs(pTai - 0.5) * 30, description: `Markov bậc 3 - ${(trans[last3].tai + trans[last3].xiu)} mẫu` };
                    }
                }
                return null;
            },
            cau_markov_bac_4: () => {
                const last4 = this.processed.slice(-4).map(p => p.result).join('');
                let trans = {};
                for (let i = 0; i < this.processed.length - 4; i++) {
                    const state = this.processed.slice(i, i+4).map(p => p.result).join('');
                    const next = this.processed[i+4].result;
                    if (!trans[state]) trans[state] = { tai: 0, xiu: 0 };
                    if (next === 1) trans[state].tai++; else trans[state].xiu++;
                }
                if (trans[last4] && trans[last4].tai + trans[last4].xiu >= 15) {
                    const pTai = trans[last4].tai / (trans[last4].tai + trans[last4].xiu);
                    if (pTai >= 0.75 || pTai <= 0.25) {
                        return { type: "cau_markov_bac_4", prediction: pTai >= 0.75 ? "Tài" : "Xỉu", confidence: 84 + Math.abs(pTai - 0.5) * 30, description: `Markov bậc 4 - ${trans[last4].tai + trans[last4].xiu} mẫu` };
                    }
                }
                return null;
            },
            cau_xac_suat_doi: () => {
                const last = this.processed[this.processed.length - 1];
                let taiAfterTai = 0, xiuAfterTai = 0, taiAfterXiu = 0, xiuAfterXiu = 0;
                for (let i = 1; i < this.processed.length; i++) {
                    if (this.processed[i-1].result === 1) {
                        if (this.processed[i].result === 1) taiAfterTai++; else xiuAfterTai++;
                    } else {
                        if (this.processed[i].result === 1) taiAfterXiu++; else xiuAfterXiu++;
                    }
                }
                if (last.result === 1) {
                    const total = taiAfterTai + xiuAfterTai;
                    if (total >= 40) {
                        const pTai = taiAfterTai / total;
                        if (pTai >= 0.75) return { type: "cau_xac_suat_doi", prediction: "Tài", confidence: 86, description: `XS Tài sau Tài: ${(pTai*100).toFixed(1)}% (${total} mẫu)` };
                        const pXiu = xiuAfterTai / total;
                        if (pXiu >= 0.75) return { type: "cau_xac_suat_doi", prediction: "Xỉu", confidence: 86, description: `XS Xỉu sau Tài: ${(pXiu*100).toFixed(1)}% (${total} mẫu)` };
                    }
                } else {
                    const total = taiAfterXiu + xiuAfterXiu;
                    if (total >= 40) {
                        const pTai = taiAfterXiu / total;
                        if (pTai >= 0.75) return { type: "cau_xac_suat_doi", prediction: "Tài", confidence: 86, description: `XS Tài sau Xỉu: ${(pTai*100).toFixed(1)}% (${total} mẫu)` };
                        const pXiu = xiuAfterXiu / total;
                        if (pXiu >= 0.75) return { type: "cau_xac_suat_doi", prediction: "Xỉu", confidence: 86, description: `XS Xỉu sau Xỉu: ${(pXiu*100).toFixed(1)}% (${total} mẫu)` };
                    }
                }
                return null;
            },
            cau_hoi_quy_tuyen_tinh: () => {
                const last15 = this.processed.slice(-15).map(p => p.result);
                let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
                for (let i = 0; i < last15.length; i++) {
                    sumX += i;
                    sumY += last15[i];
                    sumXY += i * last15[i];
                    sumX2 += i * i;
                }
                const n = last15.length;
                const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
                const pred = slope * n + (sumY - slope * sumX) / n;
                if (Math.abs(slope) > 0.15) {
                    return { type: "cau_hoi_quy_tuyen_tinh", prediction: pred > 0.5 ? "Tài" : "Xỉu", confidence: 78 + Math.abs(slope) * 40, description: `Hồi quy - độ dốc ${slope.toFixed(2)}` };
                }
                return null;
            }
        };
    }

    // ========== CAU THONG KE NANG CAO ==========
    cauThongKeNangCao() {
        return {
            cau_thong_ke_tan_suat_vang: () => {
                const last30 = this.processed.slice(-30);
                let tai = 0;
                for (let i of last30) if (i.result === 1) tai++;
                const rate = tai / 30;
                if (rate >= 0.7) return { type: "cau_thong_ke_tan_suat_vang", prediction: "Xỉu", confidence: 82, description: `Tần suất Tài ${(rate*100).toFixed(0)}% - bẻ về Xỉu` };
                if (rate <= 0.3) return { type: "cau_thong_ke_tan_suat_vang", prediction: "Tài", confidence: 82, description: `Tần suất Xỉu ${((1-rate)*100).toFixed(0)}% - bẻ về Tài` };
                return null;
            },
            cau_thong_ke_streak_tai: () => {
                const last = this.processed[this.processed.length - 1];
                if (last.taiStreak >= 3) {
                    let conf = 80;
                    if (last.taiStreak >= 5) conf = 86;
                    if (last.taiStreak >= 7) conf = 92;
                    return { type: "cau_thong_ke_streak_tai", prediction: "Tài", confidence: conf, description: `Thống kê - tiếp đà Tài ${last.taiStreak}` };
                }
                if (last.xiuStreak >= 3) {
                    let conf = 80;
                    if (last.xiuStreak >= 5) conf = 86;
                    if (last.xiuStreak >= 7) conf = 92;
                    return { type: "cau_thong_ke_streak_xiu", prediction: "Xỉu", confidence: conf, description: `Thống kê - tiếp đà Xỉu ${last.xiuStreak}` };
                }
                return null;
            },
            cau_thong_ke_face_vang: () => {
                const last = this.processed[this.processed.length - 1];
                if (last.face1Streak >= 8) return { type: "cau_thong_ke_face_vang", prediction: "Xỉu", confidence: 88, description: `Mặt 1 vắng ${last.face1Streak} phiên - Xỉu mạnh` };
                if (last.face6Streak >= 8) return { type: "cau_thong_ke_face_vang", prediction: "Tài", confidence: 88, description: `Mặt 6 vắng ${last.face6Streak} phiên - Tài mạnh` };
                if (last.face1Streak >= 12) return { type: "cau_thong_ke_face_vang", prediction: "Xỉu", confidence: 94, description: `Mặt 1 vắng ${last.face1Streak} phiên - siêu Xỉu` };
                if (last.face6Streak >= 12) return { type: "cau_thong_ke_face_vang", prediction: "Tài", confidence: 94, description: `Mặt 6 vắng ${last.face6Streak} phiên - siêu Tài` };
                return null;
            }
        };
    }

    // ========== CAU LICH SU ==========
    cauLichSu() {
        return {
            cau_lich_su_vang: () => {
                const last10 = this.processed.slice(-10).map(p => p.resultStr);
                let best = null;
                let bestSim = 0;
                for (let i = 0; i < this.processed.length - 15; i++) {
                    let sim = 0;
                    for (let j = 0; j < 10; j++) if (this.processed[i + j].resultStr === last10[j]) sim++;
                    const rate = sim / 10;
                    if (rate > bestSim && rate >= 0.85) {
                        bestSim = rate;
                        best = this.processed[i + 10].resultStr;
                    }
                }
                if (best && bestSim >= 0.85) {
                    const conf = 78 + (bestSim - 0.8) * 80;
                    return { type: "cau_lich_su_vang", prediction: best, confidence: Math.min(94, conf), description: `Lịch sử vàng - ${(bestSim*100).toFixed(0)}% giống` };
                }
                return null;
            },
            cau_lich_su_linh_thieng: () => {
                const last15 = this.processed.slice(-15).map(p => p.resultStr);
                let best = null;
                let bestSim = 0;
                for (let i = 0; i < this.processed.length - 20; i++) {
                    let sim = 0;
                    for (let j = 0; j < 15; j++) if (this.processed[i + j].resultStr === last15[j]) sim++;
                    const rate = sim / 15;
                    if (rate > bestSim && rate >= 0.8) {
                        bestSim = rate;
                        best = this.processed[i + 15].resultStr;
                    }
                }
                if (best && bestSim >= 0.8) {
                    const conf = 75 + (bestSim - 0.75) * 70;
                    return { type: "cau_lich_su_linh_thieng", prediction: best, confidence: Math.min(92, conf), description: `Lịch sử linh thiêng - ${(bestSim*100).toFixed(0)}% giống` };
                }
                return null;
            }
        };
    }

    // ========== CAU DU BAO ==========
    cauDuBao() {
        return {
            cau_du_bao_chu_ky: () => {
                const last20 = this.processed.slice(-20).map(p => p.result);
                for (let period = 2; period <= 10; period++) {
                    let matches = 0;
                    for (let i = 0; i < 20 - period; i++) {
                        if (last20[i] === last20[i + period]) matches++;
                    }
                    if (matches >= 15) {
                        const pred = last20[last20.length - period];
                        return { type: "cau_du_bao_chu_ky", prediction: pred === 1 ? "Tài" : "Xỉu", confidence: 85, description: `Chu kỳ ${period} phiên - lặp lại hoàn hảo` };
                    }
                }
                return null;
            },
            cau_du_bao_bien_dong: () => {
                const last12 = this.processed.slice(-12);
                let changes = 0;
                for (let i = 1; i < last12.length; i++) if (last12[i].result !== last12[i-1].result) changes++;
                if (changes >= 9) {
                    const last = last12[last12.length-1].result;
                    return { type: "cau_du_bao_bien_dong", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 86, description: "Biến động mạnh - đánh ngược" };
                }
                if (changes <= 3) {
                    const last = last12[last12.length-1].result;
                    return { type: "cau_du_bao_bien_dong", prediction: last === 1 ? "Tài" : "Xỉu", confidence: 84, description: "Ít biến động - tiếp đà" };
                }
                return null;
            }
        };
    }

    // ========== CAU PHONG THUY ==========
    cauPhongThuy() {
        return {
            cau_ngu_hanh: () => {
                const last5 = this.processed.slice(-5).map(p => p.result);
                const taiCount = last5.filter(r => r === 1).length;
                if (taiCount === 3) {
                    const last = last5[last5.length-1];
                    return { type: "cau_ngu_hanh", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 72, description: "Ngũ hành - cân bằng 3-2" };
                }
                if (taiCount >= 4) return { type: "cau_ngu_hanh", prediction: "Xỉu", confidence: 76, description: "Ngũ hành - Tài vượng quá" };
                if (taiCount <= 1) return { type: "cau_ngu_hanh", prediction: "Tài", confidence: 76, description: "Ngũ hành - Xỉu vượng quá" };
                return null;
            },
            cau_am_duong: () => {
                const last8 = this.processed.slice(-8).map(p => p.total);
                let duong = 0, am = 0;
                for (let t of last8) {
                    if (t >= 11) duong++; else am++;
                }
                if (duong >= 6) return { type: "cau_am_duong", prediction: "Xỉu", confidence: 78, description: "Dương vượng - bẻ về Âm" };
                if (am >= 6) return { type: "cau_am_duong", prediction: "Tài", confidence: 78, description: "Âm vượng - bẻ về Dương" };
                return null;
            }
        };
    }

    // ========== CAU THAN SO HOC ==========
    cauThanSoHoc() {
        return {
            cau_than_so: () => {
                const last = this.processed[this.processed.length - 1];
                const tong = last.total;
                const thanSo = (tong % 9) || 9;
                const history = [];
                for (let i = 0; i < this.processed.length - 1; i++) {
                    const ts = (this.processed[i].total % 9) || 9;
                    if (ts === thanSo) history.push(this.processed[i+1].result);
                }
                if (history.length >= 10) {
                    const tai = history.filter(r => r === 1).length;
                    const rate = tai / history.length;
                    if (rate >= 0.7 || rate <= 0.3) {
                        return { type: "cau_than_so", prediction: rate >= 0.7 ? "Tài" : "Xỉu", confidence: 80, description: `Thần số học - số ${thanSo} - ${(rate*100).toFixed(0)}%` };
                    }
                }
                return null;
            }
        };
    }

    // ========== CAU THIEN VAN ==========
    cauThienVan() {
        return {
            cau_sao_bang: () => {
                const last3 = this.processed.slice(-3);
                if (last3[0].isTriple || last3[1].isTriple || last3[2].isTriple) {
                    const hasTriple = last3.find(p => p.isTriple);
                    if (hasTriple) {
                        const pred = hasTriple.tripleVal <= 3 ? "Xỉu" : "Tài";
                        return { type: "cau_sao_bang", prediction: pred, confidence: 88, description: `Sao băng - bộ ba ${hasTriple.tripleVal} xuất hiện` };
                    }
                }
                return null;
            },
            cau_nhat_thuc: () => {
                const last = this.processed[this.processed.length - 1];
                if (last.isTriple && last.tripleVal === 1) return { type: "cau_nhat_thuc", prediction: "Xỉu", confidence: 96, description: "Nhật thực - bộ ba 1" };
                if (last.isTriple && last.tripleVal === 6) return { type: "cau_nhat_thuc", prediction: "Tài", confidence: 96, description: "Nhật thực - bộ ba 6" };
                return null;
            }
        };
    }

    // ========== CAU NHAP MON ==========
    cauNhapMon() {
        return {
            cau_mo_mon: () => {
                const last = this.processed[this.processed.length - 1];
                if (last.streak === 1 && this.processed.length >= 2 && this.processed[this.processed.length-2].streak >= 2) {
                    const opp = last.result === 1 ? "Xỉu" : "Tài";
                    return { type: "cau_mo_mon", prediction: opp, confidence: 74, description: "Cầu mở môn - đảo chiều sau bệt" };
                }
                return null;
            },
            cau_nhap_mon_som: () => {
                const last2 = this.processed.slice(-2);
                if (last2[0].result !== last2[1].result) {
                    return { type: "cau_nhap_mon_som", prediction: last2[1].result === 1 ? "Tài" : "Xỉu", confidence: 72, description: "Nhập môn sớm - theo đà" };
                }
                return null;
            }
        };
    }

    // ========== CAU KINH DI ==========
    cauKinhDi() {
        return {
            cau_kinh_di_chuong_1: () => {
                const last7 = this.processed.slice(-7).map(p => p.result);
                if (last7[0] === 1 && last7[1] === 1 && last7[2] === 1 && last7[3] === 1 && last7[4] === 0 && last7[5] === 0 && last7[6] === 0) {
                    return { type: "cau_kinh_di_chuong_1", prediction: "Tài", confidence: 90, description: "Kinh Dịch - Chương 1: 4 Tài 3 Xỉu" };
                }
                if (last7[0] === 0 && last7[1] === 0 && last7[2] === 0 && last7[3] === 0 && last7[4] === 1 && last7[5] === 1 && last7[6] === 1) {
                    return { type: "cau_kinh_di_chuong_1", prediction: "Xỉu", confidence: 90, description: "Kinh Dịch - Chương 1: 4 Xỉu 3 Tài" };
                }
                return null;
            },
            cau_kinh_di_chuong_2: () => {
                const last6 = this.processed.slice(-6).map(p => p.result);
                if (last6[0] === 1 && last6[1] === 1 && last6[2] === 0 && last6[3] === 1 && last6[4] === 1 && last6[5] === 0) {
                    return { type: "cau_kinh_di_chuong_2", prediction: "Xỉu", confidence: 88, description: "Kinh Dịch - Chương 2: 2-1-2-1" };
                }
                if (last6[0] === 0 && last6[1] === 0 && last6[2] === 1 && last6[3] === 0 && last6[4] === 0 && last6[5] === 1) {
                    return { type: "cau_kinh_di_chuong_2", prediction: "Tài", confidence: 88, description: "Kinh Dịch - Chương 2: 2-1-2-1" };
                }
                return null;
            }
        };
    }

    dieuChinhThichNghi(opportunities) {
        if (opportunities.length === 0) return [];
        for (let opp of opportunities) {
            const perf = this.cauPerformance[opp.type];
            if (perf) {
                let adj = opp.confidence;
                if (perf.successRate > 0.88) adj += 8;
                else if (perf.successRate > 0.82) adj += 5;
                else if (perf.successRate > 0.76) adj += 3;
                else if (perf.successRate < 0.68) adj -= 15;
                else if (perf.successRate < 0.6) adj -= 22;
                if (this.stats.consecutiveWins >= 3) adj += 6;
                if (this.stats.consecutiveLosses >= 1) adj -= 12;
                if (this.stats.consecutiveLosses >= 2) adj -= 18;
                if (this.stats.consecutiveLosses >= 3) adj -= 25;
                if (perf.totalUsed > 30 && perf.successRate > 0.85) adj += 5;
                opp.confidence = Math.min(99, Math.max(60, adj));
            }
        }
        opportunities.sort((a, b) => {
            if (a.confidence > 95 && b.confidence > 95) return 0;
            return b.confidence - a.confidence;
        });
        return opportunities;
    }

    timKiemCoHoi() {
        const opportunities = [];
        for (let [name, func] of Object.entries(this.allCau)) {
            try {
                const result = func();
                if (result && result.confidence >= 65) {
                    result.type = name;
                    opportunities.push(result);
                }
            } catch(e) {}
        }
        if (opportunities.length === 0) return null;
        const adjusted = this.dieuChinhThichNghi(opportunities);
        if (adjusted.length > 0) {
            const best = adjusted[0];
            if (best.type && this.cauPerformance[best.type]) {
                this.cauPerformance[best.type].lastUsed = Date.now();
                this.cauPerformance[best.type].totalUsed++;
                const total = this.cauPerformance[best.type].wins + this.cauPerformance[best.type].losses + 1;
                this.cauPerformance[best.type].successRate = (this.cauPerformance[best.type].wins + 0.5) / total;
            }
            return best;
        }
        return null;
    }

    duDoan() {
        if (this.stats.consecutiveLosses >= 6) {
            return { shouldBet: false, reason: `THUA ${this.stats.consecutiveLosses} LIEN TIEP - DUNG LAI`, prediction: null, confidence: 0, coolDown: true };
        }
        const opp = this.timKiemCoHoi();
        if (!opp || opp.confidence < this.stats.adaptiveThreshold) {
            return { shouldBet: false, reason: opp ? `TIN CAY ${opp.confidence}% < ${this.stats.adaptiveThreshold}%` : "KHONG TIM THAY CAU", prediction: null, confidence: 0 };
        }
        return { shouldBet: true, prediction: opp.prediction, confidence: opp.confidence, reason: opp.description, type: opp.type };
    }

    capNhatKetQua(actualResult) {
        const lastTrade = this.stats.trades[this.stats.trades.length - 1];
        if (!lastTrade) return;
        const isWin = lastTrade.prediction === actualResult;
        if (isWin) {
            this.stats.wins++;
            this.stats.consecutiveWins++;
            this.stats.consecutiveLosses = 0;
            if (this.cauPerformance[lastTrade.type]) this.cauPerformance[lastTrade.type].wins++;
        } else {
            this.stats.losses++;
            this.stats.consecutiveLosses++;
            this.stats.consecutiveWins = 0;
            if (this.cauPerformance[lastTrade.type]) this.cauPerformance[lastTrade.type].losses++;
        }
        this.stats.trades[this.stats.trades.length - 1].actual = actualResult;
        this.stats.trades[this.stats.trades.length - 1].isWin = isWin;
        const last10 = this.stats.trades.slice(-10);
        const wins10 = last10.filter(t => t.isWin).length;
        this.stats.last10Accuracy = wins10 / 10;
        let nt = 65;
        if (this.stats.last10Accuracy > 0.92) nt = 60;
        else if (this.stats.last10Accuracy > 0.88) nt = 62;
        else if (this.stats.last10Accuracy > 0.84) nt = 64;
        else if (this.stats.last10Accuracy > 0.8) nt = 65;
        else if (this.stats.last10Accuracy < 0.7) nt = 72;
        else if (this.stats.last10Accuracy < 0.65) nt = 75;
        else if (this.stats.last10Accuracy < 0.6) nt = 78;
        if (this.stats.consecutiveWins >= 5) nt = Math.max(58, nt - 4);
        if (this.stats.consecutiveLosses >= 2) nt = Math.min(80, nt + 6);
        this.stats.adaptiveThreshold = nt;
        const kq = isWin ? "WIN" : "LOSS";
        console.log(`   ${kq} Phien ${lastTrade.phien}: ${lastTrade.prediction} | TT: ${actualResult} | TL10: ${(this.stats.last10Accuracy*100).toFixed(1)}% | N: ${this.stats.adaptiveThreshold}% | ${lastTrade.type}`);
        return isWin;
    }

    chay() {
        const pred = this.duDoan();
        if (pred.shouldBet && !pred.coolDown) {
            this.stats.trades.push({ phien: this.processed[this.processed.length - 1].phien + 1, prediction: pred.prediction, confidence: pred.confidence, reason: pred.reason, type: pred.type, timestamp: new Date().toISOString() });
        }
        return pred;
    }
}

async function fetchData() {
    for (let a = 1; a <= 5; a++) {
        try {
            const res = await axios.get(API_URL, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const k of Object.keys(raw)) { if (Array.isArray(raw[k]) && raw[k].length > 5) { arr = raw[k]; break; } } }
            if (arr && arr.length >= 20) {
                const n = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                return n;
            }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { if (a < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return null;
}

async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 20) { isUpdating = false; return; }

        const latest = data[data.length - 1];

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua;
                const duDoanPrev = currentPrediction.Du_doan;
                addToHistory(predictedPhien, duDoanPrev, actualStr, currentPrediction.Do_tin_cay);
                if (duDoanPrev && duDoanPrev !== 'BỎ QUA') {
                    if (duDoanPrev.toLowerCase() === actualStr.toLowerCase()) wins++;
                    else losses++;
                }
                console.log(`📝 ${predictedPhien}: ${duDoanPrev} vs ${actualStr} | ${duDoanPrev.toLowerCase() === actualStr.toLowerCase() ? '✅' : '❌'}`);
            }
        }

        gameHistory = data;
        
        if (!predictorInstance || predictorInstance.processed.length !== data.length) {
            predictorInstance = new SieuCapBaoChua(data.slice(-500));
        } else {
            predictorInstance.processed = predictorInstance.preprocess(data.slice(-500));
        }
        
        const pred = predictorInstance.chay();

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === "Tài" ? "t" : "x";

        const recentTotals = data.slice(-20).map(p => p.tong);
        let predTotal = Math.round(recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length);
        if (latest.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (latest.tong <= 5) predTotal = Math.max(predTotal, 9);

        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) + '%' : '0%';

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1, Xuc_xac_2: latest.xuc_xac_2, Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua,
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.shouldBet ? pred.prediction : 'BỎ QUA',
            Do_tin_cay: pred.shouldBet ? pred.confidence + "%" : '0%',
            Tong_du_doan: pred.shouldBet ? predTotal : 0,
            Ly_do: pred.reason,
            Trang_thai: pred.shouldBet ? 'NÊN ĐÁNH' : 'KHÔNG ĐÁNH',
            AI_Thang: wins,
            AI_Thua: losses,
            AI_Ti_le: winRate,
            Loai_cau: pred.type || 'Không có',
            timestamp: Date.now()
        };

        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.shouldBet ? pred.prediction : 'BỎ QUA'} | ${pred.reason} | AI: ${winRate} | Lịch sử: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

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
        id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
        Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0,
        Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0,
        Ly_do: "", Trang_thai: "", AI_Thang: wins, AI_Thua: losses, AI_Ti_le: '0%',
        Loai_cau: '',
        timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('   ⚔️ SIEU CAP BAO CHUA - TAT CA CAC THUAT TOAN BAT CAU ⚔️');
console.log('   API: wtxmd52.tele68.com | 20 phiên | 30K lịch sử');
console.log('   BAO GOM: Bet 2-20, Be cau than thoai, Cau fibonacci, Markov bac 3-4');
console.log('   CAU DAC BIET: Than so, Kinh dich, Thien van, Phong thuy, Hinh hoc, Du bao chu ky');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 20) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
