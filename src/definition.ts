import * as vscode from 'vscode';
import { getSymbols, convertCCSymbols, getFilePath, excludeSet, getFileContent, getWorkDirByFilePath } from './utils';

export function registerDefinition(context: vscode.ExtensionContext) {
    let definition = vscode.languages.registerDefinitionProvider(['javascript'], {
        provideDefinition: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
            const fileName = document.fileName;
            const word = document.getText(document.getWordRangeAtPosition(position));
            const line = document.lineAt(position);
            const workDir = getWorkDirByFilePath(document.uri.path);
            const result = line.text.match(new RegExp(`ms\\..*${word}`));
            if (!result || !workDir) {
                return;
            }
            const symbolNames = result[0].split('.');
            let module = symbolNames[1];
            if (module === "user_msg_define") {module = "user_define";}
            let modulePath = getFilePath(module, workDir);
            if (!modulePath) {
                return;
            }
            let moduelUri = vscode.Uri.parse(modulePath);
            let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', moduelUri);
            let moduelExports = symbols?.find(symbol => symbol.name === '<unknown>');
            let symbol = symbols?.find(symbol => symbol.name === symbolNames[2]);
            if (!symbol) {
                if (moduelExports) {
                    symbols = moduelExports?.children;
                    symbol = symbols?.find(symbol => symbol.name === symbolNames[2]);
                }
                if (!symbol) {
                    return new vscode.Location(moduelUri, new vscode.Position(0, 0));
                }
                symbols = symbol.children;
            }
            for (let i = 3; i < symbolNames.length; i++) {
                const tSymbolName = symbolNames[i];
                symbol = symbols?.find(symbol => symbol.name === tSymbolName);
                symbols = symbol?.children;
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
        }
    });

    context.subscriptions.push(definition);
}