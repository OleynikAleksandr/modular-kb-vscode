import * as vscode from 'vscode';
import { IModule, IModuleRegistry } from '../../core/interfaces/module';

/**
 * Test module for demonstrating ModuleRegistry functionality
 */
export class TestModule implements IModule {
    public id: string = 'test-module';
    public version: string = '1.0.0';
    public displayName: string = 'Test Module';
    public description: string = 'Demonstration module for testing ModuleRegistry functionality';
    
    private context: vscode.ExtensionContext | undefined;
    private registry: IModuleRegistry | undefined;
    
    /**
     * Initialize the module
     */
    public async initialize(context: vscode.ExtensionContext, registry: IModuleRegistry): Promise<void> {
        this.context = context;
        this.registry = registry;
        
        // Не регистрируем команду здесь, так как она уже зарегистрирована в extension.ts
        // Это позволяет избежать конфликта при регистрации команд
        
        console.log(`TestModule: Module initialized`);
    }
    
    /**
     * Activate the module
     */
    public async activate(): Promise<void> {
        console.log(`TestModule: Module activated`);
    }
    
    /**
     * Deactivate the module
     */
    public async deactivate(): Promise<void> {
        console.log(`TestModule: Module deactivated`);
    }
}
