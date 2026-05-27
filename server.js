const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

const LEARNING_FILE = "./learning_data.json";
const HISTORY_FILE = "./prediction_history.json";
const MAX_HISTORY = 100;
const REQUIRED_SESSIONS = 10;
const AUTO_UPDATE_INTERVAL = 5000;

let cachedSessions = [];
let pendingPrediction = null;
let lastUpdateTime = null;
let isUpdating = false;

let learningData = {
    b52: {
        patternWeights: {},
        patternStats: {},
        predictions: [],
        totalPredictions: 0,
        correctPredictions: 0,
        streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0, wins: 0, losses: 0 },
        recentAccuracy: [],
        transitionMatrix: {},
        reversalState: { active: false, activatedAt: null, consecutiveLosses: 0, reversalCount: 0, lastReversalResult: null },
        lastUpdate: null
    }
};

let verifiedPredictions = [];

const DEFAULT_PATTERN_WEIGHTS = {
    'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0,
    'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
    'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0,
    'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0,
    'sum_trend': 1.0, 'edge_cases': 1.0, 'momentum': 1.0,
    'cau_tu_nhien': 1.0, 'dice_trend_line': 1.0, 'break_pattern': 1.0,
    'fibonacci': 1.0, 'resistance_support': 1.0, 'wave': 1.0,
    'golden_ratio': 1.0, 'day_gay': 1.0, 'cau_44': 1.0, 'cau_55': 1.0,
    'cau_212': 1.0, 'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_gap': 1.0,
    'cau_ziczac': 1.0, 'cau_doi': 1.0, 'cau_rong': 1.0,
    'smart_bet': 1.0, 'markov_chain': 1.2, 'moving_avg_drift': 1.1,
    'sum_pressure': 1.1, 'volatility': 1.0
};

const REVERSAL_THRESHOLD = 3;

// ======================================================
// DATA FETCHING - LẤY 10 PHIÊN MỚI NHẤT TỪ API
// ======================================================
async function fetchData() {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        if (!response.data || !response.data.data || response.data.data.length === 0) {
            return null;
        }
        // API trả về mảng data với phiên mới nhất ở đầu
        // Lấy 10 phiên đầu tiên (mới nhất)
        const latest10 = response.data.data.slice(0, REQUIRED_SESSIONS);
        return latest10;
    } catch (error) {
        console.error('❌ Lỗi fetch API:', error.message);
        return null;
    }
}

function normalizeData(rawData) {
    if (!Array.isArray(rawData)) rawData = [rawData];
    
    return rawData.map(item => {
        const d1 = item.xuc_xac_1 || item.Xuc_xac_1 || 0;
        const d2 = item.xuc_xac_2 || item.Xuc_xac_2 || 0;
        const d3 = item.xuc_xac_3 || item.Xuc_xac_3 || 0;
        const tong = item.tong || item.Tong || (d1 + d2 + d3);
        const ketQua = item.ket_qua || item.Ket_qua || (tong >= 11 ? "Tài" : "Xỉu");
        const phien = item.phien || item.Phien || 0;
        
        return {
            phien: phien,
            dice: [d1, d2, d3],
            Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
            Tong: tong, total: tong,
            Ket_qua: (ketQua === "Tài" || ketQua === "tài") ? "Tài" : "Xỉu",
            result: (ketQua === "Tài" || ketQua === "tài") ? "Tài" : "Xỉu"
        };
    }).filter(item => item.phien > 0 && item.Tong >= 3 && item.Tong <= 18);
}

// ======================================================
// CẬP NHẬT DỮ LIỆU LIÊN TỤC
// ======================================================
async function updateDataContinuously() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const rawData = await fetchData();
        if (!rawData || rawData.length < REQUIRED_SESSIONS) {
            isUpdating = false;
            return;
        }
        
        // Chuẩn hóa dữ liệu
        const newSessions = normalizeData(rawData);
        
        // Sắp xếp theo phien giảm dần (mới nhất đầu)
        newSessions.sort((a, b) => b.phien - a.phien);
        
        const latestPhien = newSessions[0].phien;
        const oldLatestPhien = cachedSessions.length > 0 ? cachedSessions[0].phien : 0;
        
        if (latestPhien !== oldLatestPhien || cachedSessions.length === 0) {
            console.log(`\n🔄 [${new Date().toLocaleTimeString()}] PHIÊN MỚI: ${latestPhien} (cũ: ${oldLatestPhien || 'khởi tạo'})`);
            console.log(`📊 10 phiên mới nhất: ${newSessions.map(s => `${s.phien}(${s.Ket_qua})`).join(' → ')}`);
            
            // Nếu có dự đoán đang chờ, xác minh với kết quả thực tế
            if (pendingPrediction && cachedSessions.length > 0) {
                const actualResult = cachedSessions[0].Ket_qua;
                const isCorrect = pendingPrediction.prediction === actualResult;
                
                console.log(`✅ XÁC MINH DỰ ĐOÁN:`);
                console.log(`   Phiên: ${pendingPrediction.phien}`);
                console.log(`   Dự đoán: ${pendingPrediction.prediction} (${pendingPrediction.confidence}%)`);
                console.log(`   Thực tế: ${actualResult}`);
                console.log(`   Kết quả: ${isCorrect ? 'THẮNG 🟢' : 'THUA 🔴'}`);
                
                verifiedPredictions.unshift({
                    phien: pendingPrediction.phien,
                    prediction: pendingPrediction.prediction,
                    confidence: pendingPrediction.confidence,
                    actual: actualResult,
                    isCorrect: isCorrect,
                    danh_gia: isCorrect ? 'thang' : 'thua',
                    timestamp: new Date().toISOString()
                });
                
                if (verifiedPredictions.length > MAX_HISTORY) {
                    verifiedPredictions = verifiedPredictions.slice(0, MAX_HISTORY);
                }
                
                updateLearningAfterVerification(isCorrect, pendingPrediction);
            }
            
            // Cập nhật cache với 10 phiên mới nhất
            cachedSessions = newSessions;
            lastUpdateTime = new Date().toISOString();
            
            // Tạo dự đoán mới cho phiên tiếp theo
            const nextPhien = latestPhien + 1;
            const prediction = calculateAdvancedPrediction(cachedSessions, 'b52');
            
            pendingPrediction = {
                phien: nextPhien,
                prediction: prediction.prediction,
                confidence: prediction.confidence,
                factors: prediction.factors,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${nextPhien}: ${prediction.prediction} (${prediction.confidence}%)`);
            saveAllData();
        }
        
    } catch (error) {
        console.error('❌ Lỗi cập nhật:', error.message);
    }
    
    isUpdating = false;
}

function updateLearningAfterVerification(isCorrect, prediction) {
    learningData.b52.totalPredictions++;
    
    if (isCorrect) {
        learningData.b52.correctPredictions++;
        learningData.b52.streakAnalysis.wins++;
        if (learningData.b52.streakAnalysis.currentStreak >= 0) {
            learningData.b52.streakAnalysis.currentStreak++;
        } else {
            learningData.b52.streakAnalysis.currentStreak = 1;
        }
        if (learningData.b52.streakAnalysis.currentStreak > learningData.b52.streakAnalysis.bestStreak) {
            learningData.b52.streakAnalysis.bestStreak = learningData.b52.streakAnalysis.currentStreak;
        }
    } else {
        learningData.b52.streakAnalysis.losses++;
        if (learningData.b52.streakAnalysis.currentStreak <= 0) {
            learningData.b52.streakAnalysis.currentStreak--;
        } else {
            learningData.b52.streakAnalysis.currentStreak = -1;
        }
        if (learningData.b52.streakAnalysis.currentStreak < learningData.b52.streakAnalysis.worstStreak) {
            learningData.b52.streakAnalysis.worstStreak = learningData.b52.streakAnalysis.currentStreak;
        }
    }
    
    learningData.b52.recentAccuracy.push(isCorrect ? 1 : 0);
    if (learningData.b52.recentAccuracy.length > 50) {
        learningData.b52.recentAccuracy.shift();
    }
    
    if (prediction.factors) {
        prediction.factors.forEach(factorName => {
            const patternId = getPatternIdFromName(factorName);
            if (patternId) {
                updatePatternPerformance('b52', patternId, isCorrect);
            }
        });
    }
}

// ======================================================
// LEARNING SYSTEM
// ======================================================
function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.b52) learningData = { ...learningData, ...parsed };
        }
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.verified) verifiedPredictions = parsed.verified || [];
        }
        console.log('✅ Đã tải dữ liệu học và lịch sử');
    } catch (error) {
        console.log('ℹ️ Khởi tạo dữ liệu mới');
    }
}

function saveAllData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({ verified: verifiedPredictions }, null, 2));
    } catch (error) {
        console.error('❌ Lỗi lưu dữ liệu:', error.message);
    }
}

function initializePatternStats(type) {
    if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
        learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
    }
    Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
        if (!learningData[type].patternStats[pattern]) {
            learningData[type].patternStats[pattern] = {
                total: 0, correct: 0, accuracy: 0.5,
                recentResults: [], lastAdjustment: null
            };
        }
    });
}

function getPatternWeight(type, patternId) {
    initializePatternStats(type);
    return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
    initializePatternStats(type);
    const stats = learningData[type].patternStats[patternId];
    if (!stats) return;
    stats.total++;
    if (isCorrect) stats.correct++;
    stats.recentResults.push(isCorrect ? 1 : 0);
    if (stats.recentResults.length > 20) stats.recentResults.shift();
    const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
    stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
    const oldWeight = learningData[type].patternWeights[patternId];
    let newWeight = oldWeight;
    if (stats.recentResults.length >= 5) {
        if (recentAccuracy > 0.6) newWeight = Math.min(2.0, oldWeight * 1.05);
        else if (recentAccuracy < 0.4) newWeight = Math.max(0.3, oldWeight * 0.95);
    }
    learningData[type].patternWeights[patternId] = newWeight;
    stats.lastAdjustment = new Date().toISOString();
}

function getAdaptiveConfidenceBoost(type) {
    const recentAcc = learningData[type].recentAccuracy;
    if (recentAcc.length < 10) return 0;
    const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
    if (accuracy > 0.65) return 5;
    if (accuracy > 0.55) return 2;
    if (accuracy < 0.4) return -5;
    if (accuracy < 0.45) return -2;
    return 0;
}

function getPatternIdFromName(name) {
    const mapping = {
        'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11',
        'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
        'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
        'Cầu 3-2-1': 'cau_321', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
        'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1',
        'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Chu Kỳ': 'cau_chu_ky',
        'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern',
        'Xu hướng': 'sum_trend', 'Cực Điểm': 'edge_cases',
        'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien',
        'Dây Gãy': 'day_gay', 'Cầu Rồng': 'cau_rong',
        'Markov Chain': 'markov_chain', 'Smart Bet': 'smart_bet'
    };
    for (const [key, value] of Object.entries(mapping)) {
        if (name.includes(key)) return value;
    }
    return null;
}

// ======================================================
// HELPER FUNCTIONS
// ======================================================
function getResults(history) {
    return history.map(h => h.result === 'Tài' ? 'T' : 'X');
}

function calcBreakProb(results, result, streak) {
    let same = 0, longer = 0, cur = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) cur++;
        else {
            if (results[i - 1] === result) {
                if (cur === streak) same++; else if (cur > streak) longer++;
            }
            cur = 1;
        }
    }
    if (results[results.length - 1] === result) {
        if (cur === streak) same++; else if (cur > streak) longer++;
    }
    let total = same + longer;
    return total > 0 ? same / total : 0.5;
}

// ======================================================
// FULL 40+ THUẬT TOÁN - KHÔNG THIẾU DÒNG NÀO
// ======================================================

// LOP 1-10: BIET ANALYSIS
function bietLayer(history, minLen, baseConf, weight) {
    let results = getResults(history);
    let n = results.length;
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === results[n - 1]) streak++; else break;
    }
    if (streak >= minLen) {
        let bp = calcBreakProb(results, results[n - 1], streak);
        let pred = bp > 0.5 ? (results[n - 1] === 'T' ? 'X' : 'T') : results[n - 1];
        return { p: pred, c: Math.min(95, baseConf + streak), w: weight || 8 };
    }
    return null;
}
function bietLayer1(h) { return bietLayer(h, 3, 50, 8); }
function bietLayer2(h) { return bietLayer(h, 4, 55, 9); }
function bietLayer3(h) { return bietLayer(h, 5, 60, 10); }
function bietLayer4(h) { return bietLayer(h, 6, 65, 10); }
function bietLayer5(h) { return bietLayer(h, 7, 70, 10); }
function bietLayer6(h) { return bietLayer(h, 8, 75, 10); }

// LOP 11-20: CAU CO BAN
function cau11Layer(h) {
    let results = getResults(h);
    if (results.length < 4) return null;
    let is11 = true;
    for (let i = results.length - 3; i < results.length; i++) {
        if (results[i] === results[i - 1]) { is11 = false; break; }
    }
    if (is11) {
        let len = 4;
        for (let i = results.length - 4; i >= 0; i--) {
            if (results[i] !== results[i + 1]) len++; else break;
        }
        return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: Math.min(90, 65 + len * 2), w: len >= 8 ? 12 : 8 };
    }
    return null;
}
function cau22Layer(h) {
    let results = getResults(h);
    if (results.length < 8) return null;
    let last8 = results.slice(-8);
    let is22 = true;
    for (let i = 0; i < 8; i += 2) if (last8[i] !== last8[i + 1]) { is22 = false; break; }
    if (is22 && last8[0] !== last8[2]) {
        let phase = results.length % 2;
        return { p: phase === 0 ? last8[7] : (last8[7] === 'T' ? 'X' : 'T'), c: 80, w: 10 };
    }
    return null;
}
function cau33Layer(h) {
    let results = getResults(h);
    if (results.length < 12) return null;
    let last12 = results.slice(-12);
    let is33 = true;
    for (let i = 0; i < 12; i += 3) {
        if (last12[i] !== last12[i + 1] || last12[i] !== last12[i + 2]) { is33 = false; break; }
    }
    if (is33 && last12[0] !== last12[3]) {
        let phase = results.length % 3;
        return { p: phase === 0 ? (last12[11] === 'T' ? 'X' : 'T') : last12[11], c: 82, w: 9 };
    }
    return null;
}
function cau123Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let l6 = results.slice(-6).join('');
    if (l6 === "TXXTTT") return { p: 'X', c: 77, w: 8 };
    if (l6 === "XTTXXX") return { p: 'T', c: 77, w: 8 };
    return null;
}
function cau321Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let l6 = results.slice(-6).join('');
    if (l6 === "TTTXXT") return { p: 'X', c: 76, w: 8 };
    if (l6 === "XXXTTX") return { p: 'T', c: 76, w: 8 };
    return null;
}
function zigzagLayer(h) {
    let results = getResults(h);
    if (results.length < 7) return null;
    let l7 = results.slice(-7);
    let sw = 0;
    for (let i = 1; i < 7; i++) if (l7[i] !== l7[i - 1]) sw++;
    if (sw >= 5) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68 + sw * 2, w: sw >= 7 ? 9 : 6 };
    return null;
}

// LOP 21-30: RONG HO & DAC BIET
function rongLayer(h) {
    let results = getResults(h);
    let r = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'T'; i--) r++;
    if (r >= 4) return { p: r >= 6 ? 'X' : 'T', c: Math.min(95, 65 + r * 3), w: r >= 6 ? 14 : 8 };
    return null;
}
function hoLayer(h) {
    let results = getResults(h);
    let r = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'X'; i--) r++;
    if (r >= 4) return { p: r >= 6 ? 'T' : 'X', c: Math.min(95, 65 + r * 3), w: r >= 6 ? 14 : 8 };
    return null;
}
function doiXungLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let mid = Math.floor(results.length / 2);
    let left = results.slice(0, mid), right = results.slice(mid).reverse();
    let m = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) m++;
    let ratio = m / Math.min(left.length, right.length);
    if (ratio >= 0.8) {
        let mp = mid - (results.length - mid);
        if (mp >= 0 && mp < results.length) return { p: results[mp], c: 60 + ratio * 15, w: 6 };
    }
    return null;
}
function tamGiacLayer(h) {
    let results = getResults(h);
    if (results.length < 5) return null;
    let l5 = results.slice(-5).join('');
    if (l5 === "TXTXT") return { p: 'X', c: 80, w: 7 };
    if (l5 === "XTXTX") return { p: 'T', c: 80, w: 7 };
    return null;
}

// LOP 31-40: DICE ANALYSIS
function diceSumLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let sum = (last.Xuc_xac_1 || 0) + (last.Xuc_xac_2 || 0) + (last.Xuc_xac_3 || 0);
    let sumAfter = {};
    for (let i = 0; i < h.length - 1; i++) {
        let s = (h[i].Xuc_xac_1 || 0) + (h[i].Xuc_xac_2 || 0) + (h[i].Xuc_xac_3 || 0);
        if (s === sum && i + 1 < h.length) {
            let ns = (h[i + 1].Xuc_xac_1 || 0) + (h[i + 1].Xuc_xac_2 || 0) + (h[i + 1].Xuc_xac_3 || 0);
            sumAfter[ns] = (sumAfter[ns] || 0) + 1;
        }
    }
    let total = Object.values(sumAfter).reduce((a, b) => a + b, 0);
    if (total >= 5) {
        let bestSum = 3, bestCount = 0;
        for (let s = 3; s <= 18; s++) if ((sumAfter[s] || 0) > bestCount) { bestCount = sumAfter[s]; bestSum = s; }
        return { p: bestSum >= 11 ? 'T' : 'X', c: 50 + (bestCount / total) * 35, w: 8 };
    }
    return null;
}
function diceTripleLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
    let triple = d1 + '' + d2 + '' + d3;
    let tc = 0, tt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let ht = (h[i].Xuc_xac_1 || 0) + '' + (h[i].Xuc_xac_2 || 0) + '' + (h[i].Xuc_xac_3 || 0);
        if (ht === triple && i + 1 < h.length) { tc++; if ((h[i + 1].result || '') === 'Tài') tt++; }
    }
    if (tc >= 3) {
        let prob = tt / tc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 70, w: 9 };
    }
    return null;
}
function dicePairLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pc = 0, pt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let hp12 = (h[i].Xuc_xac_1 || 0) + '' + (h[i].Xuc_xac_2 || 0);
        let hp23 = (h[i].Xuc_xac_2 || 0) + '' + (h[i].Xuc_xac_3 || 0);
        let hp13 = (h[i].Xuc_xac_1 || 0) + '' + (h[i].Xuc_xac_3 || 0);
        if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < h.length) {
            pc++; if ((h[i + 1].result || '') === 'Tài') pt++;
        }
    }
    if (pc >= 5) {
        let prob = pt / pc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 50, w: 7 };
    }
    return null;
}
function diceHighLowLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    let hlc = 0, hlt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let hhl = ((h[i].Xuc_xac_1 || 0) >= 4 ? 'H' : 'L') + ((h[i].Xuc_xac_2 || 0) >= 4 ? 'H' : 'L') + ((h[i].Xuc_xac_3 || 0) >= 4 ? 'H' : 'L');
        if (hhl === hl && i + 1 < h.length) { hlc++; if ((h[i + 1].result || '') === 'Tài') hlt++; }
    }
    if (hlc >= 5) {
        let prob = hlt / hlc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 40, w: 6 };
    }
    return null;
}

// LOP 41-50: SCORE ANALYSIS
function scoreExtremeLayer(h) {
    let lastScore = h[h.length - 1].Tong || 0;
    if (lastScore >= 17) return { p: 'X', c: 85, w: 10 };
    if (lastScore >= 15) return { p: 'X', c: 72, w: 8 };
    if (lastScore <= 4) return { p: 'T', c: 85, w: 10 };
    if (lastScore <= 6) return { p: 'T', c: 68, w: 7 };
    return null;
}
function scoreMALayer(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.Tong || 0);
    let ma5 = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
    let ma10 = scores.reduce((a, b) => a + b, 0) / 10;
    if (ma5 > ma10 + 2) return { p: 'T', c: 62, w: 6 };
    if (ma5 < ma10 - 2) return { p: 'X', c: 62, w: 6 };
    return null;
}
function scoreZoneLayer(h) {
    if (h.length < 3) return null;
    let scores = h.slice(-5).map(i => i.Tong || 0);
    let highCount = scores.filter(s => s >= 14).length;
    let lowCount = scores.filter(s => s <= 5).length;
    if (highCount >= 3) return { p: 'X', c: 68, w: 6 };
    if (lowCount >= 3) return { p: 'T', c: 68, w: 6 };
    return null;
}
function scoreBollingerLayer(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.Tong || 0);
    let avg = scores.reduce((a, b) => a + b, 0) / 10;
    let variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / 10;
    let std = Math.sqrt(variance);
    let upper = avg + 2 * std, lower = avg - 2 * std;
    let last = scores[scores.length - 1];
    if (last > upper) return { p: 'X', c: 65, w: 6 };
    if (last < lower) return { p: 'T', c: 65, w: 6 };
    return null;
}

// LOP 51-60: TREND & CYCLE
function trendShortLayer(h) {
    let results = getResults(h);
    let last5 = results.slice(-5);
    let tCount = last5.filter(r => r === 'T').length;
    if (tCount >= 4) return { p: 'X', c: 62, w: 5 };
    if (tCount <= 1) return { p: 'T', c: 62, w: 5 };
    return null;
}
function trendMediumLayer(h) {
    let results = getResults(h);
    let last10 = results.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 7) return { p: 'X', c: 68, w: 7 };
    if (tCount <= 3) return { p: 'T', c: 68, w: 7 };
    return null;
}
function switchRateLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let sw = 0;
    for (let i = results.length - 9; i < results.length; i++) if (results[i] !== results[i - 1]) sw++;
    if (sw >= 7) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68, w: 7 };
    return null;
}
function cycleLayer(h) {
    let results = getResults(h);
    if (results.length < 30) return null;
    let bestLag = 0, bestCorr = 0;
    for (let lag = 2; lag <= 10; lag++) {
        if (results.length <= lag * 2) continue;
        let matches = 0, total = 0;
        for (let i = lag; i < Math.min(results.length, 50); i++) {
            if (results[results.length - 1 - i] === results[results.length - 1 - i - lag]) matches++;
            total++;
        }
        let corr = total > 0 ? matches / total : 0;
        if (Math.abs(corr - 0.5) > bestCorr) { bestCorr = Math.abs(corr - 0.5); bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.1) {
        return { p: results[results.length - 1 - bestLag], c: 50 + bestCorr * 30, w: 5 };
    }
    return null;
}
function regimeLayer(h) {
    let results = getResults(h);
    if (results.length < 30) return null;
    let last30 = results.slice(-30);
    let tCount = last30.filter(r => r === 'T').length;
    let sw = 0;
    for (let i = 1; i < 30; i++) if (last30[i] !== last30[i - 1]) sw++;
    let ratio = tCount / 30;
    if (ratio > 0.6 && sw < 12) return { p: 'T', c: 62, w: 5 };
    if (ratio < 0.4 && sw < 12) return { p: 'X', c: 62, w: 5 };
    return null;
}

// LOP 61-70: PATTERN MATCHING
function pattern3Layer(h) {
    let results = getResults(h);
    if (results.length < 4) return null;
    let pattern = results.slice(-3).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - 3; i++) {
        if (results.slice(i, i + 3).join('') === pattern) nextCounts[results[i + 3]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 5) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 80, w: 8 };
    }
    return null;
}
function pattern5Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let pattern = results.slice(-5).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - 5; i++) {
        if (results.slice(i, i + 5).join('') === pattern) nextCounts[results[i + 5]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}
function knnPatternLayer(h) {
    let results = getResults(h);
    if (results.length < 12) return null;
    let query = results.slice(-10);
    let distances = [];
    for (let i = 0; i < results.length - 10; i++) {
        let seg = results.slice(i, i + 10);
        let dist = 0;
        for (let j = 0; j < 10; j++) if (seg[j] !== query[j]) dist++;
        if (i + 10 < results.length) distances.push({ dist, next: results[i + 10] });
    }
    distances.sort((a, b) => a.dist - b.dist);
    let k = Math.min(7, distances.length);
    let neighbors = distances.slice(0, k);
    let tCount = neighbors.filter(n => n.next === 'T').length;
    let probT = tCount / k;
    if (k >= 3) return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    return null;
}
function markovLayer(h, order) {
    let results = getResults(h);
    if (results.length <= order) return null;
    let state = results.slice(-order).join(',');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i <= results.length - order - 1; i++) {
        if (results.slice(i, i + order).join(',') === state) nextCounts[results[i + order]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}
function markov2L(h) { return markovLayer(h, 2); }
function markov3L(h) { return markovLayer(h, 3); }
function markov5L(h) { return markovLayer(h, 5); }

// LOP 71-80: RECENT & SPECIAL
function allTaiLayer(h) {
    let results = getResults(h);
    if (results.slice(-5).every(r => r === 'T')) return { p: 'X', c: 78, w: 9 };
    return null;
}
function allXiuLayer(h) {
    let results = getResults(h);
    if (results.slice(-5).every(r => r === 'X')) return { p: 'T', c: 78, w: 9 };
    return null;
}
function alternateRecentLayer(h) {
    let results = getResults(h);
    let last4 = results.slice(-4);
    let isAlt = true;
    for (let i = 1; i < 4; i++) if (last4[i] === last4[i - 1]) { isAlt = false; break; }
    if (isAlt) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 72, w: 7 };
    return null;
}
function decisionTreeLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let last1 = results[results.length - 1], last2 = results[results.length - 2], last3 = results[results.length - 3];
    let t5 = results.slice(-5).filter(r => r === 'T').length;
    if (last1 === 'T' && last2 === 'T' && last3 === 'T') return { p: 'X', c: 72, w: 7 };
    if (last1 === 'X' && last2 === 'X' && last3 === 'X') return { p: 'T', c: 72, w: 7 };
    if (t5 >= 4) return { p: 'X', c: 62, w: 5 };
    if (t5 <= 1) return { p: 'T', c: 62, w: 5 };
    return { p: last1, c: 55, w: 3 };
}
function meanReversionLayer(h) {
    let results = getResults(h);
    if (results.length < 15) return null;
    let tCount = results.filter(r => r === 'T').length;
    let mean = tCount / results.length;
    let last10 = results.slice(-10).filter(r => r === 'T').length / 10;
    if (last10 > mean + 0.15) return { p: 'X', c: 62, w: 5 };
    if (last10 < mean - 0.15) return { p: 'T', c: 62, w: 5 };
    return null;
}

// ======================================================
// SUPER ULTIMATE PREDICTION
// ======================================================
function superUltimatePrediction(history) {
    let allPredictions = [];
    let layers = [
        bietLayer1, bietLayer2, bietLayer3, bietLayer4, bietLayer5, bietLayer6,
        cau11Layer, cau22Layer, cau33Layer, cau123Layer, cau321Layer, zigzagLayer,
        rongLayer, hoLayer, doiXungLayer, tamGiacLayer,
        diceSumLayer, diceTripleLayer, dicePairLayer, diceHighLowLayer,
        scoreExtremeLayer, scoreMALayer, scoreZoneLayer, scoreBollingerLayer,
        trendShortLayer, trendMediumLayer, switchRateLayer, cycleLayer, regimeLayer,
        pattern3Layer, pattern5Layer, knnPatternLayer, markov2L, markov3L, markov5L,
        allTaiLayer, allXiuLayer, alternateRecentLayer, decisionTreeLayer, meanReversionLayer
    ];
    for (let fn of layers) {
        let p = fn(history);
        if (p) allPredictions.push(p);
    }
    return allPredictions;
}

function predict100Layers(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Chờ thêm dữ liệu', confidence: 0 };
    let allPredictions = superUltimatePrediction(history);
    if (allPredictions.length === 0) {
        let results = getResults(history);
        return { prediction: results[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }
    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of allPredictions) {
        let w = (p.w || 5) * (p.c / 100);
        if (p.p === 'T') voteT += w; else voteX += w;
        totalW += w;
    }
    if (totalW === 0) {
        let results = getResults(history);
        return { prediction: results[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }
    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(98, confidence));
    let sorted = [...allPredictions].sort((a, b) => (b.w || 5) * b.c - (a.w || 5) * a.c);
    let top3 = sorted.slice(0, 3), top5 = sorted.slice(0, 5), top10 = sorted.slice(0, 10);
    if (top10.every(p => p.p === top10[0].p)) confidence = Math.min(98, confidence + 15);
    else if (top5.every(p => p.p === top5[0].p)) confidence = Math.min(98, confidence + 10);
    else if (top3.every(p => p.p === top3[0].p)) confidence = Math.min(98, confidence + 5);
    return { prediction: finalPred === 'T' ? 'Tài' : 'Xỉu', confidence, totalLayers: allPredictions.length };
}

// ======================================================
// MAIN PREDICTION
// ======================================================
function calculateAdvancedPrediction(data, type) {
    const sessions = data.slice(0, REQUIRED_SESSIONS);
    console.log(`\n🔮 PHÂN TÍCH ${REQUIRED_SESSIONS} PHIÊN MỚI NHẤT`);
    console.log(`📊 Mới nhất: Phiên ${sessions[0].phien} → ${sessions[0].Ket_qua} (Tổng: ${sessions[0].Tong})`);
    console.log(`📊 Chuỗi: ${sessions.map(s => `${s.Ket_qua}`).join(' → ')}`);
    
    let result = predict100Layers(sessions);
    if (!result || result.confidence === 0) {
        const results = getResults(sessions);
        result = { prediction: results[results.length - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 52 };
    }
    
    console.log(`🎯 DỰ ĐOÁN: ${result.prediction} (${result.confidence}%) | ${result.totalLayers || 0} thuật toán`);
    
    return {
        prediction: result.prediction,
        confidence: result.confidence,
        factors: [`${result.totalLayers || 0} thuật toán đã chạy`]
    };
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        if (cachedSessions.length >= REQUIRED_SESSIONS && pendingPrediction) {
            const latest = cachedSessions[0];
            const winLossTable = verifiedPredictions.slice(0, 10).map(v => ({
                phien: v.phien, du_doan: v.prediction.toLowerCase(),
                ket_qua: v.actual.toLowerCase(), danh_gia: v.danh_gia
            }));
            return res.json({
                id: "@vuaoccac",
                phien_truoc: { Phien: latest.phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
                phien_hien_tai: { Phien: pendingPrediction.phien, Du_doan: pendingPrediction.prediction, Do_tin_cay: pendingPrediction.confidence + "%" },
                stats: { consecutiveLosses: countConsecutiveLosses(winLossTable) },
                win_loss_table: winLossTable,
                full_history_count: cachedSessions.length
            });
        }
        // Fallback: fetch trực tiếp
        const rawData = await fetchData();
        if (!rawData || rawData.length < REQUIRED_SESSIONS) {
            return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0 }, win_loss_table: [], full_history_count: 0 });
        }
        cachedSessions = normalizeData(rawData);
        cachedSessions.sort((a, b) => b.phien - a.phien);
        let latest = cachedSessions[0];
        let predict = calculateAdvancedPrediction(cachedSessions, 'b52');
        pendingPrediction = { phien: latest.phien + 1, prediction: predict.prediction, confidence: predict.confidence, factors: predict.factors, timestamp: new Date().toISOString() };
        res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: latest.phien + 1, Du_doan: predict.prediction, Do_tin_cay: predict.confidence + "%" },
            stats: { consecutiveLosses: 0 }, win_loss_table: [], full_history_count: cachedSessions.length
        });
    } catch (err) {
        res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Lỗi" }, phien_hien_tai: { Phien: 0, Du_doan: "Lỗi", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0 }, win_loss_table: [], full_history_count: 0 });
    }
});

app.get("/", async (req, res) => {
    if (cachedSessions.length >= REQUIRED_SESSIONS && pendingPrediction) {
        const latest = cachedSessions[0];
        const winLossTable = verifiedPredictions.slice(0, 10).map(v => ({
            phien: v.phien, du_doan: v.prediction.toLowerCase(),
            ket_qua: v.actual.toLowerCase(), danh_gia: v.danh_gia
        }));
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: pendingPrediction.phien, Du_doan: pendingPrediction.prediction, Do_tin_cay: pendingPrediction.confidence + "%" },
            stats: { consecutiveLosses: countConsecutiveLosses(winLossTable) },
            win_loss_table: winLossTable,
            full_history_count: cachedSessions.length,
            verified_count: verifiedPredictions.length,
            last_update: lastUpdateTime
        });
    }
    res.json({ status: "Đang khởi tạo...", message: "Vui lòng đợi dữ liệu đầu tiên" });
});

function countConsecutiveLosses(winLossTable) {
    let count = 0;
    for (let i = 0; i < winLossTable.length; i++) {
        if (winLossTable[i].danh_gia === "thua") count++; else break;
    }
    return count;
}

// ======================================================
// KHỞI ĐỘNG
// ======================================================
loadLearningData();
updateDataContinuously();
setInterval(() => updateDataContinuously(), AUTO_UPDATE_INTERVAL);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 TÀI XỈU AI SERVER - CẬP NHẬT LIÊN TỤC');
    console.log('='.repeat(60));
    console.log(`📡 Port: ${PORT} | 🔄 Cập nhật mỗi ${AUTO_UPDATE_INTERVAL/1000}s`);
    console.log(`📊 Lấy ${REQUIRED_SESSIONS} phiên mới nhất từ API`);
    console.log(`🧠 40+ thuật toán (Biet, Cau, Rong Ho, Dice, Score, Trend, Pattern, Markov...)`);
    console.log(`✅ Xác minh thắng/thua SAU KHI có kết quả thực tế`);
    console.log('='.repeat(60));
});
