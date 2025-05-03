import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as yauzl from 'yauzl';
import { IModule, IModuleMetadata, IModuleRegistry } from '../interfaces/module';
import { CoreManager } from '../CoreManager';

// Функция для подробного логирования
function logToFile(message: string) {
    const logDir = path.join(os.tmpdir(), 'modular-kb-logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'module-registry.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    console.log(message); // Дублируем в консоль

    // Показываем важные сообщения в интерфейсе
    if (message.includes('ОШИБКА') || message.includes('Error')) {
        vscode.window.showErrorMessage(`Диагностика: ${message}`);
    } else if (message.includes('Найден') || message.includes('успешно')) {
        vscode.window.showInformationMessage(`Диагностика: ${message}`);
    }
}

/**
 * Интерфейс для описания модуля в реестре
 */
interface IModuleRegistryItem {
    id: string;
    version: string;
    displayName: string;
    description: string;
    downloadUrl: string;
    author: string;
    dependencies: string[];
}

/**
 * Интерфейс для реестра модулей
 */
interface IModulesRegistry {
    modules: IModuleRegistryItem[];
}

/**
 * Module Registry - central component for managing modules
 */
export class ModuleRegistry implements IModuleRegistry {
    private modules: Map<string, IModule> = new Map();
    private context: vscode.ExtensionContext;
    private modulesDir: string;

    // URL реестра модулей
    private readonly registryUrl = 'https://raw.githubusercontent.com/OleynikAleksandr/modular-kb-modules-registry/main/modules-registry.json';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        // Получаем путь к директории с внешними модулями в зависимости от IDE
        this.modulesDir = this.getModulesPath(context);

        // Создаем директорию для модулей, если она не существует
        if (!fs.existsSync(this.modulesDir)) {
            fs.mkdirSync(this.modulesDir, { recursive: true });
        }

        console.log('ModuleRegistry: Initialized');
        console.log(`ModuleRegistry: Modules directory: ${this.modulesDir}`);
        console.log(`ModuleRegistry: IDE: ${vscode.env.appName}`);
    }

    /**
     * Определение пути к директории с модулями в зависимости от IDE
     * @param context Контекст расширения
     * @returns Путь к директории с модулями
     */
    private getModulesPath(context: vscode.ExtensionContext): string {
        // Получаем базовый путь расширения
        const extensionPath = context.extensionPath;
        console.log(`ModuleRegistry: Текущий путь расширения: ${extensionPath}`);

        // Определяем, какая IDE используется
        const appName = vscode.env.appName;
        console.log(`ModuleRegistry: Имя приложения: ${appName}`);

        // Используем USERPROFILE для получения домашней директории пользователя
        const userHome = process.env.USERPROFILE || process.env.HOME || '';
        let extensionParts = extensionPath.split(path.sep);
        let installedVersion = '0.0.0';

        // Ищем версию в пути
        for (const part of extensionParts) {
            if (part.includes('modularkb.modularkb-extension-')) {
                installedVersion = part.replace('modularkb.modularkb-extension-', '');
                console.log(`ModuleRegistry: Найдена версия в пути: ${installedVersion}`);
                break;
            }
        }

        let modulesPath = '';

        // Распознаем IDE и формируем путь с правильным расположением директорий расширений
        if (appName.includes('Visual Studio Code')) {
            // Правильный путь для VS Code
            modulesPath = path.join(userHome, '.vscode', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            logToFile(`ДИАГНОСТИКА: Определен путь к модулям VS Code: ${modulesPath}`);
        } else if (appName.includes('Cursor')) {
            // Правильный путь для Cursor
            modulesPath = path.join(userHome, '.cursor', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            logToFile(`ДИАГНОСТИКА: Определен путь к модулям Cursor: ${modulesPath}`);
        } else if (appName.includes('Windsurf')) {
            // Правильный путь для Windsurf
            modulesPath = path.join(userHome, '.windsurf', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            logToFile(`ДИАГНОСТИКА: Определен путь к модулям Windsurf: ${modulesPath}`);
        } else if (appName.includes('Trae')) {
            // Правильный путь для Trae
            modulesPath = path.join(userHome, '.trae', 'extensions', `modularkb.modularkb-extension-${installedVersion}`, 'modules');
            logToFile(`ДИАГНОСТИКА: Определен путь к модулям Trae: ${modulesPath}`);
        } else {
            // По умолчанию используем путь из контекста
            modulesPath = path.join(extensionPath, 'modules');
            logToFile(`ДИАГНОСТИКА: Используется путь по умолчанию: ${modulesPath}`);
        }

        console.log(`ModuleRegistry: Итоговый путь к модулям: ${modulesPath}`);

        return modulesPath;
    }

    /**
     * Register a module in the system
     * @param module Module instance to register
     */
    public async registerModule(module: IModule): Promise<void> {
        console.log(`ModuleRegistry: Attempting to register module ${module.id} (${module.displayName})`);

        if (this.modules.has(module.id)) {
            console.warn(`ModuleRegistry: Module with ID ${module.id} is already registered`);
            return;
        }

        try {
            console.log(`ModuleRegistry: Initializing module ${module.id}...`);

            // Initialize the module
            await module.initialize(this.context, this);

            console.log(`ModuleRegistry: Module ${module.id} initialized successfully`);

            // Add module to registry
            this.modules.set(module.id, module);

            console.log(`ModuleRegistry: Module ${module.id} (${module.version}) successfully registered`);
            console.log(`ModuleRegistry: Current module count: ${this.modules.size}`);
        } catch (error) {
            console.error(`ModuleRegistry: Error registering module ${module.id}:`, error);
            if (error instanceof Error) {
                console.error(`ModuleRegistry: Error details: ${error.message}`);
                console.error(`ModuleRegistry: Stack trace: ${error.stack}`);
            }
            throw error;
        }
    }

    /**
     * Get a module by ID
     * @param id Module ID
     */
    public getModule<T extends IModule>(id: string): T | undefined {
        return this.modules.get(id) as T | undefined;
    }

    /**
     * Get a list of all registered modules
     */
    public listModules(): IModuleMetadata[] {
        console.log(`ModuleRegistry: Listing modules. Current count: ${this.modules.size}`);

        const moduleList: IModuleMetadata[] = [];

        if (this.modules.size === 0) {
            console.log('ModuleRegistry: No modules registered');
            return moduleList;
        }

        this.modules.forEach((module, id) => {
            console.log(`ModuleRegistry: Found module ${id} (${module.displayName})`);
            moduleList.push({
                id: module.id,
                version: module.version,
                displayName: module.displayName,
                description: module.description
            });
        });

        console.log(`ModuleRegistry: Returning ${moduleList.length} modules`);
        return moduleList;
    }

    /**
     * Activate all registered modules
     */
    public async activateAllModules(): Promise<void> {
        for (const [id, module] of this.modules.entries()) {
            try {
                await module.activate();
                console.log(`ModuleRegistry: Module ${id} activated`);
            } catch (error) {
                console.error(`ModuleRegistry: Error activating module ${id}:`, error);
            }
        }
    }

    /**
     * Загрузка реестра модулей из репозитория
     * @returns Промис с реестром модулей
     */
    public async fetchModulesRegistry(): Promise<IModulesRegistry> {
        console.log(`ModuleRegistry: Загрузка реестра модулей из ${this.registryUrl}`);

        return new Promise<IModulesRegistry>((resolve, reject) => {
            // Устанавливаем таймаут в 10 секунд
            const request = https.get(this.registryUrl, { timeout: 10000 }, (response) => {
                // Обработка перенаправлений (301, 302, 307, 308)
                if (response.statusCode === 301 || response.statusCode === 302 ||
                    response.statusCode === 307 || response.statusCode === 308) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        console.log(`ModuleRegistry: Перенаправление на: ${redirectUrl}`);
                        // Следуем за перенаправлением с таймаутом
                        https.get(redirectUrl, { timeout: 10000 }, (redirectResponse) => {
                            if (redirectResponse.statusCode !== 200) {
                                const errorMsg = `Ошибка после перенаправления: ${redirectResponse.statusCode} ${redirectResponse.statusMessage}`;
                                console.error(`ModuleRegistry: ${errorMsg}`);
                                reject(new Error(errorMsg));
                                return;
                            }

                            let data = '';
                            redirectResponse.on('data', (chunk) => {
                                data += chunk;
                            });

                            redirectResponse.on('end', () => {
                                try {
                                    const registry = JSON.parse(data) as IModulesRegistry;
                                    console.log(`ModuleRegistry: Успешно загружен реестр с ${registry.modules.length} модулями`);
                                    resolve(registry);
                                } catch (error) {
                                    const errorMsg = `Ошибка парсинга реестра модулей: ${error}`;
                                    console.error(`ModuleRegistry: ${errorMsg}`);
                                    reject(new Error(errorMsg));
                                }
                            });
                        }).on('error', (error) => {
                            const errorMsg = `Ошибка при следовании за перенаправлением: ${error.message}`;
                            console.error(`ModuleRegistry: ${errorMsg}`);
                            reject(new Error(errorMsg));
                        });
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    const errorMsg = `Ошибка загрузки реестра модулей: ${response.statusCode} ${response.statusMessage}`;
                    console.error(`ModuleRegistry: ${errorMsg}`);
                    reject(new Error(errorMsg));
                    return;
                }

                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const registry = JSON.parse(data) as IModulesRegistry;
                        console.log(`ModuleRegistry: Успешно загружен реестр с ${registry.modules.length} модулями`);
                        resolve(registry);
                    } catch (error) {
                        const errorMsg = `Ошибка парсинга реестра модулей: ${error}`;
                        console.error(`ModuleRegistry: ${errorMsg}`);
                        reject(new Error(errorMsg));
                    }
                });
            });

            request.on('error', (error) => {
                const errorMsg = `Ошибка загрузки реестра модулей: ${error.message}`;
                console.error(`ModuleRegistry: ${errorMsg}`);
                reject(new Error(errorMsg));
            });

            // Устанавливаем таймаут на уровне запроса
            request.setTimeout(10000, () => {
                console.error('ModuleRegistry: Таймаут запроса при загрузке реестра модулей');
                reject(new Error('Таймаут запроса при загрузке реестра модулей'));
                request.destroy();
            });

            request.end();
        });
    }

    /**
     * Получение списка доступных для установки модулей
     * @returns Список модулей, которые можно установить
     */
    public async getAvailableModules(): Promise<IModuleRegistryItem[]> {
        try {
            // Загружаем реестр модулей
            let registry: IModulesRegistry;

            try {
                // Сначала пытаемся загрузить с GitHub
                registry = await this.fetchModulesRegistry();
            } catch (error) {
                console.warn('ModuleRegistry: Не удалось загрузить реестр с GitHub, пробуем использовать локальный файл', error);

                // Пробуем загрузить локальный файл реестра для тестирования
                const localRegistryPath = path.join(this.context.extensionPath, '..', 'modules-build', 'modules-registry.json');

                try {
                    console.log(`ModuleRegistry: Попытка загрузить локальный файл реестра из ${localRegistryPath}`);

                    if (fs.existsSync(localRegistryPath)) {
                        const registryContent = fs.readFileSync(localRegistryPath, 'utf8');
                        registry = JSON.parse(registryContent) as IModulesRegistry;
                        console.log(`ModuleRegistry: Успешно загружен локальный реестр с ${registry.modules.length} модулями`);
                    } else {
                        console.error(`ModuleRegistry: Локальный файл реестра не найден: ${localRegistryPath}`);
                        throw new Error('Не удалось загрузить реестр модулей ни с GitHub, ни из локального файла');
                    }
                } catch (localError) {
                    console.error('ModuleRegistry: Ошибка при загрузке локального файла реестра:', localError);
                    throw new Error('Не удалось загрузить реестр модулей ни с GitHub, ни из локального файла');
                }
            }

            // Получаем список уже установленных модулей
            const installedModuleIds = Array.from(this.modules.keys());

            // Фильтруем список, исключая уже установленные модули
            return registry.modules.filter(module => !installedModuleIds.includes(module.id));
        } catch (error) {
            console.error('ModuleRegistry: Error getting available modules:', error);
            throw error;
        }
    }

    /**
     * Deactivate all registered modules
     */
    public async deactivateAllModules(): Promise<void> {
        for (const [id, module] of this.modules.entries()) {
            try {
                await module.deactivate();
                console.log(`ModuleRegistry: Module ${id} deactivated`);
            } catch (error) {
                console.error(`ModuleRegistry: Error deactivating module ${id}:`, error);
            }
        }
    }

    /**
     * Загрузка внешнего модуля из директории
     * @param modulePath Путь к директории с модулем
     */
    public async loadExternalModule(modulePath: string): Promise<void> {
        try {
            logToFile(`ДИАГНОСТИКА: Начало загрузки внешнего модуля из ${modulePath}`);

            // Проверяем существование директории
            if (!fs.existsSync(modulePath)) {
                const errorMsg = `Директория модуля не существует: ${modulePath}`;
                logToFile(`ОШИБКА: ${errorMsg}`);
                throw new Error(errorMsg);
            } else {
                logToFile(`ДИАГНОСТИКА: Директория модуля существует: ${modulePath}`);

                // Выводим список файлов в директории модуля
                try {
                    const files = fs.readdirSync(modulePath);
                    logToFile(`ДИАГНОСТИКА: Содержимое директории модуля:`);
                    for (const file of files) {
                        const filePath = path.join(modulePath, file);
                        const stats = fs.statSync(filePath);
                        logToFile(`  - ${file} [${stats.isDirectory() ? 'Директория' : 'Файл'}]`);
                    }
                } catch (e) {
                    logToFile(`ОШИБКА при чтении содержимого директории модуля: ${e}`);
                }
            }

            // Проверяем наличие package.json
            const packageJsonPath = path.join(modulePath, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                const errorMsg = `Файл package.json не найден в: ${packageJsonPath}`;
                logToFile(`ОШИБКА: ${errorMsg}`);
                throw new Error(errorMsg);
            } else {
                logToFile(`ДИАГНОСТИКА: Найден package.json: ${packageJsonPath}`);
            }

            // Загружаем package.json
            logToFile(`ДИАГНОСТИКА: Чтение файла package.json: ${packageJsonPath}`);
            let packageJsonContent;
            try {
                packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
                logToFile(`ДИАГНОСТИКА: Успешно прочитан файл package.json, размер: ${packageJsonContent.length} байт`);
            } catch (e) {
                const errorMsg = `Ошибка при чтении package.json: ${e}`;
                logToFile(`ОШИБКА: ${errorMsg}`);
                throw new Error(errorMsg);
            }

            let modulePkg;
            try {
                modulePkg = JSON.parse(packageJsonContent);
                logToFile(`ДИАГНОСТИКА: Успешно распарсен package.json`);
                logToFile(`ДИАГНОСТИКА: Данные модуля: id=${modulePkg.id || 'не задан'}, name=${modulePkg.name || 'не задано'}, version=${modulePkg.version || 'не задана'}`);

                // Проверяем наличие команд
                if (modulePkg.contributes && modulePkg.contributes.commands) {
                    logToFile(`ДИАГНОСТИКА: Найдено команд в модуле: ${modulePkg.contributes.commands.length}`);
                    for (const cmd of modulePkg.contributes.commands) {
                        logToFile(`ДИАГНОСТИКА:   - Команда: ${cmd.command}, Название: ${cmd.title}`);
                    }
                } else {
                    logToFile(`ДИАГНОСТИКА: В модуле не найдены команды`);
                }
            } catch (e) {
                const error = e as Error;
                const errorMsg = `Ошибка при парсинге package.json: ${error.message}`;
                logToFile(`ОШИБКА: ${errorMsg}`);
                throw new Error(errorMsg);
            }

            // Создаем модуль вручную на основе данных из package.json
            logToFile(`ДИАГНОСТИКА: Создание экземпляра модуля на основе package.json`);

            // Здесь добавим проверку имени модуля
            const moduleId = modulePkg.id || modulePkg.name || 'external-module';
            const moduleName = modulePkg.name || 'external-module';

            // Дополнительная проверка для модуля Core
            if (moduleName === 'kb-core' || moduleId === 'kb-core' || modulePath.includes('kb-core')) {
                logToFile(`ДИАГНОСТИКА: Обнаружен модуль kb-core! Путь: ${modulePath}, Имя: ${moduleName}, ID: ${moduleId}`);
                // Проверяем наличие KB.Orchestrator.dll в директории модуля
                const dllPath = path.join(modulePath, 'KB.Orchestrator.dll');
                if (fs.existsSync(dllPath)) {
                    logToFile(`ДИАГНОСТИКА: Найден файл KB.Orchestrator.dll: ${dllPath}`);
                } else {
                    logToFile(`ОШИБКА: В модуле kb-core не найден файл KB.Orchestrator.dll: ${dllPath}`);
                }
            }

            const moduleInstance: IModule = {
                id: moduleId,
                version: modulePkg.version || '1.0.0',
                displayName: modulePkg.displayName || modulePkg.name || 'External Module',
                description: modulePkg.description || 'External module for Modular KB',

                // Реализуем методы интерфейса IModule
                initialize: async (context: vscode.ExtensionContext, registry: IModuleRegistry) => {
                    console.log(`ModuleRegistry: Инициализация модуля ${moduleInstance.id}`);
                    // Здесь можно добавить код инициализации, если необходимо
                },

                activate: async () => {
                    console.log(`ModuleRegistry: Активация модуля ${moduleInstance.id}`);
                    // Здесь можно добавить код активации, если необходимо

                    // Регистрируем команды или другие функции модуля
                    if (modulePkg.contributes && modulePkg.contributes.commands) {
                        console.log(`ModuleRegistry: Модуль ${moduleInstance.id} имеет ${modulePkg.contributes.commands.length} команд`);

                        // Регистрируем каждую команду из package.json модуля
                        for (const commandDef of modulePkg.contributes.commands) {
                            try {
                                if (commandDef.command && commandDef.title) {
                                    console.log(`ModuleRegistry: Регистрация команды ${commandDef.command}`);

                                    // Регистрируем команду
                                    const command = vscode.commands.registerCommand(commandDef.command, async () => {
                                        console.log(`Выполнена команда модуля: ${commandDef.command}`);

                                        // Если это команда запуска Core
                                        if (commandDef.command === 'kb.startCore') {
                                            console.log('ModuleRegistry: Запуск Core...');

                                            // Создаем экземпляр CoreManager для работы с модулем
                                            const coreManager = new CoreManager(this.context);

                                            // Вызываем метод ensureCoreAvailable, который сам найдет модуль Core и запустит его
                                            coreManager.ensureCoreAvailable();
                                        }
                                    });

                                    // Добавляем команду в context
                                    this.context.subscriptions.push(command);

                                    // Регистрируем команду в палитре команд динамически
                                    this.registerCommandInPalette(commandDef.command, commandDef.title, commandDef.category);
                                }
                            } catch (e) {
                                console.error(`ModuleRegistry: Ошибка при регистрации команды ${commandDef.command}:`, e);
                            }
                        }
                    }
                },

                deactivate: async () => {
                    console.log(`ModuleRegistry: Деактивация модуля ${moduleInstance.id}`);
                    // Здесь можно добавить код деактивации, если необходимо
                }
            };

            // Регистрируем модуль
            logToFile(`ДИАГНОСТИКА: Попытка регистрации модуля ${moduleInstance.id}`);
            try {
                await this.registerModule(moduleInstance);
                logToFile(`ДИАГНОСТИКА: Модуль ${moduleInstance.id} успешно зарегистрирован`);
            } catch (e) {
                logToFile(`ОШИБКА при регистрации модуля ${moduleInstance.id}: ${e}`);
                throw e;
            }

            logToFile(`ДИАГНОСТИКА: Внешний модуль ${moduleInstance.id} успешно загружен`);

            // Активируем модуль
            logToFile(`ДИАГНОСТИКА: Попытка активации модуля ${moduleInstance.id}`);
            try {
                await moduleInstance.activate();
                logToFile(`ДИАГНОСТИКА: Модуль ${moduleInstance.id} успешно активирован`);
            } catch (e) {
                logToFile(`ОШИБКА при активации модуля ${moduleInstance.id}: ${e}`);
                throw e;
            }

        } catch (error) {
            console.error(`ModuleRegistry: Ошибка загрузки внешнего модуля:`, error);
            if (error instanceof Error) {
                console.error(`ModuleRegistry: Детали ошибки: ${error.message}`);
                console.error(`ModuleRegistry: Стек ошибки: ${error.stack}`);
            }
            throw error;
        }
    }

    /**
     * Обработка экспорта модуля
     * @param moduleExports Экспорты модуля
     * @param modulePath Путь к модулю
     */
    private async processModuleExports(moduleExports: any, modulePath: string): Promise<void> {
        // Проверяем наличие функции createModule или класса модуля
        if (typeof moduleExports.createModule === 'function') {
            // Создаем экземпляр модуля через функцию createModule
            const moduleInstance = moduleExports.createModule();
            await this.registerAndActivateModule(moduleInstance);
        } else if (moduleExports.default && typeof moduleExports.default.createModule === 'function') {
            // Если функция createModule находится в default экспорте
            const moduleInstance = moduleExports.default.createModule();
            await this.registerAndActivateModule(moduleInstance);
        } else if (moduleExports.default && typeof moduleExports.default === 'function') {
            // Если default экспорт - это функция-конструктор
            const ModuleClass = moduleExports.default;
            const moduleInstance = new ModuleClass();
            await this.registerAndActivateModule(moduleInstance);
        } else if (typeof moduleExports === 'function') {
            // Если сам экспорт - это функция-конструктор
            const ModuleClass = moduleExports;
            const moduleInstance = new ModuleClass();
            await this.registerAndActivateModule(moduleInstance);
        } else {
            // Если ничего не нашли, пробуем найти класс, реализующий IModule
            let moduleInstance = null;

            // Проверяем все экспорты на наличие класса, реализующего IModule
            for (const key in moduleExports) {
                if (typeof moduleExports[key] === 'function') {
                    try {
                        const instance = new moduleExports[key]();
                        if (instance.id && instance.version && typeof instance.initialize === 'function' &&
                            typeof instance.activate === 'function' && typeof instance.deactivate === 'function') {
                            moduleInstance = instance;
                            break;
                        }
                    } catch (e) {
                        // Игнорируем ошибки при создании экземпляра
                    }
                }
            }

            if (moduleInstance) {
                await this.registerAndActivateModule(moduleInstance);
            } else {
                throw new Error(`Модуль не экспортирует функцию createModule или класс, реализующий IModule`);
            }
        }
    }

    /**
     * Регистрация и активация модуля
     * @param moduleInstance Экземпляр модуля
     */
    private async registerAndActivateModule(moduleInstance: IModule): Promise<void> {
        // Регистрируем модуль
        await this.registerModule(moduleInstance);

        console.log(`ModuleRegistry: Внешний модуль ${moduleInstance.id} успешно загружен`);

        // Активируем модуль
        await moduleInstance.activate();
    }

    /**
     * Открывает диалог выбора ZIP-файла и устанавливает выбранный модуль
     * @returns Promise<void>
     */
    public async installLocalModule(): Promise<void> {
        try {
            // Показываем диалог выбора файла
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'ZIP archives': ['zip']
                },
                title: 'Выберите ZIP-архив модуля для установки'
            });

            if (!fileUris || fileUris.length === 0) {
                console.log('ModuleRegistry: Пользователь не выбрал файл');
                return;
            }

            const filePath = fileUris[0].fsPath;
            console.log(`ModuleRegistry: Выбран файл: ${filePath}`);

            // Получаем имя модуля из имени файла (без расширения)
            const fileName = path.basename(filePath);
            const moduleName = fileName.replace(/\.zip$/i, '');

            // Показываем прогресс-бар
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Установка модуля ${moduleName}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Начало установки...' });

                // Устанавливаем модуль из ZIP-архива
                await this.installModuleFromZip(filePath, moduleName);

                progress.report({ increment: 100, message: 'Установка завершена' });
            });

            // Показываем уведомление об успешной установке
            vscode.window.showInformationMessage(`Модуль ${moduleName} успешно установлен`);

        } catch (error) {
            console.error('ModuleRegistry: Ошибка при установке локального модуля:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Ошибка при установке модуля: ${error.message}`);
            } else {
                vscode.window.showErrorMessage('Неизвестная ошибка при установке модуля');
            }
        }
    }

    /**
     * Загрузка модуля из репозитория GitHub
     * @param repoUrl URL репозитория GitHub
     */
    public async loadModuleFromGitHub(repoUrl: string): Promise<void> {
        try {
            console.log(`ModuleRegistry: Loading module from GitHub repository: ${repoUrl}`);

            // Проверяем, что URL является GitHub репозиторием
            if (!repoUrl.startsWith('https://github.com/')) {
                throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
            }

            // Создаем временную директорию для клонирования репозитория
            const tempDir = path.join(os.tmpdir(), `modular-kb-module-${Date.now()}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            console.log(`ModuleRegistry: Cloning repository to ${tempDir}`);

            // Клонируем репозиторий
            await new Promise<void>((resolve, reject) => {
                const gitProcess = childProcess.spawn('git', ['clone', repoUrl, tempDir], {
                    stdio: 'pipe'
                });

                let errorOutput = '';

                gitProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                gitProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Failed to clone repository: ${errorOutput}`));
                    } else {
                        resolve();
                    }
                });
            });

            console.log(`ModuleRegistry: Repository cloned successfully`);

            // Проверяем, что это модуль для нашего расширения
            const packageJsonPath = path.join(tempDir, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                throw new Error(`Module package.json not found at: ${packageJsonPath}`);
            }

            // Устанавливаем зависимости
            console.log(`ModuleRegistry: Installing dependencies`);
            await new Promise<void>((resolve, reject) => {
                const npmProcess = childProcess.spawn('npm', ['install'], {
                    cwd: tempDir,
                    stdio: 'pipe'
                });

                let errorOutput = '';

                npmProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                npmProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Failed to install dependencies: ${errorOutput}`));
                    } else {
                        resolve();
                    }
                });
            });

            // Собираем модуль
            console.log(`ModuleRegistry: Building module`);
            await new Promise<void>((resolve, reject) => {
                const buildProcess = childProcess.spawn('npm', ['run', 'build'], {
                    cwd: tempDir,
                    stdio: 'pipe'
                });

                let errorOutput = '';

                buildProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                buildProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Failed to build module: ${errorOutput}`));
                    } else {
                        resolve();
                    }
                });
            });

            // Получаем имя модуля из package.json
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const moduleName = packageJson.name;

            // Копируем модуль в директорию modules
            const targetDir = path.join(this.modulesDir, moduleName);

            // Если директория уже существует, удаляем ее
            if (fs.existsSync(targetDir)) {
                fs.rmdirSync(targetDir, { recursive: true });
            }

            // Копируем директорию модуля
            this.copyDir(tempDir, targetDir);

            console.log(`ModuleRegistry: Module copied to ${targetDir}`);

            // Загружаем модуль
            await this.loadExternalModule(targetDir);

            // Удаляем временную директорию
            fs.rmdirSync(tempDir, { recursive: true });

            console.log(`ModuleRegistry: Module from GitHub loaded successfully`);

        } catch (error) {
            console.error(`ModuleRegistry: Error loading module from GitHub:`, error);
            if (error instanceof Error) {
                console.error(`ModuleRegistry: Error details: ${error.message}`);
                console.error(`ModuleRegistry: Stack trace: ${error.stack}`);
            }
            throw error;
        }
    }

    /**
     * Рекурсивное копирование директории
     * @param src Исходная директория
     * @param dest Целевая директория
     */
    private copyDir(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * Динамически регистрирует команду в палитре команд, без необходимости указывать ее в package.json расширения
     * @param command ID команды
     * @param title Отображаемое название команды
     * @param category Категория команды (опционально)
     */
    private registerCommandInPalette(command: string, title: string, category?: string): void {
        try {
            logToFile(`ДИАГНОСТИКА: Динамическая регистрация команды в палитре: ${command}`);

            // Разделяем title и добавляем категорию, если она есть
            let fullTitle = title;
            if (category) {
                fullTitle = `${category}: ${title}`;
            }

            // В VS Code API нет прямого способа добавить команду в палитру без package.json,
            // но мы можем сделать команду видимой, добавив ее в список истории выполненных команд
            // Это хак, но он работает во многих случаях для VS Code и форков
            if (vscode.commands.executeCommand) {
                // Пытаемся добавить команду в историю команд
                vscode.commands.executeCommand('workbench.action.quickOpen', `>${fullTitle}`);
                setTimeout(() => {
                    vscode.commands.executeCommand('workbench.action.closeQuickOpen');
                }, 100);

                logToFile(`ДИАГНОСТИКА: Команда ${command} (${fullTitle}) динамически добавлена в палитру`);
            }
        } catch (error) {
            console.error(`ModuleRegistry: Ошибка при регистрации команды в палитре: ${error}`);
        }
    }

    /**
     * Загрузка модуля из ZIP-архива
     * @param moduleUrl URL ZIP-архива модуля или путь к локальному файлу
     * @param moduleName Имя модуля (для директории)
     */
    public async installModuleFromZip(moduleUrl: string, moduleName: string): Promise<void> {
        let tempDir = '';
        try {
            console.log(`ModuleRegistry: Установка модуля из ${moduleUrl}`);

            // Проверяем URL и при необходимости корректируем
            // Если URL содержит github.com/raw/, заменяем на raw.githubusercontent.com
            if (moduleUrl.includes('github.com') && moduleUrl.includes('/raw/')) {
                moduleUrl = moduleUrl.replace('github.com', 'raw.githubusercontent.com')
                    .replace('/raw/', '/');
                console.log(`ModuleRegistry: Скорректирован URL: ${moduleUrl}`);
            }

            // Создаем временную директорию для загрузки ZIP-архива
            tempDir = path.join(os.tmpdir(), `modular-kb-module-${Date.now()}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const zipFilePath = path.join(tempDir, `${moduleName}.zip`);

            // Загружаем ZIP-архив
            console.log(`ModuleRegistry: Загрузка ZIP-архива в ${zipFilePath}`);

            // Проверяем, является ли moduleUrl локальным путем
            if (fs.existsSync(moduleUrl)) {
                // Это локальный файл, просто копируем его
                console.log(`ModuleRegistry: Найден локальный ZIP-архив, копируем его`);
                fs.copyFileSync(moduleUrl, zipFilePath);
            } else {
                // Пробуем сначала загрузить из локальной директории, если там есть файл
                const localZipPath = path.join(this.context.extensionPath, '..', 'modules-build', `${moduleName}.zip`);
                if (fs.existsSync(localZipPath)) {
                    console.log(`ModuleRegistry: Найден локальный ZIP-архив в modules-build, копируем его`);
                    fs.copyFileSync(localZipPath, zipFilePath);
                } else {
                    // Если локального файла нет, загружаем с GitHub
                    await this.downloadFile(moduleUrl, zipFilePath);
                }
            }

            // Проверяем, что файл существует и имеет размер больше 0
            if (!fs.existsSync(zipFilePath) || fs.statSync(zipFilePath).size === 0) {
                throw new Error(`Не удалось загрузить ZIP-архив модуля или файл пуст: ${zipFilePath}`);
            }

            // Создаем временную директорию для распаковки
            const extractDir = path.join(tempDir, 'extracted');
            fs.mkdirSync(extractDir, { recursive: true });

            // Распаковываем ZIP-архив
            console.log(`ModuleRegistry: Распаковка ZIP-архива в ${extractDir}`);
            await this.extractZip(zipFilePath, extractDir);

            // Проверяем структуру распакованного архива
            console.log(`ModuleRegistry: Проверка структуры распакованного архива`);

            // Поиск package.json в распакованной директории
            let moduleRoot = extractDir;
            let packageJsonPath = '';

            // Проверяем файлы в корне
            if (fs.existsSync(path.join(extractDir, 'package.json'))) {
                packageJsonPath = path.join(extractDir, 'package.json');
                console.log(`ModuleRegistry: Найден package.json в корне`);
            } else {
                // Если нет в корне, ищем в поддиректориях
                const entries = fs.readdirSync(extractDir);

                for (const entry of entries) {
                    const entryPath = path.join(extractDir, entry);
                    if (fs.statSync(entryPath).isDirectory()) {
                        const possiblePackageJson = path.join(entryPath, 'package.json');
                        if (fs.existsSync(possiblePackageJson)) {
                            packageJsonPath = possiblePackageJson;
                            moduleRoot = entryPath;
                            console.log(`ModuleRegistry: Найден package.json в поддиректории ${entry}`);
                            break;
                        }
                    }
                }
            }

            if (!packageJsonPath) {
                throw new Error(`Не найден package.json в распакованном архиве. Проверьте структуру архива.`);
            }

            console.log(`ModuleRegistry: Используется package.json: ${packageJsonPath}`);

            // Читаем package.json для получения информации о модуле
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

            // Выводим информацию о модуле
            console.log(`ModuleRegistry: Модуль ID: ${packageJson.id || packageJson.name || 'не указан'}, Версия: ${packageJson.version || 'не указана'}`);


            // Создаем директорию для модуля
            const moduleDir = path.join(this.modulesDir, moduleName);
            if (fs.existsSync(moduleDir)) {
                console.log(`ModuleRegistry: Директория модуля уже существует, удаляем её`);
                fs.rmdirSync(moduleDir, { recursive: true });
            }

            // Копируем содержимое модуля в целевую директорию
            console.log(`ModuleRegistry: Копирование модуля из ${moduleRoot} в ${moduleDir}`);
            this.copyDir(moduleRoot, moduleDir);

            // Проверяем, что все необходимые файлы скопированы
            if (!fs.existsSync(path.join(moduleDir, 'package.json'))) {
                throw new Error(`Не удалось скопировать package.json в целевую директорию`);
            }

            // Загружаем модуль
            console.log(`ModuleRegistry: Загрузка модуля из ${moduleDir}`);
            await this.loadExternalModule(moduleDir);

            console.log(`ModuleRegistry: Модуль ${moduleName} успешно установлен`);
        } catch (error) {
            console.error(`ModuleRegistry: Ошибка установки модуля:`, error);
            if (error instanceof Error) {
                console.error(`ModuleRegistry: Детали ошибки: ${error.message}`);
                console.error(`ModuleRegistry: Стек ошибки: ${error.stack}`);
            }
            throw error;
        } finally {
            // Удаляем временную директорию, если она была создана
            if (tempDir && fs.existsSync(tempDir)) {
                try {
                    fs.rmdirSync(tempDir, { recursive: true });
                    console.log(`ModuleRegistry: Временная директория ${tempDir} удалена`);
                } catch (e) {
                    console.warn(`ModuleRegistry: Не удалось удалить временную директорию: ${e}`);
                }
            }
        }
    }

    /**
     * Загрузка файла по URL с использованием fetch API
     * @param url URL файла
     * @param filePath Путь для сохранения файла
     */
    private async downloadFile(url: string, filePath: string): Promise<void> {
        try {
            console.log(`ModuleRegistry: Загрузка файла с ${url}`);

            // Проверяем URL и корректируем его при необходимости
            if (url.includes('github.com/') && url.includes('/raw/')) {
                url = url.replace('github.com/', 'raw.githubusercontent.com/')
                    .replace('/raw/', '/');
                console.log(`ModuleRegistry: Скорректирован URL: ${url}`);
            }

            // Используем нативный fetch API для загрузки файла
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // Таймаут 15 секунд

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                redirect: 'follow', // Автоматически следовать за перенаправлениями
                signal: controller.signal
            });

            if (!response.ok) {
                clearTimeout(timeoutId);
                throw new Error(`Ошибка загрузки файла: ${response.status} ${response.statusText}`);
            }

            // Получаем данные в виде буфера
            const buffer = await response.arrayBuffer();

            // Записываем файл
            fs.writeFileSync(filePath, Buffer.from(buffer));

            clearTimeout(timeoutId); // Очищаем таймер

            console.log(`ModuleRegistry: Файл успешно загружен и сохранен в ${filePath}`);
        } catch (error) {
            console.error(`ModuleRegistry: Ошибка при загрузке файла:`, error);

            // Удаляем частично загруженный файл, если он существует
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error(`ModuleRegistry: Не удалось удалить частично загруженный файл:`, e);
                }
            }

            throw error;
        }
    }

    /**
     * Распаковка ZIP-архива
     * @param zipFilePath Путь к ZIP-архиву
     * @param extractPath Путь для распаковки
     */
    private async extractZip(zipFilePath: string, extractPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            yauzl.open(zipFilePath, { lazyEntries: true }, (err: Error | null, zipfile?: yauzl.ZipFile) => {
                if (err || !zipfile) {
                    reject(err || new Error('Failed to open ZIP file'));
                    return;
                }

                zipfile.on('entry', (entry: yauzl.Entry) => {
                    const entryPath = path.join(extractPath, entry.fileName);

                    if (entry.fileName.endsWith('/')) {
                        // Директория
                        fs.mkdirSync(entryPath, { recursive: true });
                        zipfile.readEntry();
                    } else {
                        // Файл
                        fs.mkdirSync(path.dirname(entryPath), { recursive: true });
                        zipfile.openReadStream(entry, (err: Error | null, readStream?: NodeJS.ReadableStream) => {
                            if (err || !readStream) {
                                reject(err || new Error(`Failed to read entry ${entry.fileName}`));
                                return;
                            }

                            const writeStream = fs.createWriteStream(entryPath);
                            readStream.pipe(writeStream);

                            writeStream.on('finish', () => {
                                zipfile.readEntry();
                            });
                        });
                    }
                });

                zipfile.on('end', () => {
                    resolve();
                });

                zipfile.on('error', (err: Error) => {
                    reject(err);
                });

                zipfile.readEntry();
            });
        });
    }

    /**
     * Сканирование и загрузка всех внешних модулей из директории модулей
     */
    public async scanAndLoadExternalModules(): Promise<void> {
        try {
            logToFile(`ДИАГНОСТИКА: Начато сканирование внешних модулей в директории ${this.modulesDir}`);

            // Проверяем существование директории
            if (!fs.existsSync(this.modulesDir)) {
                logToFile(`ОШИБКА: Директория модулей не существует, создаём её: ${this.modulesDir}`);
                fs.mkdirSync(this.modulesDir, { recursive: true });
                return;
            }

            // Получаем список всех файлов и директорий для подробной диагностики
            logToFile(`ДИАГНОСТИКА: Содержимое директории модулей:`);
            try {
                const allEntries = fs.readdirSync(this.modulesDir);
                for (const entry of allEntries) {
                    const entryPath = path.join(this.modulesDir, entry);
                    const stats = fs.statSync(entryPath);
                    logToFile(`  - ${entry} [${stats.isDirectory() ? 'Директория' : 'Файл'}]`);

                    // Если это директория, проверяем наличие package.json
                    if (stats.isDirectory()) {
                        const packageJsonPath = path.join(entryPath, 'package.json');
                        if (fs.existsSync(packageJsonPath)) {
                            try {
                                const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
                                const packageJson = JSON.parse(packageContent);
                                logToFile(`    - Найден package.json: id=${packageJson.id}, name=${packageJson.name}, version=${packageJson.version}`);
                            } catch (e) {
                                logToFile(`    - ОШИБКА чтения package.json: ${e}`);
                            }
                        } else {
                            logToFile(`    - package.json отсутствует`);
                        }
                    }
                }
            } catch (e) {
                logToFile(`ОШИБКА при чтении содержимого директории модулей: ${e}`);
            }

            // Получаем список поддиректорий для загрузки модулей
            const dirs = fs.readdirSync(this.modulesDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => path.join(this.modulesDir, dirent.name));

            logToFile(`ДИАГНОСТИКА: Найдено ${dirs.length} потенциальных директорий модулей`);

            // Загружаем каждый модуль
            for (const dir of dirs) {
                logToFile(`ДИАГНОСТИКА: Попытка загрузки модуля из ${dir}`);
                try {
                    await this.loadExternalModule(dir);
                    logToFile(`ДИАГНОСТИКА: Модуль из ${dir} успешно загружен`);
                } catch (error) {
                    logToFile(`ОШИБКА загрузки модуля из ${dir}: ${error}`);
                    if (error instanceof Error) {
                        logToFile(`ОШИБКА детали: ${error.message}`);
                        logToFile(`ОШИБКА стек: ${error.stack}`);
                    }
                    // Продолжаем загрузку других модулей
                }
            }

            // Выводим итоговый список загруженных модулей
            const loadedModules = this.listModules();
            logToFile(`ДИАГНОСТИКА: Завершено сканирование модулей. Загружено модулей: ${loadedModules.length}`);
            for (const module of loadedModules) {
                logToFile(`  - Загружен модуль: id=${module.id}, name=${module.displayName}, version=${module.version}`);
            }

        } catch (error) {
            logToFile(`ОШИБКА при сканировании внешних модулей: ${error}`);
            if (error instanceof Error) {
                logToFile(`ОШИБКА детали: ${error.message}`);
                logToFile(`ОШИБКА стек: ${error.stack}`);
            }
        }
    }
}
