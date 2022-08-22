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
const utils_1 = require("./utils");
function registerCompletion(context) {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems: (document, position, token, context) => __awaiter(this, void 0, void 0, function* () {
            const line = document.lineAt(position);
            const lineText = line.text.substring(0, position.character);
            const workDir = utils_1.getWorkDirByFilePath(document.uri.path);
            let result = lineText.match(/ms[\w.]*$/);
            if (!result || !workDir) {
                return;
            }
            result = result[0].split('.');
            if (result.length <= 1) {
                return;
            }
            if (result.length <= 2) {
                let completionItems = [];
                for (let module in utils_1.fileMap[workDir]) {
                    completionItems.push(new vscode.CompletionItem(module, vscode.CompletionItemKind.Module));
                }
                for (let module in utils_1.fileMap["project_modules"]) {
                    completionItems.push(new vscode.CompletionItem(module, vscode.CompletionItemKind.Module));
                }
                for (let module in utils_1.fileMap["node_modules/@water"]) {
                    completionItems.push(new vscode.CompletionItem(module, vscode.CompletionItemKind.Module));
                }
                return completionItems;
            }
            const moduleName = result[1];
            const moduleUri = utils_1.getModuleUriByModuleName(moduleName, workDir);
            if (!moduleUri) {
                return;
            }
            let moduleSymbolSet = new Map();
            let moduleSymbols = yield vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', moduleUri);
            if (!moduleSymbols) {
                return;
            }
            moduleSymbols.forEach(v => {
                if (v.name !== '<unknown>') {
                    moduleSymbolSet.set(v.name, v);
                    return;
                }
                v.children.forEach(t => moduleSymbolSet.set(t.name, t));
            });
            if (result.length <= 3) {
                let completionItems = [];
                moduleSymbolSet.forEach(({ name }) => completionItems.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Module)));
                return completionItems;
            }
            let symbol = moduleSymbolSet.get(result[2]);
            if (!symbol || !symbol.children) {
                return;
            }
            for (let symbolName of result.slice(3, -1)) {
                symbol = symbol.children.find(c => c.name === symbolName);
                if (!symbol || !symbol.children) {
                    return;
                }
            }
            console.log(symbol.children);
            return symbol.children.map(({ name }) => { return new vscode.CompletionItem(name + "++++bin", vscode.CompletionItemKind.Module); });
        }),
        resolveCompletionItem: () => {
            return null;
        }
    }, '.'));
}
exports.registerCompletion = registerCompletion;
//# sourceMappingURL=completion.js.map