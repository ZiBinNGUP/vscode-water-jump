import * as vscode from 'vscode';
import * as path from 'path';
import {
    getWorkDirByFilePath,
    getWorkRootDir,
    fileMap,
    getModuleUriByModuleName,
} from './utils';

export function registerCompletion(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems: async (document, position, token, context) => {
            const line = document.lineAt(position);
            const lineText = line.text.substring(0, position.character);
            const workDir = getWorkDirByFilePath(document.uri.fsPath);
            if (!workDir) {
                return;
            }

            // 匹配 ms.xxx.yyy 这样的前缀
            let match = lineText.match(/ms([\w.]*)$/);
            if (!match) {
                return;
            }

            const segments = match[1].split('.').filter(Boolean);

            // ms. → 补全模块名
            if (segments.length === 0) {
                return buildModuleCompletionItems(workDir);
            }

            const moduleName = segments[0];
            const moduleUri = getModuleUriByModuleName(moduleName, workDir);
            if (!moduleUri) {
                return;
            }

            // ms.xxx. → 补全模块导出的一级属性
            if (segments.length === 1) {
                return buildModuleSymbolCompletionItems(moduleUri);
            }

            // ms.xxx.yyy. → 补全嵌套属性
            return buildNestedCompletionItems(moduleUri, segments.slice(1));
        },
        resolveCompletionItem: () => {
            return null;
        }
    }, '.'));
}

// =============================================================================
// 模块名补全
// =============================================================================

function buildModuleCompletionItems(workDir: string): vscode.CompletionItem[] {
    const workRootDir = getWorkRootDir();
    const projectModulesPath = path.join(workRootDir, 'project_modules');

    const items: vscode.CompletionItem[] = [];
    const added = new Set<string>();

    const addFromDir = (dir: string) => {
        const modules = fileMap[dir];
        if (!modules) { return; }
        for (const name of Object.keys(modules)) {
            if (added.has(name)) { continue; }
            added.add(name);
            items.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Module));
        }
    };

    // 当前 workDir 优先
    addFromDir(workDir);

    // project_modules
    addFromDir(projectModulesPath);

    // 所有 @water 子目录（细粒度 workDir）
    for (const dir of Object.keys(fileMap)) {
        if (dir.includes('node_modules/@water')) {
            addFromDir(dir);
        }
    }

    return items;
}

// =============================================================================
// 模块符号补全
// =============================================================================

async function buildModuleSymbolCompletionItems(moduleUri: vscode.Uri): Promise<vscode.CompletionItem[] | undefined> {
    const moduleSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', moduleUri);
    if (!moduleSymbols) {
        return;
    }

    const items: vscode.CompletionItem[] = [];

    for (const symbol of moduleSymbols) {
        if (symbol.name === '<unknown>') {
            // <unknown> 通常是模块的 exports 容器
            for (const child of symbol.children) {
                items.push(createCompletionItem(child));
            }
        } else {
            items.push(createCompletionItem(symbol));
        }
    }

    return items;
}

function createCompletionItem(symbol: vscode.DocumentSymbol): vscode.CompletionItem {
    let kind = vscode.CompletionItemKind.Property;
    switch (symbol.kind) {
        case vscode.SymbolKind.Function:
        case vscode.SymbolKind.Method:
            kind = vscode.CompletionItemKind.Function;
            break;
        case vscode.SymbolKind.Class:
            kind = vscode.CompletionItemKind.Class;
            break;
        case vscode.SymbolKind.Variable:
            kind = vscode.CompletionItemKind.Variable;
            break;
        case vscode.SymbolKind.Constant:
            kind = vscode.CompletionItemKind.Constant;
            break;
        case vscode.SymbolKind.Enum:
            kind = vscode.CompletionItemKind.Enum;
            break;
        case vscode.SymbolKind.Module:
            kind = vscode.CompletionItemKind.Module;
            break;
    }
    return new vscode.CompletionItem(symbol.name, kind);
}

// =============================================================================
// 嵌套属性补全
// =============================================================================

async function buildNestedCompletionItems(moduleUri: vscode.Uri, pathSegments: string[]): Promise<vscode.CompletionItem[] | undefined> {
    const moduleSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', moduleUri);
    if (!moduleSymbols) {
        return;
    }

    // 在模块符号中逐级查找
    let currentSymbols = moduleSymbols;
    let targetSymbol: vscode.DocumentSymbol | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
        const name = pathSegments[i];
        const isLast = i === pathSegments.length - 1;

        // 尝试在 <unknown> exports 容器中查找
        const exportsContainer = currentSymbols.find(s => s.name === '<unknown>');
        if (exportsContainer) {
            targetSymbol = exportsContainer.children.find(s => s.name === name);
        }
        if (!targetSymbol) {
            targetSymbol = currentSymbols.find(s => s.name === name);
        }

        if (!targetSymbol) {
            return;
        }

        if (!isLast) {
            currentSymbols = targetSymbol.children || [];
            targetSymbol = undefined;
        }
    }

    if (!targetSymbol || !targetSymbol.children) {
        return;
    }

    return targetSymbol.children.map(child => createCompletionItem(child));
}
