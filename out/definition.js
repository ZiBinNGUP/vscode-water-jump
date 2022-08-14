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
function registerDefinition(context) {
    let definition = vscode.languages.registerDefinitionProvider(['javascript'], {
        provideDefinition: (document, position, token) => __awaiter(this, void 0, void 0, function* () {
            const fileName = document.fileName;
            const word = document.getText(document.getWordRangeAtPosition(position));
            const line = document.lineAt(position);
            const workDir = utils_1.getWorkDirByFilePath(document.uri.path);
            const result = line.text.match(new RegExp(`ms\\..*${word}`));
            if (!result || !workDir) {
                return;
            }
            const symbolNames = result[0].split('.');
            let module = symbolNames[1];
            if (module === "user_msg_define") {
                module = "user_define";
            }
            let modulePath = utils_1.getFilePath(module, workDir);
            if (!modulePath) {
                return;
            }
            let moduelUri = vscode.Uri.parse(modulePath);
            let symbols = yield vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', moduelUri);
            let moduelExports = symbols === null || symbols === void 0 ? void 0 : symbols.find(symbol => symbol.name === '<unknown>');
            let symbol = symbols === null || symbols === void 0 ? void 0 : symbols.find(symbol => symbol.name === symbolNames[2]);
            if (!symbol) {
                if (moduelExports) {
                    symbols = moduelExports === null || moduelExports === void 0 ? void 0 : moduelExports.children;
                    symbol = symbols === null || symbols === void 0 ? void 0 : symbols.find(symbol => symbol.name === symbolNames[2]);
                }
                if (!symbol) {
                    return new vscode.Location(moduelUri, new vscode.Position(0, 0));
                }
                symbols = symbol.children;
            }
            for (let i = 3; i < symbolNames.length; i++) {
                const tSymbolName = symbolNames[i];
                symbol = symbols === null || symbols === void 0 ? void 0 : symbols.find(symbol => symbol.name === tSymbolName);
                symbols = symbol === null || symbol === void 0 ? void 0 : symbol.children;
            }
            if (symbol) {
                return new vscode.Location(moduelUri, symbol.range);
            }
            return new vscode.Location(moduelUri, new vscode.Position(0, 0));
            // let module: string;
            // if (result) {
            //     module = result[0];
            // } else {
            //     if (!new RegExp(`(?<="|')${word}(?="|')`).test(line.text)) {
            //         return;
            //     }
            //     module = word;
            // }
            // if (module === 'this') {
            //     let symbols = await getSymbols(document);
            //     symbols = convertCCSymbols(symbols, document);
            //     let symbol = symbols.find(symbol => symbol.name === word);
            //     if (symbol) {
            //         return new vscode.Location(vscode.Uri.file(fileName), symbol.range);
            //     }
            // } else {
            //     const filePath = getFilePath(module);
            //     if (!filePath) {
            //         return;
            //     }
            //     const fileText = getFileContent(filePath);
            //     const lines = fileText.split('\n');
            //     let row = 0;
            //     let col = 0;
            //     let isMatch = false;
            //     if (word === module) {
            //         isMatch = true;
            //     } else {
            //         for (let i = 0; i < lines.length; i++) {
            //             if (new RegExp(`${word}.*function`).test(lines[i])) {
            //                 row = i;
            //                 col = 0;
            //                 isMatch = true;
            //                 break;
            //             }
            //         }
            //     }
            //     if (isMatch) {
            //         return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(row, col));
            //     }
            // }
        })
    });
    context.subscriptions.push(definition);
}
exports.registerDefinition = registerDefinition;
//# sourceMappingURL=definition.js.map