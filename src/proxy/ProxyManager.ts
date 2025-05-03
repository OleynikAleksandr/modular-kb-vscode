import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as vscode from 'vscode';

/**
 * Интерфейс для VS Code OutputChannel
 * Используется для абстракции от конкретной реализации VS Code
 * Это позволит легко переключаться между независимой работой и интеграцией с VS Code
 */
interface IOutputChannel {
    appendLine(value: string): void;
    show(): void;
}

/**
 * Адаптер для вывода логов без зависимости от VS Code
 * Реализует интерфейс IOutputChannel для совместимости
 * 
 * ВАЖНО: Для интеграции с VS Code в будущем:
 * 1. Раскомментируйте импорт vscode в начале файла
 * 2. Используйте vscode.window.createOutputChannel вместо этого класса
 */
class ConsoleOutputChannelAdapter implements IOutputChannel {
    private readonly channelName: string;
    
    constructor(channelName: string) {
        this.channelName = channelName;
    }
    
    appendLine(value: string): void {
        console.log(`[${this.channelName}] ${value}`);
    }
    
    show(): void {
    }
}

/**
 * Класс для управления процессом прокси-сервера
 * В версии 0.5.3 работает с VS Code Output Panel для улучшенного логирования
 * 
 * ВАЖНО: Для отключения интеграции с VS Code в будущем:
 * 1. Закомментируйте импорт vscode в начале файла
 * 2. Измените конструктор для принятия строки extensionPath
 * 3. Используйте ConsoleOutputChannelAdapter вместо vscode.window.createOutputChannel
 * 4. Используйте console.warn вместо vscode.window.showWarningMessage
 */
export class ProxyManager {
    private readonly proxyPath: string;
    private proxyPort: number | null = null;
    private proxyProcess: ChildProcess | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private isStopped: boolean = false;
    private outputChannel: IOutputChannel;
    
    /**
     * Конструктор
     * @param extensionPath Путь к расширению
     */
    constructor(private extensionPath: string) {
        this.proxyPath = path.join(extensionPath, 'dist', 'proxy.js');
        
        this.outputChannel = vscode.window.createOutputChannel('ModularKB Proxy');
        this.outputChannel.show();
        
        this.log(`ProxyManager initialized. Proxy path: ${this.proxyPath}`);
        this.log(`Log directory: ${path.join(process.env.USERPROFILE || process.env.HOME || '', '.orchestrator', 'logs')}`);
        
        // Проверяем наличие переменных окружения для прокси
        this.checkProxyEnvironmentVariables();
    }
    
    /**
     * Проверяет наличие переменных окружения для прокси
     * и выводит информацию о них
     */
    private checkProxyEnvironmentVariables(): void {
        const ghCopilotProxy = process.env.GH_COPILOT_OVERRIDE_PROXY_URL;
        const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
        const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        
        this.log('Checking proxy environment variables:');
        
        if (ghCopilotProxy) {
            this.log(`GH_COPILOT_OVERRIDE_PROXY_URL is set to: ${ghCopilotProxy}`);
            this.log('NOTE: This variable may not work with Copilot Chat 0.26.x due to bug #7802');
        } else {
            this.log('GH_COPILOT_OVERRIDE_PROXY_URL is not set');
        }
        
        if (httpProxy) {
            this.log(`HTTP_PROXY is set to: ${httpProxy}`);
        } else {
            this.log('HTTP_PROXY is not set');
        }
        
        if (httpsProxy) {
            this.log(`HTTPS_PROXY is set to: ${httpsProxy}`);
        } else {
            this.log('HTTPS_PROXY is not set');
        }
        
        if (!ghCopilotProxy && !httpProxy && !httpsProxy) {
            this.log('WARNING: No proxy environment variables are set. Copilot Chat may not use the proxy.', true);
            this.log('Please set HTTP_PROXY and HTTPS_PROXY environment variables for Copilot Chat 0.26.x', true);
            
            vscode.window.showWarningMessage(
                'No proxy environment variables detected. Due to bug #7802 in Copilot Chat 0.26.x, ' +
                'please set HTTP_PROXY and HTTPS_PROXY environment variables instead of GH_COPILOT_OVERRIDE_PROXY_URL.'
            );
        }
    }
    
    /**
     * Логирует сообщения в канал вывода
     * @param message Сообщение для логирования
     * @param isError Флаг ошибки
     */
    private log(message: string, isError: boolean = false): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] ${message}`;
        
        this.outputChannel.appendLine(formattedMessage);
        
        if (isError) {
            console.error(formattedMessage);
        } else {
            console.log(formattedMessage);
        }
    }
    
    /**
     * Поиск свободного порта в диапазоне 7001-7010
     * @returns Свободный порт
     */
    public async findFreeProxyPort(): Promise<number> {
        for (let port = 7001; port <= 7010; port++) {
            try {
                const isPortFree = await this.isPortFree(port);
                if (isPortFree) {
                    this.log(`Found free port: ${port}`);
                    return port;
                }
            } catch (error) {
                this.log(`Error checking port ${port}: ${error instanceof Error ? error.message : String(error)}`, true);
            }
        }
        
        this.log('All ports in range 7001-7010 are busy. Using default port 7001.', true);
        return 7001;
    }
    
    /**
     * Проверяет, свободен ли порт
     * @param port Порт для проверки
     * @returns true, если порт свободен, иначе false
     */
    private isPortFree(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            
            server.once('error', () => {
                resolve(false);
            });
            
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            
            server.listen(port);
        });
    }
    
    /**
     * Проверяет доступность прокси
     * @returns true, если прокси доступен, иначе false
     */
    public async isProxyAvailable(): Promise<boolean> {
        if (!this.proxyPort) {
            this.log('Proxy port not set, proxy is not available');
            return false;
        }
        
        try {
            const url = `http://127.0.0.1:${this.proxyPort}/ping`;
            this.log(`Checking proxy availability at ${url}`);
            
            const response = await fetch(url, { 
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                this.log(`Proxy is available on port ${this.proxyPort}`);
            } else {
                this.log(`Proxy health check failed with status ${response.status}`, true);
            }
            
            return response.ok;
        } catch (error) {
            this.log(`Error checking proxy availability: ${error instanceof Error ? error.message : String(error)}`, true);
            return false;
        }
    }
    
    /**
     * Запускает прокси-сервер
     * @param port Порт для прокси
     * @returns true, если прокси успешно запущен, иначе false
     */
    public async startProxy(port: number): Promise<boolean> {
        try {
            this.log(`Starting proxy on port ${port}`);
            
            this.proxyProcess = spawn('node', [this.proxyPath, '--port', port.toString()], {
                cwd: path.dirname(this.proxyPath),
                env: {
                    ...process.env,
                    PORT: port.toString()
                }
            });
            
            this.proxyProcess.stdout?.on('data', (data) => {
                this.log(`Proxy stdout: ${data}`);
            });
            
            this.proxyProcess.stderr?.on('data', (data) => {
                this.log(`Proxy stderr: ${data}`, true);
            });
            
            this.proxyProcess.on('close', (code) => {
                this.log(`Proxy process exited with code ${code}`);
                this.proxyProcess = null;
                this.proxyPort = null;
                
                if (!this.isStopped) {
                    this.log('Proxy server unexpectedly terminated, restarting...');
                    this.ensureProxyAvailable();
                }
            });
            
            this.proxyPort = port;
            this.isStopped = false;
            
            this.setupHealthCheck();
            
            this.log('Waiting for proxy to start...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const isAvailable = await this.isProxyAvailable();
            if (!isAvailable) {
                this.log('Proxy started but not responding to health check', true);
                this.stopProxy();
                return false;
            }
            
            this.log(`Proxy successfully started on port ${port}`);
            
            // Проверяем переменные окружения после успешного запуска
            this.updateProxyEnvironmentVariables(port);
            
            return true;
        } catch (error) {
            this.log(`Error starting proxy: ${error instanceof Error ? error.message : String(error)}`, true);
            return false;
        }
    }
    
    /**
     * Устанавливает интервал для проверки работоспособности прокси
     */
    private setupHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.log('Cleared previous health check interval');
        }
        
        this.log('Setting up health check interval (30 seconds)');
        this.healthCheckInterval = setInterval(async () => {
            if (this.proxyPort) {
                this.log('Running scheduled health check');
                const isAvailable = await this.isProxyAvailable();
                if (!isAvailable && !this.isStopped) {
                    this.log('Proxy not responding to health check, restarting...', true);
                    this.restartProxy();
                } else if (isAvailable) {
                    this.log('Health check passed');
                }
            }
        }, 30000);
    }
    
    /**
     * Перезапускает прокси-сервер
     */
    private async restartProxy(): Promise<void> {
        this.log('Restarting proxy server');
        this.stopProxy();
        
        this.log('Waiting before restart...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const port = await this.findFreeProxyPort();
        this.log(`Restarting proxy on port ${port}`);
        await this.startProxy(port);
    }
    
    /**
     * Обеспечивает доступность прокси
     * @returns true, если прокси доступен или успешно запущен, иначе false
     */
    public async ensureProxyAvailable(): Promise<boolean> {
        try {
            this.log('Ensuring proxy is available');
            const isAvailable = await this.isProxyAvailable();
            if (isAvailable) {
                this.log('Proxy is already available');
                return true;
            }
            
            this.log('Proxy is not available, starting it');
            const port = await this.findFreeProxyPort();
            this.log(`Found free port: ${port}`);
            
            const isStarted = await this.startProxy(port);
            if (!isStarted) {
                this.log('Failed to start proxy', true);
                return false;
            }
            
            this.log('Proxy is now available');
            return true;
        } catch (error) {
            this.log(`Error ensuring proxy availability: ${error instanceof Error ? error.message : String(error)}`, true);
            return false;
        }
    }
    
    /**
     * Обновляет переменные окружения для прокси
     * @param port Порт прокси
     */
    private updateProxyEnvironmentVariables(port: number): void {
        const proxyUrl = `http://127.0.0.1:${port}`;
        
        // Проверяем GH_COPILOT_OVERRIDE_PROXY_URL
        const ghCopilotProxy = process.env.GH_COPILOT_OVERRIDE_PROXY_URL;
        if (!ghCopilotProxy) {
            this.log('GH_COPILOT_OVERRIDE_PROXY_URL environment variable not set', true);
            this.log(`Recommended value: ${proxyUrl}`, true);
            this.log('NOTE: This variable may not work with Copilot Chat 0.26.x due to bug #7802', true);
        } else if (ghCopilotProxy !== proxyUrl) {
            this.log(`WARNING: GH_COPILOT_OVERRIDE_PROXY_URL is set to ${ghCopilotProxy}, but proxy is running on ${proxyUrl}`, true);
        }
        
        // Проверяем HTTP_PROXY и HTTPS_PROXY
        const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
        const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        
        if (!httpProxy && !httpsProxy) {
            this.log('HTTP_PROXY and HTTPS_PROXY environment variables not set', true);
            this.log(`Recommended values: HTTP_PROXY=${proxyUrl}, HTTPS_PROXY=${proxyUrl}`, true);
            this.log('These variables are required for Copilot Chat 0.26.x due to bug #7802', true);
            
            vscode.window.showWarningMessage(
                `Proxy is running on ${proxyUrl}, but HTTP_PROXY and HTTPS_PROXY are not set. ` +
                'Due to bug #7802 in Copilot Chat 0.26.x, please set these variables.'
            );
        } else {
            if (httpProxy && httpProxy !== proxyUrl) {
                this.log(`WARNING: HTTP_PROXY is set to ${httpProxy}, but proxy is running on ${proxyUrl}`, true);
            }
            if (httpsProxy && httpsProxy !== proxyUrl) {
                this.log(`WARNING: HTTPS_PROXY is set to ${httpsProxy}, but proxy is running on ${proxyUrl}`, true);
            }
        }
    }
    
    /**
     * Создает скрипт для патча extension.js файла Copilot Chat
     * @returns Путь к созданному скрипту
     */
    public createPatchScript(): string {
        try {
            this.log('Creating patch script for Copilot Chat extension.js');
            
            const scriptContent = `@echo off
echo Patching Copilot Chat extension.js to fix bug #7802...
echo.

set VSCODE_DIR=%USERPROFILE%\\.vscode
if not exist "%VSCODE_DIR%" (
    echo VS Code directory not found at %VSCODE_DIR%
    exit /b 1
)

set EXTENSION_DIR=%VSCODE_DIR%\\extensions
if not exist "%EXTENSION_DIR%" (
    echo Extensions directory not found at %EXTENSION_DIR%
    exit /b 1
)

set FOUND=0
for /d %%i in ("%EXTENSION_DIR%\\github.copilot-chat-0.26.*") do (
    set COPILOT_DIR=%%i
    set FOUND=1
)

if %FOUND% == 0 (
    echo Copilot Chat 0.26.x not found in %EXTENSION_DIR%
    exit /b 1
)

set EXTENSION_JS=%COPILOT_DIR%\\dist\\extension.js
if not exist "%EXTENSION_JS%" (
    echo extension.js not found at %EXTENSION_JS%
    exit /b 1
)

echo Found extension.js at %EXTENSION_JS%
echo Creating backup...
copy "%EXTENSION_JS%" "%EXTENSION_JS%.bak"

echo Patching extension.js...
powershell -Command "(Get-Content '%EXTENSION_JS%') -replace 'const PROXY_URL = getSetting\\(\\\"debug.overrideProxyUrl\\\"\\) \\?\\? undefined;', 'const PROXY_URL = process.env.GH_COPILOT_OVERRIDE_PROXY_URL ?? getSetting(\\\"debug.overrideProxyUrl\\\") ?? undefined;' | Set-Content '%EXTENSION_JS%'"

echo.
echo Patch completed successfully!
echo Now you can use GH_COPILOT_OVERRIDE_PROXY_URL environment variable with Copilot Chat 0.26.x
echo.
pause
`;
            
            const scriptPath = path.join(this.extensionPath, 'patch-copilot-chat.bat');
            fs.writeFileSync(scriptPath, scriptContent);
            
            this.log(`Patch script created at ${scriptPath}`);
            
            return scriptPath;
        } catch (error) {
            this.log(`Error creating patch script: ${error instanceof Error ? error.message : String(error)}`, true);
            return '';
        }
    }
    
    /**
     * Создает скрипт для настройки глобальных переменных HTTP_PROXY и HTTPS_PROXY
     * @returns Путь к созданному скрипту
     */
    public createProxySetupScript(): string {
        try {
            this.log('Creating proxy setup script');
            
            const port = this.proxyPort || 7001;
            const proxyUrl = `http://127.0.0.1:${port}`;
            
            const scriptContent = `@echo off
echo Setting up global proxy variables for Copilot Chat...
echo.

echo Current proxy settings:
echo HTTP_PROXY=%HTTP_PROXY%
echo HTTPS_PROXY=%HTTPS_PROXY%
echo.

set /p CONFIRM=Set HTTP_PROXY and HTTPS_PROXY to ${proxyUrl}? (Y/N): 
if /i "%CONFIRM%" neq "Y" exit /b

echo.
echo Setting user environment variables...
setx HTTP_PROXY "${proxyUrl}"
setx HTTPS_PROXY "${proxyUrl}"

echo.
echo Environment variables set successfully!
echo Please restart VS Code for changes to take effect.
echo.
pause
`;
            
            const scriptPath = path.join(this.extensionPath, 'setup-proxy-env.bat');
            fs.writeFileSync(scriptPath, scriptContent);
            
            this.log(`Proxy setup script created at ${scriptPath}`);
            
            return scriptPath;
        } catch (error) {
            this.log(`Error creating proxy setup script: ${error instanceof Error ? error.message : String(error)}`, true);
            return '';
        }
    }
    
    /**
     * Останавливает прокси-сервер
     */
    public stopProxy(): void {
        this.log('Stopping proxy server');
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            this.log('Cleared health check interval');
        }
        
        if (this.proxyProcess) {
            this.log(`Stopping proxy process on port ${this.proxyPort}`);
            this.isStopped = true;
            this.proxyProcess.kill();
            this.proxyProcess = null;
            this.proxyPort = null;
            this.log('Proxy process terminated');
        } else {
            this.log('No proxy process to stop');
        }
    }
}
