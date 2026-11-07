// ================== Состояние ==================
function load(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v === null || v === undefined ? fallback : v;
    } catch {
        return fallback;
    }
}

const FREE_DELIVERY_FROM = 29;
const DELIVERY_FEE = 3.5;

const state = {
    cart: load('yk_cart', []),        // [{dish_id, name, price, qty}]
    token: localStorage.getItem('yk_token'),
    user: load('yk_user', null),
    mode: 'delivery',                 // delivery | takeout
    dishes: {}                        // кэш блюд: id -> блюдо
};

// ================== Утилиты ==================
const esc = s => String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const money = n => '€' + Number(n).toFixed(2);

async function api(url, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;

    const res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Server error');
    return data;
}

let toastTimer;
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function openModal(html) {
    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('modal').classList.add('open');
}
function closeModal() {
    document.getElementById('modal').classList.remove('open');
}

// ================== Инициализация ==================
document.addEventListener('DOMContentLoaded', () => {
    // бургер-меню
    const sideMenu = document.getElementById('sideMenu');
    document.getElementById('burgerBtn').addEventListener('click', () => sideMenu.classList.add('open'));
    document.getElementById('closeBtn').addEventListener('click', () => sideMenu.classList.remove('open'));
    sideMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => sideMenu.classList.remove('open')));

    // шапка
    document.getElementById('loginLink').addEventListener('click', e => {
        e.preventDefault();
        state.user ? openProfile() : openAuth('login');
    });
    document.getElementById('cartLink').addEventListener('click', e => {
        e.preventDefault();
        openCart();
    });

    updateAuthUI();
    updateCartCount();
    loadRestaurants('all');
    loadMap();
});

// ================== Hero: Delivery / Takeout ==================
function toggleHeroTab(clickedButton, mode) {
    document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
    clickedButton.classList.add('active');
    state.mode = mode;
    toast(mode === 'delivery' ? 'Delivery mode' : 'Takeout mode: no delivery fee');
}

// ================== Рестораны ==================
async function loadRestaurants(category) {
    const grid = document.getElementById('restaurantsGrid');
    try {
        const list = await api('/api/restaurants?category=' + encodeURIComponent(category));
        if (list.length === 0) {
            grid.innerHTML = '<p style="color:var(--gray)">No restaurants found.</p>';
            return;
        }
        grid.innerHTML = list.map(r => `
            <div class="restaurant-card" onclick="openRestaurant(${r.id})">
                <img src="${esc(r.image)}" alt="${esc(r.name)}">
                <div class="res-logo-box">
                    <img src="${esc(r.logo)}" alt="${esc(r.name)}">
                </div>
            </div>
        `).join('');
    } catch (err) {
        grid.innerHTML = '<p style="color:#c0392b">Could not load restaurants. Is the server running?</p>';
    }
}

function filterMenu(category, clickedElement) {
    document.querySelectorAll('.category-item').forEach(item => item.classList.remove('active'));
    clickedElement.classList.add('active');
    loadRestaurants(category);
}

function showAll() {
    const all = document.querySelector('.category-item');
    filterMenu('all', all);
}

async function openRestaurant(id) {
    try {
        const { restaurant, dishes } = await api(`/api/restaurants/${id}/dishes`);
        dishes.forEach(d => { state.dishes[d.id] = d; });

        openModal(`
            <h2 class="modal-title">${esc(restaurant.name)}</h2>
            <ul class="dish-list">
                ${dishes.map(d => `
                    <li class="dish-row">
                        <span>${esc(d.name)}</span>
                        <span class="dish-price">${money(d.price)}</span>
                        <button class="btn-yellow-small" onclick="addToCart(${d.id})">+ Add</button>
                    </li>
                `).join('')}
            </ul>
        `);
    } catch (err) {
        toast(err.message);
    }
}

// ================== Корзина ==================
function saveCart() {
    localStorage.setItem('yk_cart', JSON.stringify(state.cart));
    updateCartCount();
}

function updateCartCount() {
    const n = state.cart.reduce((sum, i) => sum + i.qty, 0);
    document.getElementById('cart-count').textContent = n;
}

function addToCart(dishId) {
    const dish = state.dishes[dishId];
    if (!dish) return;
    const existing = state.cart.find(i => i.dish_id === dishId);
    if (existing) {
        existing.qty += 1;
    } else {
        state.cart.push({ dish_id: dishId, name: dish.name, price: dish.price, qty: 1 });
    }
    saveCart();
    toast(`${dish.name} added to cart`);
}

function changeQty(dishId, delta) {
    const item = state.cart.find(i => i.dish_id === dishId);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) state.cart = state.cart.filter(i => i.dish_id !== dishId);
    saveCart();
    openCart();
}

function cartTotals() {
    const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = state.mode === 'takeout' || subtotal >= FREE_DELIVERY_FROM || subtotal === 0 ? 0 : DELIVERY_FEE;
    return { subtotal, fee, total: subtotal + fee };
}

function openCart() {
    if (state.cart.length === 0) {
        openModal('<h2 class="modal-title">Your cart</h2><p style="color:var(--gray)">Your cart is empty. Pick a restaurant and add something tasty!</p>');
        return;
    }

    const { subtotal, fee, total } = cartTotals();
    const isDelivery = state.mode === 'delivery';

    openModal(`
        <h2 class="modal-title">Your cart <small>(${isDelivery ? 'Delivery' : 'Takeout'})</small></h2>
        <ul class="dish-list">
            ${state.cart.map(i => `
                <li class="dish-row">
                    <span>${esc(i.name)}</span>
                    <span class="qty">
                        <button onclick="changeQty(${i.dish_id}, -1)">−</button>
                        ${i.qty}
                        <button onclick="changeQty(${i.dish_id}, 1)">+</button>
                    </span>
                    <span class="dish-price">${money(i.price * i.qty)}</span>
                </li>
            `).join('')}
        </ul>
        <div class="totals">
            <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
            <div><span>Delivery</span><span>${fee === 0 ? 'Free' : money(fee)}</span></div>
            <div class="grand"><span>Total</span><span>${money(total)}</span></div>
        </div>
        <form class="modal-form" onsubmit="submitOrder(event)">
            <input id="ordName" placeholder="Your name" required value="${esc(state.user ? state.user.name : '')}">
            <input id="ordPhone" placeholder="Phone" required>
            ${isDelivery ? '<input id="ordAddress" placeholder="Delivery address" required>' : ''}
            <button type="submit" class="btn-yellow-submit full">Place order</button>
        </form>
    `);
}

async function submitOrder(event) {
    event.preventDefault();
    const body = {
        name: document.getElementById('ordName').value,
        phone: document.getElementById('ordPhone').value,
        address: state.mode === 'delivery' ? document.getElementById('ordAddress').value : '',
        mode: state.mode,
        items: state.cart.map(i => ({ dish_id: i.dish_id, qty: i.qty }))
    };

    try {
        const res = await api('/api/orders', { method: 'POST', body });
        state.cart = [];
        saveCart();
        openModal(`
            <h2 class="modal-title">Thank you! 🎉</h2>
            <p>Your order <b>#${res.id}</b> is accepted.</p>
            <p>Total: <b>${money(res.total)}</b></p>
            <p style="color:var(--gray); margin-top:8px;">We will deliver it in less than 30 minutes.</p>
        `);
    } catch (err) {
        toast(err.message);
    }
}

// ================== Вход / регистрация ==================
function updateAuthUI() {
    document.getElementById('loginLabel').textContent = state.user ? state.user.name : 'Log in';
}

function openAuth(kind) {
    const isLogin = kind === 'login';
    openModal(`
        <h2 class="modal-title">${isLogin ? 'Log in' : 'Create account'}</h2>
        <form class="modal-form" onsubmit="submitAuth(event, '${kind}')">
            ${isLogin ? '' : '<input id="authName" placeholder="Your name" required>'}
            <input id="authEmail" type="email" placeholder="Email" required>
            <input id="authPass" type="password" placeholder="Password (min 6 characters)" required>
            <button type="submit" class="btn-yellow-submit full">${isLogin ? 'Log in' : 'Sign up'}</button>
        </form>
        <p class="modal-switch">
            ${isLogin
                ? `No account? <a href="#" onclick="openAuth('register'); return false;">Sign up</a>`
                : `Already registered? <a href="#" onclick="openAuth('login'); return false;">Log in</a>`}
        </p>
    `);
}

async function submitAuth(event, kind) {
    event.preventDefault();
    const body = {
        email: document.getElementById('authEmail').value,
        password: document.getElementById('authPass').value
    };
    if (kind === 'register') body.name = document.getElementById('authName').value;

    try {
        const res = await api(kind === 'login' ? '/api/login' : '/api/register', { method: 'POST', body });
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('yk_token', res.token);
        localStorage.setItem('yk_user', JSON.stringify(res.user));
        updateAuthUI();
        closeModal();
        toast(`Welcome, ${res.user.name}!`);
    } catch (err) {
        toast(err.message);
    }
}

async function openProfile() {
    try {
        const orders = await api('/api/orders/my');
        openModal(`
            <h2 class="modal-title">${esc(state.user.name)}</h2>
            <p style="color:var(--gray); margin-bottom:16px;">${esc(state.user.email)}</p>
            ${state.user.role === 'admin' ? '<a href="/admin.html" class="btn-yellow-small" style="display:inline-block; text-decoration:none; color:inherit; margin-bottom:16px;">Open admin panel</a>' : ''}
            <h3 style="margin-bottom:8px;">My orders</h3>
            ${orders.length === 0 ? '<p style="color:var(--gray)">No orders yet.</p>' : `
                <ul class="dish-list">
                    ${orders.map(o => `
                        <li class="order-row">
                            <b>#${o.id}</b> · ${esc(o.created_at)} · ${o.mode} · <b>${money(o.total)}</b> · <span class="order-status">${esc(o.status)}</span><br>
                            <small>${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(', ')}</small>
                        </li>
                    `).join('')}
                </ul>`}
            <button class="btn-yellow-submit full" style="margin-top:20px; border-radius:4px;" onclick="logout()">Log out</button>
        `);
    } catch (err) {
        // токен мог устареть
        logout();
    }
}

function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('yk_token');
    localStorage.removeItem('yk_user');
    updateAuthUI();
    closeModal();
    toast('You are logged out');
}

// ================== Подписка ==================
async function handleSubscribe(event) {
    event.preventDefault();
    const emailInput = document.getElementById('subscriberEmail');
    try {
        const res = await api('/api/subscribe', { method: 'POST', body: { email: emailInput.value } });
        toast(res.already
            ? 'This email is already subscribed'
            : 'Thank you! You are subscribed to YellowKitchen updates.');
        emailInput.value = '';
    } catch (err) {
        toast(err.message);
    }
}

// ================== Карта ==================
async function loadMap() {
    try {
        const list = await api('/api/restaurants');
        document.getElementById('statRestaurants').textContent = list.length;

        const frame = document.getElementById('mapFrame');
        list.forEach(r => {
            const pin = document.createElement('div');
            pin.className = 'map-pin-item';
            pin.style.top = r.pin_top + '%';
            pin.style.left = r.pin_left + '%';
            pin.innerHTML = `<img src="./img/map-pin.png" alt="Pin"><div class="map-tooltip">${esc(r.name)}</div>`;
            pin.addEventListener('click', () => showMapTooltip(pin));
            frame.appendChild(pin);
        });
    } catch (err) {
        console.error('Map load failed', err);
    }
}

function showMapTooltip(clickedPin) {
    const wasActive = clickedPin.classList.contains('active');
    document.querySelectorAll('.map-pin-item').forEach(pin => pin.classList.remove('active'));
    if (!wasActive) clickedPin.classList.add('active');
}
