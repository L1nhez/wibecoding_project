const tg = window.Telegram?.WebApp;
const initData = tg?.initData || "";

const state = {
  app: null,
  today: "",
  selectedDate: "",
  range: 7,
  savingNote: null,
  editingHabitId: null,
  selectedWeekdays: new Set()
};

const colors = ["#54a9ff", "#67d391", "#f5c451", "#ff8a65", "#b08cff"];
const weekNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const weekdays = [1, 2, 3, 4, 5, 6, 0];

const el = {
  avatar: document.querySelector("#avatar"),
  dateLabel: document.querySelector("#dateLabel"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsMenu: document.querySelector("#settingsMenu"),
  prevDayButton: document.querySelector("#prevDayButton"),
  nextDayButton: document.querySelector("#nextDayButton"),
  dateStrip: document.querySelector("#dateStrip"),
  selectedDayTitle: document.querySelector("#selectedDayTitle"),
  progressText: document.querySelector("#progressText"),
  progressCaption: document.querySelector("#progressCaption"),
  progressPercent: document.querySelector("#progressPercent"),
  streakCount: document.querySelector("#streakCount"),
  habitList: document.querySelector("#habitList"),
  emptyState: document.querySelector("#emptyState"),
  habitTemplate: document.querySelector("#habitTemplate"),
  habitForm: document.querySelector("#habitForm"),
  habitInput: document.querySelector("#habitInput"),
  habitSubmitButton: document.querySelector("#habitSubmitButton"),
  scheduleType: document.querySelector("#scheduleType"),
  scheduleDate: document.querySelector("#scheduleDate"),
  scheduleInterval: document.querySelector("#scheduleInterval"),
  weekdayPicker: document.querySelector("#weekdayPicker"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
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
    throw new Error(payload.error || "Ошибка запроса");
  }

  return response.json();
}

function toDate(dateKey) {
  return new Date(`${dateKey}T12:00:00`);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function offsetDate(date, offset) {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
}

function dayOffset(baseKey, offset) {
  return dateKey(offsetDate(toDate(baseKey), offset));
}

function formatDate(dateKeyValue, options = {}) {
  return new Intl.DateTimeFormat("ru-RU", options).format(toDate(dateKeyValue));
}

function normalizeSchedule(schedule = {}) {
  return {
    type: schedule.type || "daily",
    days: Array.isArray(schedule.days) ? schedule.days.map(Number) : [],
    date: schedule.date || "",
    startDate: schedule.startDate || state.today,
    interval: Number(schedule.interval || 2)
  };
}

function isHabitScheduled(habit, dateKeyValue) {
  const schedule = normalizeSchedule(habit.schedule);
  const day = toDate(dateKeyValue).getDay();

  if (habit.archived) return false;
  if (schedule.type === "daily") return true;
  if (schedule.type === "weekdays") return day >= 1 && day <= 5;
  if (schedule.type === "weekly") return schedule.days.includes(day);
  if (schedule.type === "once") return schedule.date === dateKeyValue;
  if (schedule.type === "interval") {
    const start = toDate(schedule.startDate);
    const current = toDate(dateKeyValue);
    const diff = Math.floor((current - start) / 86400000);
    return diff >= 0 && diff % Math.max(1, schedule.interval) === 0;
  }

  return true;
}

function habitsForDate(dateKeyValue = state.selectedDate) {
  return state.app.habits.filter((habit) => isHabitScheduled(habit, dateKeyValue));
}

function checkedCount(dateKeyValue = state.selectedDate) {
  const checkins = state.app.checkins[dateKeyValue] || {};
  return habitsForDate(dateKeyValue).filter((habit) => checkins[habit.id]).length;
}

function completionLevel(dateKeyValue) {
  const total = habitsForDate(dateKeyValue).length;
  if (!total) return 0;
  const ratio = checkedCount(dateKeyValue) / total;
  if (ratio === 0) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  return 3;
}

function streakCount() {
  let count = 0;
  let cursor = state.today;

  while (true) {
    const total = habitsForDate(cursor).length;
    if (!total || checkedCount(cursor) !== total) break;
    count += 1;
    cursor = dayOffset(cursor, -1);
  }

  return count;
}

function scheduleLabel(habit) {
  const schedule = normalizeSchedule(habit.schedule);
  if (schedule.type === "daily") return "Каждый день";
  if (schedule.type === "weekdays") return "По будням";
  if (schedule.type === "weekly") return `По дням: ${schedule.days.map((day) => weekNames[day]).join(", ") || "не выбрано"}`;
  if (schedule.type === "once") return `Только ${formatDate(schedule.date || state.today, { day: "numeric", month: "short" })}`;
  if (schedule.type === "interval") return `Каждые ${schedule.interval} дн.`;
  return "Каждый день";
}

function selectedTitle() {
  if (state.selectedDate === state.today) return "Сегодня";
  if (state.selectedDate === dayOffset(state.today, -1)) return "Вчера";
  if (state.selectedDate === dayOffset(state.today, 1)) return "Завтра";
  return formatDate(state.selectedDate, { day: "numeric", month: "long" });
}

function renderProfile(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Demo";
  el.avatar.textContent = name.slice(0, 1).toUpperCase();
  el.dateLabel.textContent = formatDate(state.selectedDate, {
    weekday: "long",
    day: "numeric",
    month: "short"
  });
  el.selectedDayTitle.textContent = selectedTitle();
}

function renderDateStrip() {
  el.dateStrip.replaceChildren();

  for (let i = -3; i <= 3; i += 1) {
    const key = dayOffset(state.selectedDate, i);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-chip";
    button.classList.toggle("selected", key === state.selectedDate);
    button.classList.toggle("today", key === state.today);
    button.innerHTML = `<span>${weekNames[toDate(key).getDay()]}</span><strong>${toDate(key).getDate()}</strong>`;
    button.addEventListener("click", () => setSelectedDate(key));
    el.dateStrip.append(button);
  }
}

function renderProgress() {
  const total = habitsForDate().length;
  const done = checkedCount();
  const percent = total ? Math.round((done / total) * 100) : 0;
  el.progressText.textContent = `${done} из ${total}`;
  el.progressCaption.textContent = state.selectedDate === state.today ? "выполнено сегодня" : "выполнено за день";
  el.progressPercent.textContent = `${percent}%`;
  el.streakCount.textContent = streakCount();
  document.documentElement.style.setProperty("--progress", `${percent}%`);
}

function renderHabits() {
  el.habitList.replaceChildren();
  const checkins = state.app.checkins[state.selectedDate] || {};
  const habits = habitsForDate();
  el.emptyState.style.display = habits.length ? "none" : "block";

  habits.forEach((habit) => {
    const row = el.habitTemplate.content.firstElementChild.cloneNode(true);
    const done = Boolean(checkins[habit.id]);
    row.classList.toggle("done", done);
    row.querySelector("h3").textContent = habit.title;
    row.querySelector("p").textContent = done ? "Выполнено" : scheduleLabel(habit);
    row.querySelector(".check-button").style.borderColor = done ? habit.color : "";
    row.querySelector(".check-button span").style.background = done ? habit.color : "";
    row.querySelector(".check-button").addEventListener("click", () => toggleHabit(habit.id, !done));
    row.querySelector(".edit-button").addEventListener("click", () => startEditHabit(habit));
    row.querySelector(".archive-button").addEventListener("click", () => archiveHabit(habit.id));
    el.habitList.append(row);
  });
}

function renderNote() {
  el.noteInput.value = state.app.notes[state.selectedDate] || "";
}

function renderHistory() {
  const columns = state.range === 365 ? 53 : state.range;
  el.historyGrid.style.setProperty("--history-days", columns);
  el.historyGrid.classList.toggle("year-view", state.range === 365);
  el.historyGrid.replaceChildren();

  for (let i = state.range - 1; i >= 0; i -= 1) {
    const key = dayOffset(state.today, -i);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";
    cell.dataset.level = String(completionLevel(key));
    cell.classList.toggle("today", key === state.today);
    cell.classList.toggle("selected", key === state.selectedDate);
    cell.title = `${formatDate(key, { day: "numeric", month: "long" })}: ${checkedCount(key)} выполнено`;
    cell.addEventListener("click", () => setSelectedDate(key));
    el.historyGrid.append(cell);
  }
}

function renderWeekdayPicker() {
  el.weekdayPicker.replaceChildren();
  weekdays.forEach((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = weekNames[day];
    button.className = "weekday-button";
    button.classList.toggle("active", state.selectedWeekdays.has(day));
    button.addEventListener("click", () => {
      if (state.selectedWeekdays.has(day)) state.selectedWeekdays.delete(day);
      else state.selectedWeekdays.add(day);
      renderWeekdayPicker();
    });
    el.weekdayPicker.append(button);
  });
}

function renderScheduleControls() {
  const type = el.scheduleType.value;
  document.body.dataset.scheduleType = type;
  el.scheduleDate.value ||= state.selectedDate;
  renderWeekdayPicker();
}

function render() {
  renderProfile(state.app.profile);
  renderDateStrip();
  renderProgress();
  renderHabits();
  renderNote();
  renderHistory();
  renderScheduleControls();
}

function setSelectedDate(dateKeyValue) {
  clearTimeout(state.savingNote);
  state.selectedDate = dateKeyValue;
  el.saveStatus.textContent = "Сохранено";
  if (!state.editingHabitId) {
    el.scheduleDate.value = dateKeyValue;
  }
  render();
}

function currentSchedule() {
  const type = el.scheduleType.value;
  return {
    type,
    days: type === "weekdays" ? [1, 2, 3, 4, 5] : [...state.selectedWeekdays],
    date: el.scheduleDate.value || state.selectedDate,
    startDate: el.scheduleDate.value || state.selectedDate,
    interval: Number(el.scheduleInterval.value || 2)
  };
}

function resetHabitForm() {
  state.editingHabitId = null;
  state.selectedWeekdays = new Set();
  el.habitInput.value = "";
  el.scheduleType.value = "daily";
  el.scheduleDate.value = state.selectedDate;
  el.scheduleInterval.value = "2";
  el.habitSubmitButton.textContent = "Добавить";
  el.cancelEditButton.hidden = true;
  renderScheduleControls();
}

function startEditHabit(habit) {
  const schedule = normalizeSchedule(habit.schedule);
  state.editingHabitId = habit.id;
  state.selectedWeekdays = new Set(schedule.days);
  el.habitInput.value = habit.title;
  el.scheduleType.value = schedule.type;
  el.scheduleDate.value = schedule.date || schedule.startDate || state.selectedDate;
  el.scheduleInterval.value = String(schedule.interval || 2);
  el.habitSubmitButton.textContent = "Сохранить";
  el.cancelEditButton.hidden = false;
  renderScheduleControls();
  el.habitInput.focus();
}

async function toggleHabit(habitId, done) {
  const payload = await api("/api/checkins", {
    method: "POST",
    body: JSON.stringify({ habitId, done, date: state.selectedDate })
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
  resetHabitForm();
  render();
}

async function saveHabit(title) {
  const body = {
    title,
    color: colors[state.app.habits.length % colors.length],
    schedule: currentSchedule()
  };
  const path = state.editingHabitId ? `/api/habits/${state.editingHabitId}` : "/api/habits";
  const method = state.editingHabitId ? "PATCH" : "POST";
  const payload = await api(path, { method, body: JSON.stringify(body) });
  state.app = payload.state;
  resetHabitForm();
  render();
}

async function saveNote() {
  el.saveStatus.textContent = "Сохраняю";
  const payload = await api("/api/notes", {
    method: "POST",
    body: JSON.stringify({ date: state.selectedDate, note: el.noteInput.value })
  });
  state.app = payload.state;
  el.saveStatus.textContent = "Сохранено";
}

async function clearSelectedDay() {
  const habits = habitsForDate();
  await Promise.all(habits.map((habit) => api("/api/checkins", {
    method: "POST",
    body: JSON.stringify({ habitId: habit.id, done: false, date: state.selectedDate })
  })));
  const payload = await api("/api/state");
  state.app = payload.state;
  render();
}

el.habitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = el.habitInput.value.trim();
  if (title) saveHabit(title).catch(console.error);
});

el.cancelEditButton.addEventListener("click", resetHabitForm);
el.scheduleType.addEventListener("change", renderScheduleControls);
el.prevDayButton.addEventListener("click", () => setSelectedDate(dayOffset(state.selectedDate, -1)));
el.nextDayButton.addEventListener("click", () => setSelectedDate(dayOffset(state.selectedDate, 1)));
el.resetDoneButton.addEventListener("click", () => clearSelectedDay().catch(console.error));
el.settingsButton.addEventListener("click", () => {
  el.settingsMenu.hidden = !el.settingsMenu.hidden;
});

el.noteInput.addEventListener("input", () => {
  el.saveStatus.textContent = "Правка";
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
  const payload = await api("/api/state", { headers: telegramHeaders() });
  state.app = payload.state;
  state.today = payload.today;
  state.selectedDate = payload.today;
  resetHabitForm();
  render();
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><section class="panel"><h2>Не удалось загрузить</h2><p class="empty-state" style="display:block">${error.message}</p></section></main>`;
});
