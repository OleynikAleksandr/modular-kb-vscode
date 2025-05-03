import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Адаптер для взаимодействия с Orchestrator Core
 * В версии 0.5.1 работает независимо от Orchestrator
 */
export class OrchestratorAdapter {
    private outputChannel: vscode.OutputChannel;
    
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('ModularKB Proxy');
        this.outputChannel.show();
        this.log('OrchestratorAdapter initialized');
    }
    
    /**
     * Обрабатывает входящие сообщения от пользователя
     * @param messages Массив сообщений
     * @param meta Метаданные запроса
     * @returns Обработанные сообщения
     */
    public async processPrompt(messages: any[], meta: any): Promise<any[]> {
        this.log(`Processing prompt with ${messages?.length || 0} messages`);
        
        try {
            this.logRequest('inbound', { messages, meta });
            
            // ЗАГЛУШКА: В будущем здесь будет интеграция с Orchestrator Core
            /*
            if (orchestratorCore && orchestratorCore.isAvailable()) {
                return await orchestratorCore.processMessages(messages, meta);
            }
            */
            
            if (messages && messages.length > 0 && messages[0].content) {
                const originalContent = messages[0].content;
                messages[0].content = `[PROXY v0.5.1] ${originalContent}`;
                this.log(`Modified first message: "${originalContent.substring(0, 50)}..." -> "[PROXY v0.5.1] ${originalContent.substring(0, 50)}..."`);
            } else {
                this.log('No messages to modify or first message has no content');
            }
            
            return messages;
        } catch (error) {
            this.log(`Error in processPrompt: ${error instanceof Error ? error.message : String(error)}`, true);
            // В случае ошибки возвращаем исходные сообщения
            return messages;
        }
    }
    
    /**
     * Обрабатывает ответы от OpenAI API
     * @param chunk Часть ответа
     * @param meta Метаданные запроса
     * @returns Обработанный ответ
     */
    public async processResponse(chunk: any, meta: any): Promise<any> {
        try {
            this.log(`Processing response chunk`);
            
            this.logRequest('outbound', { chunk, meta });
            
            // ЗАГЛУШКА: В будущем здесь будет интеграция с Orchestrator Core
            /*
            if (orchestratorCore && orchestratorCore.isAvailable()) {
                return await orchestratorCore.processResponse(chunk, meta);
            }
            */
            
            return chunk;
        } catch (error) {
            this.log(`Error in processResponse: ${error instanceof Error ? error.message : String(error)}`, true);
            return chunk;
        }
    }
    
    /**
     * Логирует сообщения в канал вывода VS Code
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
     * Логирует запросы и ответы в формате JSON Lines
     * @param phase Фаза (inbound/outbound)
     * @param data Данные для логирования
     */
    private logRequest(phase: 'inbound' | 'outbound', data: any): void {
        try {
            const homeDir = process.env.USERPROFILE || process.env.HOME || '';
            const logDir = path.join(homeDir, '.orchestrator', 'logs');
            
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                this.log(`Created log directory: ${logDir}`);
            }
            
            const now = new Date();
            const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
            const logFile = path.join(logDir, filename);
            
            // Формируем запись лога в формате JSON Lines
            const logEntry = {
                ts: now.toISOString(),
                phase,
                data
            };
            
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
            
            this.log(`Logged ${phase} request to ${logFile}`);
            
            if (phase === 'inbound' && data.messages && data.messages.length > 0) {
                const firstMessage = data.messages[0];
                if (firstMessage.content) {
                    this.log(`First message content: "${firstMessage.content.substring(0, 100)}${firstMessage.content.length > 100 ? '...' : ''}"`);
                }
            }
        } catch (error) {
            this.log(`Error in logRequest: ${error instanceof Error ? error.message : String(error)}`, true);
        }
    }
}
