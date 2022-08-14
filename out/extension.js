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
const definition_1 = require("./definition");
const completion_1 = require("./completion");
function activate(context) {
    console.log('activate');
    definition_1.registerDefinition(context);
    completion_1.registerCompletion(context);
    utils_1.updateFileMap();
    vscode.workspace.onDidCreateFiles(() => {
        utils_1.updateFileMap();
    });
    vscode.workspace.onDidDeleteFiles(() => {
        utils_1.updateFileMap();
    });
    vscode.commands.registerCommand("test", () => __awaiter(this, void 0, void 0, function* () {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let document = editor.document;
        let symbols = yield utils_1.getSymbols(document);
        console.log("symbols: ", symbols);
    }));
    vscode.languages.registerHoverProvider('javascript', {
        provideHover(document, position, token) {
            return {
                contents: ['Hover Content']
            };
        }
    });
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map