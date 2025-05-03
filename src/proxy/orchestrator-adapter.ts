import * as path from 'path';
import * as fs from 'fs';

/**
 * Адаптер для взаимодействия с Orchestrator Core
 * В версии 0.5.3 работает полностью независимо
 */
export class OrchestratorAdapter {
    private logDir: string;
    private fileLoggingEnabled: boolean = false;
    
    constructor() {
        try {
            const homeDir = process.env.USERPROFILE || process.env.HOME || '';
            if (!homeDir) {
                console.error('Home directory not found, file logging disabled');
                this.fileLoggingEnabled = false;
                this.logDir = '';
                return;
            }
            
            this.logDir = path.join(homeDir, '.orchestrator', 'logs');
            
            this.ensureLogDirectoryExists();
            
            this.checkWritePermissions();
            
            console.log(`OrchestratorAdapter: Log directory initialized at ${this.logDir}`);
            console.log(`OrchestratorAdapter: File logging is ${this.fileLoggingEnabled ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error(`OrchestratorAdapter initialization error: ${error instanceof Error ? error.message : String(error)}`);
            this.fileLoggingEnabled = false;
            this.logDir = '';
        }
    }
    
    /**
     * Проверяет и создает директорию логов
     */
    private ensureLogDirectoryExists(): void {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
                console.log(`Created log directory: ${this.logDir}`);
            }
            this.fileLoggingEnabled = true;
        } catch (error) {
            console.error(`Failed to create log directory: ${error instanceof Error ? error.message : String(error)}`);
            this.fileLoggingEnabled = false;
        }
    }
    
    /**
     * Проверяет права на запись в директорию логов
     */
    private checkWritePermissions(): void {
        try {
            const testFile = path.join(this.logDir, 'test-write-permission.tmp');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            this.fileLoggingEnabled = true;
            console.log('Write permissions to log directory confirmed');
        } catch (error) {
            console.error(`No write permissions to log directory: ${error instanceof Error ? error.message : String(error)}`);
            this.fileLoggingEnabled = false;
        }
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
            
            if (messages && messages.length > 0 && messages[0].content) {
                const originalContent = messages[0].content;
                messages[0].content = `[PROXY v0.5.3] ${originalContent}`;
                this.log(`Modified first message: "${originalContent.substring(0, 50)}..." -> "[PROXY v0.5.3] ${originalContent.substring(0, 50)}..."`);
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
            
            return chunk;
        } catch (error) {
            this.log(`Error in processResponse: ${error instanceof Error ? error.message : String(error)}`, true);
            return chunk;
        }
    }
    
    /**
     * Логирует сообщения в консоль
     * @param message Сообщение для логирования
     * @param isError Флаг ошибки
     */
    private log(message: string, isError: boolean = false): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] ${message}`;
        
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
        // Всегда логируем в консоль
        this.log(`${phase.toUpperCase()} request received`);
        
        if (!this.fileLoggingEnabled || !this.logDir) {
            this.log('File logging is disabled, skipping file write', true);
            return;
        }
        
        try {
            this.ensureLogDirectoryExists();
            
            const now = new Date();
            const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
            const logFile = path.join(this.logDir, filename);
            
            // Формируем запись лога в формате JSON Lines
            const logEntry = {
                ts: now.toISOString(),
                phase,
                data
            };
            
            try {
                fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
                this.log(`Successfully logged ${phase} request to ${logFile}`);
            } catch (writeError) {
                this.log(`Failed to write to log file: ${writeError instanceof Error ? writeError.message : String(writeError)}`, true);
                
                if (!fs.existsSync(logFile)) {
                    try {
                        fs.writeFileSync(logFile, JSON.stringify(logEntry) + '\n');
                        this.log(`Created new log file and logged ${phase} request to ${logFile}`);
                    } catch (createError) {
                        this.log(`Failed to create log file: ${createError instanceof Error ? createError.message : String(createError)}`, true);
                    }
                }
            }
            
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
