const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let verifiedResults = [];
let isUpdating = false;

// ============ HELPER ============
function getPhien(item) { return item.phien || item.Phien || 0; }
function getKetQua(item) { return item.ket_qua || item.Ket_qua || ''; }
function getTong(item) { return item.tong || item.Tong || 0; }
function getX1(item) { return item.xuc_xac_1 || item.Xuc_xac_1 || 0; }
function getX2(item) { return item.xuc_xac_2 || item.Xuc_xac_2 || 0; }
function getX3(item) { return item.xuc_xac_3 || item.Xuc_xac_3 || 0; }

function normalizeData(item) {
    return {
        ket_qua: getKetQua(item),
        tong: getTong(item),
        x1: getX1(item),
        x2: getX2(item),
        x3: getX3(item),
        phien: getPhien(item)
    };
}

// ============================================================
// LOVE TRANG PREDICTOR
// ============================================================

class LoveTrangPredictor {
    constructor(data) {
        this.data = data;
        this.processed = this.preprocess(data);
        this.patternDB = new Map();
        this.buildPatternDB();
    }
    
    preprocess(data) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const ketQua = d.ket_qua.toLowerCase();
            const resultNum = (ketQua === "tài" || ketQua === "tai") ? 1 : 0;
            
            result.push({
                ...d,
                resultNum: resultNum,
                sum: d.x1 + d.x2 + d.x3,
                dice: [d.x1, d.x2, d.x3],
                diceStr: [d.x1, d.x2, d.x3].sort((a,b)=>a-b).join(''),
                isTriple: d.x1 === d.x2 && d.x2 === d.x3,
                isPair: (d.x1 === d.x2 || d.x1 === d.x3 || d.x2 === d.x3) && !(d.x1 === d.x2 && d.x2 === d.x3),
                range: Math.max(d.x1, d.x2, d.x3) - Math.min(d.x1, d.x2, d.x3)
            });
        }
        
        for (let i = 1; i < result.length; i++) {
            let streak = 1;
            for (let j = i-1; j >= 0; j--) {
                if (result[j].resultNum === result[i].resultNum) streak++;
                else break;
            }
            result[i].streak = streak;
            result[i].prevResult = result[i-1].resultNum;
        }
        
        return result;
    }
    
    buildPatternDB() {
        for (let len = 3; len <= 15; len++) {
            for (let i = 0; i <= this.processed.length - len - 1; i++) {
                const pattern = this.processed.slice(i, i+len).map(p => p.resultNum).join('');
                const next = this.processed[i+len].resultNum;
                if (!this.patternDB.has(pattern)) this.patternDB.set(pattern, { tai: 0, xiu: 0 });
                const entry = this.patternDB.get(pattern);
                if (next === 1) entry.tai++;
                else entry.xiu++;
            }
        }
    }
    
    getPattern15() {
        if (this.processed.length < 15) return "";
        return this.processed.slice(-15).map(p => p.resultNum === 1 ? "t" : "x").join('');
    }
    
    // Phân tích 15 phiên
    analyze15() {
        if (this.processed.length < 15) return { matched: [], strongSignals: [] };
        
        const last15 = this.processed.slice(-15);
        const pattern15 = last15.map(p => p.resultNum).join('');
        const dicePattern15 = last15.map(p => p.diceStr).join('|');
        
        const matched = [];
        const strongSignals = [];
        
        // Tìm pattern trùng
        for (let i = 0; i <= this.processed.length - 16; i++) {
            const histPattern = this.processed.slice(i, i+15).map(p => p.resultNum).join('');
            if (histPattern === pattern15) {
                const next = this.processed[i+15].resultNum;
                matched.push({
                    next: next === 1 ? "tai" : "xiu",
                    distance: this.processed.length - (i+15),
                    confidence: Math.min(95, 60 + (this.processed.length - i) / 10)
                });
            }
        }
        
        // Tìm dice pattern trùng
        for (let i = 0; i <= this.processed.length - 16; i++) {
            const histDice = this.processed.slice(i, i+15).map(p => p.diceStr).join('|');
            if (histDice === dicePattern15) {
                const next = this.processed[i+15].resultNum;
                strongSignals.push({
                    type: "DICE_MATCH",
                    prediction: next === 1 ? "tai" : "xiu",
                    confidence: 90
                });
                break;
            }
        }
        
        // Đánh giá pattern match
        if (matched.length > 0) {
            const taiCount = matched.filter(m => m.next === "tai").length;
            const xiuCount = matched.filter(m => m.next === "xiu").length;
            const total = taiCount + xiuCount;
            
            if (total >= 3 && (taiCount === total || xiuCount === total)) {
                strongSignals.push({
                    type: "PATTERN_100%",
                    prediction: taiCount === total ? "tai" : "xiu",
                    confidence: 96
                });
            } else if (total >= 2 && Math.max(taiCount, xiuCount) / total >= 0.75) {
                const pred = taiCount > xiuCount ? "tai" : "xiu";
                const ratio = Math.max(taiCount, xiuCount) / total * 100;
                strongSignals.push({
                    type: "PATTERN_HIGH",
                    prediction: pred,
                    confidence: 75 + (ratio - 75) / 5
                });
            }
        }
        
        return { matched, strongSignals };
    }
    
    // Các thuật toán bắt cầu
    cauBet() {
        const last = this.processed[this.processed.length-1];
        if (last.streak >= 3 && last.streak <= 5) {
            return { pred: last.resultNum === 1 ? "tai" : "xiu", conf: 55 + last.streak * 5 };
        }
        if (last.streak >= 6) {
            return { pred: last.resultNum === 1 ? "xiu" : "tai", conf: 60 + last.streak * 3 };
        }
        return null;
    }
    
    cau11() {
        if (this.processed.length < 6) return null;
        const l6 = this.processed.slice(-6).map(p => p.resultNum);
        for (let i = 1; i < 6; i++) if (l6[i] === l6[i-1]) return null;
        return { pred: l6[5] === 1 ? "xiu" : "tai", conf: 72 };
    }
    
    cau22() {
        if (this.processed.length < 8) return null;
        const l8 = this.processed.slice(-8).map(p => p.resultNum);
        for (let i = 2; i < 8; i += 2) if (l8[i] !== l8[i-2]) return null;
        if (l8[0] === l8[1]) return null;
        return { pred: l8[7] === 1 ? "xiu" : "tai", conf: 68 };
    }
    
    cau121() {
        if (this.processed.length < 8) return null;
        const l8 = this.processed.slice(-8).map(p => p.resultNum);
        if (l8[0]===1&&l8[1]===1&&l8[2]===0&&l8[3]===0&&l8[4]===1&&l8[5]===1&&l8[6]===0&&l8[7]===0) return {pred:"tai",conf:70};
        if (l8[0]===0&&l8[1]===0&&l8[2]===1&&l8[3]===1&&l8[4]===0&&l8[5]===0&&l8[6]===1&&l8[7]===1) return {pred:"xiu",conf:70};
        return null;
    }
    
    cau212() {
        if (this.processed.length < 8) return null;
        const l8 = this.processed.slice(-8).map(p => p.resultNum);
        if (l8[0]===1&&l8[1]===1&&l8[2]===0&&l8[3]===1&&l8[4]===1&&l8[5]===0&&l8[6]===1&&l8[7]===1) return {pred:"xiu",conf:72};
        if (l8[0]===0&&l8[1]===0&&l8[2]===1&&l8[3]===0&&l8[4]===0&&l8[5]===1&&l8[6]===0&&l8[7]===0) return {pred:"tai",conf:72};
        return null;
    }
    
    cauZigzag() {
        if (this.processed.length < 10) return null;
        const l10 = this.processed.slice(-10).map(p => p.resultNum);
        for (let i = 1; i < 10; i++) if (l10[i] === l10[i-1]) return null;
        return { pred: l10[9] === 1 ? "xiu" : "tai", conf: 70 };
    }
    
    cauFibonacci() {
        if (this.processed.length < 30) return null;
        const totals = this.processed.slice(-30).map(p => p.tong);
        const high = Math.max(...totals);
        const low = Math.min(...totals);
        const range = high - low;
        const last = totals[totals.length-1];
        if (last > low + range * 0.618) return { pred: "xiu", conf: 68 };
        if (last < low + range * 0.382) return { pred: "tai", conf: 68 };
        return null;
    }
    
    cauGann() {
        if (this.processed.length < 50) return null;
        const results = this.processed.map(p => p.resultNum);
        for (let c of [9, 18, 27, 36, 45]) {
            if (results.length > c && results[results.length-1] === results[results.length-c]) {
                return { pred: results[results.length-1] === 1 ? "tai" : "xiu", conf: 60 + c/45*20 };
            }
        }
        return null;
    }
    
    cauElliott() {
        if (this.processed.length < 20) return null;
        const r = this.processed.slice(-20).map(p => p.resultNum);
        let waves = [], cur = r[0], len = 1;
        for (let i = 1; i < r.length; i++) {
            if (r[i] === cur) len++;
            else { waves.push({ t: cur, l: len }); cur = r[i]; len = 1; }
        }
        waves.push({ t: cur, l: len });
        if (waves.length >= 3) {
            const w3 = waves.slice(-3);
            if (w3[0].t !== w3[1].t && w3[1].t !== w3[2].t && w3[0].t === w3[2].t && w3[1].l <= w3[0].l && w3[2].l <= w3[1].l) {
                return { pred: w3[2].t === 1 ? "xiu" : "tai", conf: 72 };
            }
        }
        return null;
    }
    
    markov3() {
        if (this.processed.length < 10) return null;
        const r = this.processed.map(p => p.resultNum);
        const states = new Map();
        for (let i = 0; i <= r.length - 4; i++) {
            const key = `${r[i]},${r[i+1]},${r[i+2]}`;
            if (!states.has(key)) states.set(key, { 0: 0, 1: 0 });
            states.get(key)[r[i+3]]++;
        }
        const lastKey = `${r[r.length-3]},${r[r.length-2]},${r[r.length-1]}`;
        const state = states.get(lastKey);
        if (state && state[0] + state[1] >= 2) {
            const total = state[0] + state[1];
            const prob = state[1] / total;
            const conf = Math.max(state[0], state[1]) / total * 100;
            return { pred: state[1] > state[0] ? "tai" : "xiu", conf: Math.min(85, conf) };
        }
        return null;
    }
    
    frequency() {
        if (this.processed.length < 30) return null;
        const r = this.processed.slice(-30).map(p => p.resultNum);
        const taiCount = r.reduce((a,b) => a+b, 0);
        if (taiCount > 20) return { pred: "xiu", conf: 65 };
        if (taiCount < 10) return { pred: "tai", conf: 65 };
        return null;
    }
    
    totalAnalysis() {
        if (this.processed.length < 20) return null;
        const totals = this.processed.slice(-20).map(p => p.tong);
        const mean = totals.reduce((a,b) => a+b, 0) / 20;
        const last = totals[totals.length-1];
        if (last > mean + 2.5) return { pred: "xiu", conf: 62 };
        if (last < mean - 2.5) return { pred: "tai", conf: 62 };
        return null;
    }
    
    diceAnalysis() {
        const last = this.processed[this.processed.length-1];
        const dice = [last.x1, last.x2, last.x3];
        let score = 0;
        for (let f of dice) { if (f <= 2) score--; if (f >= 5) score++; }
        if (score >= 2) return { pred: "tai", conf: 60 };
        if (score <= -2) return { pred: "xiu", conf: 60 };
        return null;
    }
    
    rsi() {
        if (this.processed.length < 20) return null;
        const r = this.processed.slice(-20).map(p => p.resultNum);
        let gains = 0, losses = 0;
        for (let i = 1; i < r.length; i++) {
            const diff = r[i] - r[i-1];
            if (diff > 0) gains += diff;
            else losses += -diff;
        }
        const rsi = 100 - 100 / (1 + gains/(losses+0.001));
        if (rsi > 70) return { pred: "xiu", conf: 65 };
        if (rsi < 30) return { pred: "tai", conf: 65 };
        return null;
    }
    
    patternMatch() {
        if (this.processed.length < 10) return null;
        const last8 = this.processed.slice(-8).map(p => p.resultNum).join('');
        let matches = [];
        for (let i = 0; i <= this.processed.length - 9; i++) {
            const p = this.processed.slice(i, i+8).map(p => p.resultNum).join('');
            if (p === last8) matches.push(this.processed[i+8].resultNum);
        }
        if (matches.length >= 2) {
            const taiCount = matches.filter(m => m === 1).length;
            const conf = 55 + Math.min(30, matches.length * 2);
            return { pred: taiCount > matches.length/2 ? "tai" : "xiu", conf };
        }
        return null;
    }
    
    // Tổng hợp dự đoán
    predict() {
        const analysis = this.analyze15();
        
        const allSignals = [
            this.cauBet(), this.cau11(), this.cau22(), this.cau121(), this.cau212(),
            this.cauZigzag(), this.cauFibonacci(), this.cauGann(), this.cauElliott(),
            this.markov3(), this.frequency(), this.totalAnalysis(), this.diceAnalysis(),
            this.rsi(), this.patternMatch()
        ];
        
        // Thêm tín hiệu mạnh từ phân tích 15 phiên
        for (const ss of analysis.strongSignals) {
            allSignals.push({ pred: ss.prediction, conf: ss.confidence });
        }
        
        // Lọc tín hiệu hợp lệ
        const validSignals = allSignals.filter(s => s && s.conf > 50);
        
        // Tính điểm
        let taiScore = 0, xiuScore = 0;
        for (const s of validSignals) {
            const weight = s.conf / 100;
            if (s.pred === "tai") taiScore += weight;
            else xiuScore += weight;
        }
        
        // Ưu tiên tín hiệu mạnh
        if (analysis.strongSignals.length > 0) {
            const bestStrong = analysis.strongSignals.sort((a,b) => b.confidence - a.confidence)[0];
            if (bestStrong.prediction === "tai") taiScore += 2;
            else xiuScore += 2;
        }
        
        const total = taiScore + xiuScore;
        let finalPred = taiScore >= xiuScore ? "tai" : "xiu";
        let finalConf = total > 0 ? Math.round(Math.max(taiScore, xiuScore) / total * 100) : 55;
        finalConf = Math.min(98, Math.max(60, finalConf));
        
        // Nếu có trùng cầu 100% thì độ tin cậy 96%
        if (analysis.strongSignals.some(s => s.type === "PATTERN_100%")) {
            finalPred = analysis.strongSignals.find(s => s.type === "PATTERN_100%").prediction;
            finalConf = 96;
        }
        
        const pattern = this.getPattern15();
        
        return {
            prediction: finalPred,
            confidence: finalConf,
            pattern: pattern,
            signalCount: validSignals.length,
            strongSignals: analysis.strongSignals.length,
            matchedPatterns: analysis.matched.length
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const predictor = new LoveTrangPredictor(sessions);
    return predictor.predict();
}

// ============ FETCH DATA ============
async function fetchData() {
    try {
        console.log("Đang fetch data từ API...");
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) {
            console.log("Data không đúng format, thử format khác...");
            if (Array.isArray(rawData)) {
                return rawData.map(normalizeData).sort((a, b) => a.phien - b.phien);
            }
            return null;
        }
        
        const data = rawData.data.map(normalizeData).sort((a, b) => a.phien - b.phien);
        console.log(`Đã lấy ${data.length} phiên`);
        return data;
    } catch (e) {
        console.log("Lỗi fetch:", e.message);
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const allData = await fetchData();
        if (!allData || allData.length < 15) {
            console.log("Không đủ dữ liệu (< 15 phiên)");
            isUpdating = false;
            return;
        }
        
        const latest = allData[allData.length - 1];
        const latestPhien = latest.phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length-1].phien : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            gameHistory = allData;
            
            const pred = superPredict(allData.slice(-300));
            
            currentPrediction = {
                id: "AnhKhoizZz",
                phien_truoc: latest.phien,
                xuc_xac1: latest.x1,
                xuc_xac2: latest.x2,
                xuc_xac3: latest.x3,
                tong: latest.tong,
                ket_qua: latest.ket_qua.toLowerCase(),
                pattern: pred.pattern,
                phien_hien_tai: latest.phien + 1,
                du_doan: pred.prediction,
                do_tin_cay: pred.confidence + "%"
            };
            
            console.log(`\n✅ DỰ ĐOÁN MỚI:`);
            console.log(`   Phiên trước: ${latest.phien} | Kết quả: ${latest.ket_qua} | Tổng: ${latest.tong}`);
            console.log(`   Xúc xắc: ${latest.x1}-${latest.x2}-${latest.x3}`);
            console.log(`   Pattern 15: ${pred.pattern}`);
            console.log(`   Phiên hiện tại: ${latest.phien + 1} | Dự đoán: ${pred.prediction} | Độ tin cậy: ${pred.confidence}%`);
            console.log(`   Số tín hiệu: ${pred.signalCount} | Trùng cầu: ${pred.matchedPatterns} | Tín hiệu mạnh: ${pred.strongSignals}`);
        }
    } catch (e) {
        console.log("Lỗi update:", e.message);
    }
    
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (currentPrediction) {
        return res.json(currentPrediction);
    }
    
    // Nếu chưa có dự đoán, fetch ngay
    const allData = await fetchData();
    if (!allData || allData.length < 15) {
        return res.json({
            id: "AnhKhoizZz",
            phien_truoc: 0,
            xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0,
            tong: 0,
            ket_qua: "dang tai",
            pattern: "",
            phien_hien_tai: 0,
            du_doan: "dang tai",
            do_tin_cay: "0%"
        });
    }
    
    gameHistory = allData;
    const latest = allData[allData.length - 1];
    const pred = superPredict(allData.slice(-300));
    
    currentPrediction = {
        id: "AnhKhoizZz",
        phien_truoc: latest.phien,
        xuc_xac1: latest.x1,
        xuc_xac2: latest.x2,
        xuc_xac3: latest.x3,
        tong: latest.tong,
        ket_qua: latest.ket_qua.toLowerCase(),
        pattern: pred.pattern,
        phien_hien_tai: latest.phien + 1,
        du_doan: pred.prediction,
        do_tin_cay: pred.confidence + "%"
    };
    
    res.json(currentPrediction);
});

app.get("/", (req, res) => {
    res.json({ 
        status: "OK", 
        engine: "Love Trang",
        currentPrediction: currentPrediction || "Chưa có dự đoán"
    });
});

// ============ KHỞI ĐỘNG ============
console.log('='.repeat(60));
console.log('   💖 LOVE TRANG PREDICTOR 💖');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

// Chạy ngay lần đầu
autoUpdate().then(() => {
    console.log('✅ Khởi tạo xong!');
    if (currentPrediction) {
        console.log(`📊 Dự đoán sẵn sàng: ${currentPrediction.du_doan} (${currentPrediction.do_tin_cay})`);
    }
});

// Cập nhật mỗi 100ms
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log(`🚀 Server chạy port ${PORT}`);
    console.log(`🌐 Truy cập: http://localhost:${PORT}/taixiu`);
    console.log('='.repeat(60));
});
