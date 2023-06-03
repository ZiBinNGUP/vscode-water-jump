import * as vscode from 'vscode';
import { getSymbols, convertCCSymbols, getFilePath, excludeSet, getFileContent, getWorkDirByFilePath, getSymbolByName, getModuleUriByModuleName } from './utils';

export function registerDefinition(context: vscode.ExtensionContext) {
    let definition = vscode.languages.registerDefinitionProvider(['javascript'], {
        provideDefinition: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
            const fileName = document.fileName;
            const word = document.getText(document.getWordRangeAtPosition(position));
            const line = document.lineAt(position);
            const workDir = getWorkDirByFilePath(document.uri.path);
            if (!workDir) {
                return;
            }
            const handler_list = [
                handel_config,
                handel_ms,
                handel_user_func,
            ];
            for (const func of handler_list) {
                const res = await func(line, word, workDir);
                if (res) {
                    return res;
                }
            }
        }
    });

    context.subscriptions.push(definition);
}

async function handel_ms(line: vscode.TextLine, word: string, workDir: string) {
    const result = line.text.match(new RegExp(`ms[\\w.]*${word}`));
    if (!result) {
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

async function handel_user_func(line: vscode.TextLine, word: string, workDir: string) {
    const result = line.text.match(new RegExp(`user\\.func_instance\\(\\)\\.${word}`));
    if (!result) {
        return;
    }
    const moduleUri = getModuleUriByModuleName("user_func", workDir);
    if (!moduleUri) {
        return;
    }

    const symbol = await getSymbolByName(moduleUri, ["c_normal_user_func", word]);
    
    if (symbol) {
        return new vscode.Location(moduleUri, symbol.range);
    }
    return new vscode.Location(moduleUri, new vscode.Position(0, 0));
}

async function handel_config(line: vscode.TextLine, word: string, workDir: string) {
    const result = line.text.match(new RegExp(`ms\\.config_data\\.configs.*${word}`));
    if (!result) {
        return;
    }
    const symbolNames = result[0].split('.');
    const moduleUri = getModuleUriByModuleName(symbolNames[3], workDir);
    if (!moduleUri) {
        return;
    }

    const symbol = await getSymbolByName(moduleUri, symbolNames.slice(4));
    
    if (symbol) {
        return new vscode.Location(moduleUri, symbol.range);
    }
    return new vscode.Location(moduleUri, new vscode.Position(0, 0));
}