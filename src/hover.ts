import * as vscode from 'vscode';
import {
    getWorkDirByFilePath,
    getModuleUriByModuleName,
    getAst,
    findMemberExpressionAtPosition,
    getMemberChain,
    findSymbolLocations,
    extractFunctionSignature,
} from './utils';

export function registerHover(context: vscode.ExtensionContext) {
    const hover = vscode.languages.registerHoverProvider('javascript', {
        provideHover(document, position) {
            const workDir = getWorkDirByFilePath(document.uri.fsPath);
            if (!workDir) {
                return;
            }

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
            let markdown = ``;

            if (symbolNames.length > 0) {
                const targetParsed = getAst(moduleUri.fsPath);
                if (targetParsed) {
                    const locations = findSymbolLocations(targetParsed.ast, symbolNames);
                    if (locations.length > 0) {
                        const sig = extractFunctionSignature(locations[0]);
                        if (sig) {
                            const funcName = symbolNames[symbolNames.length - 1];
                            const paramStr = sig.params.join(', ');
                            markdown += `\`\`\`typescript\nconst ${funcName}: (${paramStr}) => void\n\`\`\``;
                        }
                    }
                }
            }

            return markdown ? new vscode.Hover(new vscode.MarkdownString(markdown)) : undefined;
        }
    });

    context.subscriptions.push(hover);
}
