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
const MAX_HISTORY = 500;
const MAX_SESSIONS = 10; // Giảm xuống 10 để nhanh có dự đoán
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
        this.cacheL1 = new Map();
        this.patternDB = {};
        this.cauDB = this.initCauDB_V14();
        this.cauDangChay = null;
        
        if (this.data.length >= 5) {
            this.analyzeAllCau();
            this.deepLearn();
        }
    }

    preprocessData(data) {
        const processed = [];
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const resultBit = item.Ket_qua === "Tài" ? 1 : 0;
            const streak = (i > 0 && data[i-1].Ket_qua === item.Ket_qua) ? 
                (processed[i-1]?.s + 1 || 1) : 1;
            const dice = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
            const sum = dice[0] + dice[1] + dice[2];
            const hasDouble = (dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]) ? 1 : 0;
            const hasTriple = (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0;
            const diceRange = Math.max(...dice) - Math.min(...dice);
            
            processed.push({
                result: item.Ket_qua,
                r: resultBit,
                t: sum,
                s: streak,
                d: dice,
                hd: hasDouble,
                ht: hasTriple,
                dr: diceRange,
                p: item.Phien
            });
        }
        return processed;
    }

    initCauDB_V14() {
        return {
            coBan: {
                '1_1': { ten: 'Cầu 1-1', mau: 0, dung: 0, p: 65, w: 1.0 },
                '2_2': { ten: 'Cầu 2-2', mau: 0, dung: 0, p: 65, w: 1.0 }
            },
            ngan: {
                'TTX': { ten: 'TTX', mau: 0, dung: 0, p: 65, w: 0.7 },
                'XXT': { ten: 'XXT', mau: 0, dung: 0, p: 65, w: 0.7 }
            },
            trung: {
                'TXXT': { ten: 'Đối xứng', mau: 0, dung: 0, p: 68, w: 1.2 },
                'XTTX': { ten: 'Đối xứng', mau: 0, dung: 0, p: 68, w: 1.2 }
            }
        };
    }

    analyzeAllCau() {
        if (this.data.length < 10) return;
        
        for (let i = 5; i < this.data.length - 1; i++) {
            const sau = this.data[i+1].result;
            const truoc4 = this.data.slice(i-3, i+1).map(d => d.result);
            const s4 = truoc4.join('');
            
            if (s4 === 'TàiXỉuTàiXỉu') { this.cauDB.coBan['1_1'].mau++; if (sau === 'Xỉu') this.cauDB.coBan['1_1'].dung++; }
            if (s4 === 'XỉuTàiXỉuTài') { this.cauDB.coBan['1_1'].mau++; if (sau === 'Tài') this.cauDB.coBan['1_1'].dung++; }
            if (s4 === 'TàiXỉuXỉuTài') { this.cauDB.trung.TXXT.mau++; if (sau === 'Tài') this.cauDB.trung.TXXT.dung++; }
            if (s4 === 'XỉuTàiTàiXỉu') { this.cauDB.trung.XTTX.mau++; if (sau === 'Xỉu') this.cauDB.trung.XTTX.dung++; }
        }
        
        for (const nhom in this.cauDB) {
            for (const loai in this.cauDB[nhom]) {
                const c = this.cauDB[nhom][loai];
                if (c.mau > 0) c.p = parseFloat((c.dung / c.mau * 100).toFixed(1));
                else c.p = 65;
            }
        }
        
        this.cauDangChay = this.detectCurrentCau();
    }

    detectCurrentCau() {
        if (this.data.length < 4) return null;
        
        const last4 = this.data.slice(-4).map(d => d.result);
        const s4 = last4.join('');
        
        if (s4 === 'TàiXỉuTàiXỉu') return { ten: 'Cầu 1-1', duDoan: 'Xỉu', doTinCay: 72, weight: 1.0 };
        if (s4 === 'XỉuTàiXỉuTài') return { ten: 'Cầu 1-1', duDoan: 'Tài', doTinCay: 72, weight: 1.0 };
        if (s4 === 'TàiXỉuXỉuTài') return { ten: 'Cầu đối xứng', duDoan: 'Tài', doTinCay: 70, weight: 1.2 };
        if (s4 === 'XỉuTàiTàiXỉu') return { ten: 'Cầu đối xứng', duDoan: 'Xỉu', doTinCay: 70, weight: 1.2 };
        
        const last = this.data[this.data.length - 1];
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            return { ten: `Bệt ${last.s} phiên`, duDoan: rev, doTinCay: 65 + Math.min(15, (last.s - 2) * 4), weight: 1.2 };
        }
        
        return null;
    }

    deepLearn() {
        const startIdx = Math.max(0, this.data.length - 100);
        for (let i = startIdx; i < this.data.length - 1; i++) {
            const d = this.data[i];
            const key = `${d.r}|${d.t}|${d.s}|${d.hd}|${d.ht}`;
            const nextResult = this.data[i + 1].result;
            
            if (!this.patternDB[key]) {
                this.patternDB[key] = { 'Tài': 0, 'Xỉu': 0, total: 0 };
            }
            this.patternDB[key][nextResult]++;
            this.patternDB[key].total++;
        }
    }

    findAllMatchingCau() {
        const predictions = [];
        if (this.data.length < 4) return predictions;
        
        const last4 = this.data.slice(-4).map(d => d.result);
        const s4 = last4.join('');
        
        if (s4 === 'TàiXỉuTàiXỉu') predictions.push({ pred: 'Xỉu', conf: 72, weight: 1.0, name: 'cau_1_1', reason: 'Cầu 1-1' });
        if (s4 === 'XỉuTàiXỉuTài') predictions.push({ pred: 'Tài', conf: 72, weight: 1.0, name: 'cau_1_1', reason: 'Cầu 1-1' });
        if (s4 === 'TàiXỉuXỉuTài') predictions.push({ pred: 'Tài', conf: 70, weight: 1.2, name: 'cau_doi_xung', reason: 'Cầu đối xứng' });
        if (s4 === 'XỉuTàiTàiXỉu') predictions.push({ pred: 'Xỉu', conf: 70, weight: 1.2, name: 'cau_doi_xung', reason: 'Cầu đối xứng' });
        
        return predictions;
    }

    deepPatternPredict() {
        if (this.data.length < 5) return null;
        const last = this.data[this.data.length - 1];
        const key = `${last.r}|${last.t}|${last.s}|${last.hd}|${last.ht}`;
        const pattern = this.patternDB[key];
        
        if (pattern && pattern.total >= 3) {
            const pred = pattern['Tài'] > pattern['Xỉu'] ? 'Tài' : 'Xỉu';
            const conf = 50 + (Math.max(pattern['Tài'], pattern['Xỉu']) / pattern.total) * 40;
            return { pred, conf: Math.min(85, conf), weight: 1.5, name: 'deep_pattern', reason: `Pattern ${pattern.total} lần` };
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
            if (probTai > 0.6) predictions.push({ pred: 'Tài', conf: probTai * 100, weight: 1.3, name: 'transition', reason: `P(T)=${(probTai*100).toFixed(0)}%` });
            else if (probTai < 0.4) predictions.push({ pred: 'Xỉu', conf: (1 - probTai) * 100, weight: 1.3, name: 'transition', reason: `P(T)=${(probTai*100).toFixed(0)}%` });
        }
        
        // Streak
        if (last.s >= 3) {
            const rev = last.result === 'Tài' ? 'Xỉu' : 'Tài';
            predictions.push({ pred: rev, conf: 65 + Math.min(10, (last.s - 2) * 3), weight: 1.2, name: 'streak', reason: `Đảo sau bệt ${last.s}` });
        }
        
        return predictions;
    }

    runSpecialPredictors(last) {
        const predictions = [];
        
        if (last.t <= 6) predictions.push({ pred: 'Tài', conf: 64, weight: 1.2, name: 'tong_thap', reason: `Tổng=${last.t}` });
        if (last.t >= 15) predictions.push({ pred: 'Xỉu', conf: 63, weight: 1.2, name: 'tong_cao', reason: `Tổng=${last.t}` });
        
        if (last.ht === 1) {
            if (last.d[0] === 1) predictions.push({ pred: 'Xỉu', conf: 95, weight: 3.0, name: 'triple', reason: 'Bộ 3 mặt 1' });
            else if (last.d[0] === 6) predictions.push({ pred: 'Tài', conf: 92, weight: 3.0, name: 'triple', reason: 'Bộ 3 mặt 6' });
        }
        
        return predictions;
    }

    predict(showDetail = false) {
        const last = this.data[this.data.length - 1];
        
        const allPredictions = [];
        
        if (this.cauDangChay) {
            allPredictions.push({
                pred: this.cauDangChay.duDoan,
                conf: this.cauDangChay.doTinCay,
                weight: (this.cauDangChay.weight || 1.0) * 1.5,
                name: 'cau_dang_chay',
                reason: this.cauDangChay.ten
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
            return { prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu', confidence: 55, activeAlgorithms: 0 };
        }
        
        const scores = { 'Tài': 0, 'Xỉu': 0 };
        allPredictions.forEach(p => { scores[p.pred] += p.conf * p.weight; });
        
        const finalPred = scores['Tài'] >= scores['Xỉu'] ? 'Tài' : 'Xỉu';
        const totalScore = scores['Tài'] + scores['Xỉu'];
        let confidence = totalScore > 0 ? (Math.max(scores['Tài'], scores['Xỉu']) / totalScore * 100) : 50;
        confidence = Math.min(97, Math.round(confidence));
        
        const result = {
            prediction: finalPred,
            confidence: confidence,
            activeAlgorithms: allPredictions.length,
            cauDangChay: this.cauDangChay
        };
        
        if (showDetail) {
            console.log(`🎯 DỰ ĐOÁN: ${result.prediction} | ĐTC: ${result.confidence}% | ${result.activeAlgorithms} thuật toán`);
            if (result.cauDangChay) console.log(`📡 CẦU: ${result.cauDangChay.ten} → ${result.cauDangChay.duDoan}`);
        }
        
        return result;
    }

    updateWithNewData(newData) {
        this.raw = [...newData, ...this.raw].slice(0, 500);
        this.data = this.preprocessData(this.raw);
        this.cacheL1.clear();
        this.analyzeAllCau();
        this.deepLearn();
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
            
            if (sessionsStore.length >= 3) {
                isReady = true;
                predictor = new GodPredictorV7(sessionsStore);
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
    
    if (!isReady && sessionsStore.length >= 3) {
        isReady = true;
        predictor = new GodPredictorV7(sessionsStore);
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
            const duDoanChuan = record.du_doan.toLowerCase() === 'tài' ? 'tài' : 'xỉu';
            const ketQuaChuan = actualResult.Ket_qua.toLowerCase() === 'tài' ? 'tài' : 'xỉu';
            const isCorrect = duDoanChuan === ketQuaChuan;
            const danhGia = isCorrect ? 'thắng' : 'thua';
            
            record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            
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
        
        const latestSessions = sessionsStore.slice(0, 10);
        if (latestSessions.length > 0 && predictor) {
            const latestPhien = latestSessions[0].Phien;
            const nextPhien = latestPhien + 1;
            
            if (lastProcessedPhien !== nextPhien) {
                const result = predictor.predict(false);
                savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
                lastProcessedPhien = nextPhien;
                
                const thongKe = tinhThongKeThangThua();
                console.log(`[DỰ ĐOÁN] 👑 MD5 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) - 📊 TL: ${thongKe.ty_le_thang}% (${thongKe.thang}/${thongKe.tong})`);
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
    console.log('👑 GOD PREDICTOR V7 - DỰ ĐOÁN TÀI XỈU MD5');
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
        md5: { 
            sessions: sessionsStore.length, 
            ready: isReady,
            da_phan_tich: sessionsStore.length,
            da_du_doan: bangThangThua.length
        },
        thong_ke: thongKe
    });
});

app.get('/lc79-md5', async (req, res) => {
    try {
        if (!isReady || !predictor) {
            return res.json({ 
                status: 'loading', 
                message: `Đang tải dữ liệu: ${sessionsStore.length} phiên`,
                sessions: sessionsStore.length
            });
        }
        
        await fetchAndUpdate();
        verifyAndRecord();
        
        const latestSessions = sessionsStore.slice(0, 5);
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictor.predict(false);
        const thongKe = tinhThongKeThangThua();
        
        const record = savePredictionToHistory(latestPhien, nextPhien, result.prediction, result.confidence, latestSessions[0]);
        
        res.json({
            phien_hien_tai: record.phien_truoc_do,
            phien_du_doan: record.phien_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
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
        console.error('Error:', error);
        res.status(500).json({ error: 'Lỗi server', detail: error.message });
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
        bang_thang_thua: bangThangThua.slice(0, 30)
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 GOD PREDICTOR V7 - DỰ ĐOÁN TÀI XỈU MD5');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CẤU HÌNH:');
    console.log(`   • Lưu thắng thua tối đa ${MAX_HISTORY} phiên`);
    console.log(`   • Tự động xóa khi quá ${MAX_HISTORY} phiên`);
    console.log('   • Mỗi phiên chỉ 1 bản ghi - không bị trùng');
    console.log('   • Dự đoán ngay khi có dữ liệu');
    console.log('');
    console.log('📊 ENDPOINTS:');
    console.log('   • GET /lc79-md5 - Dự đoán + thống kê');
    console.log('   • GET /lc79-md5/lichsu - Lịch sử + bảng thắng thua');
    console.log('   • GET /lc79-md5/thongke - Chỉ thống kê');
    console.log('   • GET /status - Trạng thái hệ thống');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
