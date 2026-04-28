import * as vscode from 'vscode';
import { updateFileMap, clearAstCache } from './utils';
import { registerDefinition } from './definition';
import { registerCompletion } from './completion';
import { registerHover } from './hover';

export function activate(context: vscode.ExtensionContext) {
    console.log('[Water Jump] Extension activated');

    registerDefinition(context);
    registerCompletion(context);
    registerHover(context);

    // 初始化文件映射（不再依赖 activeTextEditor）
    updateFileMap().then(() => {
        console.log('[Water Jump] File map updated');
    }).catch(err => {
        console.error('[Water Jump] Failed to update file map:', err);
    });

    // 监听文件系统变化
    context.subscriptions.push(vscode.workspace.onDidCreateFiles(() => {
        updateFileMap();
    }));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(() => {
        updateFileMap();
    }));
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => {
        updateFileMap();
    }));

    // 文件保存时清除对应的 AST 缓存
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        clearAstCache(document.uri.fsPath);
    }));
}

export function deactivate() {
    clearAstCache();
}
