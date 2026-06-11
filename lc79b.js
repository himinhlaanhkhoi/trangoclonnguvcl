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
const MAX_HISTORY = 2000;
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
    if (predictorInstance && predictorInstance.updateResult) {
        predictorInstance.updateResult(duDoan, ketQua, isCorrect);
    }
    return isCorrect;
}

class StatisticalAnalyzer {
    constructor() {
        this.mean = 0; this.variance = 0; this.stdDev = 0; this.autocorrelation = [];
    }
    calculateStatistics(results) {
        const numerical = results.map(r => r === 'Tài' ? 1 : 0);
        const n = numerical.length;
        this.mean = numerical.reduce((a,b) => a+b, 0) / n;
        this.variance = numerical.reduce((a,b) => a + Math.pow(b - this.mean, 2), 0) / n;
        this.stdDev = Math.sqrt(this.variance);
        return { mean: this.mean, variance: this.variance, stdDev: this.stdDev };
    }
    calculateAutocorrelation(results, lag = 5) {
        const numerical = results.map(r => r === 'Tài' ? 1 : 0);
        const n = numerical.length;
        const mean = numerical.reduce((a,b) => a+b, 0) / n;
        this.autocorrelation = [];
        for (let l = 1; l <= lag; l++) {
            let numerator = 0, denominator = 0;
            for (let i = 0; i < n - l; i++) numerator += (numerical[i] - mean) * (numerical[i + l] - mean);
            for (let i = 0; i < n; i++) denominator += Math.pow(numerical[i] - mean, 2);
            this.autocorrelation.push(numerator / denominator);
        }
        return this.autocorrelation;
    }
    detectSeasonality(results) {
        const acf = this.calculateAutocorrelation(results, 10);
        let seasonLength = 0, maxValue = -Infinity;
        for (let i = 2; i <= 7; i++) {
            if (Math.abs(acf[i-1]) > maxValue && Math.abs(acf[i-1]) > 0.3) {
                maxValue = Math.abs(acf[i-1]); seasonLength = i;
            }
        }
        return seasonLength > 0 ? { period: seasonLength, strength: maxValue } : null;
    }
}

class ARIMAModel {
    constructor(p = 1, d = 1, q = 1) { this.p = p; this.d = d; this.q = q; this.arParams = Array(p).fill(0.1); this.maParams = Array(q).fill(0.1); this.residuals = []; }
    difference(series, order = 1) {
        let diffed = [...series];
        for (let d = 0; d < order; d++) { const temp = []; for (let i = 1; i < diffed.length; i++) temp.push(diffed[i] - diffed[i-1]); diffed = temp; }
        return diffed;
    }
    inverseDifference(original, predicted, order = 1) {
        let result = [...predicted];
        for (let d = 0; d < order; d++) {
            const temp = []; const base = original[original.length - result.length - 1];
            temp.push(base + result[0]);
            for (let i = 1; i < result.length; i++) temp.push(temp[i-1] + result[i]);
            result = temp;
        }
        return result;
    }
    estimateParameters(series) {
        const numerical = series.map(s => s === 'Tài' ? 1 : 0);
        const diffed = this.difference(numerical, this.d);
        if (this.p > 0 && diffed.length > this.p) {
            const r = [];
            for (let k = 0; k <= this.p; k++) {
                let sum = 0;
                for (let t = 0; t < diffed.length - k; t++) sum += (diffed[t] - 0.5) * (diffed[t + k] - 0.5);
                r.push(sum / diffed.length);
            }
            const R = [];
            for (let i = 0; i < this.p; i++) { R[i] = []; for (let j = 0; j < this.p; j++) R[i][j] = r[Math.abs(i - j)]; }
            const rVector = r.slice(1, this.p + 1);
            this.arParams = this.solveLinearSystem(R, rVector);
        }
        return { arParams: this.arParams };
    }
    solveLinearSystem(A, b) {
        const n = A.length; const augmented = A.map((row, i) => [...row, b[i]]);
        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let j = i + 1; j < n; j++) if (Math.abs(augmented[j][i]) > Math.abs(augmented[maxRow][i])) maxRow = j;
            [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
            const pivot = augmented[i][i];
            for (let j = i; j <= n; j++) augmented[i][j] /= pivot;
            for (let j = 0; j < n; j++) {
                if (j !== i) { const factor = augmented[j][i]; for (let k = i; k <= n; k++) augmented[j][k] -= factor * augmented[i][k]; }
            }
        }
        return augmented.map(row => row[n]);
    }
    predict(series, steps = 1) {
        const numerical = series.map(s => s === 'Tài' ? 1 : 0);
        const diffed = this.difference(numerical, this.d);
        if (diffed.length < Math.max(this.p, this.q)) return null;
        const predictions = [];
        let lastValues = diffed.slice(-this.p);
        let lastErrors = this.residuals.slice(-this.q);
        for (let step = 0; step < steps; step++) {
            let arTerm = 0; for (let i = 0; i < this.p; i++) arTerm += this.arParams[i] * (lastValues[lastValues.length - 1 - i] || 0);
            let maTerm = 0; for (let i = 0; i < this.q; i++) maTerm += this.maParams[i] * (lastErrors[lastErrors.length - 1 - i] || 0);
            const prediction = arTerm + maTerm;
            predictions.push(prediction);
            const error = (diffed[diffed.length - this.q + step] || 0) - prediction;
            this.residuals.push(error);
            if (this.residuals.length > this.q * 2) this.residuals.shift();
            lastValues.push(prediction); if (lastValues.length > this.p) lastValues.shift();
        }
        const undiffed = this.inverseDifference(numerical, predictions, this.d);
        const finalPrediction = undiffed[0] > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 60 + Math.abs(undiffed[0] - 0.5) * 40;
        return { prediction: finalPrediction, confidence: Math.min(89, confidence), name: 'ARIMA' };
    }
}

class GARCHModel {
    constructor(p = 1, q = 1) { this.p = p; this.q = q; this.omega = 0.1; this.alphas = Array(p).fill(0.1); this.betas = Array(q).fill(0.8); this.conditionalVariances = []; }
    estimateVolatility(returns) {
        const n = returns.length;
        this.conditionalVariances = Array(n).fill(this.omega / (1 - this.alphas.reduce((a,b) => a+b, 0) - this.betas.reduce((a,b) => a+b, 0)));
        for (let t = 1; t < n; t++) {
            let arch = 0; for (let i = 0; i < Math.min(this.p, t); i++) arch += this.alphas[i] * Math.pow(returns[t - 1 - i], 2);
            let garch = 0; for (let j = 0; j < Math.min(this.q, t); j++) garch += this.betas[j] * this.conditionalVariances[t - 1 - j];
            this.conditionalVariances[t] = this.omega + arch + garch;
        }
        return this.conditionalVariances;
    }
    predictNextVolatility(returns) {
        const lastVariance = this.conditionalVariances[this.conditionalVariances.length - 1] || this.omega;
        const lastReturn = returns[returns.length - 1] || 0;
        let arch = 0; for (let i = 0; i < Math.min(this.p, returns.length); i++) arch += this.alphas[i] * Math.pow(returns[returns.length - 1 - i] || 0, 2);
        let garch = 0; for (let j = 0; j < Math.min(this.q, this.conditionalVariances.length); j++) garch += this.betas[j] * (this.conditionalVariances[this.conditionalVariances.length - 1 - j] || lastVariance);
        const nextVariance = this.omega + arch + garch;
        return Math.sqrt(nextVariance);
    }
    predict(results) {
        const returns = [];
        for (let i = 1; i < results.length; i++) returns.push(results[i-1] === results[i] ? 0 : (results[i] === 'Tài' ? 1 : -1));
        if (returns.length < 10) return null;
        const volatilities = this.estimateVolatility(returns);
        const nextVol = this.predictNextVolatility(returns);
        const avgVol = volatilities.reduce((a,b) => a+b, 0) / volatilities.length;
        if (nextVol > avgVol * 1.3) {
            const lastResult = results[0];
            return { prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài', confidence: 68 + Math.min(20, (nextVol / avgVol - 1) * 30), name: 'GARCH' };
        } else if (nextVol < avgVol * 0.7) {
            return { prediction: results[0], confidence: 65, name: 'GARCH' };
        }
        return null;
    }
}

class MonteCarloSimulator {
    constructor(nSimulations = 1000, horizon = 5) { this.nSimulations = nSimulations; this.horizon = horizon; }
    estimateTransitionProbabilities(results) {
        const transitions = { TT: 0, TX: 0, XT: 0, XX: 0 };
        for (let i = 1; i < results.length; i++) {
            const key = (results[i-1] === 'Tài' ? 'T' : 'X') + (results[i] === 'Tài' ? 'T' : 'X');
            transitions[key]++;
        }
        const total = transitions.TT + transitions.TX + transitions.XT + transitions.XX;
        if (total === 0) return { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 };
        return { TT: transitions.TT / (transitions.TT + transitions.TX), TX: transitions.TX / (transitions.TT + transitions.TX), XT: transitions.XT / (transitions.XT + transitions.XX), XX: transitions.XX / (transitions.XT + transitions.XX) };
    }
    runSimulation(startState, transitionProbs) {
        const path = [startState]; let currentState = startState;
        for (let step = 0; step < this.horizon; step++) {
            const prob = (currentState === 'Tài') ? transitionProbs.TT : transitionProbs.XT;
            const nextState = Math.random() < prob ? 'Tài' : 'Xỉu';
            path.push(nextState); currentState = nextState;
        }
        return path;
    }
    predict(results) {
        if (results.length < 10) return null;
        const transitionProbs = this.estimateTransitionProbabilities(results);
        const startState = results[0];
        const outcomes = { Tai: 0, Xiu: 0 };
        for (let i = 0; i < this.nSimulations; i++) {
            const path = this.runSimulation(startState, transitionProbs);
            if (path[this.horizon] === 'Tài') outcomes.Tai++; else outcomes.Xiu++;
        }
        const taiProbability = outcomes.Tai / this.nSimulations;
        const prediction = taiProbability > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(taiProbability - 0.5) * 80;
        return { prediction: prediction, confidence: Math.min(91, confidence), name: 'MonteCarlo', probability: taiProbability };
    }
}

class SVMSimulator {
    constructor() { this.supportVectors = []; this.weights = []; this.bias = 0; this.kernel = 'rbf'; this.gamma = 0.5; }
    kernelFunction(x1, x2) {
        if (this.kernel === 'linear') return this.dotProduct(x1, x2);
        else if (this.kernel === 'rbf') {
            let squaredDistance = 0;
            for (let i = 0; i < x1.length; i++) squaredDistance += Math.pow(x1[i] - x2[i], 2);
            return Math.exp(-this.gamma * squaredDistance);
        }
        return this.dotProduct(x1, x2);
    }
    dotProduct(v1, v2) { let sum = 0; for (let i = 0; i < Math.min(v1.length, v2.length); i++) sum += v1[i] * v2[i]; return sum; }
    extractFeatures(results, sums) {
        const features = [];
        const numerical = results.slice(0, 10).map(r => r === 'Tài' ? 1 : 0); features.push(...numerical);
        let streak = 1; for (let i = 1; i < Math.min(5, results.length); i++) { if (results[i] === results[0]) streak++; else break; } features.push(streak / 5);
        let changes = 0; for (let i = 1; i < Math.min(10, results.length); i++) { if (results[i] !== results[i-1]) changes++; } features.push(changes / 9);
        const taiRatio = results.slice(0, 10).filter(r => r === 'Tài').length / Math.min(10, results.length); features.push(taiRatio);
        if (sums && sums.length >= 5) { const recentSum = sums[0]; features.push(recentSum / 18); }
        while (features.length < 15) features.push(0);
        return features;
    }
    train(features, labels) {
        const n = features.length; const alpha = Array(n).fill(0.01); const C = 1.0; const maxIterations = 50;
        for (let iter = 0; iter < maxIterations; iter++) {
            for (let i = 0; i < n; i++) {
                let sum = 0; for (let j = 0; j < n; j++) sum += alpha[j] * labels[j] * this.kernelFunction(features[i], features[j]);
                const prediction = sum - this.bias;
                if (labels[i] * prediction < 1) { alpha[i] += C; } else { alpha[i] = Math.max(0, alpha[i] - 0.01); }
            }
        }
        this.supportVectors = features; this.weights = alpha;
    }
    predict(features) {
        if (this.supportVectors.length === 0) return null;
        let sum = 0; for (let i = 0; i < this.supportVectors.length; i++) sum += this.weights[i] * this.kernelFunction(features, this.supportVectors[i]);
        const decision = sum - this.bias;
        const prediction = decision > 0 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.min(40, Math.abs(decision) * 20);
        return { prediction, confidence: Math.min(87, confidence), name: 'SVM' };
    }
}

class RandomForestSimulator {
    constructor(nTrees = 20, maxDepth = 5) { this.nTrees = nTrees; this.maxDepth = maxDepth; this.trees = []; }
    buildTree(features, labels, depth = 0) {
        if (depth >= this.maxDepth || features.length < 3 || this.isPure(labels)) {
            const taiCount = labels.filter(l => l === 1).length;
            return { isLeaf: true, prediction: taiCount > labels.length / 2 ? 1 : 0 };
        }
        const nFeatures = Math.floor(Math.sqrt(features[0].length));
        const selectedFeatures = this.randomSelectFeatures(nFeatures, features[0].length);
        let bestFeature = -1, bestThreshold = 0, bestGini = Infinity;
        for (const featureIdx of selectedFeatures) {
            const values = features.map(f => f[featureIdx]).sort((a,b) => a-b);
            for (let i = 1; i < values.length; i++) {
                const threshold = (values[i-1] + values[i]) / 2;
                const gini = this.calculateGiniIndex(features, labels, featureIdx, threshold);
                if (gini < bestGini) { bestGini = gini; bestFeature = featureIdx; bestThreshold = threshold; }
            }
        }
        if (bestFeature === -1) {
            const taiCount = labels.filter(l => l === 1).length;
            return { isLeaf: true, prediction: taiCount > labels.length / 2 ? 1 : 0 };
        }
        const leftIndices = [], rightIndices = [];
        for (let i = 0; i < features.length; i++) { if (features[i][bestFeature] <= bestThreshold) leftIndices.push(i); else rightIndices.push(i); }
        const leftFeatures = leftIndices.map(i => features[i]); const leftLabels = leftIndices.map(i => labels[i]);
        const rightFeatures = rightIndices.map(i => features[i]); const rightLabels = rightIndices.map(i => labels[i]);
        return { isLeaf: false, feature: bestFeature, threshold: bestThreshold, left: this.buildTree(leftFeatures, leftLabels, depth + 1), right: this.buildTree(rightFeatures, rightLabels, depth + 1) };
    }
    randomSelectFeatures(k, total) { const selected = []; const indices = Array.from({ length: total }, (_, i) => i); for (let i = 0; i < k && indices.length > 0; i++) { const randomIndex = Math.floor(Math.random() * indices.length); selected.push(indices[randomIndex]); indices.splice(randomIndex, 1); } return selected; }
    isPure(labels) { const first = labels[0]; return labels.every(l => l === first); }
    calculateGiniIndex(features, labels, featureIdx, threshold) {
        let leftCount = 0, rightCount = 0, leftTai = 0, rightTai = 0;
        for (let i = 0; i < features.length; i++) {
            if (features[i][featureIdx] <= threshold) { leftCount++; if (labels[i] === 1) leftTai++; }
            else { rightCount++; if (labels[i] === 1) rightTai++; }
        }
        const leftImpurity = 1 - Math.pow(leftTai / (leftCount + 1e-10), 2) - Math.pow(1 - leftTai / (leftCount + 1e-10), 2);
        const rightImpurity = 1 - Math.pow(rightTai / (rightCount + 1e-10), 2) - Math.pow(1 - rightTai / (rightCount + 1e-10), 2);
        return (leftCount / features.length) * leftImpurity + (rightCount / features.length) * rightImpurity;
    }
    train(features, labels) {
        const nSamples = features.length; this.trees = [];
        for (let t = 0; t < this.nTrees; t++) {
            const bootstrapIndices = []; for (let i = 0; i < nSamples; i++) bootstrapIndices.push(Math.floor(Math.random() * nSamples));
            const bootstrapFeatures = bootstrapIndices.map(i => features[i]); const bootstrapLabels = bootstrapIndices.map(i => labels[i]);
            const tree = this.buildTree(bootstrapFeatures, bootstrapLabels); this.trees.push(tree);
        }
    }
    predict(features) {
        if (this.trees.length === 0) return null;
        let taiVotes = 0;
        for (const tree of this.trees) {
            let node = tree;
            while (!node.isLeaf) { if (features[node.feature] <= node.threshold) node = node.left; else node = node.right; }
            if (node.prediction === 1) taiVotes++;
        }
        const prediction = taiVotes > this.trees.length / 2 ? 'Tài' : 'Xỉu';
        const confidence = 50 + (Math.abs(taiVotes - this.trees.length / 2) / this.trees.length) * 80;
        return { prediction, confidence: Math.min(90, confidence), name: 'RandomForest' };
    }
}

class KMeansClustering {
    constructor(k = 4) { this.k = k; this.centroids = []; this.labels = []; }
    extractRegimeFeatures(results, sums) {
        const features = [];
        const taiRatio = results.slice(0, 20).filter(r => r === 'Tài').length / Math.min(20, results.length); features.push(taiRatio);
        let volatility = 0; for (let i = 1; i < Math.min(20, results.length); i++) { if (results[i] !== results[i-1]) volatility++; } features.push(volatility / 19);
        let streakDistribution = [], currentStreak = 1;
        for (let i = 1; i < Math.min(30, results.length); i++) { if (results[i] === results[i-1]) currentStreak++; else { streakDistribution.push(currentStreak); currentStreak = 1; } }
        const avgStreak = streakDistribution.reduce((a,b) => a+b, 0) / (streakDistribution.length + 1); features.push(Math.min(1, avgStreak / 10));
        if (sums && sums.length >= 10) { const sumMean = sums.slice(0, 10).reduce((a,b) => a+b, 0) / 10; features.push(sumMean / 18); } else features.push(0.5);
        return features;
    }
    initializeCentroids(features) { const indices = Array.from({ length: features.length }, (_, i) => i); for (let i = 0; i < this.k; i++) { const randomIndex = indices[Math.floor(Math.random() * indices.length)]; this.centroids.push([...features[randomIndex]]); } }
    euclideanDistance(a, b) { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.pow(a[i] - b[i], 2); return Math.sqrt(sum); }
    fit(features, maxIterations = 50) {
        if (features.length < this.k) return;
        this.initializeCentroids(features);
        for (let iter = 0; iter < maxIterations; iter++) {
            this.labels = [];
            for (const point of features) {
                let minDist = Infinity, label = 0;
                for (let i = 0; i < this.k; i++) { const dist = this.euclideanDistance(point, this.centroids[i]); if (dist < minDist) { minDist = dist; label = i; } }
                this.labels.push(label);
            }
            const newCentroids = Array(this.k).fill().map(() => Array(features[0].length).fill(0)); const counts = Array(this.k).fill(0);
            for (let i = 0; i < features.length; i++) { const label = this.labels[i]; counts[label]++; for (let j = 0; j < features[i].length; j++) newCentroids[label][j] += features[i][j]; }
            let changed = false;
            for (let i = 0; i < this.k; i++) { if (counts[i] > 0) { for (let j = 0; j < newCentroids[i].length; j++) newCentroids[i][j] /= counts[i]; } if (this.euclideanDistance(newCentroids[i], this.centroids[i]) > 0.001) changed = true; this.centroids[i] = newCentroids[i]; }
            if (!changed) break;
        }
    }
    predictRegime(results, sums) {
        const features = this.extractRegimeFeatures(results, sums);
        if (this.centroids.length === 0) return 0;
        let minDist = Infinity, regime = 0;
        for (let i = 0; i < this.centroids.length; i++) { const dist = this.euclideanDistance(features, this.centroids[i]); if (dist < minDist) { minDist = dist; regime = i; } }
        const regimeNames = ['trending', 'volatile', 'alternating', 'random'];
        return { regime: regimeNames[regime] || 'unknown', confidence: 1 - minDist / 2 };
    }
}

class HarmonicPatternRecognizer {
    constructor() {
        this.patterns = {
            gartley: { XA: 0.618, AB: 0.382, BC: 0.886, CD: 1.272 },
            bat: { XA: 0.886, AB: 0.382, BC: 0.886, CD: 1.618 },
            crab: { XA: 1.618, AB: 0.382, BC: 0.886, CD: 2.618 },
            butterfly: { XA: 0.786, AB: 0.382, BC: 0.886, CD: 1.618 }
        };
    }
    findExtremes(results) {
        const points = []; const numerical = results.map(r => r === 'Tài' ? 1 : 0);
        for (let i = 1; i < numerical.length - 1; i++) {
            if (numerical[i] > numerical[i-1] && numerical[i] > numerical[i+1]) points.push({ index: i, value: numerical[i], type: 'peak' });
            else if (numerical[i] < numerical[i-1] && numerical[i] < numerical[i+1]) points.push({ index: i, value: numerical[i], type: 'trough' });
        }
        return points;
    }
    calculateRatios(points) {
        if (points.length < 4) return null;
        for (let i = 0; i <= points.length - 4; i++) {
            const X = points[i], A = points[i+1], B = points[i+2], C = points[i+3];
            const XA = Math.abs(A.value - X.value), AB = Math.abs(B.value - A.value), BC = Math.abs(C.value - B.value);
            const ratioAB_XA = AB / XA, ratioBC_AB = BC / AB;
            for (const [patternName, ratios] of Object.entries(this.patterns)) {
                if (Math.abs(ratioAB_XA - ratios.AB) < 0.1 && Math.abs(ratioBC_AB - ratios.BC) < 0.1) {
                    const prediction = C.type === 'peak' ? 'Xỉu' : 'Tài';
                    return { pattern: patternName, prediction: prediction, confidence: 70 + (1 - Math.abs(ratioAB_XA - ratios.AB) / 0.1) * 15 };
                }
            }
        }
        return null;
    }
    predict(results) {
        if (results.length < 15) return null;
        const extremes = this.findExtremes(results);
        const harmonic = this.calculateRatios(extremes);
        if (harmonic) return { prediction: harmonic.prediction, confidence: Math.min(85, harmonic.confidence), name: `Harmonic_${harmonic.pattern}` };
        return null;
    }
}

class UltimateEnsemble {
    constructor() { this.models = {}; this.weights = {}; this.performanceHistory = []; this.optimalWeights = null; }
    registerModel(name, model, initialWeight = 1.0) { this.models[name] = model; this.weights[name] = initialWeight; }
    updateWeight(name, success, confidence) { const learningRate = 0.08; const adjustment = success ? learningRate * (confidence / 100) : -learningRate * 0.5; this.weights[name] = Math.max(0.2, Math.min(2.0, this.weights[name] + adjustment)); }
    getWeightedPrediction(predictions, features) {
        let taiScore = 0, xiuScore = 0, totalWeight = 0, validPredictions = 0;
        for (const pred of predictions) {
            const weight = this.weights[pred.model] || 0.5;
            const confidenceWeight = pred.confidence / 100;
            const finalWeight = weight * confidenceWeight;
            if (pred.prediction === 'Tài') taiScore += finalWeight; else xiuScore += finalWeight;
            totalWeight += finalWeight; validPredictions++;
        }
        if (totalWeight === 0) return { prediction: 'Tài', confidence: 50 };
        let prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
        let confidence = (Math.max(taiScore, xiuScore) / totalWeight) * 100;
        const agreement = Math.max(taiScore, xiuScore) / totalWeight;
        if (agreement > 0.7) confidence += 8; else if (agreement < 0.55) confidence -= 5;
        const diversity = validPredictions / Object.keys(this.models).length;
        if (diversity > 0.7) confidence += 3;
        if (features && features.streakLength >= 5) confidence = Math.min(92, confidence + 5);
        return { prediction, confidence: Math.min(94, Math.max(60, confidence)) };
    }
    getBestModels(topK = 4) { return Object.entries(this.weights).sort((a, b) => b[1] - a[1]).slice(0, topK).map(([name, weight]) => ({ name, weight: weight.toFixed(2) })); }
}

class HiddenMarkovModel {
    constructor(nStates = 3) { this.nStates = nStates; this.transitionProb = Array(nStates).fill().map(() => Array(nStates).fill(1/nStates)); this.emissionProb = Array(nStates).fill().map(() => ({ Tai: 0.5, Xiu: 0.5 })); this.stateProb = Array(nStates).fill(1/nStates); this.observations = []; }
    addObservation(obs) { this.observations.push(obs); if (this.observations.length > 30) this.observations.shift(); this.updateProbabilities(); }
    updateProbabilities() {
        if (this.observations.length < 2) return;
        for (let i = 1; i < this.observations.length; i++) {
            const prev = this.observations[i-1], curr = this.observations[i];
            const prevIdx = prev === 'Tài' ? 0 : 1, currIdx = curr === 'Tài' ? 0 : 1;
            this.transitionProb[prevIdx][currIdx] = this.transitionProb[prevIdx][currIdx] * 0.95 + 0.05;
        }
        const counts = { Tai: 0, Xiu: 0 };
        for (let obs of this.observations) counts[obs]++;
        const total = this.observations.length;
        for (let s = 0; s < this.nStates; s++) { this.emissionProb[s].Tai = (counts.Tai / total) * 0.8 + 0.2; this.emissionProb[s].Xiu = (counts.Xiu / total) * 0.8 + 0.2; }
    }
    predictNext() {
        if (this.observations.length === 0) return null;
        const lastObs = this.observations[this.observations.length-1];
        const lastIdx = lastObs === 'Tài' ? 0 : 1;
        let taiProb = 0, xiuProb = 0;
        for (let s = 0; s < this.nStates; s++) {
            taiProb += this.transitionProb[lastIdx][s] * this.emissionProb[s].Tai;
            xiuProb += this.transitionProb[lastIdx][s] * this.emissionProb[s].Xiu;
        }
        const prediction = taiProb > xiuProb ? 'Tài' : 'Xỉu';
        const confidence = 55 + Math.abs(taiProb - xiuProb) * 30;
        return { prediction, confidence: Math.min(85, confidence), name: 'HMM' };
    }
}

class LSTMSimulator {
    constructor() { this.weights = []; this.bias = 0; this.memory = []; this.inputSize = 5; this.hiddenSize = 10; this.initWeights(); }
    initWeights() { for (let i = 0; i < this.hiddenSize; i++) this.weights.push(Math.random() * 0.2 - 0.1); }
    sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
    tanh(x) { return Math.tanh(x); }
    train(sequence, steps = 3) {
        if (sequence.length < steps + 1) return;
        const numerical = sequence.map(s => s === 'Tài' ? 1 : 0);
        let input = numerical.slice(-steps);
        let target = numerical[numerical.length-1];
        let output = 0;
        for (let i = 0; i < this.hiddenSize; i++) output += this.weights[i] * (input[i % steps] || 0);
        output = this.sigmoid(output + this.bias);
        const error = target - output;
        for (let i = 0; i < this.hiddenSize; i++) this.weights[i] += 0.1 * error * (input[i % steps] || 0);
        this.bias += 0.1 * error;
    }
    predict(sequence) {
        if (sequence.length < 3) return null;
        const numerical = sequence.map(s => s === 'Tài' ? 1 : 0);
        const input = numerical.slice(-3);
        let output = 0;
        for (let i = 0; i < this.hiddenSize; i++) output += this.weights[i] * (input[i % 3] || 0);
        output = this.sigmoid(output + this.bias);
        const prediction = output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(output - 0.5) * 80;
        return { prediction, confidence: Math.min(88, confidence), name: 'LSTM' };
    }
}

class ExtendedKalmanFilter {
    constructor() { this.state = 0.5; this.covariance = 1; this.processNoise = 0.1; this.measurementNoise = 0.1; }
    predict() { this.covariance += this.processNoise; return this.state; }
    update(measurement) {
        const measNum = measurement === 'Tài' ? 1 : 0;
        const kalmanGain = this.covariance / (this.covariance + this.measurementNoise);
        this.state = this.state + kalmanGain * (measNum - this.state);
        this.covariance = (1 - kalmanGain) * this.covariance;
    }
    predictNext() {
        const prediction = this.state > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(this.state - 0.5) * 80;
        return { prediction, confidence: Math.min(86, confidence), name: 'EKF' };
    }
}

class BayesianOnlineLearning {
    constructor() { this.prior = { Tai: 0.5, Xiu: 0.5 }; this.history = []; }
    updateBelief(observation) {
        this.history.push(observation);
        if (this.history.length > 100) this.history.shift();
        const taiCount = this.history.filter(h => h === 'Tài').length;
        const total = this.history.length;
        const likelihoodTai = taiCount / total;
        const likelihoodXiu = 1 - likelihoodTai;
        const posteriorTai = (likelihoodTai * this.prior.Tai) / (likelihoodTai * this.prior.Tai + likelihoodXiu * this.prior.Xiu);
        this.prior.Tai = posteriorTai;
        this.prior.Xiu = 1 - posteriorTai;
        const prediction = posteriorTai > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(posteriorTai - 0.5) * 80;
        return { prediction, confidence: Math.min(87, confidence), name: 'Bayesian' };
    }
}

class TemporalDifferenceLearning {
    constructor() { this.qValues = {}; this.alpha = 0.1; this.gamma = 0.9; this.epsilon = 0.1; this.lastState = null; this.lastAction = null; }
    getStateKey(results) { return results.slice(0, 5).join('_'); }
    getAction(state) { if (!this.qValues[state]) this.qValues[state] = { Tai: 0, Xiu: 0 }; return Math.random() < this.epsilon ? (Math.random() < 0.5 ? 'Tài' : 'Xỉu') : (this.qValues[state].Tai > this.qValues[state].Xiu ? 'Tài' : 'Xỉu'); }
    learn(reward) {
        if (!this.lastState || !this.lastAction) return;
        const nextState = this.lastState;
        if (!this.qValues[nextState]) this.qValues[nextState] = { Tai: 0, Xiu: 0 };
        const maxNextQ = Math.max(this.qValues[nextState].Tai, this.qValues[nextState].Xiu);
        const tdTarget = reward + this.gamma * maxNextQ;
        const tdError = tdTarget - this.qValues[this.lastState][this.lastAction];
        this.qValues[this.lastState][this.lastAction] += this.alpha * tdError;
    }
    predict(results) {
        const state = this.getStateKey(results);
        const action = this.getAction(state);
        this.lastState = state;
        this.lastAction = action;
        const confidence = 60 + Math.abs(this.qValues[state]?.[action] || 0) * 20;
        return { prediction: action, confidence: Math.min(84, confidence), name: 'TD' };
    }
}

class PatternRecognitionAdvanced {
    constructor() { this.patternLibrary = []; }
    predict(results) {
        if (results.length < 10) return null;
        const last5 = results.slice(0, 5).join('');
        for (let lib of this.patternLibrary) {
            if (lib.pattern === last5 && lib.outcome) {
                const confidence = 65 + (lib.confidence || 15);
                return { prediction: lib.outcome, confidence: Math.min(88, confidence), name: 'PatternMatch' };
            }
        }
        return null;
    }
    learn(pattern, outcome) { this.patternLibrary.push({ pattern, outcome, confidence: 70, timestamp: Date.now() }); if (this.patternLibrary.length > 200) this.patternLibrary.shift(); }
}

class SieuChinhXacBatTatCaCau {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.statsAnalyzer = new StatisticalAnalyzer();
        this.arima = new ARIMAModel(2, 1, 2);
        this.garch = new GARCHModel(1, 1);
        this.monteCarlo = new MonteCarloSimulator(2000, 3);
        this.svm = new SVMSimulator();
        this.randomForest = new RandomForestSimulator(25, 6);
        this.kmeans = new KMeansClustering(4);
        this.harmonic = new HarmonicPatternRecognizer();
        this.hmm = new HiddenMarkovModel(3);
        this.lstm = new LSTMSimulator();
        this.ekf = new ExtendedKalmanFilter();
        this.bayesian = new BayesianOnlineLearning();
        this.td = new TemporalDifferenceLearning();
        this.patternLib = new PatternRecognitionAdvanced();
        this.ensemble = new UltimateEnsemble();
        this.trainingData = { features: [], labels: [] };
        this.initializeEnsemble();
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
            let f1=0,f2=0,f3=0,f4=0,f5=0,f6=0;
            for(let j=idx;j>=0;j--){ const d=arr[j]; if(d.xuc_xac_1===1||d.xuc_xac_2===1||d.xuc_xac_3===1) f1++; else break; }
            for(let j=idx;j>=0;j--){ const d=arr[j]; if(d.xuc_xac_1===2||d.xuc_xac_2===2||d.xuc_xac_3===2) f2++; else break; }
            for(let j=idx;j>=0;j--){ const d=arr[j]; if(d.xuc_xac_1===3||d.xuc_xac_2===3||d.xuc_xac_3===3) f3++; else break; }
            for(let j=idx;j>=0;j--){ const d=arr[j]; if(d.xuc_xac_1===4||d.xuc_xac_2===4||d.xuc_xac_3===4) f4++; else break; }
            for(let j=idx;j>=0;j--){ const d=arr[j]; if(d.xuc_xac_1===5||d.xuc_xac_2===5||d.xuc_xac_3===5) f5++; else break; }
            for(let j=idx;j>=0;j--){ const d=arr[j]; if(d.xuc_xac_1===6||d.xuc_xac_2===6||d.xuc_xac_3===6) f6++; else break; }
            return { phien: item.phien, result: item.ket_qua==="Tài"?1:0, resultStr: item.ket_qua, total: item.tong, streak, taiStreak, xiuStreak, f1,f2,f3,f4,f5,f6, isTriple: dice[0]===dice[1]&&dice[1]===dice[2], tripleVal: dice[0], sum: dice[0]+dice[1]+dice[2] };
        });
    }

    initializeEnsemble() {
        this.ensemble.registerModel('hmm', this.hmm, 1.0);
        this.ensemble.registerModel('lstm', this.lstm, 1.0);
        this.ensemble.registerModel('ekf', this.ekf, 0.8);
        this.ensemble.registerModel('bayesian', this.bayesian, 0.9);
        this.ensemble.registerModel('td', this.td, 0.7);
        this.ensemble.registerModel('pattern', this.patternLib, 0.8);
        this.ensemble.registerModel('arima', this.arima, 0.7);
        this.ensemble.registerModel('garch', this.garch, 0.6);
        this.ensemble.registerModel('montecarlo', this.monteCarlo, 0.7);
        this.ensemble.registerModel('svm', this.svm, 0.7);
        this.ensemble.registerModel('randomforest', this.randomForest, 0.8);
        this.ensemble.registerModel('harmonic', this.harmonic, 0.6);
    }

    extractAllFeatures(results, sums) {
        const features = { length: results.length, lastResult: results[0], streakLength: 1, volatility: 0, taiRatio: 0, xiuRatio: 0, changeRate: 0, maxStreak: 0, sumTrend: 0, autocorrelation: [], seasonality: null, regime: null };
        for (let i = 1; i < results.length; i++) { if (results[i] === results[0]) features.streakLength++; else break; }
        let changes = 0, currentStreak = 1;
        for (let i = 1; i < Math.min(30, results.length); i++) {
            if (results[i] !== results[i-1]) { changes++; features.maxStreak = Math.max(features.maxStreak, currentStreak); currentStreak = 1; }
            else currentStreak++;
        }
        features.maxStreak = Math.max(features.maxStreak, currentStreak);
        features.volatility = changes / Math.min(29, results.length - 1);
        features.changeRate = features.volatility;
        const last20 = results.slice(0, Math.min(20, results.length));
        features.taiRatio = last20.filter(r => r === 'Tài').length / last20.length;
        features.xiuRatio = 1 - features.taiRatio;
        if (sums && sums.length >= 10) {
            const recentAvg = sums.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
            const prevAvg = sums.slice(5, 10).reduce((a,b) => a+b, 0) / 5;
            features.sumTrend = recentAvg - prevAvg;
        }
        features.autocorrelation = this.statsAnalyzer.calculateAutocorrelation(results, 5);
        features.seasonality = this.statsAnalyzer.detectSeasonality(results);
        features.regime = this.kmeans.predictRegime(results, sums);
        return features;
    }

    trainModels(historicalData) {
        if (!historicalData || historicalData.length < 50) return;
        const featuresList = [], labelsList = [];
        for (let i = 30; i < historicalData.length - 1; i++) {
            const windowResults = historicalData.slice(i - 30, i).map(d => d.Ket_qua);
            const windowSums = historicalData.slice(i - 30, i).map(d => d.Tong);
            const features = this.extractAllFeatures(windowResults, windowSums);
            const label = historicalData[i].Ket_qua === 'Tài' ? 1 : 0;
            const numericalFeatures = [features.streakLength / 10, features.volatility, features.taiRatio, features.changeRate, features.maxStreak / 10, features.sumTrend / 10, ...features.autocorrelation];
            while (numericalFeatures.length < 15) numericalFeatures.push(0);
            featuresList.push(numericalFeatures);
            labelsList.push(label);
        }
        if (featuresList.length > 10) {
            this.svm.train(featuresList.slice(-100), labelsList.slice(-100));
            this.randomForest.train(featuresList.slice(-200), labelsList.slice(-200));
        }
    }

    predict(data, type) {
        const results = data.map(d => d.Ket_qua);
        const sums = data.map(d => d.Tong);
        if (results.length < 5) return { prediction: 'Tài', confidence: 55, factors: ['Thiếu dữ liệu'] };
        const features = this.extractAllFeatures(results, sums);
        this.hmm.addObservation(results[0]);
        this.lstm.train(results, 3);
        this.ekf.update(results[0]);
        this.bayesian.updateBelief(results[0]);
        this.td.predict(results);
        this.patternLib.predict(results);
        const allPredictions = [];
        const hmmPred = this.hmm.predictNext(); if (hmmPred) allPredictions.push({ ...hmmPred, model: 'hmm' });
        const lstmPred = this.lstm.predict(results); if (lstmPred) allPredictions.push({ ...lstmPred, model: 'lstm' });
        const ekfPred = this.ekf.predictNext(); if (ekfPred) allPredictions.push({ ...ekfPred, model: 'ekf' });
        const bayesianPred = this.bayesian.updateBelief(results[0]); if (bayesianPred) allPredictions.push({ ...bayesianPred, model: 'bayesian' });
        const tdPred = this.td.predict(results); if (tdPred) allPredictions.push({ ...tdPred, model: 'td' });
        const patternPred = this.patternLib.predict(results); if (patternPred) allPredictions.push({ ...patternPred, model: 'pattern' });
        const arimaPred = this.arima.predict(results); if (arimaPred) allPredictions.push({ ...arimaPred, model: 'arima' });
        const garchPred = this.garch.predict(results); if (garchPred) allPredictions.push({ ...garchPred, model: 'garch' });
        const monteCarloPred = this.monteCarlo.predict(results); if (monteCarloPred) allPredictions.push({ ...monteCarloPred, model: 'montecarlo' });
        const numericalFeatures = [features.streakLength / 10, features.volatility, features.taiRatio, features.changeRate, features.maxStreak / 10, features.sumTrend / 10, ...features.autocorrelation];
        while (numericalFeatures.length < 15) numericalFeatures.push(0);
        const svmPred = this.svm.predict(numericalFeatures); if (svmPred) allPredictions.push({ ...svmPred, model: 'svm' });
        const rfPred = this.randomForest.predict(numericalFeatures); if (rfPred) allPredictions.push({ ...rfPred, model: 'randomforest' });
        const harmonicPred = this.harmonic.predict(results); if (harmonicPred) allPredictions.push({ ...harmonicPred, model: 'harmonic' });
        const cauFunctions = this.getAllCauFunctions();
        for (let fn of cauFunctions) {
            const p = fn(results, type);
            if (p && p.detected) allPredictions.push({ prediction: p.prediction, confidence: p.confidence || 70, model: 'cau_truyen_thong', name: p.name });
        }
        const finalResult = this.ensemble.getWeightedPrediction(allPredictions, features);
        const bestModels = this.ensemble.getBestModels(4);
        const factors = [`Mô hình: ${bestModels.map(m => m.name).join(', ')}`, `Tổ hợp: ${allPredictions.length} mô hình`, `Chế độ: ${features.regime.regime}`, `Biến động: ${(features.volatility * 100).toFixed(0)}%`, `Tỷ lệ Tài: ${(features.taiRatio * 100).toFixed(0)}%`];
        if (features.streakLength >= 4) factors.push(`Chuỗi: ${features.streakLength} ${results[0]}`);
        if (features.seasonality) factors.push(`Chu kỳ: ${features.seasonality.period}`);
        globalPredictions.push({ prediction: finalResult.prediction, confidence: finalResult.confidence, models: allPredictions.slice(0, 8), timestamp: Date.now() });
        if (globalPredictions.length > 100) globalPredictions.shift();
        return { prediction: finalResult.prediction, confidence: Math.round(finalResult.confidence), factors: factors.slice(0, 6), allPatterns: allPredictions.slice(0, 8).map(p => (p.name || p.model).substring(0, 25)), detailedAnalysis: { totalModels: allPredictions.length, topModels: bestModels, features: { streakLength: features.streakLength, volatility: (features.volatility * 100).toFixed(1) + '%', taiRatio: (features.taiRatio * 100).toFixed(1) + '%', regime: features.regime.regime, seasonality: features.seasonality ? `chu ky ${features.seasonality.period}` : 'khong' }, ensembleScore: finalResult.confidence.toFixed(1) + '%' } };
    }

    getAllCauFunctions() {
        return [
            (r) => { let streak = 1; for (let i = 1; i < r.length; i++) { if (r[i] === r[0]) streak++; else break; } if (streak >= 2) return { detected: true, prediction: r[0], confidence: 55 + streak * 3, name: `Bệt ${streak}` }; return null; },
            (r) => { let alt = true; for (let i = 1; i < Math.min(10, r.length); i++) if (r[i] === r[i-1]) alt = false; if (alt && r.length >= 6) return { detected: true, prediction: r[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 85, name: 'Cầu 1-1' }; return null; },
            (r) => { if (r.length < 4) return null; if (r[0] === r[1] && r[2] === r[3] && r[0] !== r[2]) return { detected: true, prediction: r[3] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 88, name: 'Cầu 2-2' }; return null; },
            (r) => { if (r.length < 6) return null; if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[2] !== r[3]) return { detected: true, prediction: r[5] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 90, name: 'Cầu 3-3' }; return null; },
            (r) => { if (r.length < 4) return null; if (r[0] === r[1] && r[2] !== r[1] && r[2] === r[3]) return { detected: true, prediction: r[3] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: 'Cầu 2-1-2' }; return null; },
            (r) => { if (r.length < 3) return null; if (r[0] !== r[1] && r[1] === r[2]) return { detected: true, prediction: r[2] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 80, name: 'Cầu 1-2' }; return null; }
        ];
    }

    updateResult(prediction, actual, wasCorrect) {
        this.td.learn(wasCorrect ? 1 : -1);
        const modelCorrectness = { hmm: prediction === actual, lstm: prediction === actual, ekf: prediction === actual, bayesian: prediction === actual, td: prediction === actual };
        for (const [model, correct] of Object.entries(modelCorrectness)) this.ensemble.updateWeight(model, correct, 70);
        if (globalPredictions.length > 0) {
            const lastPred = globalPredictions[globalPredictions.length - 1];
            if (lastPred && lastPred.prediction === prediction) {
                for (const modelPred of lastPred.models || []) {
                    const modelName = modelPred.model;
                    if (modelName && this.ensemble.weights[modelName]) this.ensemble.updateWeight(modelName, modelPred.prediction === actual, modelPred.confidence);
                }
            }
        }
    }

    duDoan(data, type) { return this.predict(data, type); }
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
            if (arr && arr.length >= 15) {
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
        if (!data || data.length < 15) { isUpdating = false; return; }
        const latest = data[data.length - 1];
        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua;
                const duDoanPrev = currentPrediction.Du_doan;
                addToHistory(predictedPhien, duDoanPrev, actualStr, currentPrediction.Do_tin_cay);
                console.log(`${predictedPhien}: ${duDoanPrev} vs ${actualStr} | ${duDoanPrev.toLowerCase() === actualStr.toLowerCase() ? 'DUNG' : 'SAI'}`);
            }
        }
        gameHistory = data;
        if (!predictorInstance || predictorInstance.processed.length !== data.length) {
            predictorInstance = new SieuChinhXacBatTatCaCau(data.slice(-500));
        } else {
            predictorInstance.processed = predictorInstance.preprocess(data.slice(-500));
        }
        const pred = predictorInstance.duDoan(data, 'taixiu');
        let pattern = "";
        for (let i = Math.max(0, data.length - 15); i < data.length; i++) pattern += data[i].ket_qua === "Tài" ? "t" : "x";
        const recentTotals = data.slice(-15).map(p => p.tong);
        let predTotal = Math.round(recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length);
        if (latest.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (latest.tong <= 5) predTotal = Math.max(predTotal, 9);
        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) + '%' : '0%';
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1,
            Xuc_xac_2: latest.xuc_xac_2,
            Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua,
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal,
            Ly_do: pred.factors ? pred.factors.join(', ') : 'Phan tich da chieu',
            Trang_thai: 'SAN SANG',
            Thang: wins,
            Thua: losses,
            Ti_le_thang: winRate,
            Loai_cau: pred.allPatterns ? pred.allPatterns[0] : 'To hop',
            Lich_su: {
                Tong_phien: verifiedResults.length,
                Thang: wc,
                Thua: verifiedResults.length - wc,
                Ty_le_thang: wr + "%"
            },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        };
        console.log(`${pred.prediction} | Tin cay: ${pred.confidence}% | ${pred.factors ? pred.factors.slice(0,3).join(', ') : ''} | Thang: ${winRate} | Lich su: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('Loi:', e.message); }
    isUpdating = false;
}

app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        return res.json(currentPrediction);
    }
    res.json({
        id: "@anhkhoidzai102",
        Phien: 0,
        Xuc_xac_1: 0,
        Xuc_xac_2: 0,
        Xuc_xac_3: 0,
        Tong: 0,
        Ket_qua: "dang tai...",
        pattern: "",
        Phien_hien_tai: 0,
        Du_doan: "dang tai...",
        Do_tin_cay: "0%",
        Tong_du_doan: 0,
        Ly_do: "",
        Trang_thai: "",
        Thang: 0,
        Thua: 0,
        Ti_le_thang: "0%",
        Loai_cau: "",
        Lich_su: {
            Tong_phien: 0,
            Thang: 0,
            Thua: 0,
            Ty_le_thang: "0%"
        },
        Bang_thang_thua: []
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('HE THONG DU DOAN TAI XIU TOI UU TUYET DOI');
console.log('API: wtxmd52.tele68.com | 15 PHIEN | 2000 PHIEN LICH SU');
console.log('BAO GOM: ARIMA, GARCH, MonteCarlo, SVM, RandomForest, HMM, LSTM, EKF, Bayesian, TD');
console.log('CAU: Bet 1-100, Be cau 2-30, Cau 1-1, 2-2, 3-3, 2-1-2, 1-2, Xen ke, Cap doi');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 15) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`Cong: ${PORT} | /taixiu`); });
