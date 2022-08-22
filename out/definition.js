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
            const result = line.text.match(new RegExp(`ms[\\w.]*${word}`));
            if (!result || !workDir) {
                return;
            }
            const symbolNames = result[0].split('.');
            let module = symbolNames[1];
            const moduleUri = utils_1.getModuleUriByModuleName(module, workDir);
            if (!moduleUri) {
                return;
            }
            const symbol = yield utils_1.getSymbolByName(moduleUri, symbolNames.slice(2));
            if (symbol) {
                return new vscode.Location(moduleUri, symbol.range);
            }
            return new vscode.Location(moduleUri, new vscode.Position(0, 0));
        })
    });
    context.subscriptions.push(definition);
}
exports.registerDefinition = registerDefinition;
//# sourceMappingURL=definition.js.map