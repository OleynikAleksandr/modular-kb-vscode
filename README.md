# Modular KB Extension

Расширение VS Code с модульной архитектурой для создания и управления базой знаний. Расширение использует модель Always-IDE, где ядро (Core) запускается как дочерний процесс расширения и функционирует только при запущенной IDE.

## Версия 0.5.0 - Обновление от 03.05.2025

### Изменения:

- **HTTP-прокси для Copilot Chat** - добавлен HTTP-прокси для перехвата запросов Copilot Chat в режиме Agent
- **Интеграция с Orchestrator Core** - прокси взаимодействует с Orchestrator Core для обработки запросов
- **Автоматический запуск/перезапуск прокси** - прокси запускается и перезапускается автоматически вместе с VS Code
- **Логирование запросов и ответов** - все запросы и ответы логируются в формате JSON Lines

## Версия 0.4.2 - Обновление от 29.04.2025

### Изменения:

- **Автоматический запуск Core** - добавлен автоматический запуск Core Оркестратора при старте IDE
- **Сохранение ручного управления** - команды для ручного запуска/остановки Core сохранены для будущей Toggle-кнопки в UI
- **Уточнение информации о путях** - исправлена информация о путях установки модулей и Core Оркестратора

## Версия 0.4.1 - Обновление от 28.04.2025

### Изменения:

- **Сборка Core как DLL-библиотеки** - Core реализован как библиотека, а не как исполняемый файл (EXE)
- **Реализация Always-IDE архитектуры** - Core существует только пока запущена IDE
- **Работающий HTTP-сервер** - реализован HTTP API на порту 56762 для взаимодействия с WebView UI
- **Интеграция Semantic Kernel** - добавлены базовые компоненты Semantic Kernel для работы с LLM
- **Подготовка к WebView UI** - разработана архитектура WebView UI для управления Core и модулями

## Функциональность

- **Core как DLL-библиотека** - запускается в контексте расширения, без необходимости запуска внешнего процесса
- **Архитектура Always-IDE** - Core живет только пока запущена IDE
- **HTTP-сервер на порту 56762** - предоставляет API для взаимодействия с Core
- **HTTP-прокси для Copilot Chat** - перехватывает запросы Copilot Chat в режиме Agent
- **Логирование запросов и ответов** - сохраняет логи в формате JSON Lines
- **Базовая интеграция с Semantic Kernel** - реализован минимальный набор компонентов для работы с LLM
- **Система модулей** - реализованы механизмы для динамической загрузки модулей
- **Подготовка к WebView UI** - разработаны основы для внедрения WebView интерфейса

## Команды

Расширение добавляет следующие команды в палитру команд VS Code/Windsurf (Ctrl+Shift+P):

- **KB: Start Core** - запускает Core как библиотеку DLL и инициализирует HTTP-сервер

## Requirements

- VS Code version 1.74.0 or higher

## Architecture

Расширение построено на архитектуре Always-IDE:

- **VS Code Extension** - пользовательский интерфейс, управление Core, WebView для UI
- **KB Core** - дочерний процесс расширения, MCP-сервер, управление модулями, DI-контейнер
- **Modules (ZIP)** - модули, расширяющие функциональность Core через DI и MCP
- **WebView UI** - единый интерфейс для Core и всех модулей

## Development

Для разработки собственных модулей используйте интерфейс `IKbModule` и формат модуля с `module.json`.

Пример структуры модуля:

```
my-module.zip
  ├─ lib/Module.My.dll
  ├─ module.json  // { id, version, entryType }
  └─ README.md
```

Пример файла `module.json`:

```json
{
  "id": "my-module",
  "version": "1.0.0",
  "entryType": "MyModule.Module, MyModule"
}
```

Пример класса модуля:

```csharp
public class MyModule : IKbModule
{
    public void Configure(IServiceCollection services, IMcpRegistry mcpRegistry)
    {
        // Регистрация сервисов в DI-контейнере
        services.AddScoped<IMyService, MyService>();
        
        // Регистрация MCP-инструментов
        mcpRegistry.RegisterTool("kb_myTool", typeof(MyTool));
        
        // Регистрация фоновых сервисов
        services.AddHostedService<MyBackgroundService>();
    }
}
```

## Установка модулей и Core Оркестратора

На данный момент принято решение добавлять модули вручную, помещая папку с собранным модулем в папку модулей расширения.

### Установка Core Оркестратора

Core Оркестратор подключается к расширению путем копирования всей папки `KB.Orchestrator\kb-core` в соответствующую директорию расширения (см. пути ниже для разных IDE).

### Установка модулей

Для установки модулей необходимо:

1. Скачать ZIP-файл модуля из репозитория модулей: [https://github.com/OleynikAleksandr/modules-build](https://github.com/OleynikAleksandr/modules-build)

2. Распаковать ZIP-файл в директорию модулей в зависимости от используемой IDE:

   - **Для VS Code**:
     ```
     C:\Users\<имя_пользователя>\.vscode\extensions\modularkb.modularkb-extension-<номер_версии>\modules\<имя_модуля>
     ```

   - **Для Cursor**:
     ```
     C:\Users\<имя_пользователя>\.cursor\extensions\modularkb.modularkb-extension-<номер_версии>\modules\<имя_модуля>
     ```

   - **Для Windsurf**:
     ```
     C:\Users\<имя_пользователя>\.windsurf\extensions\modularkb.modularkb-extension-<номер_версии>\modules\<имя_модуля>
     ```

   - **Для Trae**:
     ```
     C:\Users\<имя_пользователя>\.trae\extensions\modularkb.modularkb-extension-<номер_версии>\modules\<имя_модуля>
     ```

3. Перезапустить IDE для применения изменений

## Использование HTTP-прокси для Copilot Chat

Для использования HTTP-прокси с Copilot Chat в режиме Agent необходимо:

1. Установить расширение ModularKB
2. Запустить VS Code с переменной окружения `GH_COPILOT_OVERRIDE_PROXY_URL=http://127.0.0.1:7001`
   ```
   set GH_COPILOT_OVERRIDE_PROXY_URL=http://127.0.0.1:7001
   code
   ```
3. Прокси автоматически запустится при старте VS Code
4. Все запросы Copilot Chat в режиме Agent будут проходить через прокси
5. Логи запросов сохраняются в директории `%USERPROFILE%\.orchestrator\logs\` (Windows) или `~/.orchestrator/logs/` (Linux/macOS)

## Versions

### 0.5.0 (current) - HTTP-прокси для Copilot Chat

- **HTTP-прокси для Copilot Chat** - добавлен HTTP-прокси для перехвата запросов Copilot Chat в режиме Agent
- **Интеграция с Orchestrator Core** - прокси взаимодействует с Orchestrator Core для обработки запросов
- **Автоматический запуск/перезапуск прокси** - прокси запускается и перезапускается автоматически вместе с VS Code
- **Логирование запросов и ответов** - все запросы и ответы логируются в формате JSON Lines

### 0.4.2 - Автоматический запуск Core

- **Автоматический запуск Core** - добавлен автоматический запуск Core Оркестратора при старте IDE
- **Сохранение ручного управления** - команды для ручного запуска/остановки Core сохранены для будущей Toggle-кнопки в UI
- **Уточнение информации о путях** - исправлена информация о путях установки модулей и Core Оркестратора

### 0.4.1 - Первая работающая версия!

- **Первая работающая версия** - успешная регистрация и запуск Core Оркестратора
- **Исправление имён и регистраций** - решены все проблемы с именами и регистрацией модулей
- **Реализация Core как DLL-библиотеки** - вместо EXE-файла
- **Работающий HTTP-сервер** - на порту 56762
- **Базовая интеграция с Semantic Kernel** - подготовка к работе с LLM
- **Подготовка архитектуры WebView UI** - разработка основ для UI

### 0.4.0

- Переход на архитектуру Always-IDE
- Удаление механизмов для работы с Detached-Core
- Добавлена поддержка WebView UI для Core и модулей
- Упрощена установка и управление модулями

### 0.1.3

- Автоматическая загрузка модулей при запуске
- Упрощенный интерфейс команд
- Улучшенная обработка ошибок
- Поддержка hot-swap модулей

### 0.1.0

- Добавлена иконка для расширения
- Переименовано в "Modular KB Extension"
- Исправлен формат идентификатора издателя
- Обновлена конфигурация репозитория

### 0.0.8

- Updated extension publisher identifier
- Fixed workspace recommendations

### 0.0.7

- Added extension icon support
- Improved extension packaging

### 0.0.6

- Enhanced error handling in module system
- Added detailed logging for troubleshooting

### 0.0.5

- Improved module activation sequence
- Fixed minor bugs in module registry

### 0.0.4

- Fixed module registration issue
- Created `IModuleRegistry` interface to prevent circular dependencies
- Improved logging of the module registration process
- Added real module state verification in the "Test Module" command
- Created detailed documentation for module development

### 0.0.3

- Fixed parameter types in interfaces and classes
- Added detailed error logging

### 0.0.2

- Changed minimum VS Code version from 1.99.0 to 1.74.0 for compatibility
- Synchronized @types/vscode version with the engine version
- Removed redundant activation events for commands

### 0.0.1

- Basic implementation of ModuleRegistry
- Test module for functionality demonstration
- Commands for module interaction

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

- Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
- Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
- Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
