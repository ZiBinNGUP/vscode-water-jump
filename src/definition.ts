import * as vscode from 'vscode';
import { getSymbols, convertCCSymbols, getFilePath, excludeSet, getFileContent, getWorkDirByFilePath, getSymbolByName, getModuleUriByModuleName } from './utils';

export function registerDefinition(context: vscode.ExtensionContext) {
    let definition = vscode.languages.registerDefinitionProvider(['javascript'], {
        provideDefinition: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
            const fileName = document.fileName;
            const word = document.getText(document.getWordRangeAtPosition(position));
            const line = document.lineAt(position);
            const workDir = getWorkDirByFilePath(document.uri.path);
            const result = line.text.match(new RegExp(`ms[\\w.]*${word}`));
            if (!result || !workDir) {
                return;
            }
            const symbolNames = result[0].split('.');
            let module = symbolNames[1];
            const moduleUri = getModuleUriByModuleName(module, workDir);
            if (!moduleUri) {
                return;
            }

            const symbol = await getSymbolByName(moduleUri, symbolNames.slice(2));
            
            if (symbol) {
                return new vscode.Location(moduleUri, symbol.range);
            }
            return new vscode.Location(moduleUri, new vscode.Position(0, 0));
        }
    });

    context.subscriptions.push(definition);
}