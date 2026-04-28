import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as acorn from 'acorn';
import * as acornWalk from 'acorn-walk';

// =============================================================================
// 配置常量
// =============================================================================

/** 模块名别名映射：当 ms.xxx 中的 xxx 与实际文件名不一致时使用 */
export const MODULE_NAME_ALIASES: Record<string, string> = {
    user_msg_define: 'user_define',
};

/** 扫描的 glob 模式，按优先级排序 */
const SCAN_GLOBS = [
    'project_modules/**/*.js',
    'servers/*_server/**/*.js',
    'node_modules/@water/**/*.js',
    'bin/**/*.js',
    'robot/**/*.js',
    'project_modules/**/*.json',
];

/** 排除的关键词（用于补全过滤） */
export const excludeSet = new Set([
    'extends', 'properties', 'statics', 'editor',
    'onLoad', 'start', 'update', 'onEnable', 'onDisable', 'onDestroy',
    'if', 'else if', 'for', 'function', 'new', 'return', 'switch', 'throw', 'while',
]);

// =============================================================================
// 文件映射
// =============================================================================

/** fileMap[workDir][moduleName] = absoluteFilePath */
export let fileMap: Record<string, Record<string, string>> = {};
/** aliasMap[serverWorkDir][aliasName] = absoluteFilePath */
export let aliasMap: Record<string, Record<string, string>> = {};

export function getWorkRootDir(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

export function getWorkDirByFilePath(filePath: string): string | null {
    const workRootDir = getWorkRootDir();
    if (!workRootDir) { return null; }

    // servers 目录：精确到具体 server
    const serversPath = path.join(workRootDir, 'servers');
    if (filePath.startsWith(serversPath + path.sep) || filePath === serversPath) {
        const rel = path.relative(serversPath, filePath);
        const first = rel.split(path.sep)[0];
        if (first) {
            return path.join(serversPath, first);
        }
        return serversPath;
    }

    // project_modules
    const projectModulesPath = path.join(workRootDir, 'project_modules');
    if (filePath.startsWith(projectModulesPath + path.sep) || filePath === projectModulesPath) {
        return projectModulesPath;
    }

    // node_modules/@water：精确到第二级子目录（如 @water/mail/iface），避免同名文件冲突
    const waterPath = path.join(workRootDir, 'node_modules/@water');
    if (filePath.startsWith(waterPath + path.sep) || filePath === waterPath) {
        const rel = path.relative(waterPath, filePath);
        const parts = rel.split(path.sep);
        if (parts.length >= 2) {
            return path.join(waterPath, parts[0], parts[1]);
        }
        if (parts.length >= 1) {
            return path.join(waterPath, parts[0]);
        }
        return waterPath;
    }

    return null;
}

export async function updateFileMap(): Promise<void> {
    fileMap = {};
    aliasMap = {};
    const workRootDir = getWorkRootDir();
    if (!workRootDir) { return; }

    for (const glob of SCAN_GLOBS) {
        const files = await vscode.workspace.findFiles(glob, '{**/.git/**,**/.vscode/**}');
        for (const uri of files) {
            const filePath = uri.fsPath;
            // 处理 .js 和 .json 文件
            if (!filePath.endsWith('.js') && !filePath.endsWith('.json')) { continue; }

            const workDir = getWorkDirByFilePath(filePath);
            if (!workDir) { continue; }

            const baseName = path.basename(filePath);
            const key = baseName.replace(/\.(js|json)$/, '');

            if (!fileMap[workDir]) {
                fileMap[workDir] = {};
            }
            fileMap[workDir][key] = filePath;
        }
    }

    // 解析 *_ms.js 中的 exports 别名（按 server 隔离）
    extractAliasesFromMsFiles();
}

function extractAliasesFromMsFiles(): void {
    for (const workDir of Object.keys(fileMap)) {
        for (const [key, filePath] of Object.entries(fileMap[workDir])) {
            if (!key.endsWith('_ms')) { continue; }
            const aliases = extractAliasesFromFile(filePath);
            if (Object.keys(aliases).length > 0) {
                aliasMap[workDir] = aliasMap[workDir] || {};
                for (const [aliasName, targetPath] of Object.entries(aliases)) {
                    aliasMap[workDir][aliasName] = targetPath;
                }
            }
        }
    }
}

function extractAliasesFromFile(filePath: string): Record<string, string> {
    const aliases: Record<string, string> = {};
    const parsed = getAst(filePath);
    if (!parsed) { return aliases; }

    for (const node of (parsed.ast as acorn.Program).body) {
        // exports.xxx = require('...')
        if (node.type !== 'ExpressionStatement') { continue; }
        const expr = node.expression;
        if (expr.type !== 'AssignmentExpression') { continue; }

        const left = expr.left;
        const right = expr.right;
        if (left.type !== 'MemberExpression' || right.type !== 'CallExpression') { continue; }

        const leftChain = flattenMemberExpression(left);
        const callee = right.callee;
        if (callee.type !== 'Identifier' || callee.name !== 'require' || right.arguments.length === 0) { continue; }

        const arg = right.arguments[0];
        if (arg.type !== 'Literal' || typeof arg.value !== 'string') { continue; }

        const requirePath = arg.value;

        // exports.xxx = require('...')
        if (leftChain.length === 2 && leftChain[0] === 'exports') {
            const aliasName = leftChain[1];
            const targetPath = resolveAliasTarget(requirePath, filePath);
            if (targetPath) {
                aliases[aliasName] = targetPath;
            }
        }
    }

    return aliases;
}

function resolveAliasTarget(requirePath: string, msFilePath: string): string | undefined {
    const workRootDir = getWorkRootDir();
    if (!workRootDir) { return; }

    if (requirePath.startsWith('.')) {
        // 相对路径：基于 *_ms.js 所在目录解析
        const resolved = path.resolve(path.dirname(msFilePath), requirePath);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
        // 尝试补全 .js / .json 扩展名
        for (const ext of ['', '.js', '.json']) {
            const withExt = resolved + ext;
            if (fs.existsSync(withExt)) {
                return withExt;
            }
        }
        return resolved;
    }

    if (requirePath.startsWith('@water/')) {
        // @water 包路径
        const relativePath = requirePath.replace(/^@water\//, '');
        const resolved = path.join(workRootDir, 'node_modules/@water', relativePath);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
        for (const ext of ['', '.js', '.json']) {
            const withExt = resolved + ext;
            if (fs.existsSync(withExt)) {
                return withExt;
            }
        }
        return resolved;
    }

    // 其他 npm 包：尝试在 node_modules 中查找
    const resolved = path.join(workRootDir, 'node_modules', requirePath);
    if (fs.existsSync(resolved)) {
        return resolved;
    }
    for (const ext of ['', '.js', '.json']) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) {
            return withExt;
        }
    }

    return undefined;
}

export function getFilePath(key: string, workDir?: string): string | undefined {
    // 1. 优先在当前 workDir 的 fileMap 中查找
    if (workDir && fileMap[workDir] && fileMap[workDir][key]) {
        return fileMap[workDir][key];
    }
    // 2. 优先在当前 workDir 的 aliasMap 中查找（server 特定别名优先）
    if (workDir && aliasMap[workDir] && aliasMap[workDir][key]) {
        return aliasMap[workDir][key];
    }
    // 3. 遍历所有 workDir 的 fileMap
    for (const dir of Object.keys(fileMap)) {
        if (fileMap[dir][key]) {
            return fileMap[dir][key];
        }
    }
    // 4. 遍历所有 workDir 的 aliasMap
    for (const dir of Object.keys(aliasMap)) {
        if (aliasMap[dir][key]) {
            return aliasMap[dir][key];
        }
    }
    return undefined;
}

// =============================================================================
// 安全 IO
// =============================================================================

export function safeReadFile(filePath: string, encoding: BufferEncoding = 'utf8'): string | undefined {
    try {
        return fs.readFileSync(filePath, encoding);
    } catch {
        return undefined;
    }
}

function safeStat(filePath: string): fs.Stats | undefined {
    try {
        return fs.statSync(filePath);
    } catch {
        return undefined;
    }
}

// =============================================================================
// AST 缓存
// =============================================================================

interface CacheEntry {
    mtime: number;
    ast: acorn.Node;
    content: string;
}

const astCache = new Map<string, CacheEntry>();

export function getAst(filePath: string): { ast: acorn.Node; content: string } | undefined {
    const stat = safeStat(filePath);
    if (!stat) { return undefined; }

    const cached = astCache.get(filePath);
    if (cached && cached.mtime >= stat.mtimeMs) {
        return { ast: cached.ast, content: cached.content };
    }

    const content = safeReadFile(filePath);
    if (content === undefined) { return undefined; }

    try {
        const ast = acorn.parse(content, {
            ecmaVersion: 'latest',
            locations: true,
            sourceType: 'script',
        });
        astCache.set(filePath, { mtime: stat.mtimeMs, ast, content });
        return { ast, content };
    } catch {
        return undefined;
    }
}

export function clearAstCache(filePath?: string): void {
    if (filePath) {
        astCache.delete(filePath);
    } else {
        astCache.clear();
    }
}

// =============================================================================
// 位置与范围工具
// =============================================================================

function astLoc2vscodeRange(loc: acorn.SourceLocation | null | undefined): vscode.Range {
    if (!loc) { return new vscode.Range(0, 0, 0, 0); }
    return new vscode.Range(
        loc.start.line - 1, loc.start.column,
        loc.end.line - 1, loc.end.column
    );
}

function isPositionInRange(position: vscode.Position, loc: acorn.SourceLocation): boolean {
    const pl = position.line + 1;
    const pc = position.character;

    if (pl < loc.start.line || pl > loc.end.line) { return false; }
    if (pl === loc.start.line && pc < loc.start.column) { return false; }
    if (pl === loc.end.line && pc > loc.end.column) { return false; }
    return true;
}

function nodeSize(loc: acorn.SourceLocation): number {
    return (loc.end.line - loc.start.line) * 100000 + (loc.end.column - loc.start.column);
}

// =============================================================================
// AST 查询：MemberExpression
// =============================================================================

/**
 * 在 AST 中查找覆盖 position 的最内层 MemberExpression
 */
export function findMemberExpressionAtPosition(ast: acorn.Node, position: vscode.Position): acorn.MemberExpression | null {
    let bestNode: acorn.MemberExpression | null = null;
    let bestSize = Infinity;

    acornWalk.full(ast, (node) => {
        if (node.type !== 'MemberExpression' || !node.loc) { return; }
        if (!isPositionInRange(position, node.loc)) { return; }
        const size = nodeSize(node.loc);
        if (size < bestSize) {
            bestSize = size;
            bestNode = node as acorn.MemberExpression;
        }
    });

    return bestNode;
}

/**
 * 从 MemberExpression 提取完整属性链，例如 ms.common_def.drop_item_cause
 * 如果 object 最终不是 Identifier('ms')，返回 undefined
 */
export function getMemberChain(node: acorn.MemberExpression): string[] | undefined {
    const chain: string[] = [];
    let current: acorn.Node = node;

    while (current.type === 'MemberExpression') {
        const prop = (current as acorn.MemberExpression).property;
        if (prop.type === 'Identifier') {
            chain.unshift(prop.name);
        } else if (prop.type === 'Literal' && typeof prop.value === 'string') {
            chain.unshift(prop.value);
        } else {
            return undefined;
        }
        current = (current as acorn.MemberExpression).object;
    }

    if (current.type === 'Identifier' && (current as acorn.Identifier).name === 'ms') {
        chain.unshift('ms');
        return chain;
    }
    return undefined;
}

/**
 * 从 AST 中查找覆盖 position 的最内层 CallExpression
 */
export function findCallExpressionAtPosition(ast: acorn.Node, position: vscode.Position): acorn.CallExpression | null {
    let bestNode: acorn.CallExpression | null = null;
    let bestSize = Infinity;

    acornWalk.full(ast, (node) => {
        if (node.type !== 'CallExpression' || !node.loc) { return; }
        if (!isPositionInRange(position, node.loc)) { return; }
        const size = nodeSize(node.loc);
        if (size < bestSize) {
            bestSize = size;
            bestNode = node as acorn.CallExpression;
        }
    });

    return bestNode;
}

// =============================================================================
// AST 查询：符号定位
// =============================================================================

function flattenMemberExpression(node: acorn.Node): string[] {
    const chain: string[] = [];
    let current: acorn.Node = node;
    while (current.type === 'MemberExpression') {
        const prop = (current as acorn.MemberExpression).property;
        if (prop.type === 'Identifier') {
            chain.unshift(prop.name);
        } else if (prop.type === 'Literal' && typeof prop.value === 'string') {
            chain.unshift(prop.value);
        }
        current = (current as acorn.MemberExpression).object;
    }
    if (current.type === 'Identifier') {
        chain.unshift((current as acorn.Identifier).name);
    }
    return chain;
}

function findInStatement(node: acorn.Node, name: string): acorn.Node | undefined {
    // VariableDeclaration: const foo = ...
    if (node.type === 'VariableDeclaration') {
        for (const decl of (node as acorn.VariableDeclaration).declarations) {
            if (decl.id.type === 'Identifier' && decl.id.name === name) {
                return decl.init || node;
            }
        }
    }

    // FunctionDeclaration: function foo() {}
    if (node.type === 'FunctionDeclaration') {
        const func = node as acorn.FunctionDeclaration;
        if (func.id && func.id.name === name) {
            return node;
        }
    }

    // ClassDeclaration: class Foo {}
    if (node.type === 'ClassDeclaration') {
        const cls = node as acorn.ClassDeclaration;
        if (cls.id && cls.id.name === name) {
            return node;
        }
    }

    // ExpressionStatement: exports.foo = ... / module.exports.foo = ... / module.exports = { foo }
    if (node.type === 'ExpressionStatement') {
        const expr = (node as acorn.ExpressionStatement).expression;
        if (expr.type === 'AssignmentExpression') {
            const left = expr.left;
            if (left.type === 'MemberExpression') {
                const chain = flattenMemberExpression(left);

                // exports.foo = ...
                if (chain.length >= 2 && chain[0] === 'exports' && chain[1] === name) {
                    return node;
                }
                // module.exports.foo = ...
                if (chain.length >= 3 && chain[0] === 'module' && chain[1] === 'exports' && chain[2] === name) {
                    return node;
                }
                // module.exports = { ... } → 在右侧对象字面量中查找
                if (chain.length === 2 && chain[0] === 'module' && chain[1] === 'exports') {
                    const nested = findNestedInNode(expr.right, [name]);
                    if (nested.length > 0) {
                        return nested[0];
                    }
                }
            }
        }
    }

    return undefined;
}

function findNestedInNode(node: acorn.Node, names: string[]): acorn.Node[] {
    const results: acorn.Node[] = [];
    const [first, ...rest] = names;
    if (!first) { return results; }

    acornWalk.simple(node, {
        Property(n) {
            const prop = n as acorn.Property;
            const key = prop.key;
            let keyName: string | undefined;
            if (key.type === 'Identifier') { keyName = key.name; }
            else if (key.type === 'Literal' && typeof key.value === 'string') { keyName = key.value; }

            if (keyName === first) {
                if (rest.length === 0) {
                    results.push(prop);
                } else {
                    results.push(...findNestedInNode(prop.value, rest));
                }
            }
        },
        MethodDefinition(n) {
            const method = n as acorn.MethodDefinition;
            const key = method.key;
            let keyName: string | undefined;
            if (key.type === 'Identifier') { keyName = key.name; }
            else if (key.type === 'Literal' && typeof key.value === 'string') { keyName = key.value; }

            if (keyName === first) {
                if (rest.length === 0) {
                    results.push(method);
                } else {
                    results.push(...findNestedInNode(method.value, rest));
                }
            }
        }
    });

    return results;
}

/**
 * 在 AST 中查找符号定义位置（支持多层嵌套）
 */
export function findSymbolLocations(ast: acorn.Node, symbolNames: string[]): acorn.Node[] {
    const locations: acorn.Node[] = [];
    const [first, ...rest] = symbolNames;
    if (!first) { return locations; }

    const program = ast as acorn.Program;
    for (const node of program.body) {
        const found = findInStatement(node, first);
        if (found) {
            if (rest.length === 0) {
                locations.push(found);
            } else {
                locations.push(...findNestedInNode(found, rest));
            }
        }
    }

    return locations;
}

// =============================================================================
// 原有兼容接口（增强健壮性）
// =============================================================================

export async function getSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
    const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
    return result || [];
}

export function getModuleUriByModuleName(moduleName: string, workDir: string): vscode.Uri | undefined {
    const realName = MODULE_NAME_ALIASES[moduleName] || moduleName;
    const modulePath = getFilePath(realName, workDir);
    if (!modulePath) { return; }
    return vscode.Uri.file(modulePath);
}

export async function getSymbolByName(moduleUri: vscode.Uri, symbolNameList: string[]) {
    let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', moduleUri);
    if (!symbols) { return; }

    const moduleExports = symbols.find(symbol => symbol.name === '<unknown>');
    let symbol = symbols.find(symbol => symbol.name === symbolNameList[0]);
    if (!symbol) {
        if (moduleExports?.children) {
            const exportChildren = moduleExports.children;
            symbol = exportChildren.find(s => s.name === symbolNameList[0]);
        }
    }
    if (!symbol) { return; }

    let children: vscode.DocumentSymbol[] | undefined = symbol.children;
    for (let i = 1; i < symbolNameList.length; i++) {
        const tSymbolName = symbolNameList[i];
        symbol = children?.find(c => c.name === tSymbolName);
        children = symbol?.children;
    }
    return symbol;
}

export function getLocationByAcorn(moduleUri: vscode.Uri, symbolNameList: string[]): vscode.Location[] | undefined {
    const parsed = getAst(moduleUri.fsPath);
    if (!parsed) { return; }

    const locations = findSymbolLocations(parsed.ast, symbolNameList);
    if (locations.length === 0) { return; }

    return locations.map(node => new vscode.Location(moduleUri, astLoc2vscodeRange(node.loc)));
}

// 保留兼容接口，但内部改为新实现
export function findNodeByPosition(moduleUri: vscode.Uri, position: vscode.Position): acorn.Node | null {
    const parsed = getAst(moduleUri.fsPath);
    if (!parsed) { return null; }

    // 优先找 CallExpression，其次 MemberExpression
    const callExpr = findCallExpressionAtPosition(parsed.ast, position);
    if (callExpr) { return callExpr; }

    return findMemberExpressionAtPosition(parsed.ast, position);
}

export function convertCCSymbols(symbols: vscode.DocumentSymbol[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const ccSymbols: vscode.DocumentSymbol[] = [];
    const result = document.fileName.match(/\w+(?=\.js)/);
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

export function getFileContent(filePath: string): string | undefined {
    return safeReadFile(filePath);
}

// =============================================================================
// 局部变量追踪
// =============================================================================

function isBeforePosition(locEnd: acorn.Position, position: vscode.Position): boolean {
    const endLine = locEnd.line;
    const endCol = locEnd.column;
    const posLine = position.line + 1;
    const posCol = position.character;

    if (endLine < posLine) { return true; }
    if (endLine === posLine && endCol <= posCol) { return true; }
    return false;
}

function isScopeNode(node: acorn.Node): boolean {
    return node.type === 'Program' ||
        node.type === 'BlockStatement' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression';
}

function getNodeBody(node: acorn.Node): acorn.Node[] | undefined {
    if (node.type === 'Program') {
        return (node as acorn.Program).body as unknown as acorn.Node[];
    }
    if (node.type === 'BlockStatement') {
        return (node as acorn.BlockStatement).body as acorn.Node[];
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
        const func = node as acorn.FunctionDeclaration | acorn.FunctionExpression;
        if (func.body.type === 'BlockStatement') {
            return func.body.body as acorn.Node[];
        }
    }
    if (node.type === 'ArrowFunctionExpression') {
        const arrow = node as acorn.ArrowFunctionExpression;
        if (arrow.body.type === 'BlockStatement') {
            return (arrow.body as acorn.BlockStatement).body as acorn.Node[];
        }
    }
    return;
}

function extractDefinitionFromStatement(
    stmt: acorn.Statement,
    varName: string,
    position: vscode.Position
): acorn.Node | undefined {
    // const/let/var varName = expr
    if (stmt.type === 'VariableDeclaration') {
        for (const d of (stmt as acorn.VariableDeclaration).declarations) {
            if (d.id.type === 'Identifier' && d.id.name === varName && d.init) {
                if (d.loc && isBeforePosition(d.loc.end, position)) {
                    return d.init;
                }
            }
        }
    }

    // varName = expr
    if (stmt.type === 'ExpressionStatement') {
        const expr = (stmt as acorn.ExpressionStatement).expression;
        if (expr.type === 'AssignmentExpression') {
            const left = expr.left;
            if (left.type === 'Identifier' && left.name === varName) {
                if (stmt.loc && isBeforePosition(stmt.loc.end, position)) {
                    return expr.right;
                }
            }
        }
    }

    return;
}

function findLastDefinitionBeforePosition(
    body: acorn.Node[],
    position: vscode.Position,
    varName: string
): acorn.Node | undefined {
    let lastDef: acorn.Node | undefined;

    for (const node of body) {
        if (node.type !== 'ExpressionStatement' && node.type !== 'VariableDeclaration') {
            continue;
        }
        // 语句完全在光标之后，停止扫描
        if (node.loc && node.loc.start.line > position.line + 1) {
            break;
        }

        const def = extractDefinitionFromStatement(node as acorn.Statement, varName, position);
        if (def) {
            lastDef = def;
        }
    }

    return lastDef;
}

/**
 * 在 AST 中查找光标所在作用域内、光标位置之前的变量定义右侧表达式节点
 */
export function findVariableDefinition(
    ast: acorn.Node,
    position: vscode.Position,
    varName: string
): acorn.Node | undefined {
    let targetScope: acorn.Node | null = null;
    let targetScopeSize = Infinity;
    let targetAncestors: acorn.Node[] = [];

    acornWalk.fullAncestor(ast, (_node, _state, ancestors) => {
        const current = ancestors[ancestors.length - 1];
        if (!current.loc || !isPositionInRange(position, current.loc)) {
            return;
        }
        if (!isScopeNode(current)) {
            return;
        }

        const size = nodeSize(current.loc);
        if (size < targetScopeSize) {
            targetScopeSize = size;
            targetScope = current;
            targetAncestors = [...ancestors];
        }
    });

    if (!targetScope) {
        return;
    }

    // 从 targetScope 的祖先链中提取所有 scope 节点（从内层到外层）
    const scopeStack = targetAncestors.filter(n => isScopeNode(n)).reverse();

    for (const scope of scopeStack) {
        const body = getNodeBody(scope);
        if (!body) { continue; }

        const def = findLastDefinitionBeforePosition(body, position, varName);
        if (def) {
            return def;
        }
    }

    return;
}

/**
 * 将表达式节点解析为 ms.xxx.yyy 形式的属性链
 * 遇到无法静态解析的计算属性（如 [npc_id]）时跳过该层级
 */
// =============================================================================
// 函数签名提取
// =============================================================================

function formatParam(node: acorn.Node): string {
    if (node.type === 'Identifier') {
        return (node as acorn.Identifier).name;
    }
    if (node.type === 'ObjectPattern') {
        const props = (node as acorn.ObjectPattern).properties.map(p => {
            if (p.type === 'Property') {
                const key = p.key;
                if (key.type === 'Identifier') { return key.name; }
                if (key.type === 'Literal' && typeof key.value === 'string') { return key.value; }
            }
            if (p.type === 'RestElement') {
                return '...' + formatParam(p.argument);
            }
            return '';
        }).filter(Boolean);
        return `{${props.join(', ')}}`;
    }
    if (node.type === 'ArrayPattern') {
        const elems = (node as acorn.ArrayPattern).elements.map(e => e ? formatParam(e) : '').filter(Boolean);
        return `[${elems.join(', ')}]`;
    }
    if (node.type === 'RestElement') {
        return '...' + formatParam((node as acorn.RestElement).argument);
    }
    if (node.type === 'AssignmentPattern') {
        return formatParam((node as acorn.AssignmentPattern).left) + ' = ...';
    }
    return '';
}

export function extractFunctionSignature(node: acorn.Node): { params: string[]; isArrow?: boolean } | undefined {
    let funcNode: acorn.Function | undefined;

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
        funcNode = node as acorn.Function;
    } else if (node.type === 'MethodDefinition') {
        funcNode = (node as acorn.MethodDefinition).value as acorn.FunctionExpression;
    } else if (node.type === 'Property') {
        const prop = node as acorn.Property;
        if (prop.value.type === 'FunctionExpression' || prop.value.type === 'ArrowFunctionExpression') {
            funcNode = prop.value as acorn.Function;
        }
    } else if (node.type === 'VariableDeclarator') {
        const decl = node as acorn.VariableDeclarator;
        if (decl.init && (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')) {
            funcNode = decl.init as acorn.Function;
        }
    } else if (node.type === 'ExpressionStatement') {
        const expr = (node as acorn.ExpressionStatement).expression;
        if (expr.type === 'AssignmentExpression' &&
            (expr.right.type === 'FunctionExpression' || expr.right.type === 'ArrowFunctionExpression')) {
            funcNode = expr.right as acorn.Function;
        }
    }

    if (!funcNode) {
        return;
    }

    const params = funcNode.params.map(formatParam);
    return { params, isArrow: funcNode.type === 'ArrowFunctionExpression' };
}

// =============================================================================
// 局部变量追踪
// =============================================================================

export function resolveExpressionToMsChain(node: acorn.Node): string[] | undefined {
    if (node.type !== 'MemberExpression') {
        return undefined;
    }

    const chain: string[] = [];
    let current: acorn.Node = node;

    while (current.type === 'MemberExpression') {
        const memberExpr = current as acorn.MemberExpression;
        const prop = memberExpr.property;

        if (!memberExpr.computed) {
            // obj.prop
            if (prop.type === 'Identifier') {
                chain.unshift(prop.name);
            } else {
                return undefined;
            }
        } else {
            // obj[expr]
            if (prop.type === 'Literal') {
                if (typeof prop.value === 'string') {
                    chain.unshift(prop.value);
                } else if (typeof prop.value === 'number') {
                    chain.unshift(String(prop.value));
                } else {
                    return undefined;
                }
            }
            // 非字面量计算属性（如 [npc_id]）→ 跳过，不加入链
        }

        current = memberExpr.object;
    }

    if (current.type === 'Identifier' && (current as acorn.Identifier).name === 'ms') {
        chain.unshift('ms');
        return chain;
    }

    return undefined;
}
