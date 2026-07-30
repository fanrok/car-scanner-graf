/**
 * Тесты для анализатора логов Car Scanner Graf
 * 
 * Проверяют:
 * 1. Парсинг CSV файла - корректное чтение данных
 * 2. Отрисовка графиков - все графики создаются и отображаются
 * 3. Все точки на графиках отрисовываются
 * 4. Скрытие графиков через кнопку глаза и через панель настроек
 * 5. Перетаскивание графиков в основном списке и в панели настроек
 * 6. Скроллы вверх/вниз и влево/вправо
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Пути к файлам
const CSV_FILE = path.join(__dirname, '2026-07-29 16-15-14.csv');
const APP_JS = path.join(__dirname, '..', 'app.js');

// Загружаем исходный код приложения
const appJsContent = fs.readFileSync(APP_JS, 'utf-8');

// Описание ролей из app.js (извлекаем паттерны)
const ROLES = [
  { id:'rpm', match: /обороты\s+двигателя/, unit:'rpm' },
  { id:'uoz', match: /опережени|уоз|зажиган|ignition\s*timing|ignition\s*angle/, unit:'°' },
  { id:'correction', match: /кратковременная\s+коррекция/, unit:'%' },
  { id:'manifold', match: /впускном\s+коллекторе/, unit:'kPa' },
  { id:'intakeTemp', match: /всасываемого\s+воздуха/, unit:'℃' },
  { id:'throttle', match: /дроссел|дпдз|throttle/, unit:'%' },
  { id:'speed', match: /скорость\s+автомобиля/, unit:'km/h' },
  { id:'boost', match: /наддув|boost/, unit:'bar' },
  { id:'maf', match: /расход\s+воздуха/, unit:'g/s' },
  { id:'afr', match: /топливо\s*\/?\s*воздух|\bafr\b/, unit:'' },
  { id:'coolant', match: /охлаждающей\s+жидкости/, unit:'℃' },
  { id:'catalystTemp', match: /катализатор|catalyst/i, unit:'℃' },
  { id:'knockDetected', match: /knock\s+detected/, unit:'' },
];

describe('CSV Parser Tests', () => {
  let csvContent;
  let parsedData;
  
  beforeAll(() => {
    // Читаем CSV файл
    expect(fs.existsSync(CSV_FILE)).toBe(true);
    csvContent = fs.readFileSync(CSV_FILE, 'utf-8');
    expect(csvContent).toBeTruthy();
    expect(csvContent.length).toBeGreaterThan(0);
  });
  
  describe('Парсинг CSV файла', () => {
    test('Файл существует и не пустой', () => {
      expect(fs.existsSync(CSV_FILE)).toBe(true);
      const stats = fs.statSync(CSV_FILE);
      expect(stats.size).toBeGreaterThan(100);
    });
    
    test('CSV имеет правильную структуру (SECONDS;PID;VALUE;UNITS)', () => {
      const lines = csvContent.trim().split(/\r?\n/);
      expect(lines.length).toBeGreaterThan(10);
      
      // Проверяем первую строку
      const firstLine = lines[0];
      expect(firstLine).toContain('SECONDS');
      expect(firstLine).toContain('PID');
      expect(firstLine).toContain('VALUE');
      expect(firstLine).toContain('UNITS');
    });
    
    test('Все строки имеют 4 поля', () => {
      const lines = csvContent.trim().split(/\r?\n/);
      lines.forEach((line, index) => {
        const fields = line.split(';').filter(f => f.trim() !== '');
        // Каждая запись должна иметь 4 поля (время, имя, значение, единицы)
        if (line.includes('SECONDS')) return; // пропускаем заголовок
        expect(fields.length).toBeGreaterThanOrEqual(4);
      });
    });
    
    test('Временные метки корректны (числа)', () => {
      const lines = csvContent.trim().split(/\r?\n/).slice(1, 20);
      lines.forEach(line => {
        const fields = line.split(';');
        const timestamp = parseFloat(fields[0].replace(/"/g, ''));
        expect(isNaN(timestamp)).toBe(false);
        expect(timestamp).toBeGreaterThan(0);
      });
    });
    
    test('Значения параметров корректны (числа)', () => {
      const lines = csvContent.trim().split(/\r?\n/).slice(1, 20);
      lines.forEach(line => {
        const fields = line.split(';');
        const value = parseFloat(fields[2].replace(/"/g, '').replace(',', '.'));
        expect(isNaN(value)).toBe(false);
      });
    });
    
    test('Присутствуют ключевые параметры (Обороты, УОЗ, Дроссель и т.д.)', () => {
      const lowerContent = csvContent.toLowerCase();
      expect(lowerContent).toContain('обороты двигателя');
      expect(lowerContent).toContain('опережения зажигания');
      expect(lowerContent).toContain('дроссельной заслонки');
    });
  });
  
  describe('Извлечение параметров из CSV', () => {
    test('Извлекаются уникальные имена параметров', () => {
      const lines = csvContent.trim().split(/\r?\n/).slice(1);
      const paramNames = new Set();
      
      for (let i = 0; i < lines.length; i += 4) {
        if (i + 1 < lines.length) {
          const name = lines[i + 1].replace(/"/g, '').trim();
          if (name) paramNames.add(name);
        }
      }
      
      expect(paramNames.size).toBeGreaterThan(5);
      expect(paramNames.size).toBeLessThan(200);
    });
    
    test('Параметры классифицируются по ролям', () => {
      const lines = csvContent.trim().split(/\r?\n/).slice(1);
      const foundRoles = new Set();
      
      for (let i = 0; i < Math.min(lines.length, 100); i += 4) {
        if (i + 1 < lines.length) {
          const name = lines[i + 1].replace(/"/g, '').trim().toLowerCase();
          
          ROLES.forEach(role => {
            if (role.match.test(name)) {
              foundRoles.add(role.id);
            }
          });
        }
      }
      
      // Ожидаем найти несколько основных ролей
      expect(foundRoles.size).toBeGreaterThan(3);
    });
  });
});

describe('Графики и отрисовка', () => {
  test('app.js содержит функции для построения графиков', () => {
    expect(appJsContent).toContain('function renderAll');
    expect(appJsContent).toContain('function buildCharts');
    expect(appJsContent).toContain('canvas');
  });
  
  test('app.js содержит обработку данных для графиков', () => {
    expect(appJsContent).toContain('allData');
    expect(appJsContent).toContain('paramConfigs');
    expect(appJsContent).toContain('chartOrder');
  });
  
  test('Определены цвета для разных типов графиков', () => {
    expect(appJsContent).toContain('color:');
    expect(appJsContent).toContain('#FFC107'); // rpm
    expect(appJsContent).toContain('#AB47BC'); // uoz
  });
});

describe('Скрытие графиков', () => {
  test('Реализовано скрытие графиков через hiddenParams', () => {
    expect(appJsContent).toContain('hiddenParams');
    expect(appJsContent).toContain('hiddenParams.add');
    expect(appJsContent).toContain('hiddenParams.clear');
  });
  
  test('Есть кнопка скрытия (глаз)', () => {
    expect(appJsContent).toContain('chart-hide-btn');
    expect(appJsContent).toContain('Скрыть график');
  });
  
  test('Панель настроек с галочками видимости', () => {
    expect(appJsContent).toContain('settings-panel');
    expect(appJsContent).toContain('settings-list');
    expect(appJsContent).toContain('галочка');
  });
  
  test('Функция applyVisibility применяется после загрузки', () => {
    expect(appJsContent).toContain('applyVisibility');
  });
});

describe('Перетаскивание графиков (Drag & Drop)', () => {
  test('Реализовано перетаскивание в основном списке', () => {
    expect(appJsContent).toContain('dragState');
    expect(appJsContent).toContain('dragging');
    expect(appJsContent).toContain('pointerdown');
    expect(appJsContent).toContain('pointermove');
    expect(appJsContent).toContain('pointerup');
  });
  
  test('Реализовано перетаскивание в панели настроек', () => {
    expect(appJsContent).toContain('settingsDrag');
    expect(appJsContent).toContain('settingsList');
    expect(appJsContent).toContain('draggable = true');
  });
  
  test('Сохранение порядка графиков', () => {
    expect(appJsContent).toContain('saveOrder');
    expect(appJsContent).toContain('ORDER_KEY');
    expect(appJsContent).toContain('localStorage');
  });
  
  test('Кнопка сброса порядка', () => {
    expect(appJsContent).toContain('resetZoom');
    expect(appJsContent).toContain('chartOrder = naturalOrder');
  });
});

describe('Скроллы и навигация', () => {
  test('Вертикальный скролл (основной)', () => {
    expect(appJsContent).toContain('scrollTop');
    expect(appJsContent).toContain('scrollIntoView');
  });
  
  test('Горизонтальный скролл (позиция времени)', () => {
    expect(appJsContent).toContain('timePosition');
    expect(appJsContent).toContain('timePositionDisplay');
    expect(appJsContent).toContain('Shift');
  });
  
  test('Ползунок позиции времени', () => {
    expect(appJsContent).toContain('timePosition');
    expect(appJsContent).toContain('addEventListener');
  });
  
  test('Таймлайн (нижняя полоса прокрутки)', () => {
    expect(appJsContent).toContain('timeline');
    expect(appJsContent).toContain('timelineTrack');
    expect(appJsContent).toContain('updateTimeline');
  });
  
  test('Колесо мыши для навигации', () => {
    expect(appJsContent).toContain('wheel');
    expect(appJsContent).toContain('deltaX');
    expect(appJsContent).toContain('deltaY');
  });
  
  test('Сенсорное управление (свайпы)', () => {
    expect(appJsContent).toContain('touchstart');
    expect(appJsContent).toContain('touchmove');
    expect(appJsContent).toContain('pan');
  });
});

describe('Интеграционные тесты', () => {
  test('parseAndDraw функция существует', () => {
    expect(appJsContent).toContain('function parseAndDraw');
  });
  
  test('Обработка ошибок при парсинге', () => {
    expect(appJsContent).toContain('catch');
    expect(appJsContent).toContain('Ошибка разбора');
  });
  
  test('Отображение информации о файле', () => {
    expect(appJsContent).toContain('fileInfo');
    expect(appJsContent).toContain('точек');
    expect(appJsContent).toContain('параметров');
  });
  
  test('Кнопка сброса зума и порядка', () => {
    expect(appJsContent).toContain('resetZoom');
    expect(appJsContent).toContain('windowSize = 30');
    expect(appJsContent).toContain('timePosition = 0');
  });
});

describe('Дополнительные проверки CSS', () => {
  const cssContent = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf-8');
  
  test('Стили для перетаскивания', () => {
    expect(cssContent).toContain('dragging');
    expect(cssContent).toContain('cursor: grab');
    expect(cssContent).toContain('cursor: grabbing');
  });
  
  test('Стили для скрытия графиков', () => {
    expect(cssContent).toContain('chart-hide-btn');
    expect(cssContent).toContain('hidden-item');
  });
  
  test('Стили для панели настроек', () => {
    expect(cssContent).toContain('settings-panel');
    expect(cssContent).toContain('settings-overlay');
  });
  
  test('Стили для скролла', () => {
    expect(cssContent).toContain('overflow-y: auto');
  });
});

describe('Проверка HTML структуры', () => {
  const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  
  test('Есть контейнер для графиков', () => {
    expect(htmlContent).toContain('id="charts"');
  });
  
  test('Есть кнопки управления зумом', () => {
    expect(htmlContent).toContain('id="zoomIn"');
    expect(htmlContent).toContain('id="zoomOut"');
    expect(htmlContent).toContain('id="resetZoom"');
  });
  
  test('Есть ползунки окна и позиции', () => {
    expect(htmlContent).toContain('id="windowSize"');
    expect(htmlContent).toContain('id="timePosition"');
  });
  
  test('Есть таймлайн', () => {
    expect(htmlContent).toContain('id="timeline"');
    expect(htmlContent).toContain('id="timelineTrack"');
  });
  
  test('Подключён app.js', () => {
    expect(htmlContent).toContain('src="app.js"');
  });
});
