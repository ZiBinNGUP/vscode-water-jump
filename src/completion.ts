import * as vscode from 'vscode';
import { getSymbols, convertCCSymbols, getFilePath, excludeSet, getFileContent, getWorkDirByFilePath, fileMap, getModuleUriByModuleName, getSymbolByName } from './utils';

export function registerCompletion(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider('javascript', {
		provideCompletionItems: async (document, position, token, context) => {
			const line = document.lineAt(position);
			const lineText = line.text.substring(0, position.character);
			const workDir = getWorkDirByFilePath(document.uri.path);
            let result = lineText.match(/ms[\w.]*$/);
			if (!result || !workDir) {
				return;
			}
			result = result[0].split('.');
			if (result.length <= 1) {
				return;
			}
			
			if (result.length <= 2) {
				let completionItems: vscode.CompletionItem[] = [];
				for (let module in fileMap[workDir]) {
					completionItems.push(new vscode.CompletionItem(module, vscode.CompletionItemKind.Module));
				}
				for (let module in fileMap["project_modules"]) {
					completionItems.push(new vscode.CompletionItem(module, vscode.CompletionItemKind.Module));
				}
				for (let module in fileMap["node_modules/@water"]) {
					completionItems.push(new vscode.CompletionItem(module, vscode.CompletionItemKind.Module));
				}
				return completionItems;
			}

			const moduleName = result[1];
			const moduleUri = getModuleUriByModuleName(moduleName, workDir);
			
			if (!moduleUri) {
				return;
			}
			let moduleSymbolSet = new Map() as Map<string, vscode.DocumentSymbol>;
			let moduleSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', moduleUri);
			if (!moduleSymbols) {
				return;
			}
			moduleSymbols.forEach(v => {
				if (v.name !== '<unknown>') {
					moduleSymbolSet.set(v.name, v)
					return;
				}
				v.children.forEach(t => moduleSymbolSet.set(t.name, t))
			});
			if (result.length <= 3) {
				let completionItems: vscode.CompletionItem[] = [];
				moduleSymbolSet.forEach(({name}) => completionItems.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Module)));
				return completionItems;
			}

			let symbol = moduleSymbolSet.get(result[2]);
			if (!symbol || !symbol.children) {
				return;
			}
			for (let symbolName of result.slice(3, -1)) {
				symbol = symbol.children.find(c => c.name === symbolName);
				if (!symbol || !symbol.children) {
					return;
				}
			}
			console.log(symbol.children);
			return symbol.children.map(({name}) => {return new vscode.CompletionItem(name + "++++bin", vscode.CompletionItemKind.Module)});
		},
		resolveCompletionItem: () => {
			return null;
		}
	}, '.'));
}