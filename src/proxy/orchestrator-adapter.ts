import * as path from 'path';
import * as fs from 'fs';

/**
 * Интерфейс для VS Code OutputChannel
 * Используется для абстракции от конкретной реализации VS Code
 */
interface IOutputChannel {
    appendLine(value: string): void;
    show(): void;
}

/**
 * Реализация OutputChannel для использования вне VS Code
 */
class ConsoleOutputChannel implements IOutputChannel {
    constructor(private name: string) {
        console.log(`[${name}] Output channel created`);
    }
    
    appendLine(value: string): void {
        console.log(`[${this.name}] ${value}`);
    }
    
    show(): void {
    }
}

/**
 * Адаптер для взаимодействия с Orchestrator Core
 * В версии 0.5.3 работает с VS Code Output Panel для улучшенного логирования
 */
export class OrchestratorAdapter {
    private logDir: string = '';
    private fileLoggingEnabled: boolean = false;
    private outputChannel: IOutputChannel;
    
    constructor() {
        this.outputChannel = new ConsoleOutputChannel('ModularKB Proxy Requests');
        this.outputChannel.show();
        
        try {
            
            const homeDir = process.env.USERPROFILE || process.env.HOME || '';
            if (!homeDir) {
                this.logError('Home directory not found, file logging disabled');
                this.fileLoggingEnabled = false;
                this.logDir = '';
                return;
            }
            
            this.logDir = path.join(homeDir, '.orchestrator', 'logs');
            this.logInfo(`Log directory path: ${this.logDir}`);
            
            this.ensureLogDirectoryExists();
            this.checkWritePermissions();
            
            this.logInfo(`Log directory initialized at ${this.logDir}`);
            this.logInfo(`File logging is ${this.fileLoggingEnabled ? 'enabled' : 'disabled'}`);
            
            this.logTestEntry();
        } catch (error) {
            this.logError(`Initialization error: ${error instanceof Error ? error.message : String(error)}`);
            this.fileLoggingEnabled = false;
            this.logDir = '';
        }
    }
    
    /**
     * Создает тестовую запись в лог для проверки работоспособности
     */
    private logTestEntry(): void {
        try {
            if (!this.fileLoggingEnabled || !this.logDir) {
                this.logWarning('Cannot create test log entry: file logging is disabled');
                return;
            }
            
            const now = new Date();
            const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
            const logFile = path.join(this.logDir, filename);
            
            const testEntry = {
                ts: now.toISOString(),
                phase: 'test',
                data: { message: 'This is a test log entry to verify logging functionality' }
            };
            
            fs.appendFileSync(logFile, JSON.stringify(testEntry) + '\n');
            this.logInfo(`Created test log entry in ${logFile}`);
        } catch (error) {
            this.logError(`Failed to create test log entry: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Проверяет и создает директорию логов
     */
    private ensureLogDirectoryExists(): void {
        try {
            this.logInfo(`Checking if log directory exists: ${this.logDir}`);
            
            if (!fs.existsSync(this.logDir)) {
                this.logInfo(`Log directory does not exist, creating it: ${this.logDir}`);
                fs.mkdirSync(this.logDir, { recursive: true });
                this.logInfo(`Created log directory: ${this.logDir}`);
            } else {
                this.logInfo(`Log directory already exists: ${this.logDir}`);
            }
            
            this.fileLoggingEnabled = true;
        } catch (error) {
            this.logError(`Failed to create log directory: ${error instanceof Error ? error.message : String(error)}`);
            this.fileLoggingEnabled = false;
        }
    }
    
    /**
     * Проверяет права на запись в директорию логов
     */
    private checkWritePermissions(): void {
        try {
            this.logInfo(`Checking write permissions for log directory: ${this.logDir}`);
            
            const testFile = path.join(this.logDir, 'test-write-permission.tmp');
            this.logInfo(`Creating test file: ${testFile}`);
            
            fs.writeFileSync(testFile, 'test');
            this.logInfo(`Test file created successfully`);
            
            fs.unlinkSync(testFile);
            this.logInfo(`Test file removed successfully`);
            
            this.fileLoggingEnabled = true;
            this.logInfo('Write permissions to log directory confirmed');
        } catch (error) {
            this.logError(`No write permissions to log directory: ${error instanceof Error ? error.message : String(error)}`);
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
        this.logInfo(`Processing prompt with ${messages?.length || 0} messages`);
        
        try {
            this.logRequest('inbound', { messages, meta });
            
            if (messages && messages.length > 0 && messages[0].content) {
                const originalContent = messages[0].content;
                messages[0].content = `[PROXY v0.5.3] ${originalContent}`;
                this.logInfo(`Modified first message: "${originalContent.substring(0, 50)}..." -> "[PROXY v0.5.3] ${originalContent.substring(0, 50)}..."`);
            } else {
                this.logInfo('No messages to modify or first message has no content');
            }
            
            return messages;
        } catch (error) {
            this.logError(`Error in processPrompt: ${error instanceof Error ? error.message : String(error)}`);
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
            this.logInfo(`Processing response chunk`);
            
            this.logRequest('outbound', { chunk, meta });
            
            return chunk;
        } catch (error) {
            this.logError(`Error in processResponse: ${error instanceof Error ? error.message : String(error)}`);
            return chunk;
        }
    }
    
    /**
     * Логирует информационное сообщение
     * @param message Сообщение для логирования
     */
    private logInfo(message: string): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] INFO: ${message}`;
        
        console.log(formattedMessage);
        this.outputChannel.appendLine(formattedMessage);
    }
    
    /**
     * Логирует предупреждение
     * @param message Сообщение для логирования
     */
    private logWarning(message: string): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] WARNING: ${message}`;
        
        console.warn(formattedMessage);
        this.outputChannel.appendLine(formattedMessage);
    }
    
    /**
     * Логирует ошибку
     * @param message Сообщение для логирования
     */
    private logError(message: string): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] ERROR: ${message}`;
        
        console.error(formattedMessage);
        this.outputChannel.appendLine(formattedMessage);
    }
    
    /**
     * Логирует запросы и ответы в формате JSON Lines
     * @param phase Фаза (inbound/outbound)
     * @param data Данные для логирования
     */
    private logRequest(phase: 'inbound' | 'outbound', data: any): void {
        // Всегда логируем в VS Code Output
        this.logInfo(`${phase.toUpperCase()} request received`);
        
        // Если это входящий запрос, выводим содержимое первого сообщения
        if (phase === 'inbound' && data.messages && data.messages.length > 0) {
            const firstMessage = data.messages[0];
            if (firstMessage.content) {
                this.logInfo(`First message content: "${firstMessage.content.substring(0, 100)}${firstMessage.content.length > 100 ? '...' : ''}"`);
            }
        }
        
        if (!this.fileLoggingEnabled || !this.logDir) {
            this.logWarning('File logging is disabled, skipping file write');
            return;
        }
        
        try {
            this.ensureLogDirectoryExists();
            
            const now = new Date();
            const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
            const logFile = path.join(this.logDir, filename);
            
            this.logInfo(`Writing to log file: ${logFile}`);
            
            // Формируем запись лога в формате JSON Lines
            const logEntry = {
                ts: now.toISOString(),
                phase,
                data
            };
            
            try {
                fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
                this.logInfo(`Successfully logged ${phase} request to ${logFile}`);
            } catch (writeError) {
                this.logError(`Failed to write to log file: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
                
                if (!fs.existsSync(logFile)) {
                    try {
                        this.logInfo(`Attempting to create new log file: ${logFile}`);
                        fs.writeFileSync(logFile, JSON.stringify(logEntry) + '\n');
                        this.logInfo(`Created new log file and logged ${phase} request to ${logFile}`);
                    } catch (createError) {
                        this.logError(`Failed to create log file: ${createError instanceof Error ? createError.message : String(createError)}`);
                    }
                }
            }
        } catch (error) {
            this.logError(`Error in logRequest: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
