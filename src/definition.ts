import * as vscode from 'vscode';
import {
    getWorkDirByFilePath,
    getModuleUriByModuleName,
    getLocationByAcorn,
    findMemberExpressionAtPosition,
    findCallExpressionAtPosition,
    getMemberChain,
    getSymbolByName,
    getAst,
    fileMap,
    findVariableDefinition,
    resolveExpressionToMsChain,
} from './utils';
import * as acorn from 'acorn';

export function registerDefinition(context: vscode.ExtensionContext) {
    const definition = vscode.languages.registerDefinitionProvider(['javascript'], {
        provideDefinition: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
            const workDir = getWorkDirByFilePath(document.uri.fsPath);
            if (!workDir) {
                return;
            }

            // 安全获取当前单词，光标在空白/标点处时返回 undefined
            const wordRange = document.getWordRangeAtPosition(position);
            const word = wordRange ? document.getText(wordRange) : '';

            const handlerList = [
                handleConfig,
                handleVariableTrace,
                handleMs,
                handleUserFunc,
                handleRpcFunc,
            ];

            for (const func of handlerList) {
                const res = await func(word, workDir, document, position);
                if (res) {
                    return res;
                }
            }
        }
    });

    context.subscriptions.push(definition);
}

// =============================================================================
// 局部变量别名追踪跳转
// =============================================================================

async function handleVariableTrace(word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
    const parsed = getAst(document.uri.fsPath);
    if (!parsed) {
        return;
    }

    const memberExpr = findMemberExpressionAtPosition(parsed.ast, position);
    if (!memberExpr) {
        return;
    }

    const chain = getMemberChain(memberExpr);
    if (!chain || chain.length < 2) {
        return;
    }
    if (chain[0] === 'ms') {
        return; // 已由 handleMs 处理
    }

    const varName = chain[0];
    const propertyPath = chain.slice(1);

    // 回溯变量定义
    const defNode = findVariableDefinition(parsed.ast, position, varName);
    if (!defNode) {
        return;
    }

    // 解析定义来源
    const sourceChain = resolveExpressionToMsChain(defNode);
    if (!sourceChain || sourceChain[0] !== 'ms') {
        return;
    }

    // 合并完整链
    const fullChain = [...sourceChain, ...propertyPath];

    // 复用跳转逻辑
    const moduleName = fullChain[1];
    if (!moduleName) {
        return;
    }
    const moduleUri = getModuleUriByModuleName(moduleName, workDir);
    if (!moduleUri) {
        return;
    }

    const symbolNames = fullChain.slice(2);
    const locations = getLocationByAcorn(moduleUri, symbolNames);
    if (locations) {
        return locations;
    }

    if (moduleUri.fsPath.endsWith('.json')) {
        const symbol = await getSymbolByName(moduleUri, symbolNames);
        if (symbol) {
            return new vscode.Location(moduleUri, symbol.range);
        }
    }

    return new vscode.Location(moduleUri, new vscode.Position(0, 0));
}

// =============================================================================
// ms.xxx.yyy 通用跳转
// =============================================================================

async function handleMs(word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
    const parsed = getAst(document.uri.fsPath);
    if (!parsed) {
        return;
    }

    const memberExpr = findMemberExpressionAtPosition(parsed.ast, position);
    if (!memberExpr) {
        return;
    }

    const chain = getMemberChain(memberExpr);
    if (!chain || chain[0] !== 'ms') {
        return;
    }

    const moduleName = chain[1];
    if (!moduleName) {
        return;
    }

    const moduleUri = getModuleUriByModuleName(moduleName, workDir);
    if (!moduleUri) {
        return;
    }

    const symbolNames = chain.slice(2);
    const locations = getLocationByAcorn(moduleUri, symbolNames);
    if (locations) {
        return locations;
    }

    // JSON 文件 fallback：VSCode 内置 SymbolProvider 可解析 JSON key
    if (moduleUri.fsPath.endsWith('.json')) {
        const symbol = await getSymbolByName(moduleUri, symbolNames);
        if (symbol) {
            return new vscode.Location(moduleUri, symbol.range);
        }
    }

    // 组合配置 fallback：msg_def.ret_code_def 在运行时与 error_code 合并
    // 当在 msg_def.js 中找不到属性时，尝试在 error_code（sys_error_code.json）中查找
    if (moduleName === 'msg_def' && symbolNames[0] === 'ret_code_def') {
        const errorCodeUri = getModuleUriByModuleName('error_code', workDir);
        if (errorCodeUri) {
            const errorSymbols = symbolNames.slice(1);
            const errorLocations = getLocationByAcorn(errorCodeUri, errorSymbols);
            if (errorLocations) {
                return errorLocations;
            }
            if (errorCodeUri.fsPath.endsWith('.json')) {
                const symbol = await getSymbolByName(errorCodeUri, errorSymbols);
                if (symbol) {
                    return new vscode.Location(errorCodeUri, symbol.range);
                }
            }
        }
    }

    return new vscode.Location(moduleUri, new vscode.Position(0, 0));
}

// =============================================================================
// user.func_instance().xxx 跳转
// =============================================================================

async function handleUserFunc(word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
    const parsed = getAst(document.uri.fsPath);
    if (!parsed) {
        return;
    }

    const memberExpr = findMemberExpressionAtPosition(parsed.ast, position);
    if (!memberExpr) {
        return;
    }

    const chain = getMemberChain(memberExpr);
    if (!chain || chain.length < 3) {
        return;
    }

    // 匹配 user.func_instance().xxx 或 user.func_instance()?.xxx 等形式
    if (chain[0] !== 'user' || chain[1] !== 'func_instance') {
        return;
    }

    const methodName = chain[2];
    if (!methodName) {
        return;
    }

    const moduleUri = getModuleUriByModuleName('user_func', workDir);
    if (!moduleUri) {
        return;
    }

    // 尝试在 user_func.js 中查找类名，优先通过 AST 探测，避免硬编码
    const className = await detectUserFuncClassName(moduleUri);
    if (className) {
        const symbol = await getSymbolByName(moduleUri, [className, methodName]);
        if (symbol) {
            return new vscode.Location(moduleUri, symbol.range);
        }
    }

    // 兜底：直接在文件中查找该函数/方法符号
    const symbol = await getSymbolByName(moduleUri, [methodName]);
    if (symbol) {
        return new vscode.Location(moduleUri, symbol.range);
    }

    return new vscode.Location(moduleUri, new vscode.Position(0, 0));
}

/**
 * 尝试从 user_func.js 的 AST 中自动探测主类名（如 c_normal_user_func）
 */
async function detectUserFuncClassName(moduleUri: vscode.Uri): Promise<string | undefined> {
    const parsed = getAst(moduleUri.fsPath);
    if (!parsed) {
        return;
    }

    for (const node of (parsed.ast as acorn.Program).body) {
        if (node.type === 'ClassDeclaration') {
            const cls = node as acorn.ClassDeclaration;
            if (cls.id) {
                return cls.id.name;
            }
        }
    }
    return;
}

// =============================================================================
// ms.config_data.configs.xxx 配置跳转（项目特定逻辑）
// =============================================================================

async function handleConfig(word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
    const parsed = getAst(document.uri.fsPath);
    if (!parsed) {
        return;
    }

    const memberExpr = findMemberExpressionAtPosition(parsed.ast, position);
    if (!memberExpr) {
        return;
    }

    const chain = getMemberChain(memberExpr);
    if (!chain || chain.length < 4) {
        return;
    }

    // 必须匹配 ms.config_data.configs.xxx[.yyy...]
    if (chain[0] !== 'ms' || chain[1] !== 'config_data' || chain[2] !== 'configs') {
        return;
    }

    // configs 后面的第一级（如 sys_kv）被视为模块/文件名
    const configModuleName = chain[3];
    const moduleUri = getModuleUriByModuleName(configModuleName, workDir);
    if (!moduleUri) {
        return;
    }

    // 剩余层级作为符号路径在目标文件内查找
    const symbolNames = chain.slice(4);
    if (symbolNames.length === 0) {
        return new vscode.Location(moduleUri, new vscode.Position(0, 0));
    }

    const symbol = await getSymbolByName(moduleUri, symbolNames);
    if (symbol) {
        return new vscode.Location(moduleUri, symbol.range);
    }

    return new vscode.Location(moduleUri, new vscode.Position(0, 0));
}

// =============================================================================
// rpc_call_func / rpc_function_server 跳转
// =============================================================================

async function handleRpcFunc(word: string, workDir: string, document: vscode.TextDocument, position: vscode.Position) {
    const parsed = getAst(document.uri.fsPath);
    if (!parsed) {
        return;
    }

    const node = findCallExpressionAtPosition(parsed.ast, position);
    if (!node) {
        return;
    }

    const callExpr = node as acorn.CallExpression;
    if (callExpr.callee.type !== 'MemberExpression') {
        return;
    }

    const prop = callExpr.callee.property;
    if (prop.type !== 'Identifier') {
        return;
    }

    if (prop.name !== 'rpc_call_func' && prop.name !== 'rpc_function_server') {
        return;
    }

    const params = callExpr.arguments;
    if (params.length < 3) {
        return;
    }

    const moduleNameNode = params[1];
    const funcNameNode = params[2];
    const instanceNameNode = params[6];

    if (moduleNameNode.type !== 'Literal' || typeof moduleNameNode.value !== 'string') {
        return;
    }
    if (funcNameNode.type !== 'Literal' || typeof funcNameNode.value !== 'string') {
        return;
    }

    const moduleName = moduleNameNode.value;
    const funcName = funcNameNode.value;

    // instanceName 存在时：优先跳转到 instanceName 对应的类定义
    if (instanceNameNode && instanceNameNode.type === 'Literal' && typeof instanceNameNode.value === 'string' && instanceNameNode.value) {
        const instanceName = instanceNameNode.value;
        const { fileMap } = await import('./utils');
        const locationList: vscode.Location[] = [];

        for (const dir of Object.keys(fileMap)) {
            const moduleUri = getModuleUriByModuleName(moduleName, dir);
            if (!moduleUri) {
                continue;
            }
            const locations = getLocationByAcorn(moduleUri, [instanceName]);
            if (locations) {
                locationList.push(...locations);
            }
        }

        if (locationList.length > 0) {
            return locationList;
        }

        // 如果找不到类定义，至少返回模块文件顶部
        for (const dir of Object.keys(fileMap)) {
            const moduleUri = getModuleUriByModuleName(moduleName, dir);
            if (moduleUri) {
                return new vscode.Location(moduleUri, new vscode.Position(0, 0));
            }
        }
        return;
    }

    // 没有 instanceName：在所有 workDir 中查找函数定义
    const { fileMap } = await import('./utils');
    const locationList: vscode.Location[] = [];

    for (const dir of Object.keys(fileMap)) {
        const moduleUri = getModuleUriByModuleName(moduleName, dir);
        if (!moduleUri) {
            continue;
        }
        const locations = getLocationByAcorn(moduleUri, [funcName]);
        if (locations) {
            locationList.push(...locations);
        }
    }

    if (locationList.length > 0) {
        return locationList;
    }

    return;
}
