"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function activate(context) {
    console.log('Playwright Helper is now active!');
    // คำสั่งสำหรับรันไฟล์ปัจจุบัน
    let runCurrentFile = vscode.commands.registerCommand('playwright-helper.runCurrentFile', (uri) => {
        let filePath;
        if (uri) {
            // คลิกขวาจาก explorer
            filePath = uri.fsPath;
        }
        else {
            // รันจาก editor ที่เปิดอยู่
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No active file to run');
                return;
            }
            filePath = activeEditor.document.fileName;
        }
        // ตรวจสอบว่าเป็นไฟล์ test หรือไม่
        if (!filePath.includes('.test.') && !filePath.includes('.spec.')) {
            vscode.window.showWarningMessage('This doesn\'t appear to be a test file');
        }
        runPlaywrightTest(filePath);
    });
    // คำสั่งสำหรับรันไฟล์พร้อมตัวเลือก
    let runCurrentFileWithOptions = vscode.commands.registerCommand('playwright-helper.runCurrentFileWithOptions', async (uri) => {
        let filePath;
        if (uri) {
            filePath = uri.fsPath;
        }
        else {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No active file to run');
                return;
            }
            filePath = activeEditor.document.fileName;
        }
        // แสดงตัวเลือกสำหรับรัน test
        const options = await vscode.window.showQuickPick([
            { label: 'Run headless (normal)', value: '--headed=false' },
            { label: 'Run with headed browser', value: '--headed' },
            { label: 'Run loop 3 times', value: '--repeat-each=3 --workers=1' },
            { label: 'Run with debug', value: '--debug' },
            { label: 'Run with specific browser', value: '--project=chromium' },
            { label: 'Run with UI mode', value: '--ui' }
        ], { placeHolder: 'Select run option' });
        if (options) {
            runPlaywrightTest(filePath, options.value);
        }
    });
    // คำสั่งสำหรับแสดง report
    let showReport = vscode.commands.registerCommand('playwright-helper.showReport', () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }
        const terminal = vscode.window.createTerminal('Playwright Report');
        terminal.sendText('npx playwright show-report');
        terminal.show();
    });
    context.subscriptions.push(runCurrentFile, runCurrentFileWithOptions, showReport);
}
function runPlaywrightTest(filePath, options = '') {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }
    // แปลง absolute path เป็น relative path และแปลง \ เป็น / สำหรับ Windows
    let relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
    relativePath = relativePath.replace(/\\/g, '/'); // แปลง Windows path separator
    // สร้าง terminal และรันคำสั่ง
    const terminal = vscode.window.createTerminal('Playwright Test');
    // สร้างคำสั่งพร้อมตัวเลือก
    const command = `npx playwright test ${relativePath} ${options}`.trim();
    terminal.sendText(command);
    terminal.show();
    vscode.window.showInformationMessage(`Running: ${command}`);
}
function deactivate() { }
