const API_URL = "http://127.0.0.1:8000"; // Backend URL
// --- Global State ---
let currentUser = null;
let currentWeekStart = null;
let currentSelectedDate = null;
let scheduleData = {};
let friendsList = [];
let friendRequests = [];
let activeMatches = [];
let matchRequests = [];
let currentMatchState = {
    friendUsername: null,
    currentDate: new Date()
};
// --- Timezone Data ---
const timezones = {
    'UTC': 'UTC',
    'America/New_York': 'Eastern Time (US & Canada)',
    'America/Chicago': 'Central Time (US & Canada)',
    'America/Denver': 'Mountain Time (US & Canada)',
    'America/Los_Angeles': 'Pacific Time (US & Canada)',
    'Europe/London': 'London, Dublin',
    'Europe/Paris': 'Paris, Berlin, Rome',
    'Asia/Tokyo': 'Tokyo, Seoul',
    'Asia/Shanghai': 'Beijing, Shanghai',
    'Asia/Kolkata': 'India Standard Time',
    'Australia/Sydney': 'Sydney, Melbourne'
};
// --- App Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById('registerForm')) {
        setupLoginPage();
    } else if (document.getElementById('app')) {
        initializeApp();
    }
});
function setupLoginPage() {
    const registerForm = document.getElementById('registerForm');
    const loginForm = document.getElementById('loginForm');
    const message = document.getElementById('message');
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const displayName = document.getElementById('reg-displayname').value;
        const password = document.getElementById('reg-password').value;
        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, display_name: displayName, password })
            });
            const data = await response.json();
            if (response.ok) {
                message.textContent = 'Registration successful! Please log in.';
                message.style.color = 'var(--success-color, green)';
                registerForm.reset();
            } else {
                message.textContent = `Registration failed: ${data.detail}`;
                message.style.color = 'var(--danger-color, red)';
            }
        } catch (error) {
            message.textContent = 'An error occurred. Please try again.';
            message.style.color = 'var(--danger-color, red)';
        }
    });
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        try {
            const response = await fetch(`${API_URL}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('accessToken', data.access_token);
                window.location.href = 'welcome.html';
            } else {
                const errorData = await response.json();
                message.textContent = `Login failed: ${errorData.detail}`;
                message.style.color = 'var(--danger-color, red)';
            }
        } catch (error) {
            message.textContent = 'An error occurred. Please try again.';
            message.style.color = 'var(--danger-color, red)';
        }
    });
}
async function initializeApp() {
    const token = localStorage.getItem('accessToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = await apiRequest('/users/me/');
    if (!currentUser) return;
    
    populateTimezoneSelect();
    initializeCalendar();
    setupSearch();
    await updateFriendAndMatchData();
    document.getElementById('timezone-select').addEventListener('change', updateTimezone);
    document.getElementById('friends-btn').addEventListener('click', openFriendsModal);
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
}
// --- API Request Helper ---
async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` };
    const options = { method, headers };
    
    if (body) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        if (response.status === 401) {
            logout();
            return null;
        }
        if (!response.ok) {
            const errData = await response.json().catch(() => ({ detail: response.statusText }));
            console.error('API Error:', errData.detail);
            alert(`Error: ${errData.detail}`);
            return null;
        }
        return response.status === 204 || (response.status === 200 && method === 'DELETE') ? true : await response.json();
    } catch (error) {
        console.error('Network or API request failed:', error);
        alert('An unexpected error occurred.');
        return null;
    }
}
// --- Data Fetching ---
async function updateFriendAndMatchData() {
    const [friends, friendReqs, matches, matchReqs] = await Promise.all([
        apiRequest('/friends/'),
        apiRequest('/friends/requests'),
        apiRequest('/matches'),
        apiRequest('/matches/requests')
    ]);
    friendsList = friends || [];
    friendRequests = friendReqs || [];
    activeMatches = matches || [];
    matchRequests = matchReqs || [];
    const reqCountBadge = document.getElementById('requests-count');
    reqCountBadge.textContent = friendRequests.length > 0 ? `(${friendRequests.length})` : '';
    const matchReqCountBadge = document.getElementById('match-requests-count');
    matchReqCountBadge.textContent = matchRequests.length > 0 ? `(${matchRequests.length})` : '';
}
// --- User Profile & Timezone ---
function populateTimezoneSelect() {
    const timezoneSelect = document.getElementById('timezone-select');
    timezoneSelect.innerHTML = Object.entries(timezones)
        .map(([value, text]) => `<option value="${value}">${text}</option>`)
        .join('');
    timezoneSelect.value = currentUser.timezone || 'UTC';
}
async function updateTimezone() {
    const newTimezone = document.getElementById('timezone-select').value;
    const updatedUser = await apiRequest('/users/me/', 'PUT', { timezone: newTimezone });
    if (updatedUser) {
        currentUser.timezone = updatedUser.timezone;
    }
}
// --- User Search ---
function setupSearch() {
    const searchInput = document.getElementById('user-search');
    const searchResults = document.getElementById('search-results');
    
    let debounceTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const query = searchInput.value.trim();
            if (query.length < 2) {
                searchResults.style.display = 'none';
                return;
            }
            const users = await apiRequest(`/users/search?query=${encodeURIComponent(query)}`);
            renderSearchResults(users);
        }, 300);
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResults.style.display = 'none';
        }
    });
}
function renderSearchResults(users) {
    const resultsContainer = document.getElementById('search-results');
    if (!users || users.length === 0) {
        resultsContainer.innerHTML = `<div class="search-result-item">No users found.</div>`;
        resultsContainer.style.display = 'block';
        return;
    }
    
    resultsContainer.innerHTML = users.map(user => `
        <div class="search-result-item" data-username="${user.username}">
            <div class="user-info">
                <span class="display-name">${user.display_name}</span>
                <span class="username">@${user.username}</span>
            </div>
            ${getFriendButton(user.friendship_status, user.username)}
        </div>
    `).join('');
    resultsContainer.style.display = 'block';
}
function getFriendButton(status, username) {
    switch (status) {
        case 'friends': return `<button class="secondary" disabled>Friends</button>`;
        case 'request_sent': return `<button class="secondary" disabled>Request Sent</button>`;
        case 'request_received': return `<button class="accept-btn" onclick="respondToFriendRequestWrapper('${username}', true)">Accept</button>`;
        default: return `<button onclick="sendFriendRequestWrapper('${username}')">Add Friend</button>`;
    }
}
// --- Friends & Matches Modal ---
function openFriendsModal() {
    document.getElementById('friends-modal').style.display = 'block';
    switchFriendsMode('matches');
    renderFriendsModalContent();
}
function closeFriendsModal() {
    document.getElementById('friends-modal').style.display = 'none';
}
function switchFriendsMode(mode) {
    document.getElementById('matches-tab').classList.toggle('active', mode === 'matches');
    document.getElementById('my-friends-tab').classList.toggle('active', mode === 'friends');
    document.getElementById('requests-tab').classList.toggle('active', mode === 'requests');
    renderFriendsModalContent(mode);
}
function renderFriendsModalContent(mode) {
    const activeMode = mode || document.querySelector('#friends-modal .tab-btn.active').id.split('-')[0];
    const container = document.getElementById('friends-content');
    if (activeMode === 'matches') renderMatchesTab(container);
    else if (activeMode === 'friends') renderFriendsTab(container);
    else renderFriendRequestsTab(container);
}
// --- Tab Rendering Functions ---
function renderMatchesTab(container) {
    let content = '<h4>Match Requests</h4>';
    if (matchRequests.length === 0) {
        content += `<div class="empty-state">No pending match requests.</div>`;
    } else {
        content += `<ul class="request-list">${matchRequests.map(username => `
            <li class="match-request-item">
                <div class="user-info">
                    <span class="display-name">@${username}</span> wants to match schedules.
                </div>
                <div class="match-request-item-actions">
                    <button class="accept-btn" onclick="respondToMatchRequest('${username}', true)">Accept</button>
                    <button class="decline-btn" onclick="respondToMatchRequest('${username}', false)">Decline</button>
                </div>
            </li>`).join('')}</ul>`;
    }
    content += '<h4 style="margin-top: 2rem;">Active Matches</h4>';
    if (activeMatches.length === 0) {
        content += `<div class="empty-state">Request a match from your friends list to get started.</div>`;
    } else {
        content += `<ul class="friend-list">${activeMatches.map(match => {
            const friend = match.users.find(u => u !== currentUser.username);
            return `<li class="match-item">
                <span class="username">@${friend}</span>
                <div class="match-item-actions">
                    <button onclick="openMatchOverlapModal('${friend}')">View Match</button>
                    <button class="remove-slot" onclick="deleteMatch('${friend}')">Unmatch</button>
                </div>
            </li>`;
        }).join('')}</ul>`;
    }
    container.innerHTML = content;
}
function renderFriendsTab(container) {
    if (friendsList.length === 0) {
        container.innerHTML = `<div class="empty-state">Use the search bar to find friends.</div>`;
        return;
    }
    container.innerHTML = `<ul class="friend-list">${friendsList.map(friend => {
        const isMatched = activeMatches.some(m => m.users.includes(friend.username));
        let buttonHtml = isMatched
            ? `<button class="secondary" disabled>Matched</button>`
            : `<button onclick="sendMatchRequest('${friend.username}')">Request Match</button>`;
        return `
            <li class="friend-item">
                <div class="user-info"><span class="display-name">${friend.display_name}</span><span class="username">@${friend.username}</span></div>
                <div class="friend-item-actions">
                    ${buttonHtml}
                    <button class="remove-slot" onclick="removeFriend('${friend.username}')">Unfriend</button>
                </div>
            </li>`;
    }).join('')}</ul>`;
}
function renderFriendRequestsTab(container) {
    if (friendRequests.length === 0) {
        container.innerHTML = `<div class="empty-state">No pending friend requests.</div>`;
        return;
    }
    container.innerHTML = `<ul class="request-list">${friendRequests.map(req => `
        <li class="request-item">
            <div class="user-info"><span class="display-name">${req.display_name}</span><span class="username">@${req.username}</span></div>
            <div class="request-item-actions">
                <button class="accept-btn" onclick="respondToFriendRequestWrapper('${req.username}', true)">Accept</button>
                <button class="decline-btn" onclick="respondToFriendRequestWrapper('${req.username}', false)">Decline</button>
            </div>
        </li>`).join('')}</ul>`;
}
// --- Friend & Match Actions ---
async function sendFriendRequestWrapper(username) {
    if(await apiRequest('/friends/request', 'POST', { to_username: username }))
        document.getElementById('user-search').dispatchEvent(new Event('input'));
}
async function respondToFriendRequestWrapper(username, accept) {
    if(await apiRequest('/friends/respond', 'POST', { from_username: username, accept })) {
        await updateFriendAndMatchData();
        renderFriendsModalContent('requests');
    }
}
async function removeFriend(username) {
    if (!confirm(`Unfriend @${username}? This will also remove any schedule match.`)) return;
    if(await apiRequest(`/friends/${username}`, 'DELETE')) {
        await updateFriendAndMatchData();
        renderFriendsModalContent('friends');
    }
}
async function sendMatchRequest(friendUsername) {
    if(await apiRequest(`/matches/request/${friendUsername}`, 'POST')) {
        alert('Match request sent!');
        await updateFriendAndMatchData();
        renderFriendsModalContent('friends');
    }
}
async function respondToMatchRequest(fromUsername, accept) {
    if(await apiRequest(`/matches/respond/${fromUsername}?accept=${accept}`, 'POST')) {
        await updateFriendAndMatchData();
        renderFriendsModalContent('matches');
    }
}
async function deleteMatch(friendUsername, confirmFirst = true) {
    const doDelete = confirmFirst ? confirm(`Unmatch with @${friendUsername}?`) : true;
    if (doDelete) {
        if(await apiRequest(`/matches/${friendUsername}`, 'DELETE')) {
            await updateFriendAndMatchData();
            renderFriendsModalContent('matches');
        }
    }
}
// --- Match Overlap Modal ---
function openMatchOverlapModal(friendUsername) {
    currentMatchState.friendUsername = friendUsername;
    currentMatchState.currentDate = new Date();
    document.getElementById('match-modal-title').textContent = `Match with @${friendUsername}`;
    document.getElementById('match-overlap-modal').style.display = 'block';
    renderMatchOverlapView();
}
function closeMatchOverlapModal() {
    document.getElementById('match-overlap-modal').style.display = 'none';
}
async function renderMatchOverlapView() {
    const { friendUsername, currentDate } = currentMatchState;
    const dateStr = formatDate(currentDate);
    const overlapData = await apiRequest(`/matches/overlap/${friendUsername}/${dateStr}`);
    const body = document.getElementById('match-modal-body');
    if (!overlapData) {
        body.innerHTML = `<div class="empty-state">Could not load schedule data.</div>`;
        return;
    }
    const dateDisplay = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    body.innerHTML = `
        <div class="overlap-date-nav">
            <button class="nav-btn" onclick="navigateMatchDate(-1)"><</button>
            <span class="overlap-date-display">${dateDisplay}</span>
            <button class="nav-btn" onclick="navigateMatchDate(1)">></button>
        </div>
        <div class="overlap-section"><h4>Common Free Time</h4><div class="overlap-slot-grid">${overlapData.overlaps.length > 0 ? overlapData.overlaps.map(s => `<div class="overlap-slot common">${formatTime(s.start)} - ${formatTime(s.end)}</div>`).join('') : '<div class="empty-state">No common free time.</div>'}</div></div>
        <div class="overlap-section"><h4>@${friendUsername}'s Free Time <small>(in your timezone)</small></h4><div class="overlap-slot-grid">${overlapData.user_a_slots.length > 0 ? overlapData.user_a_slots.map(s => `<div class="overlap-slot friend">${formatTime(s.start)} - ${formatTime(s.end)}</div>`).join('') : '<div class="empty-state">No free time set.</div>'}</div></div>
        <div class="overlap-section"><h4>Your Free Time</h4><div class="overlap-slot-grid">${overlapData.user_b_slots.length > 0 ? overlapData.user_b_slots.map(s => `<div class="overlap-slot own">${formatTime(s.start)} - ${formatTime(s.end)}</div>`).join('') : '<div class="empty-state">No free time set.</div>'}</div></div>`;
}
function navigateMatchDate(direction) {
    currentMatchState.currentDate.setDate(currentMatchState.currentDate.getDate() + direction);
    renderMatchOverlapView();
}
// --- Calendar Functions ---
function initializeCalendar() {
    const today = new Date();
    currentWeekStart = new Date(today.setDate(today.getDate() - (today.getDay() + 6) % 7));
    document.getElementById('prev-week').addEventListener('click', () => { currentWeekStart.setDate(currentWeekStart.getDate() - 7); renderCalendar(); });
    document.getElementById('next-week').addEventListener('click', () => { currentWeekStart.setDate(currentWeekStart.getDate() + 7); renderCalendar(); });
    renderCalendar();
}
async function renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    const weekDisplay = document.getElementById('week-display');
    const weekEnd = new Date(currentWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    weekDisplay.textContent = `${currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    calendarGrid.innerHTML = '';
    await loadWeekScheduleData();
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 0; i < 7; i++) {
        const date = new Date(currentWeekStart); date.setDate(date.getDate() + i);
        calendarGrid.appendChild(createDayCard(date, dayNames[i]));
    }
}
async function loadWeekScheduleData() {
    const endDate = new Date(currentWeekStart); endDate.setDate(endDate.getDate() + 6);
    const schedules = await apiRequest(`/schedule/?start_date=${formatDate(currentWeekStart)}&end_date=${formatDate(endDate)}`);
    scheduleData = {};
    if (schedules) schedules.forEach(s => scheduleData[s.date] = s);
}
function createDayCard(date, dayName) {
    const dayCard = document.createElement('div'); dayCard.className = 'day-card';
    const dateStr = formatDate(date); const schedule = scheduleData[dateStr];
    if (date.toDateString() === new Date().toDateString()) dayCard.classList.add('today');
    if (schedule) {
        if (!schedule.is_available) dayCard.classList.add('unavailable');
        else if (schedule.free_times.length > 0 || schedule.busy_times.length > 0) dayCard.classList.add('has-schedule');
    }
    dayCard.innerHTML = `<div class="day-header"><span class="day-name">${dayName}</span><span class="day-date">${date.getDate()}</span></div><div class="day-status">${getStatusText(schedule)}</div><div class="time-summary">${getTimeSummary(schedule)}</div>`;
    dayCard.addEventListener('click', () => openDayModal(date, dateStr));
    return dayCard;
}
function getStatusText(s) { if (!s) return 'Available'; if (!s.is_available) return 'Unavailable'; if (s.free_times.length > 0 || s.busy_times.length > 0) return 'Has schedule'; return 'Available'; }
function getTimeSummary(s) { if (!s || !s.is_available) return ''; const f = s.free_times.length, b = s.busy_times.length; const summary = []; if (f > 0) summary.push(`${f} free`); if (b > 0) summary.push(`${b} busy`); return summary.join(', '); }
// --- Schedule Modal Functions ---
function openDayModal(date, dateStr) {
    currentSelectedDate = dateStr;
    const modal = document.getElementById('day-modal');
    const formatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('modal-date-title').textContent = `Schedule for ${date.toLocaleDateString('en-US', formatOptions)}`;
    const schedule = scheduleData[currentSelectedDate] || { is_available: true };
    document.getElementById('is-available').checked = schedule.is_available;
    renderDayModalContent();
    modal.style.display = 'block';
}
function closeDayModal() {
    document.getElementById('day-modal').style.display = 'none';
    currentSelectedDate = null;
}
function renderDayModalContent() {
    const schedule = scheduleData[currentSelectedDate] || { free_times: [], busy_times: [] };
    const freeListContainer = document.getElementById('free-slots-list');
    const busyListContainer = document.getElementById('busy-slots-list');
    freeListContainer.innerHTML = (schedule.free_times || []).map((slot, index) => `
        <div class="time-slot">
            <span class="time-slot-text">${formatTime(slot.start)} - ${formatTime(slot.end)}</span>
            <button class="remove-slot" onclick="removeTimeSlot(${index}, 'free')">X</button>
        </div>`).join('');
    if (!schedule.free_times || schedule.free_times.length === 0) {
        freeListContainer.innerHTML = `<div class="empty-state">No free times set.</div>`;
    }
    busyListContainer.innerHTML = (schedule.busy_times || []).map((slot, index) => `
        <div class="time-slot busy-time">
            <span class="time-slot-text">${formatTime(slot.start)} - ${formatTime(slot.end)}</span>
            <button class="remove-slot" onclick="removeTimeSlot(${index}, 'busy')">X</button>
        </div>`).join('');
    if (!schedule.busy_times || schedule.busy_times.length === 0) {
        busyListContainer.innerHTML = `<div class="empty-state">No busy times set.</div>`;
    }
}
function showAddTimeForm(mode) {
    const containerId = mode === 'free' ? 'add-free-time-container' : 'add-busy-time-container';
    const container = document.getElementById(containerId);
    
    // Check if form already exists
    if (container.querySelector('.add-time-form')) return;
    
    const template = document.getElementById('add-time-form-template');
    if (!template) {
        console.error('Template not found');
        return;
    }
    
    const formClone = template.querySelector('.add-time-form').cloneNode(true);
    container.innerHTML = '';
    container.appendChild(formClone);
    
    const startSelect = formClone.querySelector('.start-time-select');
    const endSelect = formClone.querySelector('.end-time-select');
    
    populateTimeDropdowns(startSelect, endSelect);
    
    formClone.querySelector('.save-slot-btn').addEventListener('click', () => saveNewSlot(mode));
    formClone.querySelector('.cancel-slot-btn').addEventListener('click', () => {
        container.innerHTML = `<button class="add-new-slot-btn" onclick="showAddTimeForm('${mode}')">+ Add ${mode.charAt(0).toUpperCase() + mode.slice(1)} Time</button>`;
    });
}
async function saveNewSlot(mode) {
    const form = document.querySelector('.add-time-form');
    const startTime = form.querySelector('.start-time-select').value;
    const endTime = form.querySelector('.end-time-select').value;
    if (startTime >= endTime) {
        alert('End time must be after start time.');
        return;
    }
    
    if (!scheduleData[currentSelectedDate]) {
        scheduleData[currentSelectedDate] = { date: currentSelectedDate, busy_times: [], free_times: [], is_available: true };
    }
    const schedule = scheduleData[currentSelectedDate];
    const existingSlots = (mode === 'free' ? schedule.free_times : schedule.busy_times) || [];
    for (const slot of existingSlots) {
        if (startTime < slot.end && endTime > slot.start) {
            alert(`This new time slot overlaps with an existing one.`);
            return;
        }
    }
    
    existingSlots.push({ start: startTime, end: endTime });
    existingSlots.sort((a, b) => a.start.localeCompare(b.start));
    if (await updateDayScheduleOnBackend()) {
        renderDayModalContent();
        const containerId = mode === 'free' ? 'add-free-time-container' : 'add-busy-time-container';
        document.getElementById(containerId).innerHTML = `<button class="add-new-slot-btn" onclick="showAddTimeForm('${mode}')">+ Add ${mode.charAt(0).toUpperCase() + mode.slice(1)} Time</button>`;
    }
}
async function removeTimeSlot(index, mode) {
    const schedule = scheduleData[currentSelectedDate];
    if (!schedule) return;
    const slots = mode === 'free' ? schedule.free_times : schedule.busy_times;
    slots.splice(index, 1);
    if (await updateDayScheduleOnBackend()) {
        renderDayModalContent();
    }
}
async function toggleDayAvailability() {
    if (!scheduleData[currentSelectedDate]) {
        scheduleData[currentSelectedDate] = { date: currentSelectedDate, busy_times: [], free_times: [], is_available: true };
    }
    scheduleData[currentSelectedDate].is_available = document.getElementById('is-available').checked;
    await updateDayScheduleOnBackend();
}
async function updateDayScheduleOnBackend() {
    const currentSchedule = scheduleData[currentSelectedDate];
    if (!currentSchedule) return false;
    if (await apiRequest('/schedule/', 'POST', currentSchedule)) {
        renderCalendar();
        return true;
    }
    return false;
}
// --- Utility Functions ---
function populateTimeDropdowns(startSelect, endSelect) {
    if (!startSelect || !endSelect) return;
    startSelect.innerHTML = ''; endSelect.innerHTML = '';
    for (let i = 0; i < 48; i++) {
        const h = Math.floor(i / 2), m = (i % 2) * 30;
        const val = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 || 12;
        const displayTxt = `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
        const option = document.createElement('option');
        option.value = val; option.textContent = displayTxt;
        option.className = ampm === 'AM' ? 'am-option' : 'pm-option';
        startSelect.appendChild(option.cloneNode(true));
        endSelect.appendChild(option.cloneNode(true));
    }
    startSelect.value = '09:00'; endSelect.value = '17:00';
}
function formatDate(date) { return date.toISOString().split('T')[0]; }
function formatTime(timeStr) {
    const [h, m] = timeStr.split(':');
    return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function logout() {
    localStorage.removeItem('accessToken');
    window.location.href = 'index.html';
}
window.addEventListener('click', (e) => {
    if (e.target == document.getElementById('day-modal')) closeDayModal();
    if (e.target == document.getElementById('friends-modal')) closeFriendsModal();
    if (e.target == document.getElementById('match-overlap-modal')) closeMatchOverlapModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeDayModal();
        closeFriendsModal();
        closeMatchOverlapModal();
    }
});