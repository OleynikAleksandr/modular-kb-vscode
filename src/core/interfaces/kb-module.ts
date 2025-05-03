/**
 * Интерфейс для реестра MCP-инструментов
 */
export interface IMcpRegistry {
    /**
     * Регистрация инструмента в MCP
     * @param name Имя инструмента
     * @param toolType Тип инструмента
     */
    registerTool(name: string, toolType: any): void;
}

/**
 * Интерфейс для коллекции сервисов
 */
export interface IServiceCollection {
    /**
     * Добавление сервиса с областью видимости "scoped"
     * @param serviceType Тип сервиса (интерфейс)
     * @param implementationType Тип реализации
     */
    addScoped<T, U extends T>(serviceType: any, implementationType: any): IServiceCollection;
    
    /**
     * Добавление сервиса с областью видимости "singleton"
     * @param serviceType Тип сервиса (интерфейс)
     * @param implementationType Тип реализации
     */
    addSingleton<T, U extends T>(serviceType: any, implementationType: any): IServiceCollection;
    
    /**
     * Добавление фонового сервиса
     * @param serviceType Тип сервиса
     */
    addHostedService<T>(serviceType: any): IServiceCollection;
}

/**
 * Интерфейс для модуля базы знаний
 */
export interface IKbModule {
    /**
     * Конфигурация модуля
     * @param services Коллекция сервисов для регистрации зависимостей
     * @param mcpRegistry Реестр MCP для регистрации инструментов
     */
    configure(services: IServiceCollection, mcpRegistry: IMcpRegistry): void;
}
