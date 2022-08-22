import * as vscode from 'vscode';
import { updateFileMap, getSymbols } from './utils';
import { registerDefinition } from './definition';
import { registerCompletion } from './completion';

export function activate(context: vscode.ExtensionContext) {
	console.log('activate');
	registerDefinition(context);
	registerCompletion(context);
	updateFileMap();
	vscode.workspace.onDidCreateFiles(() => {
		updateFileMap();
	});
	vscode.workspace.onDidDeleteFiles(() => {
		updateFileMap();
	});

	// vscode.commands.registerCommand("test", async () => {
	// 	let editor = vscode.window.activeTextEditor;
	// 	if (!editor) { return; }
	// 	let document = editor.document;
	// 	let symbols = await getSymbols(document);
	// 	console.log("symbols: ", symbols);
	// });

	// vscode.languages.registerHoverProvider('javascript', {
	// 	provideHover(document, position, token) {
	// 	  return {
	// 		contents: ['Hover Content']
	// 	  };
	// 	}
	//   });
}

export function deactivate() { }
