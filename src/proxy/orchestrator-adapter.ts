import * as path from 'path';
import * as fs from 'fs';

/**
 * Адаптер для взаимодействия с Orchestrator Core
 */
export class OrchestratorAdapter {
    /**
     * Обрабатывает входящие сообщения от пользователя
     * @param messages Массив сообщений
     * @param meta Метаданные запроса
     * @returns Обработанные сообщения
     */
    public async processPrompt(messages: any[], meta: any): Promise<any[]> {
        this.logRequest('inbound', { messages, meta });
        
        if (messages && messages.length > 0 && messages[0].content) {
            messages[0].content = `[DEBUG] ${messages[0].content}`;
        }
        
        return messages;
    }
    
    /**
     * Обрабатывает ответы от OpenAI API
     * @param chunk Часть ответа
     * @param meta Метаданные запроса
     * @returns Обработанный ответ
     */
    public async processResponse(chunk: any, meta: any): Promise<any> {
        this.logRequest('outbound', { chunk, meta });
        
        return chunk;
    }
    
    /**
     * Логирует запросы и ответы в формате JSON Lines
     * @param phase Фаза (inbound/outbound)
     * @param data Данные для логирования
     */
    private logRequest(phase: 'inbound' | 'outbound', data: any): void {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        const logDir = path.join(homeDir, '.orchestrator', 'logs');
        
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const now = new Date();
        const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
        const logFile = path.join(logDir, filename);
        
        const logEntry = {
            ts: now.toISOString(),
            phase,
            data
        };
        
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }
}
