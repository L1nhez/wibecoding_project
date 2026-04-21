const tg = window.Telegram?.WebApp;
const initData = tg?.initData || "";
const tgUser = tg?.initDataUnsafe?.user;

const state = {
  app: null,
  today: "",
  range: 7,
  savingNote: null
};

const colors = ["#54a9ff", "#67d391", "#f5c451", "#ff8a65", "#b08cff"];

const el = {
  avatar: document.querySelector("#avatar"),
  dateLabel: document.querySelector("#dateLabel"),
  progressText: document.querySelector("#progressText"),
  progressPercent: document.querySelector("#progressPercent"),
  habitList: document.querySelector("#habitList"),
  emptyState: document.querySelector("#emptyState"),
  habitTemplate: document.querySelector("#habitTemplate"),
  addHabitForm: document.querySelector("#addHabitForm"),
  habitInput: document.querySelector("#habitInput"),
  resetDoneButton: document.querySelector("#resetDoneButton"),
  noteInput: document.querySelector("#noteInput"),
  saveStatus: document.querySelector("#saveStatus"),
  historyGrid: document.querySelector("#historyGrid"),
  tabs: document.querySelectorAll(".tab")
};

function telegramHeaders() {
  return initData ? { "x-telegram-init-data": initData } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...telegramHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Request failed");
  }

  return response.json();
}

function formatDate(dateKey) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date(`${dateKey}T12:00:00`));
}

function activeHabits() {
  return state.app.habits.filter((habit) => !habit.archived);
}

function checkedCount(dateKey = state.today) {
  const checkins = state.app.checkins[dateKey] || {};
  return activeHabits().filter((habit) => checkins[habit.id]).length;
}

function completionLevel(dateKey) {
  const total = activeHabits().length;
  if (!total) return 0;
  const ratio = checkedCount(dateKey) / total;
  if (ratio === 0) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  return 3;
}

function dayOffset(offset) {
  const date = new Date(`${state.today}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function renderProfile(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Demo";
  el.avatar.textContent = name.slice(0, 1).toUpperCase();
  el.dateLabel.textContent = formatDate(state.today);
}

function renderProgress() {
  const total = activeHabits().length;
  const done = checkedCount();
  const percent = total ? Math.round((done / total) * 100) : 0;
  el.progressText.textContent = `${done} of ${total}`;
  el.progressPercent.textContent = `${percent}%`;
  document.documentElement.style.setProperty("--progress", `${percent}%`);
}

function renderHabits() {
  el.habitList.replaceChildren();
  const todayCheckins = state.app.checkins[state.today] || {};
  const habits = activeHabits();
  el.emptyState.style.display = habits.length ? "none" : "block";

  habits.forEach((habit) => {
    const row = el.habitTemplate.content.firstElementChild.cloneNode(true);
    const done = Boolean(todayCheckins[habit.id]);
    row.classList.toggle("done", done);
    row.querySelector("h3").textContent = habit.title;
    row.querySelector("p").textContent = done ? "Done today" : "Waiting for check-in";
    row.querySelector(".check-button").style.borderColor = done ? habit.color : "";
    row.querySelector(".check-button span").style.background = done ? habit.color : "";
    row.querySelector(".check-button").addEventListener("click", () => toggleHabit(habit.id, !done));
    row.querySelector(".archive-button").addEventListener("click", () => archiveHabit(habit.id));
    el.habitList.append(row);
  });
}

function renderNote() {
  el.noteInput.value = state.app.notes[state.today] || "";
}

function renderHistory() {
  el.historyGrid.style.setProperty("--history-days", state.range);
  el.historyGrid.replaceChildren();

  for (let i = state.range - 1; i >= 0; i -= 1) {
    const dateKey = dayOffset(-i);
    const cell = document.createElement("div");
    cell.className = "day-cell";
    cell.dataset.level = String(completionLevel(dateKey));
    cell.title = `${formatDate(dateKey)}: ${checkedCount(dateKey)} done`;
    el.historyGrid.append(cell);
  }
}

function render() {
  renderProfile(state.app.profile);
  renderProgress();
  renderHabits();
  renderNote();
  renderHistory();
}

async function toggleHabit(habitId, done) {
  const payload = await api("/api/checkins", {
    method: "POST",
    body: JSON.stringify({ habitId, done, date: state.today })
  });
  state.app = payload.state;
  tg?.HapticFeedback?.impactOccurred("light");
  renderProgress();
  renderHabits();
  renderHistory();
}

async function archiveHabit(habitId) {
  const payload = await api(`/api/habits/${habitId}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true })
  });
  state.app = payload.state;
  renderProgress();
  renderHabits();
  renderHistory();
}

async function addHabit(title) {
  const payload = await api("/api/habits", {
    method: "POST",
    body: JSON.stringify({ title, color: colors[state.app.habits.length % colors.length] })
  });
  state.app = payload.state;
  el.habitInput.value = "";
  renderProgress();
  renderHabits();
  renderHistory();
}

async function saveNote() {
  el.saveStatus.textContent = "Saving";
  const payload = await api("/api/notes", {
    method: "POST",
    body: JSON.stringify({ date: state.today, note: el.noteInput.value })
  });
  state.app = payload.state;
  el.saveStatus.textContent = "Saved";
}

async function clearToday() {
  const habits = activeHabits();
  await Promise.all(habits.map((habit) => api("/api/checkins", {
    method: "POST",
    body: JSON.stringify({ habitId: habit.id, done: false, date: state.today })
  })));
  const payload = await api("/api/state");
  state.app = payload.state;
  renderProgress();
  renderHabits();
  renderHistory();
}

el.addHabitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = el.habitInput.value.trim();
  if (title) addHabit(title).catch(console.error);
});

el.resetDoneButton.addEventListener("click", () => {
  clearToday().catch(console.error);
});

el.noteInput.addEventListener("input", () => {
  el.saveStatus.textContent = "Editing";
  clearTimeout(state.savingNote);
  state.savingNote = setTimeout(() => saveNote().catch(console.error), 550);
});

el.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    el.tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    state.range = Number(tab.dataset.range);
    renderHistory();
  });
});

async function boot() {
  tg?.ready();
  tg?.expand();
  const payload = await api("/api/state", {
    headers: telegramHeaders(),
    body: tgUser ? undefined : undefined
  });
  state.app = payload.state;
  state.today = payload.today;
  render();
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><section class="panel"><h2>Could not load</h2><p class="empty-state" style="display:block">${error.message}</p></section></main>`;
});
