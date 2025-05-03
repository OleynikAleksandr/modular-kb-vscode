import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as http from 'http';

/**
 * Класс для управления процессом Core (Always-IDE модель)
 */
export class CoreManager {
    // Путь к директории модулей (публичный для доступа из активации расширения)
    public readonly modulesPath: string;
    private orchestratorModulePath: string;
    private mcpConfigPath: string;
    private corePort: number | null = null;
    // Процесс Core (не null, когда Core запущен)
    private coreProcess: ChildProcess | null = null;

    constructor(private context: vscode.ExtensionContext) {
        // Путь к папке с модулями с учетом IDE
        this.modulesPath = this.getModulesPath(context);
        // Путь к core-модулю только kb-core
        this.orchestratorModulePath = path.join(this.modulesPath, 'kb-core');
        // Путь к конфигурационному файлу MCP
        this.mcpConfigPath = this.getMcpConfigPath();
        console.log(`CoreManager: Путь к модулям: ${this.modulesPath}`);
        console.log(`CoreManager: Путь к модулю kb-core: ${this.orchestratorModulePath}`);
        console.log(`CoreManager: IDE: ${vscode.env.appName}`);
    }

    /**
     * Определение пути к директории с модулями в зависимости от IDE
     * @param context Контекст расширения
     * @returns Путь к директории с модулями
     */
    private getModulesPath(context: vscode.ExtensionContext): string {
        // Получаем базовый путь расширения
        const extensionPath = context.extensionPath;
        console.log(`CoreManager: Текущий путь расширения: ${extensionPath}`);

        // Определяем, какая IDE используется
        const appName = vscode.env.appName;
        console.log(`CoreManager: Имя приложения: ${appName}`);

        // Используем USERPROFILE для получения домашней директории пользователя
        const userHome = process.env.USERPROFILE || process.env.HOME || '';
        let extensionParts = extensionPath.split(path.sep);
        let installedVersion = '0.0.0';

        // Ищем версию в пути
        for (const part of extensionParts) {
            if (part.includes('modularkb.modularkb-extension-')) {
                installedVersion = part.replace('modularkb.modularkb-extension-', '');
                console.log(`CoreManager: Найдена версия в пути: ${installedVersion}`);
                break;
            }
        }

        let modulesPath = '';

        // Распознаем IDE и формируем путь с правильными директориями расширений
        if (appName.includes('Visual Studio Code')) {
            // Правильный путь для VS Code
            modulesPath = path.join(userHome, '.vscode', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            console.log(`CoreManager: Определен путь к модулям VS Code: ${modulesPath}`);
        } else if (appName.includes('Code - Copilot')) {
            // Путь для VS Code Copilot
            modulesPath = path.join(userHome, '.vscode-copilot', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            console.log(`CoreManager: Определен путь к модулям VS Code Copilot: ${modulesPath}`);
        } else if (appName.includes('Cursor')) {
            // Правильный путь для Cursor
            modulesPath = path.join(userHome, '.cursor', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            console.log(`CoreManager: Определен путь к модулям Cursor: ${modulesPath}`);
        } else if (appName.includes('Windsurf')) {
            // Правильный путь для Windsurf
            modulesPath = path.join(userHome, '.windsurf', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            console.log(`CoreManager: Определен путь к модулям Windsurf: ${modulesPath}`);
        } else if (appName.includes('Trae')) {
            // Правильный путь для Trae
            modulesPath = path.join(userHome, '.trae', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            console.log(`CoreManager: Определен путь к модулям Trae: ${modulesPath}`);
        } else {
            // По умолчанию используем путь из контекста
            modulesPath = path.join(extensionPath, 'modules');
            console.log(`CoreManager: Используется путь по умолчанию: ${modulesPath}`);
        }

        console.log(`CoreManager: Итоговый путь к модулям: ${modulesPath}`);

        return modulesPath;
    }

    /**
     * Создание папки modules, если она не существует
     */
    private async ensureModulesDirExists(): Promise<void> {
        try {
            await fs.access(this.modulesPath).catch(async () => {
                await fs.mkdir(this.modulesPath, { recursive: true });
                console.log(`CoreManager: Создана папка для модулей: ${this.modulesPath}`);
            });
        } catch (error) {
            console.error('CoreManager: Ошибка при создании папки для модулей:', error);
        }
    }

    /**
     * Получение пути к конфигурационному файлу MCP в зависимости от IDE
     */
    private getMcpConfigPath(): string {
        // Определяем путь к конфигурационному файлу в зависимости от IDE
        const appDataPath = process.env.APPDATA || '';

        // Проверяем, какая IDE используется
        if (vscode.env.appName.includes('Visual Studio Code')) {
            return path.join(appDataPath, 'Code', 'User', 'mcp.json');
        } else if (vscode.env.appName.includes('Code - Copilot')) {
            return path.join(appDataPath, 'Code - Copilot', 'User', 'mcp.json');
        } else if (vscode.env.appName.includes('Cursor')) {
            return path.join(process.env.HOME || appDataPath, '.cursor', 'mcp.json');
        } else if (vscode.env.appName.includes('Windsurf')) {
            return path.join(process.env.HOME || appDataPath, '.windsurf', 'mcp.json');
        } else if (vscode.env.appName.includes('Trae')) {
            return path.join(process.env.HOME || appDataPath, '.trae', 'mcp.json');
        }

        // По умолчанию используем путь для VS Code
        return path.join(appDataPath, 'Code', 'User', 'mcp.json');
    }

    /**
     * Проверка доступности Core
     * @returns true, если Core доступен, иначе false
     */
    public async isCoreAvailable(): Promise<boolean> {
        try {
            // Проверяем наличие конфигурационного файла MCP
            const mcpConfigExists = await this.fileExists(this.mcpConfigPath);
            if (!mcpConfigExists) {
                console.log('CoreManager: MCP конфигурационный файл не существует');
                return false;
            }

            // Читаем конфигурационный файл
            const mcpConfig = JSON.parse(await fs.readFile(this.mcpConfigPath, 'utf-8'));

            // Ищем сервер KB Core
            const kbCoreServer = mcpConfig.servers?.find((server: any) =>
                server.name === 'KB Core' && server.type === 'http');

            if (!kbCoreServer) {
                console.log('CoreManager: Сервер KB Core не найден в конфигурации MCP');
                return false;
            }

            // Получаем URL сервера
            const serverUrl = kbCoreServer.url;
            if (!serverUrl) {
                console.log('CoreManager: URL сервера KB Core не указан');
                return false;
            }

            // Извлекаем порт из URL
            const match = serverUrl.match(/:(\d+)/);
            if (match && match[1]) {
                this.corePort = parseInt(match[1], 10);
            } else {
                console.log('CoreManager: Не удалось извлечь порт из URL сервера');
                return false;
            }

            // Проверяем доступность сервера по эндпоинту /control/health
            const healthUrl = `${serverUrl.replace(/\/mcp$/, '')}/control/health`;
            console.log(`CoreManager: Проверка доступности Core по URL: ${healthUrl}`);

            const isAvailable = await this.checkHealth(healthUrl);
            console.log(`CoreManager: Core ${isAvailable ? 'доступен' : 'недоступен'}`);

            return isAvailable;
        } catch (error) {
            console.error('CoreManager: Ошибка при проверке доступности Core:', error);
            return false;
        }
    }

    /**
     * Проверка доступности сервера по URL
     * @param url URL для проверки
     * @returns true, если сервер доступен, иначе false
     */
    private async checkHealth(url: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const request = http.get(url, { timeout: 5000 }, (response) => {
                if (response.statusCode === 200) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });

            request.on('error', () => {
                resolve(false);
            });

            request.on('timeout', () => {
                request.destroy();
                resolve(false);
            });
        });
    }

    /**
     * Проверка существования файла
     * @param filePath Путь к файлу
     * @returns true, если файл существует, иначе false
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Поиск свободного порта
     * @returns Свободный порт
     */
    public async findFreePort(): Promise<number> {
        return new Promise<number>((resolve) => {
            const server = net.createServer();
            server.listen(0, () => {
                const port = (server.address() as net.AddressInfo).port;
                server.close(() => resolve(port));
            });
        });
    }

    /**
     * Проверка наличия модуля Core (KB.Orchestrator или KB.Core)
     * @returns true, если модуль найден, иначе false
     */
    public async isOrchestratorModuleInstalled(): Promise<boolean> {
        try {
            // Ищем модуль только по имени kb-core
            let moduleDir = this.orchestratorModulePath;
            let moduleExists = await this.fileExists(moduleDir);
            if (!moduleExists) {
                console.log(`CoreManager: Директория модуля не найдена: ${this.orchestratorModulePath}`);
                return false;
            }
            // Проверяем наличие DLL в папке модуля
            let dllExists = false;
            const possibleDlls = [
                path.join(moduleDir, 'KB.Orchestrator.dll'),
                path.join(moduleDir, 'core', 'KB.Orchestrator.dll'),
                path.join(moduleDir, 'KB.Core.dll'),
                path.join(moduleDir, 'core', 'KB.Core.dll')
            ];
            for (const dllPath of possibleDlls) {
                if (await this.fileExists(dllPath)) {
                    dllExists = true;
                    console.log(`CoreManager: Найден DLL: ${dllPath}`);
                    break;
                }
            }
            try {
                const files = await fs.readdir(moduleDir);
                console.log(`CoreManager: Содержимое директории модуля:`, files);
            } catch (err) {
                console.error(`CoreManager: Ошибка при чтении содержимого директории модуля:`, err);
            }
            return dllExists;
        } catch (error) {
            console.error('CoreManager: Ошибка при проверке наличия модуля kb-core:', error);
            return false;
        }
    }

    /**
     * Запуск Core как дочернего процесса расширения (Always-IDE модель)
     * @param port Порт для Core
     * @returns true, если Core успешно запущен, иначе false
     */
    public async startCore(port: number): Promise<boolean> {
        try {
            console.log(`CoreManager: Запуск kb-core на порту ${port}`);
            const moduleInstalled = await this.isOrchestratorModuleInstalled();
            if (!moduleInstalled) {
                console.error('CoreManager: Модуль kb-core не установлен');
                vscode.window.showErrorMessage('kb-core module is not installed. Please install the kb-core module first using "Modular KB: Install Module" command.');
                return false;
            }
            let dllPath = '';
            let moduleDir = this.orchestratorModulePath;
            let dllDir = '';
            const possibleDlls = [
                path.join(moduleDir, 'KB.Orchestrator.dll'),
                path.join(moduleDir, 'core', 'KB.Orchestrator.dll'),
                path.join(moduleDir, 'KB.Core.dll'),
                path.join(moduleDir, 'core', 'KB.Core.dll')
            ];
            for (const possibleDll of possibleDlls) {
                if (await this.fileExists(possibleDll)) {
                    dllPath = possibleDll;
                    dllDir = path.dirname(possibleDll);
                    console.log(`CoreManager: Найден DLL: ${dllPath}`);
                    break;
                }
            }
            if (!dllPath) {
                console.error('CoreManager: Не найден DLL модуля kb-core');
                vscode.window.showErrorMessage('Cannot find KB.Core.dll or KB.Orchestrator.dll in the kb-core module.');
                return false;
            }
            this.coreProcess = spawn('dotnet', [dllPath, "--port", port.toString()], {
                cwd: dllDir
            });
            this.coreProcess.stdout?.on('data', (data) => {
                console.log(`Core stdout: ${data}`);
            });
            this.coreProcess.stderr?.on('data', (data) => {
                console.error(`Core stderr: ${data}`);
            });
            this.coreProcess.on('close', (code) => {
                console.log(`Core process exited with code ${code}`);
                this.coreProcess = null;
                this.corePort = null;
            });
            this.corePort = port;
            console.log(`CoreManager: kb-core запущен на порту ${port}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;
        } catch (error) {
            console.error('CoreManager: Ошибка при запуске kb-core:', error);
            return false;
        }
    }

    /**
     * Регистрация MCP-сервера в конфигурации IDE
     * @param port Порт сервера
     * @returns true, если сервер успешно зарегистрирован, иначе false
     */
    public async registerMcpServer(port: number): Promise<boolean> {
        try {
            console.log(`CoreManager: Регистрация MCP-сервера на порту ${port}`);

            // Создаем директорию для конфигурационного файла, если она не существует
            await fs.mkdir(path.dirname(this.mcpConfigPath), { recursive: true });

            // Проверяем существование конфигурационного файла
            let mcpConfig: any = { servers: [] };

            if (await this.fileExists(this.mcpConfigPath)) {
                // Читаем существующий конфигурационный файл
                const configContent = await fs.readFile(this.mcpConfigPath, 'utf-8');
                try {
                    mcpConfig = JSON.parse(configContent);
                    if (!mcpConfig.servers) {
                        mcpConfig.servers = [];
                    }
                } catch (e) {
                    console.error('CoreManager: Ошибка при парсинге конфигурационного файла MCP:', e);
                    mcpConfig = { servers: [] };
                }
            }

            // Удаляем существующий сервер KB Core, если он есть
            mcpConfig.servers = mcpConfig.servers.filter((server: any) => server.name !== 'KB Core');

            // Добавляем новый сервер
            mcpConfig.servers.push({
                name: "KB Core",
                url: `http://127.0.0.1:${port}/mcp`,
                type: "http"
            });

            // Записываем конфигурационный файл
            await fs.writeFile(this.mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

            console.log(`CoreManager: MCP-сервер успешно зарегистрирован на порту ${port}`);

            return true;
        } catch (error) {
            console.error('CoreManager: Ошибка при регистрации MCP-сервера:', error);
            return false;
        }
    }

    /**
     * Обеспечение доступности Core
     * @returns true, если Core доступен или успешно запущен, иначе false
     */
    public async ensureCoreAvailable(): Promise<boolean> {
        try {
            // Проверяем доступность Core
            const isAvailable = await this.isCoreAvailable();
            if (isAvailable) {
                console.log('CoreManager: Core уже доступен');
                return true;
            }

            // Проверяем наличие модуля KB.Orchestrator
            const moduleInstalled = await this.isOrchestratorModuleInstalled();
            if (!moduleInstalled) {
                console.error('CoreManager: Модуль KB.Orchestrator не установлен');
                vscode.window.showErrorMessage('KB Core module is not installed. Please install the KB.Orchestrator module first using "Modular KB: Install Module" command.');
                return false;
            }

            // Находим свободный порт
            const port = await this.findFreePort();
            console.log(`CoreManager: Найден свободный порт: ${port}`);

            // Запускаем Core
            const isStarted = await this.startCore(port);
            if (!isStarted) {
                console.error('CoreManager: Не удалось запустить Core');
                return false;
            }

            // Регистрируем MCP-сервер
            const isRegistered = await this.registerMcpServer(port);
            if (!isRegistered) {
                console.error('CoreManager: Не удалось зарегистрировать MCP-сервер');
                return false;
            }

            // Проверяем доступность Core после запуска
            const healthUrl = `http://127.0.0.1:${port}/control/health`;

            // Пробуем несколько раз с интервалом
            for (let i = 0; i < 5; i++) {
                const isHealthy = await this.checkHealth(healthUrl);
                if (isHealthy) {
                    console.log('CoreManager: Core успешно запущен и доступен');
                    return true;
                }

                // Ждем перед следующей попыткой
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.error('CoreManager: Core запущен, но не отвечает на проверку здоровья');
            return false;
        } catch (error) {
            console.error('CoreManager: Ошибка при обеспечении доступности Core:', error);
            return false;
        }
    }

    /**
     * Останавливает процесс Core
     */
    public stopCore(): void {
        if (this.coreProcess) {
            console.log('CoreManager: Останавливаем Core процесс');
            this.coreProcess.kill();
            this.coreProcess = null;
            this.corePort = null;
        }
    }
}
