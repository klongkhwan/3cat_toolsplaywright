import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as cp from 'child_process';

export function activate(context: vscode.ExtensionContext) {
  console.log('Playwright Helper is now active!');

  // ===== Utils =====
  const isTestSpec = (file: string) => /\.(test|spec)\.(ts|js)$/.test(file);

  const ensurePlaywright = async (): Promise<boolean> => {
    return new Promise((resolve) => {
      cp.exec('npx playwright --version', (err) => resolve(!err));
    });
  };

  // ====== 1) Run current file ======
  const runCurrentFile = vscode.commands.registerCommand(
    'playwright-helper.runCurrentFile',
    (uri?: vscode.Uri) => {
      let filePath: string;

      if (uri) {
        // คลิกขวาจาก explorer
        filePath = uri.fsPath;
      } else {
        // รันจาก editor ที่เปิดอยู่
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          vscode.window.showErrorMessage('No active file to run');
          return;
        }
        filePath = activeEditor.document.fileName;
      }

      // เตือนถ้าไม่ใช่ไฟล์ test/spec (ยังรันได้ แต่เตือน)
      if (!filePath.includes('.test.') && !filePath.includes('.spec.')) {
        vscode.window.showWarningMessage("This doesn't appear to be a test file");
      }

      runPlaywrightTest(filePath);
    }
  );

  // ====== 2) Run current file with options ======
  const runCurrentFileWithOptions = vscode.commands.registerCommand(
    'playwright-helper.runCurrentFileWithOptions',
    async (uri?: vscode.Uri) => {
      let filePath: string;

      if (uri) {
        filePath = uri.fsPath;
      } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          vscode.window.showErrorMessage('No active file to run');
          return;
        }
        filePath = activeEditor.document.fileName;
      }

      const options = await vscode.window.showQuickPick(
        [
          { label: 'Run headless (normal)', value: '--headed=false' },
          { label: 'Run with headed browser', value: '--headed' },
          { label: 'Run loop 3 times', value: '--repeat-each=3 --workers=1' },
          { label: 'Run with debug', value: '--debug' },
          { label: 'Run with specific browser (chromium)', value: '--project=chromium' },
          { label: 'Run with UI mode', value: '--ui' }
        ],
        { placeHolder: 'Select run option' }
      );

      if (options) {
        runPlaywrightTest(filePath, options.value);
      }
    }
  );

  // ====== 3) Show report ======
  const showReport = vscode.commands.registerCommand('playwright-helper.showReport', () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const terminal = vscode.window.createTerminal('Playwright Report');
    terminal.sendText('npx playwright show-report');
    terminal.show();
  });

  // ====== 4) Record & Insert (เปิด browser เปล่า ๆ) ======
  const recordAndInsert = vscode.commands.registerCommand(
    'playwright-helper.recordAndInsert',
    async (uri?: vscode.Uri) => {
      try {
        // หาไฟล์เป้าหมาย
        const activeEditor = vscode.window.activeTextEditor;
        const targetUri = uri ?? activeEditor?.document.uri;
        if (!targetUri) {
          vscode.window.showErrorMessage('Open a .test.ts or .test.js file first.');
          return;
        }

        const filePath = targetUri.fsPath;
        if (!isTestSpec(filePath)) {
          vscode.window.showErrorMessage('This command is intended for *.test.ts/*.spec.ts (or js).');
          return;
        }

        // ให้แน่ใจว่า editor เปิดไฟล์นั้นอยู่
        let editor = activeEditor;
        if (!editor || editor.document.uri.fsPath !== filePath) {
          const doc = await vscode.workspace.openTextDocument(targetUri);
          editor = await vscode.window.showTextDocument(doc, { preview: false });
        }
        if (!editor) return;

        // เช็ค playwright
        if (!(await ensurePlaywright())) {
          const pick = await vscode.window.showWarningMessage(
            'Playwright not found. Install @playwright/test and browsers?',
            'Install now',
            'Cancel'
          );
          if (pick === 'Install now') {
            const term = vscode.window.createTerminal('Playwright Setup');
            term.show();
            term.sendText('npm i -D @playwright/test');
            term.sendText('npx playwright install');
          }
          return;
        }

        // เตรียมไฟล์ output ชั่วคราว
        const tmpFile = path.join(os.tmpdir(), `playrec-${Date.now()}.spec.ts`);

        // รัน codegen แบบไม่ใส่ URL (เปิด browser เปล่า ๆ)
        const args = [
          'playwright',
          'codegen',
          '--target=playwright-test',
          '--lang=ts',
          '--output',
          tmpFile
        ];

        vscode.window.showInformationMessage(
          'Recorder started. Interact with the opened browser, then close it to insert code.'
        );

        const child = cp.spawn('npx', args, {
          cwd: vscode.workspace.rootPath ?? undefined,
          shell: true
        });

        const exitCode: number = await new Promise((resolve) => {
          child.on('close', (code) => resolve(code ?? 0));
        });

        if (exitCode !== 0) {
          vscode.window.showErrorMessage(`Recorder exited with code ${exitCode}.`);
          return;
        }

        if (!existsSync(tmpFile)) {
          vscode.window.showErrorMessage('No recorded file produced.');
          return;
        }
        // อ่านโค้ดแล้วแทรกที่ตำแหน่งเคอร์เซอร์
        let recorded = await fs.readFile(tmpFile, 'utf8');

        // --- กรองส่วนหัวที่ไม่ต้องการออก ---
        // ลบ: import { test, expect } from '@playwright/test';
        recorded = recorded.replace(
          /^\s*import\s+\{\s*test\s*,\s*expect\s*\}\s+from\s+['"]@playwright\/test['"];?\s*\r?\n?/m,
          ''
        );

        // ลบ: test.use(...) (รองรับหลายบรรทัด)
        recorded = recorded.replace(
          /^\s*test\.use\(\s*[\s\S]*?\);\s*\r?\n?/m,
          ''
        );

        // ตัดช่องว่างหัวท้าย (กันบรรทัดว่าง)
        recorded = recorded.trim();

        // (ออปชัน) ครอบด้วย test.step ถ้าต้องการ
        // recorded = ["await test.step('Recorded', async ({ page }) => {", recorded, "});"].join('\n');

        await editor.edit((builder) => {
          const pos = editor!.selection.active;
          builder.insert(pos, `\n${recorded}\n`);
        });

// จัด format (ปิดไว้เพื่อไม่ให้เด้งเลือก formatter ถ้ายังไม่ตั้งค่า)
// try { await vscode.commands.executeCommand('editor.action.formatDocument'); } catch {}

        // จัด format เอกสาร (เงียบ ๆ ถ้าไม่มี formatter)
        try {
          // await vscode.commands.executeCommand('editor.action.formatDocument');
        } catch {}

        vscode.window.showInformationMessage('Inserted recorded Playwright code at cursor.');

        // ลบไฟล์ชั่วคราว
        try {
          await fs.unlink(tmpFile);
        } catch {}

      } catch (err: any) {
        console.error(err);
        vscode.window.showErrorMessage(`Error: ${err?.message ?? String(err)}`);
      }
    }
  );

  context.subscriptions.push(
    runCurrentFile,
    runCurrentFileWithOptions,
    showReport,
    recordAndInsert
  );
}

// ===== Helpers =====
function runPlaywrightTest(filePath: string, options: string = '') {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  // แปลง absolute path เป็น relative และ normalize สำหรับ Windows
  let relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
  relativePath = relativePath.replace(/\\/g, '/');

  const terminal = vscode.window.createTerminal('Playwright Test');
  const command = `npx playwright test ${relativePath} ${options}`.trim();
  terminal.sendText(command);
  terminal.show();

  vscode.window.showInformationMessage(`Running: ${command}`);
}

export function deactivate() {}
