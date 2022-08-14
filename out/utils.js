"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
exports.fileMap = {};
exports.excludeSet = new Set(['extends', 'properties', 'statics', 'editor', 'onLoad', 'start', 'update', 'onEnable', 'onDisable', 'onDestroy', 'if', 'else if', 'for', 'function', 'new', 'return', 'switch', 'throw', 'while']);
function getWorkRootDir() {
    var _a;
    const workDir = ((_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0].uri.path) || "";
    console.log(workDir);
    return workDir;
}
function getWorkDirList() {
    const workRootDir = getWorkRootDir();
    let workDirList = [
        "project_modules",
        "node_modules/@water",
        "servers/\\w*_server",
    ];
    return workDirList.map((v) => workRootDir + "/" + v);
}
function getWorkDirByFilePath(filePath) {
    const workDirList = getWorkDirList();
    let regex = new RegExp(workDirList.join('|'), "");
    let workDir = regex.exec(filePath);
    if (workDir) {
        return workDir[0];
    }
    return null;
}
exports.getWorkDirByFilePath = getWorkDirByFilePath;
function updateFileMap() {
    var _a;
    let tfileMap = {};
    exports.fileMap = {};
    const document = (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document;
    if (!document) {
        return;
    }
    const workDirList = getWorkDirList();
    const workRootDir = getWorkRootDir();
    const walkDir = (currentPath, tfileMap) => {
        const files = fs.readdirSync(currentPath);
        files.forEach(fileName => {
            const filePath = path.join(currentPath, fileName);
            const fileStat = fs.statSync(filePath);
            if (fileStat.isFile() && fileName.endsWith('.js')) {
                const workDir = getWorkDirByFilePath(filePath);
                if (!workDir) {
                    return;
                }
                const key = fileName.substring(0, fileName.length - 3);
                tfileMap[workDir] = tfileMap[workDir] || {};
                tfileMap[workDir][key] = filePath;
            }
            else if (fileStat.isDirectory()) {
                walkDir(filePath, tfileMap);
            }
        });
    };
    walkDir(workRootDir, tfileMap);
    const fileMapKeys = Object.keys(tfileMap);
    for (let i = 0; i < workDirList.length; i++) {
        const workDirReg = new RegExp(workDirList[i]);
        for (let j = 0; j < fileMapKeys.length; j++) {
            const key = fileMapKeys[j];
            if (workDirReg.test(key)) {
                exports.fileMap[key] = tfileMap[key];
            }
        }
    }
    console.log("updateFileMap fileMap: ", exports.fileMap);
}
exports.updateFileMap = updateFileMap;
function getFilePath(key, workDir) {
    console.log("getFilePath fileMap: ", exports.fileMap);
    if (workDir && (!exports.fileMap || !exports.fileMap[workDir])) {
        updateFileMap();
    }
    if (workDir && exports.fileMap[workDir][key]) {
        return exports.fileMap[workDir][key];
    }
    for (const workDir in exports.fileMap) {
        if (exports.fileMap[workDir][key]) {
            return exports.fileMap[workDir][key];
        }
    }
}
exports.getFilePath = getFilePath;
function getFileContent(filePath) {
    return fs.readFileSync(filePath).toString();
}
exports.getFileContent = getFileContent;
function getSymbols(document) {
    return __awaiter(this, void 0, void 0, function* () {
        vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri) || [];
        return (yield vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)) || [];
    });
}
exports.getSymbols = getSymbols;
function convertCCSymbols(symbols, document) {
    const ccSymbols = [];
    const result = document.fileName.match(/\w+(?=.js)/);
    if (result) {
        const classSymbol = symbols.find(symbol => symbol.name === result[0]);
        if (classSymbol) {
            symbols = classSymbol.children;
        }
    }
    symbols.forEach(symbol => {
        if (symbol.name === 'properties') {
            symbol.children.forEach(symbolChild => {
                if (/\w+/.test(symbolChild.name)) {
                    ccSymbols.push(symbolChild);
                }
            });
        }
        else if (symbol.kind !== vscode.SymbolKind.Variable) {
            if (/\w+/.test(symbol.name)) {
                ccSymbols.push(symbol);
            }
        }
    });
    return ccSymbols;
}
exports.convertCCSymbols = convertCCSymbols;
function goToSymbol(document, symbolName) {
    return __awaiter(this, void 0, void 0, function* () {
        const symbols = yield getSymbols(document);
        const findSymbol = symbols.find(symbol => symbol.name === symbolName);
        const activeTextEditor = vscode.window.activeTextEditor;
        if (findSymbol && activeTextEditor) {
            activeTextEditor.revealRange(findSymbol.range, vscode.TextEditorRevealType.AtTop);
            activeTextEditor.selection = new vscode.Selection(findSymbol.range.start, findSymbol.range.start);
        }
    });
}
exports.goToSymbol = goToSymbol;
//# sourceMappingURL=utils.js.map