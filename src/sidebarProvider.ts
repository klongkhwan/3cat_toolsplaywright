import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as cp from 'child_process';

export class PlaywrightSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'playwright-helper-sidebar';
  private _view?: vscode.WebviewView;
  private _lastKnownEditor?: vscode.TextEditor;

  constructor(private readonly _extensionUri: vscode.Uri) {
    // Track the last active text editor so webview focus doesn't lose it
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) { this._lastKnownEditor = editor; }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Auto-load Projects Config and test files
    this._loadProjects().catch(() => { });
    this._scanTests().catch(() => { });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._loadProjects().catch(() => { });
        this._scanTests().catch(() => { });
      }
    });

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'runTest':
          vscode.commands.executeCommand('playwright-helper.runCurrentFile');
          break;
        case 'runTestWithOptions':
          vscode.commands.executeCommand('playwright-helper.runCurrentFileWithOptions');
          break;
        case 'runHeaded':
          {
            const options: string[] = [];
            if (msg.headedOption) { options.push(msg.headedOption); }
            if (msg.browsers && msg.browsers.length > 0) {
              msg.browsers.forEach((b: string) => options.push(`--project=${b}`));
            }
            this._runWithOption(options.join(' '));
          }
          break;
        case 'runDebug':
          this._runWithOption('--debug');
          break;
        case 'runUI':
          {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
              vscode.window.showErrorMessage('No workspace folder found');
              break;
            }
            const terminal = vscode.window.createTerminal('Playwright Test');
            const command = 'npx playwright test tests --ui';
            terminal.sendText(command);
            terminal.show();
            vscode.window.showInformationMessage(`Running: ${command}`);
          }
          break;
        case 'runProject':
          this._runWithOption(`--project=${msg.project}`);
          break;
        case 'showReport':
          vscode.commands.executeCommand('playwright-helper.showReport');
          break;
        case 'recordCode':
          vscode.commands.executeCommand('playwright-helper.recordAndInsert');
          break;
        case 'pickLocator':
          this._pickLocator();
          break;
        case 'recordNew':
          this._recordNewTest();
          break;
        case 'recordAtCursor':
          vscode.commands.executeCommand('playwright-helper.recordAndInsert');
          break;
        case 'insertSnippet':
          this._insertSnippet(msg.snippet);
          break;
        case 'openConfig':
          this._openPlaywrightConfig();
          break;
        case 'loadProjects':
          this._loadProjects().catch(() => { });
          break;
        case 'installPlaywright':
          this._installPlaywright();
          break;
        case 'scanTests':
          this._scanTests();
          break;
        case 'runSelectedTests':
          this._runSelectedTests(msg.files || [], msg.option || '');
          break;
        case 'openFile':
          if (msg.filePath) {
            const uri = vscode.Uri.file(msg.filePath);
            vscode.workspace.openTextDocument(uri).then(doc => vscode.window.showTextDocument(doc));
          }
          break;
        case 'installNpm':
          this._installNpm();
          break;
        case 'runUnified':
          this._runUnified(msg);
          break;
      }
    });
  }

  private _runWithOption(option: string) {
    // Use _lastKnownEditor as fallback when webview has stolen focus
    const activeEditor = vscode.window.activeTextEditor ?? this._lastKnownEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage('No active file to run. Please click on a test file in the editor first.');
      return;
    }
    const filePath = activeEditor.document.fileName;
    if (!filePath.includes('.test.') && !filePath.includes('.spec.')) {
      vscode.window.showWarningMessage("This doesn't appear to be a test file");
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }
    let relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
    relativePath = relativePath.replace(/\\/g, '/');
    const terminal = vscode.window.createTerminal('Playwright Test');
    const command = `npx playwright test ${relativePath} ${option}`.trim();
    terminal.sendText(command);
    terminal.show();
    vscode.window.showInformationMessage(`Running: ${command}`);
  }

  private _insertSnippet(snippetName: string) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage('Open a file first');
      return;
    }

    const snippets: Record<string, string> = {
      '3ctest': "test('${1:test description}', async ({ page }) => {\n  const loginPage = new LoginPage(page, 'dev');\n  await loginPage.fulllogin();\n  $0\n});",
      '3capiresponse': 'await page.waitForResponse(res => res.url().includes("/apipath") && res.ok());',
      '3cfulltest': "import { test, expect } from '@playwright/test';\n\ntest.describe('${1:SuiteName}', () => {\n  test.beforeEach(async ({ page }) => {\n    await page.goto('${2:https://example.com}');\n  });\n\n  test.afterEach(async ({ page }) => {\n    await page.evaluate(() => localStorage.clear());\n  });\n\n  test('${3:should do something}', async ({ page }) => {\n    await test.step('${4:step description}', async () => {\n      $0\n    });\n  });\n});",
      '3cpomodel': "export class ${1:PageName} {\n  readonly page: Page;\n  readonly ${2:elementName}: Locator;\n\n  constructor(page: Page) {\n    this.page = page;\n    this.${2:elementName} = page.locator('${3:selector}');\n  }\n\n  async ${4:methodName}() {\n    $0\n  }\n}",
      '3cexpect': "await expect(${1:locator}).${2|toBeVisible,toHaveText,toHaveValue,toBeChecked,toBeDisabled,toBeEnabled|}(${3:''});",
      '3cexport': "export async function ${1:input_date}(page: Page, ${2:inputDate}: string) {\n     await page.keyboard.type(${2:inputDate});\n}",
    };

    const snippet = snippets[snippetName];
    if (!snippet) { return; }

    activeEditor.insertSnippet(new vscode.SnippetString(snippet));
    vscode.window.showInformationMessage(`Inserted "${snippetName}" snippet`);
  }

  private async _openPlaywrightConfig() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const configFiles = [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mts',
    ];

    for (const file of configFiles) {
      const uri = vscode.Uri.joinPath(workspaceFolder.uri, file);
      try {
        await vscode.workspace.fs.stat(uri);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        return;
      } catch { }
    }

    vscode.window.showInformationMessage('No playwright.config file found. Create one?');
  }

  private async _loadProjects() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) { return; }

      const configFiles = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts'];
      let configContent: string | undefined;

      for (const file of configFiles) {
        const uri = vscode.Uri.joinPath(workspaceFolder.uri, file);
        try {
          const buf = await vscode.workspace.fs.readFile(uri);
          configContent = new TextDecoder().decode(buf);
          break;
        } catch { }
      }

      if (!configContent) {
        this._postMessage({ command: 'projectsLoaded', projects: [] });
        return;
      }

      // Extract project names from config
      const projectNames: string[] = [];

      // Match string literal names: name: 'xxx' or name: "xxx"
      const nameRegex = /name\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = nameRegex.exec(configContent)) !== null) {
        projectNames.push(match[1]);
      }

      // Match variable names used as project name: name: browserName
      const varNameRegex = /name\s*:\s*([a-zA-Z_$][\w$]*)/g;
      while ((match = varNameRegex.exec(configContent)) !== null) {
        const varRef = match[1];
        if (!projectNames.includes(varRef)) {
          const forOfRegex = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${varRef}\\s+of\\s*\\[([^\\]]+)\\]`);
          const forMatch = forOfRegex.exec(configContent);
          if (forMatch) {
            const items = forMatch[1].match(/['"]([^'"]+)['"]/g);
            if (items) {
              items.forEach((item: string) => {
                const name = item.replace(/['"]/g, '');
                if (!projectNames.includes(name)) {
                  projectNames.push(name);
                }
              });
            }
          }
        }
      }

      this._postMessage({ command: 'projectsLoaded', projects: projectNames });
    } catch (err) {
      this._postMessage({ command: 'projectsLoaded', projects: [] });
    }
  }

  private _postMessage(msg: object) {
    this._view?.webview.postMessage(msg);
  }

  private _installPlaywright() {
    const term = vscode.window.createTerminal('Playwright Setup');
    term.show();
    term.sendText('npm i -D @playwright/test');
    term.sendText('npx playwright install');
  }

  private _installNpm() {
    const term = vscode.window.createTerminal('NPM Install');
    term.show();
    term.sendText('npm ci');
  }

  private _runUnified(msg: { files?: string[], projects?: string[], headedOption?: string, browsers?: string[], testTitle?: string, testLine?: number | string }) {
    const args: string[] = ['playwright', 'test'];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    // Selected test files
    const files = msg.files || [];
    if (files.length > 0) {
      files.forEach(f => {
        let rel = path.relative(workspaceFolder.uri.fsPath, f);
        rel = rel.replace(/\\/g, '/');
        // If targeting a single subtest by line
        if (msg.testLine && files.length === 1) {
          rel = `${rel}:${msg.testLine}`;
        }
        args.push(rel);
      });
    }

    // Config projects
    const projects = msg.projects || [];
    projects.forEach(p => args.push(`--project=${p}`));

    // Browser projects (only if no config projects selected)
    const browsers = msg.browsers || [];
    if (projects.length === 0 && browsers.length > 0) {
      browsers.forEach(b => args.push(`--project=${b}`));
    }

    // Headed / Headless
    if (msg.headedOption) {
      args.push(msg.headedOption);
    }

    // If we have testTitle but NO testLine, fallback to grep
    if (msg.testTitle && !msg.testLine) {
      const escapedTitle = msg.testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      args.push('-g', `^${escapedTitle}$`);
    }

    // Force reporters
    args.push('--reporter=line,json,html');

    const reportFile = path.join(os.tmpdir(), `3cat-report-${Date.now()}.json`);
    const options: vscode.ShellExecutionOptions = {
      cwd: workspaceFolder.uri.fsPath,
      env: {
        'PLAYWRIGHT_JSON_OUTPUT_NAME': reportFile
      }
    };

    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const execution = new vscode.ProcessExecution(npx, args, options);
    const task = new vscode.Task(
      { type: 'playwright-test', command: 'test' },
      workspaceFolder,
      'Playwright Test',
      '3CAT',
      execution
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
      clear: true,
      focus: false
    };

    vscode.tasks.executeTask(task).then(taskExecution => {
      const modeLabel = msg.headedOption ? ' (headed)' : ' (headless)';
      vscode.window.showInformationMessage(`Running${modeLabel}: ${args.join(' ')}`);

      const disposable = vscode.tasks.onDidEndTaskProcess(async (e) => {
        if (e.execution === taskExecution) {
          disposable.dispose();
          try {
            if (existsSync(reportFile)) {
              const data = await fs.readFile(reportFile, 'utf8');
              const report = JSON.parse(data);

              const results: Record<string, { status: string, duration: number, subTests?: Record<string, { status: string }> }> = {};
              let totalDuration = 0;
              let passCount = 0;
              let failCount = 0;

              if (report.suites) {
                for (const suite of report.suites) {
                  let fileDuration = 0;
                  let fileFailed = false;
                  let fileSubTests: any = {};
                  let hasTests = false;

                  const processSuite = (s: any, parentTitle: string, isFirst: boolean) => {
                    const fullSuiteTitle = isFirst ? '' : (parentTitle ? parentTitle + ' ' + s.title : s.title);
                    if (s.specs) {
                      hasTests = true;
                      s.specs.forEach((spec: any) => {
                        if (!spec.ok) fileFailed = true;
                        if (spec.tests) {
                          spec.tests.forEach((t: any) => {
                            if (t.results) {
                              t.results.forEach((r: any) => {
                                fileDuration += r.duration || 0;
                              });
                            }
                          });
                        }
                        const fullTitle = fullSuiteTitle ? `${fullSuiteTitle.trim()} ${spec.title}` : spec.title;
                        fileSubTests[fullTitle.trim()] = { status: spec.ok ? 'passed' : 'failed' };
                      });
                    }
                    if (s.suites) s.suites.forEach((childSuite: any) => processSuite(childSuite, fullSuiteTitle, false));
                  };

                  processSuite(suite, '', true);

                  if (hasTests && suite.file) {
                    let absPath = path.resolve(workspaceFolder.uri.fsPath, suite.file);
                    // Check if file exists, if not try to find it in the workspace (Playwright might report relative to testDir)
                    if (!existsSync(absPath)) {
                      const allFiles = await vscode.workspace.findFiles('**/' + suite.file, '**/node_modules/**');
                      if (allFiles.length > 0) {
                        absPath = allFiles[0].fsPath;
                      }
                    }
                    let rel = this._normalizeRel(workspaceFolder.uri.fsPath, absPath);
                    results[rel] = {
                      status: fileFailed ? 'failed' : 'passed',
                      duration: fileDuration,
                      subTests: fileSubTests
                    };
                    totalDuration += fileDuration;
                    if (fileFailed) failCount++; else passCount++;
                  }
                }
              }

              this._postMessage({
                command: 'testResults',
                results,
                stats: { totalDuration, passCount, failCount }
              });
              try { await fs.unlink(reportFile); } catch { }
            } else {
              this._postMessage({ command: 'testResults', results: {} });
            }
          } catch (err) {
            console.error('Error reading test report:', err);
            this._postMessage({ command: 'testResults', results: {} });
          }
        }
      });
    });
  }

  private async _pickLocator() {
    const url = await vscode.window.showInputBox({
      prompt: 'Enter URL to pick locator from',
      placeHolder: 'https://example.com',
      title: 'Pick Locator'
    });
    if (!url) { return; }

    const tmpFile = path.join(os.tmpdir(), `playloc-${Date.now()}.ts`);

    const args = [
      'playwright', 'codegen',
      '--target=javascript',
      '--output', tmpFile,
      url
    ];

    vscode.window.showInformationMessage('Pick Locator: Click elements in the browser. Close when done.');

    const child = cp.spawn('npx', args, {
      cwd: vscode.workspace.rootPath ?? undefined,
      shell: true
    });

    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code: number | null) => resolve(code ?? 0));
    });

    if (exitCode !== 0) {
      vscode.window.showErrorMessage(`Picker exited with code ${exitCode}.`);
      return;
    }

    try {
      const content = await fs.readFile(tmpFile, 'utf8');
      // Extract locator lines (page.locator, page.getBy*, etc.)
      const locatorLines = content.split('\n').filter(
        (line: string) => /(?:page\.(?:locator|getBy|frameLocator)|locator\()/.test(line)
      );

      if (locatorLines.length === 0) {
        vscode.window.showWarningMessage('No locators found. Try clicking elements in the browser.');
        return;
      }

      // Show quick pick to select which locator
      const items: vscode.QuickPickItem[] = locatorLines.map((line: string) => ({
        label: line.trim(),
        description: 'locator'
      }));
      // Store locator strings for lookup
      const locatorMap: Record<string, string> = {};
      locatorLines.forEach((line: string) => { locatorMap[line.trim()] = line.trim(); });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a locator to insert',
        title: 'Pick Locator'
      });

      if (selected) {
        const locatorStr = locatorMap[selected.label] ?? selected.label;
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const pos = activeEditor.selection.active;
          await activeEditor.edit((builder) => {
            builder.insert(pos, `\n${locatorStr}\n`);
          });
          vscode.window.showInformationMessage('Inserted locator at cursor.');
        } else {
          vscode.window.showInformationMessage(`Locator: ${locatorStr}`);
        }
      }

      try { await fs.unlink(tmpFile); } catch { }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error: ${err?.message ?? String(err)}`);
    }
  }

  private async _recordNewTest() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const testName = await vscode.window.showInputBox({
      prompt: 'Enter test file name',
      placeHolder: 'my-test',
      title: 'Record New Test'
    });
    if (!testName) { return; }

    const fileName = testName.endsWith('.spec.ts') || testName.endsWith('.test.ts')
      ? testName
      : `${testName}.spec.ts`;

    const filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
    const tmpFile = path.join(os.tmpdir(), `playrec-new-${Date.now()}.spec.ts`);

    // เปิด browser เปล่า ๆ ไม่ต้องถาม URL
    const args = [
      'playwright', 'codegen',
      '--target=playwright-test',
      '--lang=ts',
      '--output', tmpFile
    ];

    vscode.window.showInformationMessage('Recording new test. Interact with the browser, then close it.');

    const child = cp.spawn('npx', args, {
      cwd: vscode.workspace.rootPath ?? undefined,
      shell: true
    });

    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code: number | null) => resolve(code ?? 0));
    });

    if (exitCode !== 0) {
      vscode.window.showErrorMessage(`Recorder exited with code ${exitCode}.`);
      return;
    }

    if (!existsSync(tmpFile)) {
      vscode.window.showErrorMessage('No recorded file produced.');
      return;
    }

    let recorded = await fs.readFile(tmpFile, 'utf8');
    recorded = recorded.trim();

    // Write to new file
    await fs.writeFile(filePath.fsPath, recorded, 'utf8');

    // Open the new file
    const doc = await vscode.workspace.openTextDocument(filePath.fsPath);
    await vscode.window.showTextDocument(doc);

    // Scan tests to update UI
    await this._scanTests();
  }

  private async _scanTests() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) { return; }
      const rootPath = workspaceFolder.uri.fsPath;

      // 1. Initial discovery using findFiles to ensure all files (even empty ones) are found
      const globFiles = await vscode.workspace.findFiles(
        '**/*.{test,spec}.{ts,js}',
        '**/node_modules/**'
      );

      const filesMap = new Map<string, any>();
      for (const f of globFiles) {
        const absPath = f.fsPath;
        const rel = this._normalizeRel(rootPath, absPath);
        filesMap.set(rel.toLowerCase(), { absolute: absPath, relative: rel, subTests: [] });
      }

      const tmpFile = path.join(os.tmpdir(), `play-list-${Date.now()}.json`);
      const command = `npx playwright test --list --reporter=json`;

      const options: cp.ExecOptions = {
        cwd: rootPath,
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: tmpFile }
      };

      try {
        await new Promise<void>((resolve) => {
          cp.exec(command, options, () => resolve());
        });

        if (existsSync(tmpFile)) {
          const data = await fs.readFile(tmpFile, 'utf8');
          const report = JSON.parse(data);
          const allProjectsSet = new Set<string>();

          if (report.suites) {
            const processSuite = (suite: any) => {
              if (suite.file) {
                let absPath = path.resolve(rootPath, suite.file);
                // Robust matching for files that might be reported relative to a testDir
                if (!existsSync(absPath)) {
                  for (const entry of filesMap.values()) {
                    if (entry.relative.endsWith(suite.file.replace(/\\/g, '/'))) {
                      absPath = entry.absolute;
                      break;
                    }
                  }
                }

                const rel = this._normalizeRel(rootPath, absPath);
                const relLower = rel.toLowerCase();

                if (!filesMap.has(relLower)) {
                  filesMap.set(relLower, { absolute: absPath, relative: rel, subTests: [] });
                }
                const fileEntry = filesMap.get(relLower);

                const extractSpecs = (s: any, parentTitle: string = '', isRoot: boolean = false) => {
                  const fullSuiteTitle = isRoot ? '' : (parentTitle ? `${parentTitle} ${s.title}` : s.title);
                  if (s.specs) {
                    s.specs.forEach((spec: any) => {
                      const fullTitle = fullSuiteTitle ? `${fullSuiteTitle.trim()} ${spec.title}` : spec.title;
                      const tagRegex = /(@\w+)/g;
                      const tags = fullTitle.match(tagRegex) || [];
                      const cleanTitle = fullTitle.replace(tagRegex, '').trim();

                      const projects = (spec.tests || []).map((t: any) => {
                        if (t.projectName) allProjectsSet.add(t.projectName);
                        return t.projectName;
                      });
                      fileEntry.subTests.push({
                        title: cleanTitle,
                        fullTitle: fullTitle.trim(),
                        tags,
                        projects,
                        line: spec.line
                      });
                    });
                  }
                  if (s.suites) s.suites.forEach((childSuite: any) => extractSpecs(childSuite, fullSuiteTitle, false));
                };
                extractSpecs(suite, '', true);
              } else if (suite.suites) {
                suite.suites.forEach(processSuite);
              }
            };
            report.suites.forEach(processSuite);
          }

          const testFiles = Array.from(filesMap.values()).sort((a, b) => a.relative.localeCompare(b.relative));
          const allProjects = Array.from(allProjectsSet).sort();
          this._postMessage({ command: 'testsScanned', files: testFiles, allProjects });
          try { await fs.unlink(tmpFile); } catch { }
          return;
        }
      } catch (err) {
        // Playwright failed, but we already have filesMap from findFiles
      }

      const testFiles = Array.from(filesMap.values()).sort((a, b) => a.relative.localeCompare(b.relative));
      this._postMessage({ command: 'testsScanned', files: testFiles, allProjects: [] });
    } catch (err) {
      console.error('Scan error:', err);
    }
  }

  private _runSelectedTests(files: string[], option: string) {
    if (files.length === 0) {
      vscode.window.showWarningMessage('No tests selected');
      return;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return; }
    const root = workspaceFolder.uri.fsPath;
    const relativePaths = files.map(f => path.relative(root, f).replace(/\\/g, '/'));
    const terminal = vscode.window.createTerminal('Playwright Test');
    const cmd = 'npx playwright test ' + relativePaths.join(' ') + (option ? ' ' + option : '');
    terminal.sendText(cmd);
    terminal.show();
    vscode.window.showInformationMessage('Running ' + files.length + ' test(s)');
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Generate a nonce to allow only specific scripts (required by VS Code CSP)
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3CAT Helper</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --bg-card: var(--vscode-editor-background);
      --fg: var(--vscode-foreground);
      --fg2: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, rgba(255,255,255,0.08));
      --accent: #7c3aed;
      --accent2: #6366f1;
      --accent-glow: rgba(124,58,237,0.25);
      --btn-bg: var(--vscode-input-background);
      --btn-fg: var(--vscode-input-foreground);
      --btn-border: var(--vscode-input-border, rgba(255,255,255,0.1));
      --hover: rgba(179, 142, 243, 0.08);
      --radius: 8px;
      --radius-sm: 5px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    *:focus { outline: none !important; }
    *:focus-visible { outline: 2px solid var(--accent) !important; outline-offset: 1px; }
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--fg); background: var(--bg); padding: 0; overflow-x: hidden; }
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(124,58,237,0.3); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,0.5); }

    /* Header */
    .header { background: linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #3b82f6 100%); padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
    .header-logo { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: 1px; text-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .header-sub { font-size: 10px; color: rgba(255,255,255,0.7); margin-left: auto; background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 10px; }

    /* Sections */
    .content { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: border-color 0.2s; }
    .card.collapsed:hover { border-color: var(--accent); }
    .card-head { display: flex; align-items: center; gap: 7px; padding: 9px 12px; cursor: pointer; user-select: none; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--fg2); transition: background 0.15s; }
    .card-head:hover { background: var(--hover); }
    .card-head .ic { font-size: 13px; width: 18px; text-align: center; }
    .card-head .arr { margin-left: auto; font-size: 9px; transition: transform 0.2s; color: var(--fg2); }
    .card-head.collapsed .arr { transform: rotate(-90deg); }
    .card-body { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 5px; }
    .card-body.hidden { display: none; }

    /* Buttons */
    .btn { display: flex; align-items: center; gap: 7px; padding: 7px 11px; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 11.5px; font-family: inherit; text-align: left; width: 100%; transition: all 0.15s; }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); border: 1px solid var(--btn-border); font-weight: 600; }
    .btn-primary:hover { border-color: var(--accent); background: var(--hover); }
    .btn-ghost { background: var(--btn-bg); color: var(--btn-fg); border: 1px solid var(--btn-border); }
    .btn-ghost:hover { border-color: var(--accent); background: var(--hover); }
    .btn .ic { width: 16px; text-align: center; flex-shrink: 0; }
    .btn-row { display: flex; gap: 4px; }
    .btn-row .btn { flex: 1; justify-content: center; padding: 6px 4px; font-size: 11px; }

    /* Divider & Label */
    .sep { height: 1px; background: var(--border); margin: 5px 0; }
    .lbl { font-size: 10px; color: var(--fg2); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 3px; }

    /* Radio Group */
    .radio-group { display: flex; gap: 4px; }
    .radio-opt { display: flex; align-items: center; gap: 5px; padding: 6px 10px; border: 1px solid var(--btn-border); border-radius: var(--radius-sm); background: var(--btn-bg); color: var(--btn-fg); cursor: pointer; font-size: 11px; flex: 1; justify-content: center; transition: all 0.15s; user-select: none; }
    .radio-opt:hover { border-color: var(--accent); }
    .radio-opt.active { border-color: var(--accent); color: var(--fg); font-weight: 600; }
    .radio-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--btn-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; }
    .radio-opt.active .radio-dot { border-color: var(--accent); }
    .radio-dot-inner { width: 6px; height: 6px; border-radius: 50%; background: transparent; transition: background 0.15s; }
    .radio-opt.active .radio-dot-inner { background: var(--accent); }

    /* Browser Multi-Select List */
    .browser-list { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: rgba(0,0,0,0.1); }
    .browser-item { display: flex; align-items: center; gap: 7px; padding: 5px 8px; cursor: pointer; transition: background 0.12s; font-size: 11px; }
    .browser-item:hover { background: var(--hover); }
    .browser-item.selected { background: rgba(124,58,237,0.1); }
    .browser-cb { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid var(--btn-border); background: var(--btn-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; font-size: 9px; color: transparent; }
    .browser-item.selected .browser-cb { background: var(--accent); border-color: var(--accent); color: #fff; }

    /* Select & Input */
    select { width: 100%; padding: 5px 8px; border: 1px solid var(--btn-border); border-radius: var(--radius-sm); background: var(--btn-bg); color: var(--btn-fg); font-family: inherit; font-size: 11px; transition: border-color 0.15s; }
    select:focus-visible { border-color: var(--accent); }
    .search-input { width: 100%; padding: 6px 8px; border: 1px solid var(--btn-border); border-radius: var(--radius-sm); background: rgba(0,0,0,0.2); color: var(--fg); font-family: inherit; font-size: 11px; transition: border-color 0.15s; margin-bottom: 6px; }
    .search-input:focus-visible { border-color: var(--accent); }
    .search-input::placeholder { color: var(--fg2); }

    /* Snippet Grid */
    .snip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .snip-grid .btn { font-size: 10px; padding: 6px 4px; justify-content: center; text-align: center; line-height: 1.2; height: 100%; min-height: 32px; }
    .snip-grid .btn:hover { border-color: var(--accent); background: var(--hover); }


    /* Project Multi-Select List */
    .proj-list { display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); background: rgba(0,0,0,0.1); }
    .proj-item { display: flex; align-items: center; gap: 7px; padding: 5px 8px; cursor: pointer; transition: background 0.12s; font-size: 11px; }
    .proj-item:hover { background: var(--hover); }
    .proj-item.selected { background: rgba(124,58,237,0.1); }
    .proj-cb { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid var(--btn-border); background: var(--btn-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; font-size: 9px; color: transparent; }
    .proj-item.selected .proj-cb { background: var(--accent); border-color: var(--accent); color: #fff; }
    .proj-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .proj-run-bar { display: flex; gap: 4px; margin-top: 4px; }
    .proj-run-bar .btn { flex: 1; }
    .proj-badge { background: rgba(124,58,237,0.2); color: var(--accent); padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; margin-left: 4px; }
    .proj-empty { padding: 12px; text-align: center; color: var(--fg2); font-size: 11px; }
    .proj-toolbar { display: flex; gap: 4px; margin-bottom: 4px; align-items: center; }
    .proj-toolbar .lbl { flex: 1; margin: 0; }
    .proj-toolbar .btn { flex: none; padding: 4px 8px; font-size: 10px; }

    /* Test Explorer */
    .test-toolbar { display: flex; gap: 4px; margin-bottom: 4px; align-items: center; }
    .test-toolbar .lbl { flex: 1; margin: 0; }
    .test-toolbar .btn { flex: none; padding: 4px 8px; font-size: 10px; }
    .test-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 0px; }
    .test-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; cursor: pointer; transition: background 0.12s; font-size: 13px; }
    .test-item.selected { background: rgba(124,58,237,0.1); }
    .test-item:hover, .test-folder:hover, .test-sub-item:hover { background: rgba(179, 142, 243, 0.08); }
    .test-cb { display: none; }
    .test-item.selected .test-cb { background: var(--accent); border-color: var(--accent); color: #fff; }
    .test-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .test-empty { padding: 16px; text-align: center; color: var(--fg2); font-size: 13px; }
    .test-tag { font-size: 9px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; padding: 0 4px; border-radius: 4px; margin-left: 5px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(245, 158, 11, 0.2); height: 14px; line-height: 1; vertical-align: middle; }
    .test-tag:nth-of-type(2n) { background: rgba(16, 185, 129, 0.15); color: #10b981; border-color: rgba(16, 185, 129, 0.2); }
    .test-tag:nth-of-type(3n) { background: rgba(59, 130, 246, 0.15); color: #3b82f6; border-color: rgba(59, 130, 246, 0.2); }
    .test-folder { display: flex; align-items: center; gap: 8px; padding: 4px 6px; cursor: pointer; font-size: 13px; color: var(--fg); user-select: none; }
    .test-folder .folder-arrow, .test-item .file-arrow { font-size: 10px; transition: transform 0.15s; width: 12px; text-align: center; }
    .file-arrow-spacer { width: 12px; display: inline-block; }
    .test-folder.collapsed .folder-arrow, .test-item.collapsed .file-arrow { transform: rotate(-90deg); }
    .test-folder-group.collapsed > .test-folder-children, .test-item-group.collapsed > .test-item-children { display: none; }
    .test-item-children { }
    .run-bar { display: flex; gap: 4px; margin-top: 6px; }
    .run-bar .btn { flex: 1; }
    .badge { background: rgba(124,58,237,0.2); color: var(--accent); padding: 1px 6px; border-radius: 8px; font-size: 11px; font-weight: 600; margin-left: 4px; }
    .btn-center { justify-content: center; text-align: center; }
    .btn-run-main { font-size: 13px !important; padding: 8px 12px !important; font-weight: 700 !important; letter-spacing: 0.5px; }

    /* Hover Actions */
    .test-item .hover-actions, .test-folder .hover-actions, .test-sub-item .hover-actions { display: flex; opacity: 0; margin-left: auto; gap: 4px; align-items: center; pointer-events: none; }
    .test-item:hover .hover-actions, .test-folder:hover .hover-actions, .test-sub-item:hover .hover-actions { opacity: 1; pointer-events: auto; }
    .hover-btn { font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 3px; opacity: 0.7; transition: all 0.15s; border: 1px solid transparent; background: rgba(0,0,0,0.1); color: var(--fg); }
    .hover-btn:hover { opacity: 1; background: var(--hover); border: 1px solid var(--border); color: var(--accent); }
    .test-time, .folder-time { font-size: 11px; color: var(--fg2); margin-left: 4px; }
    .test-status, .folder-status { font-size: 13px; display: inline-flex; align-items: center; justify-content: center; width: 14px; margin-right: 2px; }
    
    /* Animations */
    @keyframes spin { 100% { transform: rotate(360deg); } }
    .spinner { display: inline-block; width: 10px; height: 10px; border: 2px solid rgba(124,58,237,0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; }

    /* Header Stats */
    .test-header-stats { display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.1); padding: 6px 8px; border-radius: var(--radius-sm); margin-bottom: 6px; border: 1px solid var(--border); }
    .stat-text { font-size: 11px; font-weight: 600; color: var(--fg); }
    .stat-time { font-size: 10px; color: var(--fg2); }

    /* Footer */
    .footer { margin: 6px 8px; padding: 6px; border-radius: var(--radius-sm); background: var(--bg-card); border: 1px solid var(--border); text-align: center; font-size: 10px; color: var(--fg2); }
  </style>
</head>
<body>



  <div class="content">

    <!-- Test Explorer -->
    <div class="card">
      <div class="card-head" data-toggle="section">
        <span class="ic">&#128269;</span><span>Test Explorer</span><span id="headerStatus" style="margin-left: 8px;"></span><span class="arr">&#9660;</span>
      </div>
      <div class="card-body">
        <input type="text" id="testFilter" class="search-input" placeholder="Filter (e.g. text, !exclude, @tag)">
        <div class="test-header-stats" style="display: none;" id="testHeaderStats">
          <div class="stat-text" id="statTests">Tests: 0/0</div>
          <div class="stat-time" id="statTime">0.0s</div>
          <button class="btn btn-ghost" id="btnRerunLast" style="padding: 2px 6px; font-size: 10px; flex: none; width: auto;"><span class="ic">&#8635;</span> Rerun</button>
        </div>
        <div class="test-list" id="testFileList">
          <div class="test-empty">Loading...</div>
        </div>
        <div class="sep"></div>
        <span class="lbl">Projects Config</span>
        <div class="proj-list" id="projectConfigList">
          <div class="proj-empty">Loading...</div>
        </div>
        <div class="sep"></div>
        <div class="radio-group">
          <div class="radio-opt" data-headed="--headed" id="radioHeaded">
            <div class="radio-dot"><div class="radio-dot-inner"></div></div>
            &#128421; Headed
          </div>
          <div class="radio-opt" data-headed="" id="radioHeadless">
            <div class="radio-dot"><div class="radio-dot-inner"></div></div>
            &#128683; Headless
          </div>
        </div>
        <span class="lbl" style="display: none;">Browser Project</span>
        <div class="browser-list" id="browserList" style="display: none;">
          <div class="browser-item" data-browser="chromium">
            <div class="browser-cb">&#10003;</div>
            <span>Chromium</span>
          </div>
          <div class="browser-item" data-browser="firefox">
            <div class="browser-cb">&#10003;</div>
            <span>Firefox</span>
          </div>
          <div class="browser-item" data-browser="webkit">
            <div class="browser-cb">&#10003;</div>
            <span>WebKit</span>
          </div>
        </div>
        <div class="sep"></div>
        <button class="btn btn-ghost" data-cmd="runTest"><span class="ic">&#9654;</span> Run Current File</button>
        <button class="btn btn-ghost" data-cmd="runUI"><span class="ic">&#127912;</span> Run UI Mode</button>
        <button class="btn btn-ghost" data-cmd="runTestWithOptions"><span class="ic">&#9881;</span> Run with Options...</button>
        <button class="btn btn-ghost" data-cmd="showReport"><span class="ic">&#128202;</span> Show Report</button>
      </div>
    </div>

    <!-- Tools -->
    <div class="card collapsed">
      <div class="card-head collapsed" data-toggle="section">
        <span class="ic">&#128295;</span><span>Recording Tools</span><span class="arr">&#9660;</span>
      </div>
      <div class="card-body hidden">
        <button class="btn btn-ghost" data-cmd="recordNew"><span class="ic">&#127916;</span> Record New Test</button>
        <button class="btn btn-ghost" data-cmd="recordAtCursor"><span class="ic">&#128221;</span> Record at Cursor</button>
        <button class="btn btn-ghost" data-cmd="pickLocator"><span class="ic">&#127919;</span> Pick Locator</button>
      </div>
    </div>

    <!-- Snippets -->
    <div class="card collapsed">
      <div class="card-head collapsed" data-toggle="section">
        <span class="ic">&#128203;</span><span>Code Snippets</span><span class="arr">&#9660;</span>
      </div>
      <div class="card-body hidden">
        <span class="lbl">Insert at cursor</span>
        <div class="snip-grid">
          <button class="btn btn-ghost" data-snippet="3ctest">Playwright Test</button>
          <button class="btn btn-ghost" data-snippet="3capiresponse">Check API Response</button>
          <button class="btn btn-ghost" data-snippet="3cfulltest">Full script Test</button>
          <button class="btn btn-ghost" data-snippet="3cpomodel">Page Object Model</button>
          <button class="btn btn-ghost" data-snippet="3cexpect">Expect</button>
          <button class="btn btn-ghost" data-snippet="3cexport">Export Function</button>
        </div>
      </div>
    </div>

    <!-- Settings -->
    <div class="card collapsed">
      <div class="card-head collapsed" data-toggle="section">
        <span class="ic">&#9881;</span><span>Settings</span><span class="arr">&#9660;</span>
      </div>
      <div class="card-body hidden">
        <button class="btn btn-ghost" data-cmd="openConfig" style="font-size:10px;opacity:0.8"><span class="ic">&#9881;</span> playwright.config</button>
        <div class="sep"></div>
        <button class="btn btn-ghost" data-cmd="installNpm" style="font-size:10px"><span class="ic">&#128230;</span> Install Npm (npm ci)</button>
        <button class="btn btn-ghost" data-cmd="installPlaywright" style="font-size:10px"><span class="ic">&#128230;</span> Install Playwright</button>
      </div>
    </div>

  </div>

  <div class="footer">3CAT Helper v3.0.0</div>

  <script nonce="${nonce}">
    var vscode = acquireVsCodeApi();
    var selectedTests = {};

    function updateCount() {
      var keys = Object.keys(selectedTests);
      var n = 0;
      for (var i = 0; i < keys.length; i++) { if (selectedTests[keys[i]]) n++; }
      var el = document.getElementById('selCount');
      if (el) el.textContent = String(n);
      return n;
    }

    function getSelectedFiles() {
      var result = [];
      var keys = Object.keys(selectedTests);
      for (var i = 0; i < keys.length; i++) {
        if (selectedTests[keys[i]]) result.push(keys[i]);
      }
      return result;
    }

    function runSelectedWithOption(opt) {
      var files = getSelectedFiles();
      if (files.length === 0) { return; }
      vscode.postMessage({ command: 'runSelectedTests', files: files, option: opt });
    }

    // Accessibility & Focus Management
    document.addEventListener('mousedown', function(e) {
      // Prevent focus rings on mouse click
      const t = e.target;
      if (t && t.blur && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        setTimeout(() => t.blur(), 0);
      }
    });

    // Event Delegation
    document.addEventListener('click', function(e) {
      var t = e.target;
      var header = t.closest('[data-toggle="section"]');
      if (header) {
        var card = header.closest('.card');
        header.classList.toggle('collapsed');
        if (card) card.classList.toggle('collapsed');
        var body = header.nextElementSibling;
        if (body) body.classList.toggle('hidden');
        return;
      }
      var cmdBtn = t.closest('[data-cmd]');
      if (cmdBtn) {
        vscode.postMessage({ command: cmdBtn.getAttribute('data-cmd') });
        return;
      }
      var snipBtn = t.closest('[data-snippet]');
      if (snipBtn) {
        vscode.postMessage({ command: 'insertSnippet', snippet: snipBtn.getAttribute('data-snippet') });
        return;
      }
      
      // Hover Action: Run File
      var runFileBtn = t.closest('.run-file-btn');
      if (runFileBtn) {
        e.stopPropagation();
        var fp = runFileBtn.getAttribute('data-file');
        if (fp) runUnified([fp], false);
        return;
      }
      var debugFileBtn = t.closest('.debug-file-btn');
      if (debugFileBtn) {
        e.stopPropagation();
        var fp = debugFileBtn.getAttribute('data-file');
        if (fp) runUnified([fp], true);
        return;
      }
      
      // Hover Action: Run Folder
      var runFolderBtn = t.closest('.run-folder-btn');
      if (runFolderBtn) {
        e.stopPropagation();
        var folderGroup = runFolderBtn.closest('.test-folder-group');
        var files = [];
        if (folderGroup) {
           var items = folderGroup.querySelectorAll('.test-item');
           items.forEach(function(it) {
              var f = it.getAttribute('data-file');
              if (f) files.push(f);
           });
        }
        if (files.length > 0) runUnified(files, false);
        return;
      }
      var debugFolderBtn = t.closest('.debug-folder-btn');
      if (debugFolderBtn) {
        e.stopPropagation();
        var folderGroup = debugFolderBtn.closest('.test-folder-group');
        var files = [];
        if (folderGroup) {
           var items = folderGroup.querySelectorAll('.test-item');
           items.forEach(function(it) {
              var f = it.getAttribute('data-file');
              if (f) files.push(f);
           });
        }
        if (files.length > 0) runUnified(files, true);
        return;
      }
      // Project item toggle (multi-select)
      var projItem = t.closest('.proj-item');
      if (projItem) {
        var pn = projItem.getAttribute('data-project');
        if (pn) {
          selectedProjects[pn] = !selectedProjects[pn];
          projItem.classList.toggle('selected', !!selectedProjects[pn]);
        }
        updateProjCount();
        if (typeof applyTestFilter === 'function') applyTestFilter();
        return;
      }
      // Test file open button
      var openBtn = t.closest('.test-open');
      if (openBtn) {
        e.stopPropagation();
        var abs = openBtn.getAttribute('data-abs');
        if (abs) vscode.postMessage({ command: 'openFile', filePath: abs });
        return;
      }
      // Test folder toggle
      var testFolder = t.closest('.test-folder');
      if (testFolder) {
        var group = testFolder.closest('.test-folder-group');
        if (group) {
          group.classList.toggle('collapsed');
          testFolder.classList.toggle('collapsed');
        }
        return;
      }
      // Test item toggle
      var testItem = t.closest('.test-item');
      if (testItem) {
        var group = testItem.closest('.test-item-group');
        var hasSub = testItem.querySelector('.file-arrow');
        
        // If clicking the arrow or if it's a file header with subtests, toggle
        if (t.classList.contains('file-arrow') || (hasSub && !t.closest('.hover-actions'))) {
           if (group) {
              group.classList.toggle('collapsed');
              testItem.classList.toggle('collapsed');
           }
        }

        var fp = testItem.getAttribute('data-file');
        if (fp) {
          selectedTests[fp] = !selectedTests[fp];
          testItem.classList.toggle('selected', !!selectedTests[fp]);
        }
        updateCount();
        return;
      }
      
      var runSubBtn = t.closest('.run-subtest-btn');
      if (runSubBtn) {
        e.stopPropagation();
        var fp = runSubBtn.getAttribute('data-parent');
        var title = runSubBtn.getAttribute('data-title');
        var line = runSubBtn.getAttribute('data-line');
        if (fp && title) runUnified([fp], false, title, line);
        return;
      }

      var debugSubBtn = t.closest('.debug-subtest-btn');
      if (debugSubBtn) {
        e.stopPropagation();
        var fp = debugSubBtn.getAttribute('data-parent');
        var title = debugSubBtn.getAttribute('data-title');
        var line = debugSubBtn.getAttribute('data-line');
        if (fp && title) runUnified([fp], true, title, line);
        return;
      }

      // Sub-test item click (open file)
      var subItem = t.closest('.test-sub-item');
      if (subItem) {
        var fp = subItem.getAttribute('data-parent');
        if (fp) {
          vscode.postMessage({ command: 'openFile', filePath: fp });
        }
        return;
      }
    });


    // Project multi-select (Quick Actions - from config)
    var selectedProjects = {};

    function updateProjCount() {
      var keys = Object.keys(selectedProjects);
      var n = 0;
      for (var i = 0; i < keys.length; i++) { if (selectedProjects[keys[i]]) n++; }
      var el = document.getElementById('projSelCount');
      if (el) el.textContent = String(n);
      return n;
    }

    function applyTestFilter() {
      var filterInput = document.getElementById('testFilter');
      if (!filterInput) return;
      var term = filterInput.value.toLowerCase();
      var isExclude = term.startsWith('!');
      var searchTerm = isExclude ? term.substring(1).trim() : term.trim();
      
      var selectedProjList = getSelectedProjects();

      var groups = document.querySelectorAll('.test-item-group');
      groups.forEach(function(group) {
          var item = group.querySelector('.test-item');
          if (!item) return;
          var name = (item.getAttribute('data-rel') || '').toLowerCase();
          var match = name.includes(searchTerm);
          var shouldShow = searchTerm === '' ? true : (isExclude ? !match : match);

          var children = group.querySelector('.test-item-children');
          var anySubMatch = false;
          if (children) {
              var subItems = children.querySelectorAll('.test-sub-item');
              subItems.forEach(function(si) {
                  var subName = (si.getAttribute('data-title') || '').toLowerCase();
                  var subMatch = subName.includes(searchTerm);
                  var shouldShowSub = searchTerm === '' ? true : (isExclude ? !subMatch : subMatch);
                  si.style.display = shouldShowSub ? 'flex' : 'none';
                  if (shouldShowSub) anySubMatch = true;
              });
          }

          if (searchTerm !== '' && anySubMatch) shouldShow = true;
          group.style.display = shouldShow ? 'block' : 'none';
          item.style.display = shouldShow ? 'flex' : 'none';
      });

      var groups = document.querySelectorAll('.test-folder-group');
      groups.forEach(function(group) {
          if (searchTerm === '') {
            group.style.display = 'block';
            return;
          }
          var childItems = group.querySelectorAll('.test-item');
          var hasVisible = false;
          for(var i=0; i<childItems.length; i++) {
            if (childItems[i].style.display !== 'none') {
              hasVisible = true;
              break;
            }
          }
          group.style.display = hasVisible ? 'block' : 'none';
      });
    }

    var filterInput = document.getElementById('testFilter');
    if (filterInput) {
      filterInput.addEventListener('input', applyTestFilter);
    }

    function getSelectedProjects() {
      var result = [];
      var keys = Object.keys(selectedProjects);
      for (var i = 0; i < keys.length; i++) {
        if (selectedProjects[keys[i]]) result.push(keys[i]);
      }
      return result;
    }

    // Radio: Headed / Headless
    var currentHeadedOpt = null; // Default to none selected
    document.querySelectorAll('.radio-opt').forEach(function(el) {
      el.addEventListener('click', function() {
        if (el.classList.contains('active')) {
          el.classList.remove('active');
          currentHeadedOpt = null;
        } else {
          document.querySelectorAll('.radio-opt').forEach(function(r) { r.classList.remove('active'); });
          el.classList.add('active');
          currentHeadedOpt = el.getAttribute('data-headed') || '';
        }
      });
    });

    // Unified Run button — gathers files + projects + mode + browsers
    function getSelectedBrowsers() {
      var result = [];
      var keys = Object.keys(selectedBrowsers);
      for (var i = 0; i < keys.length; i++) {
        if (selectedBrowsers[keys[i]]) result.push(keys[i]);
      }
      return result;
    }

    // Unified Run Logic
    var lastRunConfig = null;

    function runUnified(filesToRun, isDebug, testTitle, testLine) {
        var itemGroups = document.querySelectorAll('.test-item-group');
        itemGroups.forEach(function(group) {
          var item = group.querySelector('.test-item');
          if (!item) return;
          var statusEl = item.querySelector('.test-status');
          var timeEl = item.querySelector('.test-time');
          if (statusEl) statusEl.innerHTML = '';
          if (timeEl) timeEl.innerHTML = '';
          var fp = item.getAttribute('data-file');
          var isRunning = filesToRun.length === 0 || filesToRun.indexOf(fp) !== -1;
          
          if (isRunning && !testTitle) {
             if (statusEl) statusEl.innerHTML = '<div class="spinner"></div>';
          }
          
          var children = group.querySelector('.test-item-children');
          if (children) {
              var subItems = children.querySelectorAll('.test-sub-item');
              subItems.forEach(function(si) {
                 var subStatusEl = si.querySelector('.subtest-status');
                 if (subStatusEl) {
                    var isSubRunning = isRunning;
                    if (testTitle && si.getAttribute('data-title') !== testTitle) {
                       isSubRunning = false;
                    }
                    subStatusEl.innerHTML = isSubRunning ? '<div class="spinner"></div>' : '';
                 }
              });
          }
        });
        
        var folders = document.querySelectorAll('.test-folder-group');
        folders.forEach(function(group) {
           var folderEl = group.querySelector('.test-folder');
           var statusEl = folderEl ? folderEl.querySelector('.folder-status') : null;
           var timeEl = folderEl ? folderEl.querySelector('.folder-time') : null;
           if (statusEl) statusEl.innerHTML = '';
           if (timeEl) timeEl.innerHTML = '';
           
           var isRunning = false;
           if (filesToRun.length === 0) {
              isRunning = true;
           } else {
              var childItems = group.querySelectorAll('.test-item');
              for (var i = 0; i < childItems.length; i++) {
                 var fp = childItems[i].getAttribute('data-file');
                 if (filesToRun.indexOf(fp) !== -1) {
                    isRunning = true;
                    break;
                 }
              }
           }
           if (isRunning && statusEl) {
              statusEl.innerHTML = '<div class="spinner"></div>';
           }
        });
        
        var cfg = {
          command: 'runUnified',
          files: filesToRun,
          projects: getSelectedProjects(),
          headedOption: currentHeadedOpt,
          browsers: getSelectedBrowsers(),
          testTitle: testTitle,
          testLine: testLine
        };
        if (isDebug) {
          cfg.headedOption = '--debug';
        }
        lastRunConfig = cfg;
        vscode.postMessage(cfg);
        
        var statTests = document.getElementById('statTests');
        if (statTests) statTests.textContent = 'Running...';
    }

    var btnRerunLast = document.getElementById('btnRerunLast');
    if (btnRerunLast) {
      btnRerunLast.addEventListener('click', function() {
        if (lastRunConfig) {
          runUnified(lastRunConfig.files, lastRunConfig.headedOption === '--debug', lastRunConfig.testTitle, lastRunConfig.testLine);
        } else {
          runUnified(getSelectedFiles(), false);
        }
      });
    }

    // Event handlers for hover actions are in document.addEventListener('click', ...)

    // Browser Project multi-select
    var selectedBrowsers = {};
    document.addEventListener('click', function(e) {
      var bItem = e.target.closest('.browser-item');
      if (bItem) {
        var bn = bItem.getAttribute('data-browser');
        if (bn) {
          selectedBrowsers[bn] = !selectedBrowsers[bn];
          bItem.classList.toggle('selected', !!selectedBrowsers[bn]);
        }
        return;
      }
    }, true);

    // Messages from extension
    window.addEventListener('message', function(ev) {
      var msg = ev.data;

      if (msg.command === 'testsScanned') {
        var list = document.getElementById('testFileList');
        if (!list) return;
        selectedTests = {};
        if (!msg.files || msg.files.length === 0) {
          list.innerHTML = '<div class="test-empty">No test files found</div>';
          updateCount();
          return;
        }
        // Build a nested tree structure
        var tree = { folders: {}, files: [] };
        for (var i = 0; i < msg.files.length; i++) {
          var f = msg.files[i];
          var parts = f.relative.split('/');
          var current = tree;
          // Traverse and create folders
          for (var j = 0; j < parts.length - 1; j++) {
            var p = parts[j];
            var pLower = p.toLowerCase();
            var existingKey = Object.keys(current.folders).find(function(k) { return k.toLowerCase() === pLower; });
            if (!existingKey) {
              current.folders[p] = { folders: {}, files: [] };
              existingKey = p;
            }
            current = current.folders[existingKey];
          }
          // Add file to the leaf folder
          var fileName = parts[parts.length - 1];
          current.files.push({ fileName: fileName, absolute: f.absolute, relative: f.relative, subTests: f.subTests || [] });
        }

        function renderTree(node, depth, pathPrefix) {
          var res = '';
          var folderNames = Object.keys(node.folders).sort();
          
          // 1. Render all folder headings first
          for (var i = 0; i < folderNames.length; i++) {
            var fName = folderNames[i];
            var folderPath = pathPrefix ? pathPrefix + '/' + fName : fName;
            var childNode = node.folders[fName];
            
            res += '<div class="test-folder-group" data-folder="' + folderPath + '">';
            res += '<div class="test-folder" style="padding-left: ' + (depth * 16 + 8) + 'px" data-toggle-folder="' + folderPath + '">' +
              '<span class="folder-arrow">&#9660;</span>' +
              '<span class="folder-status"></span>' +
              '<span class="test-name" title="' + folderPath + '">' + fName + '</span>' +
              '<span class="folder-time"></span>' +
              '<div class="hover-actions">' +
              '<span class="hover-btn run-folder-btn" data-folder="' + folderPath + '" title="Run folder">&#9654;</span>' +
              '<span class="hover-btn debug-folder-btn" data-folder="' + folderPath + '" title="Debug folder">&#128030;</span>' +
              '</div>' +
              '</div>';
            res += '<div class="test-folder-children">';
            res += renderTree(childNode, depth + 1, folderPath);
            res += '</div></div>';
          }

          // 2. Render files in this directory
          node.files.sort(function(a, b) { return a.fileName.localeCompare(b.fileName); });
          for (var j = 0; j < node.files.length; j++) {
            var item = node.files[j];
            var hasSub = item.subTests && item.subTests.length > 0;
            res += '<div class="test-item-group" data-file="' + item.absolute + '">';
            res += '<div class="test-item" style="padding-left: ' + (depth * 16 + 8) + 'px" data-file="' + item.absolute + '" data-rel="' + item.relative + '">' +
              (hasSub ? '<span class="file-arrow">&#9660;</span>' : '<span class="file-arrow-spacer"></span>') +
              '<span class="test-status"></span>' +
              '<span class="test-name" title="' + item.relative + '">' + item.fileName + '</span>' +
              '<span class="test-time"></span>' +
              '<div class="hover-actions">' +
              '<span class="hover-btn run-file-btn" data-file="' + item.absolute + '" title="Run file">&#9654;</span>' +
              '<span class="hover-btn debug-file-btn" data-file="' + item.absolute + '" title="Debug file">&#128030;</span>' +
              '<span class="hover-btn test-open" data-abs="' + item.absolute + '" title="Open file">&#128196;</span>' +
              '</div>' +
              '</div>';

             if (hasSub) {
              res += '<div class="test-item-children">';
              for (var k = 0; k < item.subTests.length; k++) {
                 var sub = item.subTests[k];
                 var tagHtml = '';
                 if (sub.tags && sub.tags.length > 0) {
                    for (var t = 0; t < sub.tags.length; t++) {
                       tagHtml += '<span class="test-tag">' + sub.tags[t] + '</span>';
                    }
                 }
                 res += '<div class="test-sub-item" style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; padding-left: ' + (depth * 16 + 28) + 'px; cursor: pointer;" data-parent="' + item.absolute + '" data-projects="' + sub.projects.join(',') + '" data-title="' + sub.fullTitle + '" data-line="' + sub.line + '">' +
                    '<span class="subtest-status" style="width: 14px; text-align: center; font-size: 11px;"></span>' +
                    '<span class="test-name" style="color: var(--fg2);">' + sub.title + tagHtml + '</span>' +
                    '<div class="hover-actions">' +
                    '<span class="hover-btn run-subtest-btn" data-parent="' + item.absolute + '" data-title="' + sub.fullTitle + '" data-line="' + sub.line + '" title="Run test">&#9654;</span>' +
                    '<span class="hover-btn debug-subtest-btn" data-parent="' + item.absolute + '" data-title="' + sub.fullTitle + '" data-line="' + sub.line + '" title="Debug test">&#128030;</span>' +
                    '</div>' +
                    '</div>';
              }
              res += '</div>';
            }
            res += '</div>';
          }
          
          return res;
        }

        list.innerHTML = renderTree(tree, 0, '');
        
        // Dynamic project discovery from tests
        if (msg.allProjects && msg.allProjects.length > 0) {
            updateProjectConfigList(msg.allProjects);
        }

        updateCount();
        if (typeof applyTestFilter === 'function') applyTestFilter();
      }
      
      function updateProjectConfigList(projects) {
          var projList = document.getElementById('projectConfigList');
          if (!projList) return;
          // Preserve existing selections if possible
          var html = '';
          for (var j = 0; j < projects.length; j++) {
            var p = projects[j];
            var isSelected = !!selectedProjects[p];
            html += '<div class="proj-item' + (isSelected ? ' selected' : '') + '" data-project="' + p + '">' +
              '<div class="proj-cb">&#10003;</div>' +
              '<span class="proj-name">' + p + '</span>' +
              '</div>';
          }
          projList.innerHTML = html;
          updateProjCount();
      }

      if (msg.command === 'projectsLoaded') {
        var projList = document.getElementById('projectConfigList');
        if (!projList) return;
        selectedProjects = {};
        if (!msg.projects || msg.projects.length === 0) {
          projList.innerHTML = '<div class="proj-empty">No projects found</div>';
          updateProjCount();
          return;
        }
        var html = '';
        for (var j = 0; j < msg.projects.length; j++) {
          var p = msg.projects[j];
          html += '<div class="proj-item" data-project="' + p + '">' +
            '<div class="proj-cb">&#10003;</div>' +
            '<span class="proj-name">' + p + '</span>' +
            '</div>';
        }
        projList.innerHTML = html;
        updateProjCount();
      }

      if (msg.command === 'testResults') {
        var itemGroups = document.querySelectorAll('.test-item-group');
        itemGroups.forEach(function(group) {
          var item = group.querySelector('.test-item');
          if (!item) return;
          var rel = item.getAttribute('data-rel');
          var statusEl = item.querySelector('.test-status');
          var timeEl = item.querySelector('.test-time');
          if (statusEl && rel && msg.results[rel]) {
            if (msg.results[rel].status === 'passed') {
              statusEl.innerHTML = '✅';
            } else if (msg.results[rel].status === 'failed') {
              statusEl.innerHTML = '❌';
            }
            if (timeEl && msg.results[rel].duration !== undefined) {
              timeEl.innerHTML = (msg.results[rel].duration / 1000).toFixed(1) + 's';
            }

            var children = group.querySelector('.test-item-children');
            if (children) {
                var subItems = children.querySelectorAll('.test-sub-item');
                subItems.forEach(function(si) {
                   var title = si.getAttribute('data-title');
                   var subStatusEl = si.querySelector('.subtest-status');
                   if (title && subStatusEl) {
                      if (msg.results[rel].subTests && msg.results[rel].subTests[title]) {
                         var st = msg.results[rel].subTests[title].status;
                         subStatusEl.innerHTML = st === 'passed' ? '✅' : '❌';
                      } else {
                         subStatusEl.innerHTML = '';
                      }
                   }
                });
            }
          } else if (statusEl) {
            statusEl.innerHTML = '';
            var children = group.querySelector('.test-item-children');
            if (children) {
                var subItems = children.querySelectorAll('.test-sub-item');
                subItems.forEach(function(si) {
                   var subStatusEl = si.querySelector('.subtest-status');
                   if (subStatusEl) subStatusEl.innerHTML = '';
                });
            }
          }
        });
        
        var folderGroups = document.querySelectorAll('.test-folder-group');
        folderGroups.forEach(function(group) {
          var folderEl = group.querySelector('.test-folder');
          if (!folderEl) return;
          var statusEl = folderEl.querySelector('.folder-status');
          var timeEl = folderEl.querySelector('.folder-time');
          var childItems = group.querySelectorAll('.test-item');
          var anyFailed = false;
          var anyPassed = false;
          var totalTime = 0;
          var allFinished = true;
          childItems.forEach(function(item) {
             var rel = item.getAttribute('data-rel');
             if (rel && msg.results[rel]) {
               totalTime += msg.results[rel].duration || 0;
               if (msg.results[rel].status === 'failed') anyFailed = true;
               else if (msg.results[rel].status === 'passed') anyPassed = true;
             } else {
               allFinished = false;
             }
          });
          
          if (anyFailed) {
            if (statusEl) statusEl.innerHTML = '❌';
          } else if (anyPassed && allFinished) {
             if (statusEl) statusEl.innerHTML = '✅';
          } else if (anyPassed) {
             if (statusEl) statusEl.innerHTML = '✅'; 
          } else {
             if (statusEl) statusEl.innerHTML = '';
          }
          if (timeEl && totalTime > 0) {
            timeEl.innerHTML = (totalTime / 1000).toFixed(1) + 's';
          }
        });
        
        var statTests = document.getElementById('statTests');
        var statTime = document.getElementById('statTime');
        if (msg.stats) {
          var headerStats = document.getElementById('testHeaderStats');
          if (headerStats) headerStats.style.display = 'flex';
          var total = msg.stats.passCount + msg.stats.failCount;
          var overallIcon = msg.stats.failCount > 0 ? '❌ ' : (msg.stats.passCount > 0 ? '✅ ' : '');
           
           var headerStatus = document.getElementById('headerStatus');
           if (headerStatus) headerStatus.textContent = overallIcon;

           if (statTests) statTests.textContent = overallIcon + 'Tests: ' + msg.stats.passCount + '/' + total + ' passed' + (msg.stats.failCount > 0 ? ' (' + msg.stats.failCount + ' fail)' : '');
           if (statTime) statTime.textContent = (msg.stats.totalDuration / 1000).toFixed(1) + 's';
        }
      }
    });
  </script>
</body>
</html>`;
  }
  private _normalizeRel(root: string, abs: string): string {
    const r = root.replace(/\\/g, '/');
    const a = abs.replace(/\\/g, '/');
    const rF = r.charAt(1) === ':' ? r.charAt(0).toUpperCase() + r.slice(1) : r;
    const aF = a.charAt(1) === ':' ? a.charAt(0).toUpperCase() + a.slice(1) : a;
    let rel = path.posix.relative(rF, aF);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
}


/** Generate a cryptographic nonce for Content Security Policy */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
