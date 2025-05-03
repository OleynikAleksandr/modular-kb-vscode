import * as vscode from 'vscode';

/**
 * Интерфейс для реестра модулей
 */
export interface IModuleRegistry {
    registerModule(module: IModule): Promise<void>;
    getModule<T extends IModule>(id: string): T | undefined;
    listModules(): IModuleMetadata[];
}

/**
 * Базовый интерфейс для всех модулей в системе
 */
export interface IModule {
    /**
     * Уникальный идентификатор модуля
     */
    id: string;
    
    /**
     * Версия модуля в формате семантического версионирования
     */
    version: string;
    
    /**
     * Название модуля для отображения
     */
    displayName: string;
    
    /**
     * Описание модуля
     */
    description: string;
    
    /**
     * Инициализация модуля
     * @param context Контекст расширения VS Code
     * @param registry Реестр модулей для взаимодействия с другими модулями
     */
    initialize(context: vscode.ExtensionContext, registry: IModuleRegistry): Promise<void>;
    
    /**
     * Активация модуля
     */
    activate(): Promise<void>;
    
    /**
     * Деактивация модуля
     */
    deactivate(): Promise<void>;
}

/**
 * Метаданные модуля
 */
export interface IModuleMetadata {
    id: string;
    version: string;
    displayName: string;
    description: string;
    dependencies?: string[];
}
