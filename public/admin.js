const STATUSES = ['new', 'cooking', 'delivering', 'done', 'cancelled'];
const CATEGORIES = { burger: 'Burgers', risotto: 'Risotto', asian: 'Asian', salads: 'Salads' };

let token = localStorage.getItem('yk_token');
let currentTab = 'dashboard';
let ordersFilter = '';
let restaurantsCache = [];

// ================== Утилиты ==================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const money = n => '€' + Number(n).toFixed(2);

async function api(url, method = 'GET', body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || 'Server error');
        err.status = res.status;
        throw err;
    }
    return data;
}

let toastTimer;
function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function openModal(html) {
    $('modalBody').innerHTML = html;
    $('modal').classList.add('open');
}
function closeModal() {
    $('modal').classList.remove('open');
}

// ================== Вход ==================
function showLogin(message) {
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginError').textContent = message || '';
}

async function doLogin(event) {
    event.preventDefault();
    try {
        const res = await api('/api/login', 'POST', {
            email: $('loginEmail').value,
            password: $('loginPass').value
        });
        token = res.token;
        localStorage.setItem('yk_token', res.token);
        localStorage.setItem('yk_user', JSON.stringify(res.user));
        await init();
    } catch (err) {
        $('loginError').textContent = err.message;
    }
}

function logout() {
    token = null;
    localStorage.removeItem('yk_token');
    localStorage.removeItem('yk_user');
    showLogin();
}

async function init() {
    if (!token) return showLogin();
    try {
        await api('/api/admin/stats');
    } catch (err) {
        return showLogin(err.status === 403 ? 'This account is not an admin.' : '');
    }
    $('login').hidden = true;
    $('app').hidden = false;

    let name = '';
    try { name = JSON.parse(localStorage.getItem('yk_user')).name; } catch {}
    $('adminName').textContent = name;

    showTab(currentTab);
}

// ================== Вкладки ==================
function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === name);
    });
    const renderers = {
        dashboard: renderDashboard,
        orders: renderOrders,
        restaurants: renderRestaurants,
        subscribers: renderSubscribers
    };
    renderers[name]();
}

async function guarded(fn) {
    try {
        await fn();
    } catch (err) {
        if (err.status === 401 || err.status === 403) return showLogin('Session expired. Please log in again.');
        toast(err.message);
    }
}

// ================== Dashboard ==================
function renderDashboard() {
    return guarded(async () => {
        const s = await api('/api/admin/stats');
        $('view').innerHTML = `
            <div class="page-head"><h1>Dashboard</h1></div>
            <div class="cards">
                <div class="card accent"><div class="num">${s.newOrders}</div><div class="label">New orders</div></div>
                <div class="card"><div class="num">${s.orders}</div><div class="label">Total orders</div></div>
                <div class="card"><div class="num">${money(s.revenue)}</div><div class="label">Revenue (without cancelled)</div></div>
                <div class="card"><div class="num">${s.restaurants}</div><div class="label">Restaurants</div></div>
                <div class="card"><div class="num">${s.dishes}</div><div class="label">Dishes</div></div>
                <div class="card"><div class="num">${s.users}</div><div class="label">Customers</div></div>
                <div class="card"><div class="num">${s.subscribers}</div><div class="label">Subscribers</div></div>
            </div>
        `;
    });
}

// ================== Заказы ==================
function renderOrders() {
    return guarded(async () => {
        const orders = await api('/api/admin/orders' + (ordersFilter ? '?status=' + ordersFilter : ''));

        $('view').innerHTML = `
            <div class="page-head">
                <h1>Orders</h1>
                <select id="orderFilter" style="width:auto" onchange="ordersFilter = this.value; renderOrders()">
                    <option value="">All statuses</option>
                    ${STATUSES.map(s => `<option value="${s}" ${s === ordersFilter ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </div>
            <div class="table-wrap">
                ${orders.length === 0 ? '<div class="empty">No orders yet.</div>' : `
                <table>
                    <thead><tr><th>#</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
                    <tbody>
                        ${orders.map(o => `
                        <tr>
                            <td><b>${o.id}</b></td>
                            <td>${esc(o.created_at)}<div class="muted">${o.mode}</div></td>
                            <td>
                                ${esc(o.name)}<div class="muted">${esc(o.phone)}</div>
                                <div class="muted">${o.mode === 'delivery' ? esc(o.address) : 'Takeout'}</div>
                                ${o.user_email ? `<div class="muted">account: ${esc(o.user_email)}</div>` : '<div class="muted">guest</div>'}
                            </td>
                            <td>${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join('<br>')}</td>
                            <td><b>${money(o.total)}</b><div class="muted">delivery ${o.fee ? money(o.fee) : 'free'}</div></td>
                            <td>
                                <select class="status-select status-${o.status}" onchange="setStatus(${o.id}, this)">
                                    ${STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                                </select>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>`}
            </div>
        `;
    });
}

function setStatus(id, selectEl) {
    return guarded(async () => {
        await api('/api/admin/orders/' + id, 'PATCH', { status: selectEl.value });
        selectEl.className = 'status-select status-' + selectEl.value;
        toast(`Order #${id}: ${selectEl.value}`);
    });
}

// ================== Рестораны ==================
function renderRestaurants() {
    return guarded(async () => {
        restaurantsCache = await api('/api/admin/restaurants');

        $('view').innerHTML = `
            <div class="page-head">
                <h1>Restaurants</h1>
                <button class="btn primary" onclick="restaurantForm()">+ Add restaurant</button>
            </div>
            <div class="table-wrap">
                ${restaurantsCache.length === 0 ? '<div class="empty">No restaurants yet.</div>' : `
                <table>
                    <thead><tr><th></th><th>Name</th><th>Category</th><th>Map pin</th><th>Dishes</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                        ${restaurantsCache.map(r => `
                        <tr>
                            <td><img class="thumb" src="${esc(r.image)}" alt=""></td>
                            <td><b>${esc(r.name)}</b></td>
                            <td>${esc(CATEGORIES[r.category] || r.category)}</td>
                            <td class="muted">top ${r.pin_top}% · left ${r.pin_left}%</td>
                            <td>${r.dish_count}</td>
                            <td><span class="badge ${r.active ? 'on' : 'off'}">${r.active ? 'Visible' : 'Hidden'}</span></td>
                            <td>
                                <div class="actions">
                                    <button class="btn small" onclick="openDishes(${r.id})">Dishes</button>
                                    <button class="btn small" onclick="restaurantForm(${r.id})">Edit</button>
                                    <button class="btn small danger" onclick="deleteRestaurant(${r.id})">Delete</button>
                                </div>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>`}
            </div>
        `;
    });
}

function restaurantForm(id) {
    const r = restaurantsCache.find(x => x.id === id) ||
        { name: '', category: 'burger', image: 'img/', logo: 'img/', pin_top: 50, pin_left: 50, active: 1 };

    openModal(`
        <h2 class="modal-title">${id ? 'Edit restaurant' : 'New restaurant'}</h2>
        <form class="form" onsubmit="saveRestaurant(event, ${id || 0})">
            <label>Name <input id="rName" required value="${esc(r.name)}"></label>
            <label>Category
                <select id="rCategory">
                    ${Object.entries(CATEGORIES).map(([k, v]) =>
                        `<option value="${k}" ${k === r.category ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </label>
            <label>Photo path <input id="rImage" required value="${esc(r.image)}" placeholder="img/burger/burger.png"></label>
            <label>Logo path <input id="rLogo" required value="${esc(r.logo)}" placeholder="img/burger/burger-logo.png"></label>
            <div class="row">
                <label>Pin top, % <input id="rTop" type="number" min="0" max="100" step="0.1" required value="${r.pin_top}"></label>
                <label>Pin left, % <input id="rLeft" type="number" min="0" max="100" step="0.1" required value="${r.pin_left}"></label>
            </div>
            <label class="check"><input id="rActive" type="checkbox" ${r.active ? 'checked' : ''}> Visible on the site</label>
            <button type="submit" class="btn primary">Save</button>
        </form>
    `);
}

function saveRestaurant(event, id) {
    event.preventDefault();
    return guarded(async () => {
        const body = {
            name: $('rName').value,
            category: $('rCategory').value,
            image: $('rImage').value,
            logo: $('rLogo').value,
            pin_top: $('rTop').value,
            pin_left: $('rLeft').value,
            active: $('rActive').checked
        };
        if (id) await api('/api/admin/restaurants/' + id, 'PUT', body);
        else await api('/api/admin/restaurants', 'POST', body);
        closeModal();
        toast('Saved');
        renderRestaurants();
    });
}

function deleteRestaurant(id) {
    const r = restaurantsCache.find(x => x.id === id);
    if (!confirm(`Delete "${r.name}" and all its dishes?`)) return;
    return guarded(async () => {
        await api('/api/admin/restaurants/' + id, 'DELETE');
        toast('Deleted');
        renderRestaurants();
    });
}

// ================== Блюда ==================
function openDishes(restaurantId) {
    return guarded(async () => {
        const r = restaurantsCache.find(x => x.id === restaurantId);
        const dishes = await api(`/api/admin/restaurants/${restaurantId}/dishes`);

        openModal(`
            <h2 class="modal-title">${esc(r.name)} · dishes</h2>
            ${dishes.length === 0 ? '<p class="muted" style="margin-bottom:12px">No dishes yet.</p>' : ''}
            ${dishes.map(d => `
                <div class="dish-edit">
                    <input id="dn${d.id}" value="${esc(d.name)}">
                    <input id="dp${d.id}" type="number" min="0.01" step="0.01" value="${d.price}">
                    <label><input id="da${d.id}" type="checkbox" ${d.active ? 'checked' : ''}> visible</label>
                    <span class="actions" style="display:flex; gap:6px">
                        <button class="btn small primary" onclick="saveDish(${d.id}, ${restaurantId})">Save</button>
                        <button class="btn small danger" onclick="deleteDish(${d.id}, ${restaurantId})">✕</button>
                    </span>
                </div>
            `).join('')}
            <div class="dish-add">
                <h3 style="font-size:14px; margin-bottom:10px">Add a dish</h3>
                <div class="dish-edit">
                    <input id="newDishName" placeholder="Dish name">
                    <input id="newDishPrice" type="number" min="0.01" step="0.01" placeholder="Price">
                    <label><input id="newDishActive" type="checkbox" checked> visible</label>
                    <button class="btn small primary" onclick="addDish(${restaurantId})">Add</button>
                </div>
            </div>
        `);
    });
}

function saveDish(id, restaurantId) {
    return guarded(async () => {
        await api('/api/admin/dishes/' + id, 'PUT', {
            name: $('dn' + id).value,
            price: $('dp' + id).value,
            active: $('da' + id).checked
        });
        toast('Dish saved');
    });
}

function deleteDish(id, restaurantId) {
    if (!confirm('Delete this dish?')) return;
    return guarded(async () => {
        await api('/api/admin/dishes/' + id, 'DELETE');
        toast('Dish deleted');
        await openDishes(restaurantId);
        renderRestaurants();
    });
}

function addDish(restaurantId) {
    return guarded(async () => {
        await api(`/api/admin/restaurants/${restaurantId}/dishes`, 'POST', {
            name: $('newDishName').value,
            price: $('newDishPrice').value,
            active: $('newDishActive').checked
        });
        toast('Dish added');
        await openDishes(restaurantId);
        renderRestaurants();
    });
}

// ================== Подписчики ==================
function renderSubscribers() {
    return guarded(async () => {
        const list = await api('/api/admin/subscribers');
        $('view').innerHTML = `
            <div class="page-head"><h1>Subscribers (${list.length})</h1></div>
            <div class="table-wrap">
                ${list.length === 0 ? '<div class="empty">No subscribers yet.</div>' : `
                <table>
                    <thead><tr><th>#</th><th>Email</th></tr></thead>
                    <tbody>${list.map(s => `<tr><td>${s.id}</td><td>${esc(s.email)}</td></tr>`).join('')}</tbody>
                </table>`}
            </div>
        `;
    });
}

init();
