import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as acorn from 'acorn';
import * as acornWalk from 'acorn-walk';

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
			if (fileStat.isFile() && (fileName.endsWith('.js') || fileName.endsWith('.json'))) {
				const workDir = getWorkDirByFilePath(filePath);
				if (!workDir) {
					return;
				}
				const key = fileName.split('.')[0];
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
	for (let i = 1; i < symbolNameList.length; i++) {
		const tSymbolName = symbolNameList[i];
		symbol = symbols?.find(symbol => symbol.name === tSymbolName);
		symbols = symbol?.children;
	}
	return symbol;
}


function astLoc2vscodeRange(loc: acorn.SourceLocation | null | undefined): vscode.Range {
	if (!loc) {
		return new vscode.Range(0, 0, 0, 0);
	}
	return new vscode.Range(loc.start.line - 1, loc.start.column, loc.end.line - 1, loc.end.column);
}

export function getLocationByAcorn(moduleUri: vscode.Uri, symbolNameList: string[]) : vscode.Location[] | undefined {
	const contentData = fs.readFileSync(`${moduleUri.path}`, 'utf8');
	const acron_options = {
		locations: true,
	} as acorn.Options;
	const ast = acorn.parse(contentData, acron_options);

	const firstSymbol = symbolNameList.shift();
	const lastSymbol = symbolNameList.pop();
	let locationList: vscode.Location[] = [];
	if (!firstSymbol) {
		return;
	}
	type NodeHandler = (node: acorn.Node, symbol: string) => acorn.Node | undefined;
	for (const node of ast.body) {
		const solution : Record<string, NodeHandler> = {
			"VariableDeclaration": solutionVariableDeclaration,
			"ExpressionStatement": solutionExpressionStatement,
		};
		const handler = solution[node.type];
		if (!handler) {
			continue;
		}
		const findNode = handler(node, firstSymbol);
		if(findNode){
			if (!lastSymbol) {
				return [
					new vscode.Location(moduleUri, astLoc2vscodeRange(findNode.loc))
				];
			} else {
				acornWalk.simple(findNode, {
						Property: (node: acorn.Node) => {
							const PropertyNode = node as acorn.Property;
							const key = PropertyNode.key;
							if (key.type === "Identifier" && key.name === lastSymbol) {
								locationList.push(new vscode.Location(moduleUri, astLoc2vscodeRange(PropertyNode.loc)));
							}
						}
					}
				);
				if (locationList.length > 0) {
					return locationList;
				}
			}
			break;
		}
	}

	acornWalk.simple(ast, {
		MethodDefinition: (node: acorn.Node) => {
			const MethodDefinitionNode = node as acorn.MethodDefinition;
			const key = MethodDefinitionNode.key;
			if (key.type === "Identifier" && key.name === lastSymbol) {
				locationList.push(new vscode.Location(moduleUri, astLoc2vscodeRange(MethodDefinitionNode.loc)));
			}
		},
		ExportNamedDeclaration: (node: acorn.Node) => {
			
		}
	});
	if (locationList.length > 0) {
		return locationList;
	}

	return;
}

function solutionVariableDeclaration (node: acorn.Node, symbol: string) : acorn.Node | undefined {
	const VariableDeclarationNode = node as acorn.VariableDeclaration;
	if (!VariableDeclarationNode.declarations) {
		return;
	}
	for (const declaration of VariableDeclarationNode.declarations) {
		const id = declaration.id;
		if (id.type === "Identifier" && id.name === symbol) {
			console.log(VariableDeclarationNode.loc);
			return VariableDeclarationNode;
		}
	}
}

function solutionExpressionStatement(node: acorn.Node, symbol: string) : acorn.Node | undefined {
	const ExpressionStatementNode = node as acorn.ExpressionStatement;
	const expression = ExpressionStatementNode.expression;
	if (expression.type === "AssignmentExpression") {
		const left = expression.left;
		if (left.type === "MemberExpression") {
			const property = left.property;
			const object = left.object;
			if (property.type === "Identifier" && property.name === symbol && object.type === "Identifier" && object.name === "exports") {
				return ExpressionStatementNode;
			}
		}
	}
}


export function findNodeByPosition(moduleUri: vscode.Uri, position: vscode.Position) : null | acorn.Node {
	const acron_options = {
		locations: true,
	} as acorn.Options;
	const contentData = fs.readFileSync(`${moduleUri.path}`, 'utf8');
    const ast = acorn.parse(contentData, acron_options);

    let targetFunctionNode = null;
    acornWalk.simple(ast, {
        CallExpression(node) {
			if (!node.loc?.start || !node.loc?.end) {
				return;
			}
			if (node.loc?.start?.line > position.line + 1 || node.loc?.end.line < position.line + 1) {
				return;
			}
			if (node.loc.start.line === position.line + 1 && node.loc.start.column > position.character) {
				return;
			}
			if (node.loc.end.line === position.line + 1 && node.loc.end.column < position.character) {
				return;
			}
			targetFunctionNode = node;
        }
    });

    return targetFunctionNode;
}