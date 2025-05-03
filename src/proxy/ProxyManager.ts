import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';

/**
 * Класс для управления процессом прокси-сервера
 */
export class ProxyManager {
    private readonly proxyPath: string;
    private proxyPort: number | null = null;
    private proxyProcess: ChildProcess | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private isStopped: boolean = false;
    
    /**
     * Конструктор
     * @param context Контекст расширения
     */
    constructor(private context: vscode.ExtensionContext) {
        this.proxyPath = path.join(context.extensionPath, 'dist', 'proxy.js');
        console.log(`ProxyManager: Путь к прокси: ${this.proxyPath}`);
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
                    return port;
                }
            } catch (error) {
                console.error(`ProxyManager: Ошибка при проверке порта ${port}:`, error);
            }
        }
        
        console.warn('ProxyManager: Все порты в диапазоне 7001-7010 заняты');
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
            return false;
        }
        
        try {
            const url = `http://127.0.0.1:${this.proxyPort}/ping`;
            
            const response = await fetch(url, { 
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            return response.ok;
        } catch (error) {
            console.error('ProxyManager: Ошибка при проверке доступности прокси:', error);
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
            console.log(`ProxyManager: Запуск прокси на порту ${port}`);
            
            this.proxyProcess = spawn('node', [this.proxyPath, '--port', port.toString()], {
                cwd: path.dirname(this.proxyPath),
                env: {
                    ...process.env,
                    PORT: port.toString()
                }
            });
            
            this.proxyProcess.stdout?.on('data', (data) => {
                console.log(`Proxy stdout: ${data}`);
            });
            
            this.proxyProcess.stderr?.on('data', (data) => {
                console.error(`Proxy stderr: ${data}`);
            });
            
            this.proxyProcess.on('close', (code) => {
                console.log(`Proxy process exited with code ${code}`);
                this.proxyProcess = null;
                this.proxyPort = null;
                
                if (!this.isStopped) {
                    console.log('ProxyManager: Прокси-сервер неожиданно завершил работу, перезапускаем...');
                    this.ensureProxyAvailable();
                }
            });
            
            this.proxyPort = port;
            this.isStopped = false;
            
            this.setupHealthCheck();
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const isAvailable = await this.isProxyAvailable();
            if (!isAvailable) {
                console.error('ProxyManager: Прокси запущен, но не отвечает на проверку доступности');
                this.stopProxy();
                return false;
            }
            
            console.log(`ProxyManager: Прокси успешно запущен на порту ${port}`);
            
            if (!process.env.GH_COPILOT_OVERRIDE_PROXY_URL) {
                vscode.window.showWarningMessage(
                    'Переменная окружения GH_COPILOT_OVERRIDE_PROXY_URL не установлена. ' +
                    'Copilot Chat не будет использовать прокси. Запустите VS Code с этой переменной.'
                );
            }
            
            return true;
        } catch (error) {
            console.error('ProxyManager: Ошибка при запуске прокси:', error);
            return false;
        }
    }
    
    /**
     * Устанавливает интервал для проверки работоспособности прокси
     */
    private setupHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        this.healthCheckInterval = setInterval(async () => {
            if (this.proxyPort) {
                const isAvailable = await this.isProxyAvailable();
                if (!isAvailable && !this.isStopped) {
                    console.log('ProxyManager: Прокси не отвечает на проверку работоспособности, перезапускаем...');
                    this.restartProxy();
                }
            }
        }, 30000);
    }
    
    /**
     * Перезапускает прокси-сервер
     */
    private async restartProxy(): Promise<void> {
        this.stopProxy();
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const port = await this.findFreeProxyPort();
        await this.startProxy(port);
    }
    
    /**
     * Обеспечивает доступность прокси
     * @returns true, если прокси доступен или успешно запущен, иначе false
     */
    public async ensureProxyAvailable(): Promise<boolean> {
        try {
            const isAvailable = await this.isProxyAvailable();
            if (isAvailable) {
                console.log('ProxyManager: Прокси уже доступен');
                return true;
            }
            
            const port = await this.findFreeProxyPort();
            console.log(`ProxyManager: Найден свободный порт: ${port}`);
            
            const isStarted = await this.startProxy(port);
            if (!isStarted) {
                console.error('ProxyManager: Не удалось запустить прокси');
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('ProxyManager: Ошибка при обеспечении доступности прокси:', error);
            return false;
        }
    }
    
    /**
     * Останавливает прокси-сервер
     */
    public stopProxy(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        
        if (this.proxyProcess) {
            console.log('ProxyManager: Останавливаем прокси-сервер');
            this.isStopped = true;
            this.proxyProcess.kill();
            this.proxyProcess = null;
            this.proxyPort = null;
        }
    }
}
