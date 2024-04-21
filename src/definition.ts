import * as vscode from 'vscode';
import { getSymbols, convertCCSymbols, fileMap, excludeSet, findNodeByPosition, getWorkDirByFilePath, getSymbolByName, getModuleUriByModuleName, getLocationByAcorn } from './utils';
import * as acorn from 'acorn';

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
                handel_rpc_func,
            ];
            for (const func of handler_list) {
                const res = await func(line, word, workDir, document, position);
                if (res) {
                    return res;
                }
            }
        }
    });

    context.subscriptions.push(definition);
}

async function handel_ms(line: vscode.TextLine, word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
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

    // const symbol = await getSymbolByName(moduleUri, symbolNames.slice(2));
    return getLocationByAcorn(moduleUri, symbolNames.slice(2)) || new vscode.Location(moduleUri, new vscode.Position(0, 0));
}

async function handel_user_func(line: vscode.TextLine, word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
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

async function handel_config(line: vscode.TextLine, word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
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
}

async function handel_rpc_func(line: vscode.TextLine, word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
    const result = line.text.match(new RegExp(`ms\\.proxy_agent_mgr\\..*${word}`));
    if (!result) {
        return;
    }
    const node = findNodeByPosition(document.uri, position);
    if (!node) {
        return;
    }
    const callExpressionNode = node as acorn.CallExpression;
    if (callExpressionNode.callee.type !== 'MemberExpression' || callExpressionNode.callee.property.type !== 'Identifier' || 
    (callExpressionNode.callee.property.name !== 'rpc_call_func' && callExpressionNode.callee.property.name !== 'rpc_function_server')) {
        return;
    }
    // [, moduleName, funcName, , , , instanceName]
    const params = callExpressionNode.arguments;
    const moduleName = params[1] as acorn.Literal;
    const funcName = params[2] as acorn.Literal;
    const instanceName = params[6] as acorn.Literal;
    let symbolList = [];

    if (!funcName.value || typeof funcName.value !== 'string' || !moduleName.value || typeof moduleName.value !== 'string') {
        return;
    }
    if (instanceName && instanceName.value && typeof instanceName.value === 'string') {
        symbolList = [instanceName.value];
        return;
    }

    symbolList.push(funcName.value);
    let locationList : vscode.Location[] = [];
    for (const workDir in fileMap) {
        const moduleUri = getModuleUriByModuleName(moduleName.value, workDir);
        if (!moduleUri) {
            continue;
        }
        const tLocationList = await getLocationByAcorn(moduleUri, symbolList);
        if (!tLocationList) {
            continue;
        }
        locationList.push(...tLocationList);
    }
    return locationList;
}