/* ============================================================================
   ARCHIVO: app.js
   CUÁNDO SE UTILIZA Y CÓMO SE CONECTA CON HTML:
   - Se enlaza al final de index.html mediante <script src="app.js"></script>.
   - Actúa en 3 momentos clave:
     1. Al cargar la página (evento 'DOMContentLoaded'): lee el estado guardado en
        localStorage y sincroniza los contadores del DOM.
     2. Durante la interacción en vivo ('onclick', 'onchange', 'oninput'): cambia
        pestañas y calcula subtotales en dólares.
     3. Al enviar un formulario ('onsubmit'): valida las reglas de negocio de Ookini
        antes de aprobar la operación y guardar en JSON.
   ============================================================================ */

// =========================================================================
// 1. CONSTANTES Y REGLAS DEL NEGOCIO (Tipos primitivos y Objetos)
// =========================================================================
const MAX_SPECIAL_CUPS_PER_DAY = 50;          // Límite global diario de filtrados especiales
const MAX_SPECIAL_CUPS_PER_PERSON = 2;        // Límite por cliente al día
const MAX_TASTING_SPOTS = 8;                  // Cupo máximo en la cata semanal
const STORAGE_KEY = 'ookini_daily_state_v1';  // Clave única en localStorage

// Diccionario (Objeto) con los precios oficiales en dólares (USD)
const PRICES = {
    'V60': 5,
    'Kyoto drip': 7,
    'Siphon': 8,
    'Prensa francesa': 3,
    'Cata semanal': 25
};

// =========================================================================
// 2. GESTIÓN DEL ESTADO Y PERSISTENCIA (JSON + localStorage)
// =========================================================================

/**
 * Devuelve un objeto limpio que representa el inicio de un día operativo en Ookini.
 * Se utiliza al iniciar por primera vez o al pulsar "Reiniciar día".
 * @returns {Object} Estado inicial con todos los cupos disponibles y ventas en 0.
 */
function getInitialState() {
    return {
        specialCupsRemaining: MAX_SPECIAL_CUPS_PER_DAY,
        tastingSpotsRemaining: MAX_TASTING_SPOTS,
        frenchPressSold: 0,
        totalRevenue: 0,
        // Objeto diccionario: { "kenji takahashi": 2 } para rastrear tazas por cliente
        customerSpecialCups: {},
        // Arreglo (Array) de objetos con el historial cronológico de transacciones
        logs: []
    };
}

/**
 * Recupera el estado guardado en el navegador (localStorage) al abrir la web.
 * Convierte la cadena JSON de vuelta a un objeto JavaScript usando JSON.parse().
 * @returns {Object} El estado recuperado o un estado inicial nuevo si no existe.
 */
function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? { ...getInitialState(), ...JSON.parse(saved) } : getInitialState();
    } catch (e) {
        return getInitialState();
    }
}

/**
 * Guarda el estado actual en localStorage serializándolo a texto con JSON.stringify().
 * Se ejecuta cada vez que ocurre una reserva, un pedido o un reinicio del día.
 */
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // Silencia errores en navegadores con modo incógnito estricto
    }
}

/**
 * Normaliza el nombre de un cliente para evitar duplicados engañosos
 * (ej. "Sofía Pérez" y "sofia   perez" se reconocen como la misma persona).
 * @param {string} name - Nombre ingresado en el formulario.
 * @returns {string} Nombre en minúsculas, sin tildes ni espacios dobles.
 */
function normalizeCustomerName(name) {
    return name
        .trim()
        .toLowerCase()
        .normalize('NFD')                   // Descompone caracteres con tilde (á -> a + ´)
        .replace(/[\u0300-\u036f]/g, '')    // Elimina los signos diacríticos (tildes)
        .replace(/\s+/g, ' ');              // Reemplaza múltiples espacios por uno solo
}

// Variable global mutable que mantiene el estado vivo de la sesión
let state = loadState();

// =========================================================================
// 3. INTERACCIÓN CON EL DOM: PESTAÑAS Y CÁLCULO DE SUBTOTALES
// =========================================================================

/**
 * Alterna entre los 3 formularios del simulador ('especial', 'walkin', 'cata')
 * manipulando las clases CSS de Tailwind ('hidden', colores activos).
 * Se dispara desde los botones con onclick="switchTab(...)" en index.html.
 * @param {string} tabName - Identificador de la pestaña seleccionada.
 */
function switchTab(tabName) {
    const tabs = ['especial', 'walkin', 'cata'];
    hideFeedback();

    // Bucle forEach para recorrer las 3 pestañas y activar solo la elegida
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const form = document.getElementById(`form-${t}`);

        if (t === tabName) {
            btn.classList.remove('text-stone', 'hover:text-charcoal');
            btn.classList.add('bg-charcoal', 'text-washi', 'shadow-sm');
            form.classList.remove('hidden');
        } else {
            btn.classList.remove('bg-charcoal', 'text-washi', 'shadow-sm');
            btn.classList.add('text-stone', 'hover:text-charcoal');
            form.classList.add('hidden');
        }
    });

    updateFormSummary();
}

/**
 * Calcula y muestra en tiempo real el precio total a pagar en cada formulario.
 * Se dispara con los eventos onchange (selects) y oninput (inputs numéricos).
 */
function updateFormSummary() {
    // 1. Cálculo para Preparaciones Especiales
    const methodSelect = document.getElementById('special-method');
    const selectedOption = methodSelect.options[methodSelect.selectedIndex];
    const unitPrice = parseInt(selectedOption.getAttribute('data-price'), 10);
    const specialQty = parseInt(document.getElementById('special-qty').value, 10) || 1;
    document.getElementById('special-total-preview').textContent = `$${unitPrice * specialQty}`;

    // 2. Cálculo para Prensa Francesa Walk-in
    const walkinQty = parseInt(document.getElementById('walkin-qty').value, 10) || 0;
    document.getElementById('walkin-total-preview').textContent = `$${Math.max(0, walkinQty) * PRICES['Prensa francesa']}`;

    // 3. Cálculo para Cata Semanal
    const tastingSpots = parseInt(document.getElementById('tasting-spots').value, 10) || 0;
    document.getElementById('tasting-total-preview').textContent = `$${Math.max(0, tastingSpots) * PRICES['Cata semanal']}`;
}

// =========================================================================
// 4. CONTROLADORES DE REGLAS DE NEGOCIO (Eventos Submit)
// =========================================================================

/**
 * Valida y registra una reserva de método especial (V60, Kyoto drip o Siphon).
 * Aplica dos condiciones críticas:
 * - Condición A: No superar el límite global de 50 tazas especiales diarias.
 * - Condición B: No superar el límite individual de 2 tazas por persona al día.
 * @param {Event} event - Evento submit del formulario #form-especial.
 */
function handleSpecialReservation(event) {
    event.preventDefault(); // Evita que el navegador recargue la página al enviar
    hideFeedback();

    const rawName = document.getElementById('special-name').value.trim();
    const normalizedName = normalizeCustomerName(rawName);
    const method = document.getElementById('special-method').value;
    const qty = parseInt(document.getElementById('special-qty').value, 10);

    if (!rawName) {
        showFeedback('Por favor ingresa el nombre del cliente para registrar su reserva.', 'error');
        return;
    }

    // Validación 1: Disponibilidad global del día (50 tazas)
    if (state.specialCupsRemaining === 0) {
        showFeedback('Lo sentimos, se ha alcanzado el límite máximo de 50 tazas especiales por hoy. Puedes pedir Prensa Francesa walk-in.', 'error');
        return;
    }

    if (qty > state.specialCupsRemaining) {
        showFeedback(`Solo queda ${state.specialCupsRemaining} taza especial disponible hoy.`, 'error');
        return;
    }

    // Validación 2: Límite de 2 tazas por cliente al día
    const previousCupsByPerson = state.customerSpecialCups[normalizedName] || 0;
    if (previousCupsByPerson + qty > MAX_SPECIAL_CUPS_PER_PERSON) {
        const allowed = MAX_SPECIAL_CUPS_PER_PERSON - previousCupsByPerson;
        if (allowed <= 0) {
            showFeedback(`${rawName} ya alcanzó el máximo permitido de 2 tazas especiales por día.`, 'error');
        } else {
            showFeedback(`${rawName} ya tiene ${previousCupsByPerson} taza reservada hoy. Solo puede reservar ${allowed} más.`, 'error');
        }
        return;
    }

    // Actualización del estado tras superar todas las validaciones
    const totalCost = PRICES[method] * qty;
    state.specialCupsRemaining -= qty;
    state.customerSpecialCups[normalizedName] = previousCupsByPerson + qty;
    state.totalRevenue += totalCost;

    addLog({
        type: 'Reserva Especial',
        customer: rawName,
        detail: `${qty}x ${method}`,
        amount: totalCost,
        badgeColor: 'bg-matcha/15 text-matcha'
    });

    showFeedback(`¡Ookini, ${rawName}! Reserva confirmada: ${qty}x ${method} ($${totalCost}).`, 'success');
    document.getElementById('special-name').value = '';
    saveState();
    updateUI();
}

/**
 * Registra una venta inmediata (Walk-in) de Prensa Francesa a $3 por taza.
 * No requiere reserva previa ni aplica límite por persona.
 * @param {Event} event - Evento submit del formulario #form-walkin.
 */
function handleWalkinOrder(event) {
    event.preventDefault();
    hideFeedback();

    const rawName = document.getElementById('walkin-name').value.trim() || 'Cliente Walk-in';
    const qty = parseInt(document.getElementById('walkin-qty').value, 10);

    if (isNaN(qty) || qty < 1) {
        showFeedback('Ingresa una cantidad válida de tazas (mínimo 1).', 'error');
        return;
    }

    const totalCost = PRICES['Prensa francesa'] * qty;
    state.frenchPressSold += qty;
    state.totalRevenue += totalCost;

    addLog({
        type: 'Walk-in',
        customer: rawName,
        detail: `${qty}x Prensa francesa`,
        amount: totalCost,
        badgeColor: 'bg-charcoal/10 text-charcoal'
    });

    showFeedback(`Pedido walk-in registrado: ${qty}x Prensa francesa para ${rawName} ($${totalCost}).`, 'success');
    document.getElementById('walkin-name').value = '';
    document.getElementById('walkin-qty').value = 1;
    saveState();
    updateFormSummary();
    updateUI();
}

/**
 * Valida y reserva cupos para la Cata Semanal ($25 por persona).
 * Aplica la regla de capacidad estricta de 8 cupos por sesión.
 * @param {Event} event - Evento submit del formulario #form-cata.
 */
function handleTastingReservation(event) {
    event.preventDefault();
    hideFeedback();

    const rawName = document.getElementById('tasting-name').value.trim();
    const spots = parseInt(document.getElementById('tasting-spots').value, 10);

    if (!rawName) {
        showFeedback('Por favor ingresa un nombre para la reserva de la cata.', 'error');
        return;
    }

    if (isNaN(spots) || spots < 1) {
        showFeedback('Debes reservar al menos 1 cupo.', 'error');
        return;
    }

    // Validación de cupo máximo semanal (8 lugares)
    if (state.tastingSpotsRemaining === 0) {
        showFeedback('La cata semanal está llena (8/8 cupos reservados).', 'error');
        return;
    }

    if (spots > state.tastingSpotsRemaining) {
        showFeedback(`Solo quedan ${state.tastingSpotsRemaining} cupo(s) disponible(s) para la cata de esta semana.`, 'error');
        return;
    }

    const totalCost = PRICES['Cata semanal'] * spots;
    state.tastingSpotsRemaining -= spots;
    state.totalRevenue += totalCost;

    addLog({
        type: 'Cata Semanal',
        customer: rawName,
        detail: `${spots} cupo(s) degustación`,
        amount: totalCost,
        badgeColor: 'bg-terracotta/15 text-terracotta'
    });

    showFeedback(`¡Cupo asegurado! ${spots} lugar(es) reservados para ${rawName} en la cata semanal ($${totalCost}).`, 'success');
    document.getElementById('tasting-name').value = '';
    document.getElementById('tasting-spots').value = 1;
    saveState();
    updateFormSummary();
    updateUI();
}

// =========================================================================
// 5. RENDERIZADO DEL DOM Y UTILIDADES VISUALES
// =========================================================================

/**
 * Sincroniza todos los elementos visuales de index.html con los valores
 * actuales almacenados en el objeto 'state' (contadores, barras y botones).
 */
function updateUI() {
    // 1. Actualización de textos numéricos en Hero, Tarjetas e Indicadores
    document.getElementById('hero-special-left').textContent = state.specialCupsRemaining;
    document.getElementById('hero-tasting-left').textContent = state.tastingSpotsRemaining;

    document.getElementById('card-special-badge').textContent = `${state.specialCupsRemaining} tazas disponibles`;
    document.getElementById('card-tasting-badge').textContent = `${state.tastingSpotsRemaining} lugares libres`;

    document.getElementById('special-counter-text').textContent = `${state.specialCupsRemaining} / ${MAX_SPECIAL_CUPS_PER_DAY}`;
    document.getElementById('tasting-counter-text').textContent = `${state.tastingSpotsRemaining} / ${MAX_TASTING_SPOTS}`;
    document.getElementById('french-press-sold').textContent = state.frenchPressSold;
    document.getElementById('daily-revenue').textContent = `$${state.totalRevenue}`;

    // 2. Actualización del ancho porcentual de las barras de progreso
    const specialPct = (state.specialCupsRemaining / MAX_SPECIAL_CUPS_PER_DAY) * 100;
    const tastingPct = (state.tastingSpotsRemaining / MAX_TASTING_SPOTS) * 100;
    document.getElementById('special-progress-bar').style.width = `${specialPct}%`;
    document.getElementById('tasting-progress-bar').style.width = `${tastingPct}%`;

    // 3. Bloqueo preventivo de botones cuando los cupos llegan a 0
    const btnEspecial = document.getElementById('btn-submit-especial');
    if (state.specialCupsRemaining === 0) {
        btnEspecial.disabled = true;
        btnEspecial.textContent = 'Cupo Diario Agotado (50/50)';
        btnEspecial.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        btnEspecial.disabled = false;
        btnEspecial.textContent = 'Confirmar Reserva Especial';
        btnEspecial.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    const btnCata = document.getElementById('btn-submit-cata');
    if (state.tastingSpotsRemaining === 0) {
        btnCata.disabled = true;
        btnCata.textContent = 'Cata Semanal Llena (8/8)';
        btnCata.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        btnCata.disabled = false;
        btnCata.textContent = 'Reservar Cupo en Cata Semanal';
        btnCata.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    // 4. Redibujar la lista de registros del día
    renderLogs();
}

/**
 * Inserta una nueva transacción al inicio del historial (state.logs)
 * añadiendo la hora local formateada.
 * @param {Object} entry - Datos de la operación aprobada.
 */
function addLog(entry) {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    state.logs.unshift({ ...entry, time: timeString });
}

/**
 * Transforma el arreglo state.logs en tarjetas HTML usando .map() y .join('')
 * e inyecta el resultado dentro del contenedor #activity-log en index.html.
 */
function renderLogs() {
    const container = document.getElementById('activity-log');
    
    if (state.logs.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 px-4 rounded-2xl bg-sand/50 border border-dashed border-wood text-xs text-stone">
                Aún no hay reservas ni pedidos registrados hoy. Utiliza el panel izquierdo para simular una operación.
            </div>
        `;
        return;
    }

    container.innerHTML = state.logs.map(log => `
        <div class="p-3.5 rounded-2xl bg-sand/60 border border-wood/70 flex items-center justify-between gap-3">
            <div>
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold ${log.badgeColor}">${log.type}</span>
                    <span class="text-[11px] text-stone">${log.time}</span>
                </div>
                <p class="text-sm font-medium text-charcoal mt-1">${escapeHTML(log.customer)}</p>
                <p class="text-xs text-stone">${escapeHTML(log.detail)}</p>
            </div>
            <span class="font-serif font-semibold text-base text-charcoal">$${log.amount}</span>
        </div>
    `).join('');
}

/**
 * Muestra notificaciones visuales de éxito o error dentro del formulario,
 * evitando el uso invasivo de alert().
 * @param {string} message - Texto explicativo para el usuario.
 * @param {'success'|'error'} type - Define el color del borde y fondo.
 */
function showFeedback(message, type) {
    const box = document.getElementById('feedback-box');
    box.textContent = message;
    box.classList.remove('hidden', 'bg-matcha/15', 'border-matcha', 'bg-terracotta/15', 'border-terracotta');

    if (type === 'success') {
        box.classList.add('bg-matcha/15', 'border-matcha', 'text-charcoal');
    } else {
        box.classList.add('bg-terracotta/15', 'border-terracotta', 'text-charcoal');
    }
}

/**
 * Oculta la caja de notificaciones del simulador.
 */
function hideFeedback() {
    document.getElementById('feedback-box').classList.add('hidden');
}

/**
 * Restaura todos los cupos y borra el historial del día tanto en memoria
 * como en localStorage. Se activa con onclick="resetSimulation()".
 */
function resetSimulation() {
    state = getInitialState();
    saveState();
    hideFeedback();
    updateUI();
}

/**
 * Escapa caracteres especiales HTML (&, <, >, ", ') para prevenir inyección
 * de código (XSS) al renderizar nombres escritos por el usuario.
 * @param {string} str - Cadena sin sanitizar.
 * @returns {string} Cadena segura para insertar en innerHTML.
 */
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

// =========================================================================
// 6. PUNTO DE ENTRADA (Evento DOMContentLoaded)
// Se ejecuta automáticamente cuando el navegador termina de construir el HTML.
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
    updateFormSummary();
    updateUI();
});