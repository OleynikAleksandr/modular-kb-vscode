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
            
            const proxyUrl = process.env.GH_COPILOT_OVERRIDE_PROXY_URL;
            if (!proxyUrl) {
                this.log('GH_COPILOT_OVERRIDE_PROXY_URL environment variable not set', true);
                console.warn(
                    'Environment variable GH_COPILOT_OVERRIDE_PROXY_URL is not set. ' +
                    'Copilot Chat will not use the proxy. Launch VS Code with this variable set.'
                );
                
                // ВАЖНО: Для интеграции с VS Code в будущем:
                // vscode.window.showWarningMessage(
                //     'Environment variable GH_COPILOT_OVERRIDE_PROXY_URL is not set. ' +
                //     'Copilot Chat will not use the proxy. Launch VS Code with this variable set.'
                // );
            } else {
                this.log(`GH_COPILOT_OVERRIDE_PROXY_URL is set to: ${proxyUrl}`);
            }
            
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
