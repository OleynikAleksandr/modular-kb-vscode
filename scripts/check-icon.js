const fs = require('fs');
const path = require('path');

// Получаем путь к корню проекта
const projectRoot = path.resolve(__dirname, '..');
console.log('Проверка иконки расширения');
console.log('Корень проекта:', projectRoot);

// Проверяем наличие файла package.json
const packageJsonPath = path.join(projectRoot, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
    console.error('Ошибка: Файл package.json не найден!');
    process.exit(1);
}

// Читаем package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
console.log('Версия расширения:', packageJson.version);

// Проверяем наличие поля icon
if (!packageJson.icon) {
    console.error('Ошибка: В package.json отсутствует поле "icon"!');
    process.exit(1);
}

console.log('Путь к иконке в package.json:', packageJson.icon);

// Проверяем наличие файла иконки
const iconPath = path.join(projectRoot, packageJson.icon);
console.log('Полный путь к иконке:', iconPath);

if (!fs.existsSync(iconPath)) {
    console.error('Ошибка: Файл иконки не найден по указанному пути!');
    
    // Проверяем наличие директории images
    const imagesDir = path.join(projectRoot, 'images');
    if (fs.existsSync(imagesDir)) {
        console.log('Директория images существует, содержимое:');
        const files = fs.readdirSync(imagesDir);
        files.forEach(file => {
            console.log(`- ${file}`);
        });
    } else {
        console.error('Директория images не существует!');
    }
    
    process.exit(1);
}

// Проверяем размер файла иконки
const stats = fs.statSync(iconPath);
console.log('Размер файла иконки:', stats.size, 'байт');

// Проверяем содержимое .vscodeignore
const vscodeignorePath = path.join(projectRoot, '.vscodeignore');
if (fs.existsSync(vscodeignorePath)) {
    const vscodeignore = fs.readFileSync(vscodeignorePath, 'utf8');
    console.log('Содержимое .vscodeignore:');
    console.log(vscodeignore);
    
    // Проверяем, не исключена ли папка с иконкой
    const iconDir = path.dirname(packageJson.icon);
    if (vscodeignore.includes(iconDir) && !vscodeignore.includes(`!${iconDir}`)) {
        console.warn(`Предупреждение: Директория ${iconDir} может быть исключена в .vscodeignore!`);
        console.warn('Рекомендуется добавить строку: !' + iconDir + '/**');
    }
}

console.log('Проверка завершена успешно! Иконка найдена и должна быть включена в пакет расширения.');
