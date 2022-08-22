import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export let fileMap: { [workDir: string]: { [file: string]: string } } = {};
export const excludeSet = new Set(['extends', 'properties', 'statics', 'editor', 'onLoad', 'start', 'update', 'onEnable', 'onDisable', 'onDestroy', 'if', 'else if', 'for', 'function', 'new', 'return', 'switch', 'throw', 'while']);
function getWorkRootDir() {
	const workDir = vscode.workspace.workspaceFolders?.[0].uri.path || "";
	console.log(workDir);
	return workDir;
}
function getWorkDirList() {
	const workRootDir = getWorkRootDir();
	let workDirList = [
		"project_modules",
		"node_modules/@water",
		"servers/\\w*_server",
	];
	return workDirList.map((v) => workRootDir + "/" + v);
}
export function getWorkDirByFilePath(filePath: string) {
	const workDirList = getWorkDirList();
	let regex = new RegExp(workDirList.join('|'), "");
	let workDir = regex.exec(filePath);
	if (workDir) {
		return workDir[0];
	}
	return null;
}
export function updateFileMap() {
	let tfileMap: { [workDir: string]: { [file: string]: string } } = {};
	fileMap = {};
	const document = vscode.window.activeTextEditor?.document;
	if (!document) {
		return;
	}
	const workDirList = getWorkDirList();
	const workRootDir = getWorkRootDir();
	const walkDir = (currentPath: string, tfileMap: { [workDir: string]: { [file: string]: string } }) => {
		const files = fs.readdirSync(currentPath);
		files.forEach(fileName => {
			const filePath = path.join(currentPath, fileName);
			const fileStat = fs.statSync(filePath);
			if (fileStat.isFile() && fileName.endsWith('.js')) {
				const workDir = getWorkDirByFilePath(filePath);
				if (!workDir) {
					return;
				}
				const key = fileName.substring(0, fileName.length - 3);
				tfileMap[workDir] = tfileMap[workDir] || {};
				tfileMap[workDir][key] = filePath;
			} else if (fileStat.isDirectory()) {
				walkDir(filePath, tfileMap);
			}
		});
	};
	walkDir(workRootDir, tfileMap);

	const fileMapKeys = Object.keys(tfileMap);
	for (let i = 0; i < workDirList.length; i++) {
		const workDirReg = new RegExp(workDirList[i]);
		for (let j = 0; j < fileMapKeys.length; j++) {
			const key = fileMapKeys[j];
			if (workDirReg.test(key)) {
				fileMap[key] = tfileMap[key];
			}
		}
	}
	console.log("updateFileMap fileMap: ", fileMap);
}

export function getFilePath(key: string, workDir?: string): string | undefined {
	console.log("getFilePath fileMap: ", fileMap);
	if (workDir && (!fileMap || !fileMap[workDir])) {
		updateFileMap();
	}

	if (workDir && fileMap[workDir][key]) {
		return fileMap[workDir][key];
	}

	for (const workDir in fileMap) {
		if (fileMap[workDir][key]) {
			return fileMap[workDir][key];
		}
	}
}

export function getFileContent(filePath: string) {
	return fs.readFileSync(filePath).toString();
}

export async function getSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
	vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri) || [];
	return await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri) || [];
}

export function convertCCSymbols(symbols: vscode.DocumentSymbol[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
	const ccSymbols: vscode.DocumentSymbol[] = [];
	const result = document.fileName.match(/\w+(?=.js)/);
	if (result) {
		const classSymbol = symbols.find(symbol => symbol.name === result[0]);
		if (classSymbol) {
			symbols = classSymbol.children;
		}
	}
	symbols.forEach(symbol => {
		if (symbol.name === 'properties') {
			symbol.children.forEach(symbolChild => {
				if (/\w+/.test(symbolChild.name)) {
					ccSymbols.push(symbolChild);
				}
			});
		} else if (symbol.kind !== vscode.SymbolKind.Variable) {
			if (/\w+/.test(symbol.name)) {
				ccSymbols.push(symbol);
			}
		}
	});
	return ccSymbols;
}

export async function goToSymbol(document: vscode.TextDocument, symbolName: string) {
	const symbols = await getSymbols(document);
	const findSymbol = symbols.find(symbol => symbol.name === symbolName);
	const activeTextEditor = vscode.window.activeTextEditor;
	if (findSymbol && activeTextEditor) {
		activeTextEditor.revealRange(findSymbol.range, vscode.TextEditorRevealType.AtTop);
		activeTextEditor.selection = new vscode.Selection(findSymbol.range.start, findSymbol.range.start);
	}
}

export function getModuleUriByModuleName(moduleName: string, workDir: string): vscode.Uri | undefined {
	if (moduleName === "user_msg_define") {
		moduleName = "user_define";
	}
	let modulePath = getFilePath(moduleName, workDir);
	if (!modulePath) {
		return;
	}
	return vscode.Uri.parse(modulePath);
}

export async function getSymbolByName(moduleUri: vscode.Uri, symbolNameList: string[]) {
	let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', moduleUri);
	let moduleExports = symbols?.find(symbol => symbol.name === '<unknown>');
	let symbol = symbols?.find(symbol => symbol.name === symbolNameList[0]);
	if (!symbol) {
		if (moduleExports) {
			symbols = moduleExports?.children;
			symbol = symbols?.find(symbol => symbol.name === symbolNameList[0]);
		}
	}
	if (!symbol) {
		return;
	}
	symbols = symbol.children;
	for (let i = 3; i < symbolNameList.length; i++) {
		const tSymbolName = symbolNameList[i];
		symbol = symbols?.find(symbol => symbol.name === tSymbolName);
		symbols = symbol?.children;
	}
	return symbol;
}