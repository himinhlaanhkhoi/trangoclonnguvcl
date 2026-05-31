const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let predictor = null;

// ============ HELPERS ============
const getPhien = item => item.phien ?? item.Phien ?? 0;
const getKetQua = item => (item.ket_qua ?? item.Ket_qua ?? '').toLowerCase();
const getTong = item => item.tong ?? item.Tong ?? 0;
const getX1 = item => item.xuc_xac_1 ?? item.Xuc_xac_1 ?? 0;
const getX2 = item => item.xuc_xac_2 ?? item.Xuc_xac_2 ?? 0;
const getX3 = item => item.xuc_xac_3 ?? item.Xuc_xac_3 ?? 0;

const normalize = item => ({
    ket_qua: getKetQua(item),
    tong: getTong(item),
    x1: getX1(item),
    x2: getX2(item),
    x3: getX3(item),
    phien: getPhien(item),
});

// ============ UTILS ============
const Utils = {
    sum: (arr) => arr.reduce((a,b) => a + b, 0),
    avg: (arr) => arr.length ? Utils.sum(arr) / arr.length : 0,
    std: (arr) => {
        const mean = Utils.avg(arr);
        return Math.sqrt(Utils.avg(arr.map(x => Math.pow(x - mean, 2))));
    },
    variance: (arr) => {
        const mean = Utils.avg(arr);
        return Utils.avg(arr.map(x => Math.pow(x - mean, 2)));
    },
    entropy: (arr) => {
        const p = Utils.avg(arr);
        if (p === 0 || p === 1) return 0;
        return -p * Math.log2(p) - (1-p) * Math.log2(1-p);
    }
};

// ============ DATA PREPROCESSOR V12 ============
class DataPreprocessorV12 {
    constructor(data) { this.raw = data; this.processed = null; }
    
    process() {
        const p = [];
        for (let i = 0; i < this.raw.length; i++) {
            const d = this.raw[i];
            const dice = [d.x1, d.x2, d.x3];
            const kq = d.ket_qua;
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;
            
            p.push({
                phien: d.phien, result: r, resultStr: kq, total: d.tong,
                x1: d.x1, x2: d.x2, x3: d.x3, dice,
                sum: d.x1+d.x2+d.x3, min: Math.min(...dice), max: Math.max(...dice),
                range: Math.max(...dice)-Math.min(...dice),
                isTriple: d.x1===d.x2 && d.x2===d.x3,
                isPair: (d.x1===d.x2||d.x1===d.x3||d.x2===d.x3) && !(d.x1===d.x2&&d.x2===d.x3),
                tripleValue: d.x1===d.x2&&d.x2===d.x3?d.x1:0,
                has1: dice.includes(1), has2: dice.includes(2), has3: dice.includes(3),
                has4: dice.includes(4), has5: dice.includes(5), has6: dice.includes(6),
            });
        }
        
        for (let i=1; i<p.length; i++) {
            let s=1;
            for(let j=i-1; j>=0&&p[j].result===p[i].result; j--) s++;
            p[i].streak = s;
        }
        
        for (let i=1; i<p.length; i++) {
            for (let f=1; f<=6; f++) {
                let s=0;
                for(let j=i; j>=0&&p[j][`has${f}`]; j--) s++;
                p[i][`face${f}Streak`] = s;
            }
        }
        
        for (let i=5; i<p.length; i++) {
            p[i].last5Sum = p.slice(i-4,i+1).reduce((a,b)=>a+b.result,0);
        }
        
        for (let i=10; i<p.length; i++) {
            p[i].last10Tai = p.slice(i-9,i+1).reduce((a,b)=>a+b.result,0)/10;
            p[i].entropy10 = Utils.entropy(p.slice(i-9,i+1).map(x=>x.result));
            p[i].trend10 = (p[i].result-p[i-9].result)/10;
        }
        
        for (let i=15; i<p.length; i++) {
            p[i].last15Pattern = p.slice(i-14,i+1).map(x=>x.result).join('');
        }
        
        for (let i=20; i<p.length; i++) {
            p[i].trend20 = (p[i].result-p[i-19].result)/20;
        }
        
        this.processed = p;
        return p;
    }
}

// ============================================================
// GOD MODE PREDICTOR V12.0
// Khai thác cốt lõi xác suất | Phá nát lỗ hổng game
// Siêu thích nghi | Độ chính xác tối đa
// ============================================================

class GodModePredictor {
    constructor(data) {
        this.raw = data;
        this.processed = null;
        this.core = null;
        this.exploits = [];
        this.history = [];
        this.init();
    }
    
    init() {
        const prep = new DataPreprocessorV12(this.raw);
        this.processed = prep.process();
        this.analyzeCoreProbability();
    }
    
    analyzeCoreProbability() {
        const results = this.processed.map(p => p.result);
        const n = results.length;
        const taiCount = results.filter(r => r === 1).length;
        const baseProb = taiCount / n;
        
        const totals = this.processed.map(p => p.total);
        const meanTotal = Utils.avg(totals);
        const stdTotal = Utils.std(totals);
        
        const faceCount = [0,0,0,0,0,0,0];
        for (const p of this.processed) {
            faceCount[p.x1]++; faceCount[p.x2]++; faceCount[p.x3]++;
        }
        const totalRolls = n * 3;
        const faceProb = faceCount.map(c => c / totalRolls);
        
        const corrMatrix = Array(7).fill().map(() => Array(7).fill(0));
        for (let i = 1; i < this.processed.length; i++) {
            const prev = [this.processed[i-1].x1, this.processed[i-1].x2, this.processed[i-1].x3];
            const curr = [this.processed[i].x1, this.processed[i].x2, this.processed[i].x3];
            for (const fp of prev) for (const fc of curr) corrMatrix[fp][fc]++;
        }
        for (let i=1; i<=6; i++) {
            const rowSum = corrMatrix[i].reduce((a,b)=>a+b,0);
            if (rowSum>0) for (let j=1; j<=6; j++) corrMatrix[i][j]/=rowSum;
        }
        
        const totalGivenPrev = {};
        for (let i=1; i<this.processed.length; i++) {
            const prev = this.processed[i-1].total;
            const curr = this.processed[i].total;
            if(!totalGivenPrev[prev]) totalGivenPrev[prev] = [];
            totalGivenPrev[prev].push(curr);
        }
        for (const prev in totalGivenPrev) {
            const arr = totalGivenPrev[prev];
            const mean = Utils.avg(arr);
            totalGivenPrev[prev] = { mean, std: Utils.std(arr) };
        }
        
        this.core = { baseProb, meanTotal, stdTotal, faceProb, corrMatrix, totalGivenPrev, n };
    }
    
    findExploits() {
        const exploits = [];
        
        // Face absence
        for (let face=1; face<=6; face++) {
            let lastSeen=-1;
            for(let i=this.processed.length-1; i>=0; i--) {
                if(this.processed[i][`has${face}`]){lastSeen=i;break;}
            }
            const absence = this.processed.length-1-lastSeen;
            if(absence>=12) {
                exploits.push({
                    type:"face_absence", face, absence,
                    prediction:face<=3?"xiu":"tai",
                    confidence:65+Math.min(20,absence)
                });
            }
        }
        
        // Total deviation
        const lastTotal = this.processed[this.processed.length-1].total;
        const deviation = Math.abs(lastTotal-this.core.meanTotal)/this.core.stdTotal;
        if(deviation>1.5) {
            exploits.push({
                type:"total_deviation", deviation,
                prediction:lastTotal>this.core.meanTotal?"xiu":"tai",
                confidence:60+Math.min(20,deviation*5)
            });
        }
        
        // Long streak
        const lastStreak = this.processed[this.processed.length-1].streak;
        if(lastStreak>=5) {
            exploits.push({
                type:"long_streak", streak:lastStreak,
                prediction:this.processed[this.processed.length-1].result===1?"xiu":"tai",
                confidence:60+Math.min(25,lastStreak*4)
            });
        }
        
        // Alternating
        if(this.processed.length>=10){
            const last10 = this.processed.slice(-10).map(p=>p.result);
            let isAlt=true;
            for(let i=1;i<10;i++) if(last10[i]===last10[i-1]){isAlt=false;break;}
            if(isAlt) exploits.push({type:"long_alternating",length:10,prediction:last10[9]===1?"xiu":"tai",confidence:72});
        }
        
        // Face correlation
        const lastFaces = [this.processed[this.processed.length-1].x1,this.processed[this.processed.length-1].x2,this.processed[this.processed.length-1].x3];
        let faceSignal={tai:0,xiu:0};
        for(const face of lastFaces){
            const nextProb=this.core.corrMatrix[face];
            if(nextProb){
                for(let nf=1;nf<=6;nf++){
                    if(nf<=3) faceSignal.xiu+=nextProb[nf];
                    else faceSignal.tai+=nextProb[nf];
                }
            }
        }
        const totalFS=faceSignal.tai+faceSignal.xiu;
        if(totalFS>0){
            const faceConf=Math.abs(faceSignal.tai-faceSignal.xiu)/totalFS*100;
            if(faceConf>55) exploits.push({type:"face_correlation",prediction:faceSignal.tai>faceSignal.xiu?"tai":"xiu",confidence:faceConf});
        }
        
        return exploits;
    }
    
    analyzeTotalZones() {
        const totals = this.processed.map(p=>p.total);
        const dist={};
        for(let i=3;i<=18;i++) dist[i]=0;
        for(const t of totals) dist[t]++;
        const peaks=[], valleys=[];
        for(let i=4;i<=17;i++){
            if(dist[i]<dist[i-1]&&dist[i]<dist[i+1]) valleys.push(i);
            if(dist[i]>dist[i-1]&&dist[i]>dist[i+1]) peaks.push(i);
        }
        const lastTotal=totals[totals.length-1];
        if(peaks.includes(lastTotal)) return {zone:"peak",prediction:"xiu",confidence:62};
        if(valleys.includes(lastTotal)) return {zone:"valley",prediction:"tai",confidence:62};
        return {zone:"normal",prediction:null,confidence:0};
    }
    
    analyzeChaoticCycles() {
        const results=this.processed.map(p=>p.result);
        const windows=[5,7,9,11,13,15,17,19];
        let bestCycle=null,bestAccuracy=0;
        for(const w of windows){
            if(results.length<w*2) continue;
            let matches=0;
            for(let i=w;i<results.length;i++) if(results[i]===results[i-w]) matches++;
            const acc=matches/(results.length-w);
            if(acc>bestAccuracy&&acc>0.58){bestAccuracy=acc;bestCycle=w;}
        }
        if(bestCycle&&results.length>=bestCycle){
            const pred=results[results.length-bestCycle];
            return {hasCycle:true,cycle:bestCycle,accuracy:bestAccuracy,prediction:pred===1?"tai":"xiu",confidence:60+bestAccuracy*30};
        }
        return {hasCycle:false};
    }
    
    bayesianInference() {
        const last=this.processed[this.processed.length-1];
        const lastResult=last.result, lastTotal=last.total, lastStreak=last.streak;
        let prior=this.core.baseProb;
        
        let streakLikelihood=0.5;
        if(lastStreak>=4){
            let sf=0,st=0;
            for(let i=lastStreak;i<this.processed.length-1;i++){
                let isS=true;
                for(let j=0;j<lastStreak;j++) if(this.processed[i-1-j].result!==lastResult){isS=false;break;}
                if(isS){st++;if(this.processed[i].result===lastResult) sf++;}
            }
            streakLikelihood=st>5?sf/st:0.5+(lastStreak-3)*0.05;
        }
        
        let totalLikelihood=0.5;
        if(this.core.totalGivenPrev[lastTotal]) totalLikelihood=this.core.totalGivenPrev[lastTotal].mean>=11?0.6:0.4;
        
        const posterior=(prior*streakLikelihood*totalLikelihood)/(prior*streakLikelihood*totalLikelihood+(1-prior)*(1-streakLikelihood)*(1-totalLikelihood));
        const conf=Math.abs(posterior-0.5)*2*100;
        return {prediction:posterior>=0.5?"tai":"xiu",confidence:Math.min(85,conf),posterior};
    }
    
    totalExploit() {
        const lastTotal=this.processed[this.processed.length-1].total;
        const last3=this.processed.slice(-3).map(p=>p.total);
        const trend3=(last3[2]-last3[0])/2;
        if(Math.abs(trend3)>2) return {prediction:trend3>0?"xiu":"tai",confidence:63,exploit:"total_trend"};
        if(lastTotal>=16) return {prediction:"xiu",confidence:68,exploit:"total_very_high"};
        if(lastTotal<=4) return {prediction:"tai",confidence:70,exploit:"total_very_low"};
        return null;
    }
    
    neuralHeuristic() {
        const recent=this.processed.slice(-20);
        const results=recent.map(p=>p.result);
        const totals=recent.map(p=>p.total);
        const avgResult=Utils.avg(results);
        const avgTotal=Utils.avg(totals);
        const trend=(results[results.length-1]-results[0])/20;
        const totalTrend=(totals[totals.length-1]-totals[0])/20;
        const volatility=Utils.std(totals);
        const ent=Utils.entropy(results);
        const streak=this.processed[this.processed.length-1].streak;
        
        let score=0;
        score+=(avgResult-0.5)*0.8;
        score+=trend*1.2;
        score+=(avgTotal-10.5)/10*0.5;
        score+=totalTrend*0.6;
        score+=(volatility-3)/5*0.3;
        score+=(0.5-ent)*0.7;
        score+=(streak-2.5)/8*0.4;
        
        let prob=0.5+Math.min(0.4,Math.max(-0.4,score));
        return {prediction:prob>=0.5?"tai":"xiu",confidence:Math.abs(prob-0.5)*2*100,prob};
    }
    
    // Phân tích 15 phiên
    analyzeLast15() {
        if(this.processed.length<15) return {matched:[],strong:[]};
        const last15=this.processed.slice(-15);
        const pat15=last15.map(p=>p.result).join('');
        const dice15=last15.map(p=>`${p.x1}${p.x2}${p.x3}`).join('|');
        const matched=[],strong=[];
        
        for(let i=0;i<=this.processed.length-16;i++){
            const hist=this.processed.slice(i,i+15).map(p=>p.result).join('');
            if(hist===pat15) matched.push({next:this.processed[i+15].result===1?"tai":"xiu",conf:Math.min(95,60+matched.length*5)});
        }
        for(let i=0;i<=this.processed.length-16;i++){
            const hd=this.processed.slice(i,i+15).map(p=>`${p.x1}${p.x2}${p.x3}`).join('|');
            if(hd===dice15){strong.push({type:"DICE",prediction:this.processed[i+15].result===1?"tai":"xiu",confidence:90});break;}
        }
        if(matched.length>0){
            const tc=matched.filter(m=>m.next==="tai").length,xc=matched.filter(m=>m.next==="xiu").length;
            if(tc+xc>=3&&(tc===tc+xc||xc===tc+xc)) strong.push({type:"PAT100",prediction:tc===tc+xc?"tai":"xiu",confidence:96});
            else if(tc+xc>=2&&Math.max(tc,xc)/(tc+xc)>=0.75){const p=tc>xc?"tai":"xiu";strong.push({type:"PATHIGH",prediction:p,confidence:75+(Math.max(tc,xc)/(tc+xc)*100-75)/5});}
        }
        return {matched,strong};
    }
    
    getLast15Pattern() {
        if(this.processed.length<15) return "";
        return this.processed.slice(-15).map(p=>p.result===1?"t":"x").join('');
    }
    
    superPredict() {
        const analysis=this.analyzeLast15();
        const signals=[];
        
        // Exploits
        const exploits=this.findExploits();
        for(const exp of exploits) signals.push({source:`Exploit_${exp.type}`,prediction:exp.prediction,confidence:exp.confidence,weight:1.2});
        
        // Zones
        const zones=this.analyzeTotalZones();
        if(zones.prediction) signals.push({source:`Zone_${zones.zone}`,prediction:zones.prediction,confidence:zones.confidence,weight:1.0});
        
        // Cycles
        const cycles=this.analyzeChaoticCycles();
        if(cycles.hasCycle) signals.push({source:`Cycle_${cycles.cycle}`,prediction:cycles.prediction,confidence:cycles.confidence,weight:1.1});
        
        // Bayes
        const bayes=this.bayesianInference();
        signals.push({source:"Bayesian",prediction:bayes.prediction,confidence:bayes.confidence,weight:1.15});
        
        // Total exploit
        const totalExp=this.totalExploit();
        if(totalExp) signals.push({source:`TotalExploit_${totalExp.exploit}`,prediction:totalExp.prediction,confidence:totalExp.confidence,weight:1.1});
        
        // Neural
        const neural=this.neuralHeuristic();
        signals.push({source:"NeuralHeuristic",prediction:neural.prediction,confidence:neural.confidence,weight:1.0});
        
        // Pattern match từ 15 phiên
        if(analysis.matched.length>0){
            const best=analysis.matched.sort((a,b)=>b.conf-a.conf)[0];
            signals.push({source:"Pattern15",prediction:best.next,confidence:best.conf,weight:1.3});
        }
        for(const ss of analysis.strong) signals.push({source:ss.type,prediction:ss.prediction,confidence:ss.confidence,weight:2.0});
        
        // Statistical
        const last10Tai=this.processed.slice(-10).reduce((a,b)=>a+b.result,0)/10;
        if(last10Tai>0.7) signals.push({source:"StatHigh",prediction:"xiu",confidence:65,weight:1.0});
        if(last10Tai<0.3) signals.push({source:"StatLow",prediction:"tai",confidence:65,weight:1.0});
        
        const recTot=this.processed.slice(-10).map(p=>p.total);
        const avgRec=Utils.avg(recTot);
        const last=this.processed[this.processed.length-1];
        if(last.total>avgRec+3) signals.push({source:"TotalHigh",prediction:"xiu",confidence:62,weight:1.0});
        if(last.total<avgRec-3) signals.push({source:"TotalLow",prediction:"tai",confidence:62,weight:1.0});
        
        // Fibonacci
        if(this.processed.length>=30){
            const totals=this.processed.slice(-30).map(p=>p.total);
            const h=Math.max(...totals),l=Math.min(...totals),r=h-l;
            if(last.total>l+r*0.618) signals.push({source:"Fib",prediction:"xiu",confidence:66,weight:1.0});
            if(last.total<l+r*0.382) signals.push({source:"Fib",prediction:"tai",confidence:66,weight:1.0});
        }
        
        // Weighted voting
        let taiScore=0,xiuScore=0;
        for(const sig of signals){
            const w=sig.confidence*sig.weight;
            if(sig.prediction==="tai") taiScore+=w;
            else xiuScore+=w;
        }
        
        let final=taiScore>=xiuScore?"tai":"xiu";
        let conf=Math.round(Math.max(taiScore,xiuScore)/(taiScore+xiuScore)*100);
        
        if(analysis.strong.some(s=>s.type==="PAT100")){final=analysis.strong.find(s=>s.type==="PAT100").prediction;conf=96;}
        else if(analysis.strong.some(s=>s.type==="DICE")){final=analysis.strong.find(s=>s.type==="DICE").prediction;conf=Math.max(conf,90);}
        
        conf=Math.max(60,Math.min(98,conf));
        const pattern=this.getLast15Pattern();
        
        let predictedTotal=10;
        if(this.processed.length>=10){
            const totals=this.processed.slice(-10).map(p=>p.total);
            predictedTotal=Math.round(Utils.avg(totals));
            if(last.total>=15) predictedTotal=Math.min(predictedTotal,12);
            if(last.total<=5) predictedTotal=Math.max(predictedTotal,9);
            predictedTotal=Math.min(18,Math.max(3,predictedTotal));
        }
        
        this.lastPrediction=final;
        
        return {prediction:final,confidence:conf,pattern,predictedTotal};
    }
}

// ============ FETCH ============
async function fetchData() {
    try {
        const res = await axios.get(API_URL, {timeout:10000});
        const raw = res.data;
        const arr = raw?.data ?? (Array.isArray(raw)?raw:null);
        return arr?.map(normalize).sort((a,b)=>a.phien-b.phien)??null;
    } catch { return null; }
}

// ============ UPDATE ============
async function updatePrediction() {
    if(isUpdating) return;
    isUpdating=true;
    try {
        const data = await fetchData();
        if(!data||data.length<15) return;
        const latest=data[data.length-1];
        
        predictor = new GodModePredictor(data.slice(-500));
        const pred = predictor.superPredict();
        if(!pred) return;
        
        gameHistory=data;
        currentPrediction={
            id:'AnhKhoizZz',
            phien_truoc:latest.phien,
            xuc_xac1:latest.x1,
            xuc_xac2:latest.x2,
            xuc_xac3:latest.x3,
            tong:latest.tong,
            ket_qua:latest.ket_qua,
            pattern:pred.pattern,
            phien_hien_tai:latest.phien+1,
            du_doan:pred.prediction,
            do_tin_cay:pred.confidence+'%',
            tong_du_doan:pred.predictedTotal,
        };
        console.log(`💀 GOD MODE: ${pred.prediction} (${pred.confidence}%) | Tổng ~${pred.predictedTotal} | Pattern: ${pred.pattern}`);
    } catch(e){console.error('Lỗi update:',e.message);}
    isUpdating=false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if(!currentPrediction) await updatePrediction();
    if(currentPrediction) return res.json(currentPrediction);
    res.json({id:'AnhKhoizZz',phien_truoc:0,xuc_xac1:0,xuc_xac2:0,xuc_xac3:0,tong:0,ket_qua:'đang tải',pattern:'',phien_hien_tai:0,du_doan:'đang tải',do_tin_cay:'0%',tong_du_doan:0});
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
updatePrediction();
setInterval(updatePrediction, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('   💀 GOD MODE PREDICTOR V12.0 💀');
    console.log('   Khai thác cốt lõi xác suất | Phá nát lỗ hổng game');
    console.log('   API: lovetrang-xinkgai.onrender.com/data');
    console.log('='.repeat(60));
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log('='.repeat(60));
});
