// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { ModuleRegistry } from './core/registry/ModuleRegistry';
import { CoreManager } from './core/CoreManager';

// Global module registry
let moduleRegistry: ModuleRegistry;
// Core manager
let coreManager: CoreManager;

// Синхронное создание директории modules
function ensureModulesDirSyncExists(modulesPath: string): boolean {
	try {
		// Проверяем существование директории
		const fs = require('fs');
		if (!fs.existsSync(modulesPath)) {
			// Создаем директорию синхронно
			fs.mkdirSync(modulesPath, { recursive: true });
			console.log(`Создана директория модулей: ${modulesPath}`);
		} else {
			console.log(`Директория модулей уже существует: ${modulesPath}`);
		}
		return true;
	} catch (error) {
		console.error(`Ошибка при создании директории модулей: ${error}`);
		return false;
	}
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('Активация расширения Modular KB...');

	// Initialize Core manager for path resolution
	coreManager = new CoreManager(context);

	// Синхронно создаём директорию модулей до любых других действий
	const modulesPathCreated = ensureModulesDirSyncExists(coreManager.modulesPath);
	if (!modulesPathCreated) {
		vscode.window.showErrorMessage('Ошибка при создании директории модулей. Расширение может работать некорректно.');
	}

	// Initialize module registry
	moduleRegistry = new ModuleRegistry(context);

	// Проверяем наличие модуля KB.Orchestrator и автоматически запускаем Core
	try {
		console.log('Проверка наличия модуля KB.Orchestrator...');
		const isModuleInstalled = await coreManager.isOrchestratorModuleInstalled();

		if (isModuleInstalled) {
			console.log('Модуль KB.Orchestrator установлен');

			// Проверяем доступность Core
			const isCoreAvailable = await coreManager.isCoreAvailable();
			if (isCoreAvailable) {
				vscode.window.showInformationMessage('KB Core is running and ready to use');
			} else {
				// Автоматический запуск Core при старте IDE
				console.log('Автоматический запуск KB Core...');
				
				// Находим свободный порт
				const port = await coreManager.findFreePort();
				
				// Запускаем Core
				const isStarted = await coreManager.startCore(port);
				if (!isStarted) {
					vscode.window.showErrorMessage('Failed to start KB Core automatically. You can try to start it manually using "KB: Start Core" command.');
					return;
				}
				
				// Регистрируем MCP-сервер
				const isRegistered = await coreManager.registerMcpServer(port);
				if (!isRegistered) {
					vscode.window.showErrorMessage('Failed to register MCP server. KB Core may not function properly.');
					return;
				}
				
				vscode.window.showInformationMessage(`KB Core started automatically and running on port ${port}.`);
			}
		} else {
			console.log('Модуль KB.Orchestrator не установлен');
			vscode.window.showInformationMessage('KB Core module is not installed. Use "Modular KB: Install Module" command to install KB.Orchestrator module.');
		}
	} catch (error) {
		console.error('Ошибка при проверке модуля KB.Orchestrator:', error);
		vscode.window.showErrorMessage('Error checking KB.Orchestrator module');
	}

	// Register command to scan and load new external modules
	const scanModulesCommand = vscode.commands.registerCommand('modular-kb-vscode.scanModules', async () => {
		console.log('Выполнена команда "modular-kb-vscode.scanModules"');

		try {
			// Проверяем наличие модуля KB.Orchestrator
			const isModuleInstalled = await coreManager.isOrchestratorModuleInstalled();
			if (!isModuleInstalled) {
				vscode.window.showErrorMessage('KB Core module is not installed. Please install the KB.Orchestrator module first using "Modular KB: Install Module" command.');
				return;
			}

			// Проверяем доступность Core
			const isCoreAvailable = await coreManager.isCoreAvailable();
			if (!isCoreAvailable) {
				vscode.window.showWarningMessage('KB Core is not running. Starting Core...');

				// Находим свободный порт
				const port = await coreManager.findFreePort();

				// Запускаем Core
				const isStarted = await coreManager.startCore(port);
				if (!isStarted) {
					vscode.window.showErrorMessage('Failed to start KB Core. Operation canceled.');
					return;
				}

				// Регистрируем MCP-сервер
				const isRegistered = await coreManager.registerMcpServer(port);
				if (!isRegistered) {
					vscode.window.showErrorMessage('Failed to register MCP server. Operation canceled.');
					return;
				}
			}

			// Отправляем запрос на сканирование модулей в Core
			vscode.window.showInformationMessage('Scanning for new modules...');

			// TODO: Реализовать отправку запроса в Core через REST API
			// В текущей версии используем локальный реестр модулей

			// Сохраняем количество модулей до сканирования
			const modulesBefore = moduleRegistry.listModules().length;

			// Сканируем и загружаем модули
			await moduleRegistry.scanAndLoadExternalModules();

			// Получаем количество модулей после сканирования
			const modulesAfter = moduleRegistry.listModules().length;

			// Вычисляем количество новых модулей
			const newModulesCount = modulesAfter - modulesBefore;

			if (newModulesCount > 0) {
				vscode.window.showInformationMessage(`New modules loaded: ${newModulesCount}`);
			} else {
				vscode.window.showInformationMessage('No new modules found');
			}
		} catch (error) {
			if (error instanceof Error) {
				vscode.window.showErrorMessage(`Error scanning modules: ${error.message}`);
			} else {
				vscode.window.showErrorMessage(`Unknown error scanning modules`);
			}
		}
	});

	// Register command to install module
	const installModuleCommand = vscode.commands.registerCommand('modular-kb-vscode.installModule', async () => {
		console.log('Выполнена команда "modular-kb-vscode.installModule"');

		try {
			// Используем новый метод installLocalModule для выбора и установки модуля
			console.log('Вызываем метод installLocalModule');
			await moduleRegistry.installLocalModule();

			// Показываем сообщение о необходимости перезапуска
			const action = await vscode.window.showInformationMessage(
				'Модуль успешно установлен. Рекомендуется перезапустить VS Code.',
				'Перезапустить сейчас',
				'Позже'
			);

			if (action === 'Перезапустить сейчас') {
				vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		} catch (error) {
			if (error instanceof Error) {
				vscode.window.showErrorMessage(`Ошибка при установке модуля: ${error.message}`);
			} else {
				vscode.window.showErrorMessage(`Неизвестная ошибка при установке модуля`);
			}
		}
	});

	// Register command to start Core (Always-IDE)
	const startCoreCommand = vscode.commands.registerCommand('kb.startCore', async () => {
		try {
			const isModuleInstalled = await coreManager.isOrchestratorModuleInstalled();
			if (!isModuleInstalled) {
				vscode.window.showErrorMessage('kb-core module is not installed. Please install the kb-core module first using "Modular KB: Install Module" command.');
				return;
			}
			const isCoreAvailable = await coreManager.isCoreAvailable();
			if (isCoreAvailable) {
				vscode.window.showInformationMessage('kb-core is already running.');
				return;
			}
			const port = await coreManager.findFreePort();
			vscode.window.showInformationMessage('Starting kb-core...');
			const isStarted = await coreManager.startCore(port);
			if (!isStarted) {
				vscode.window.showErrorMessage('Failed to start kb-core.');
				return;
			}
			const isRegistered = await coreManager.registerMcpServer(port);
			if (!isRegistered) {
				vscode.window.showErrorMessage('Failed to register MCP server.');
				return;
			}
			vscode.window.showInformationMessage(`kb-core started and running on port ${port}.`);
		} catch (error) {
			vscode.window.showErrorMessage(`Error starting kb-core: ${error instanceof Error ? error.message : error}`);
		}
	});

	// Register command to stop Core (Always-IDE)
	const stopCoreCommand = vscode.commands.registerCommand('kb.stopCore', async () => {
		try {
			coreManager.stopCore();
			vscode.window.showInformationMessage('kb-core stopped.');
		} catch (error) {
			vscode.window.showErrorMessage(`Error stopping kb-core: ${error instanceof Error ? error.message : error}`);
		}
	});

	// Register all commands
	context.subscriptions.push(
		scanModulesCommand,
		installModuleCommand,
		startCoreCommand,
		stopCoreCommand
	);

	// Scan and load external modules on startup
	try {
		console.log('Автоматическая загрузка модулей при запуске...');
		await moduleRegistry.scanAndLoadExternalModules();
		const modules = moduleRegistry.listModules();
		console.log(`Загружено модулей при запуске: ${modules.length}`);
	} catch (error) {
		console.error('Ошибка сканирования модулей при запуске:', error);
	}

	console.log('Расширение Modular KB активировано');
}

// This method is called when your extension is deactivated
export async function deactivate() {
	// Деактивация всех модулей при выключении расширения
	if (moduleRegistry) {
		await moduleRegistry.deactivateAllModules();
	}

	// Останавливаем Core процесс при закрытии IDE (Always-IDE модель)
	if (coreManager) {
		console.log('Останавливаем KB Core процесс при деактивации расширения...');
		coreManager.stopCore();
	}
}
