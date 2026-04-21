const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "habit-state.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const DEFAULT_HABITS = [
  { title: "Вода", color: "#54a9ff" },
  { title: "Движение 10 минут", color: "#67d391" },
  { title: "Чтение", color: "#f5c451" }
];

function defaultSchedule() {
  return {
    type: "daily",
    days: [],
    date: "",
    startDate: todayKey(),
    interval: 2
  };
}

function normalizeSchedule(schedule = {}) {
  const type = ["daily", "weekdays", "weekly", "once", "interval"].includes(schedule.type)
    ? schedule.type
    : "daily";
  const days = Array.isArray(schedule.days)
    ? schedule.days.map(Number).filter((day) => day >= 0 && day <= 6)
    : [];

  return {
    type,
    days,
    date: String(schedule.date || ""),
    startDate: String(schedule.startDate || todayKey()),
    interval: Math.max(1, Math.min(365, Number(schedule.interval || 2)))
  };
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
  }
}

async function readStore() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw || "{\"users\":{}}");
}

async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function createUserState(profile) {
  const now = new Date().toISOString();
  return {
    profile,
    habits: DEFAULT_HABITS.map((habit) => ({
      id: crypto.randomUUID(),
      title: habit.title,
      color: habit.color,
      schedule: defaultSchedule(),
      archived: false,
      createdAt: now
    })),
    checkins: {},
    notes: {},
    createdAt: now,
    updatedAt: now
  };
}

function normalizeProfile(user) {
  const id = String(user?.id || "dev-user");
  return {
    id,
    firstName: user?.first_name || user?.firstName || "Demo",
    lastName: user?.last_name || user?.lastName || "",
    username: user?.username || ""
  };
}

function parseInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  if (!userRaw) return null;

  if (BOT_TOKEN) {
    const hash = params.get("hash");
    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const digest = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
    if (!hash || digest !== hash) return null;
  }

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

function getRequester(req, body = {}) {
  const initData = req.headers["x-telegram-init-data"] || body.initData || "";
  const telegramUser = parseInitData(initData);
  const devUser = body.devUser || { id: "dev-user", first_name: "Demo" };
  return normalizeProfile(telegramUser || devUser);
}

async function getOrCreateUser(store, profile) {
  const id = String(profile.id);
  if (!store.users[id]) {
    store.users[id] = createUserState(profile);
    await writeStore(store);
  } else {
    store.users[id].profile = { ...store.users[id].profile, ...profile };
    store.users[id].habits = (store.users[id].habits || []).map((habit) => ({
      ...habit,
      schedule: normalizeSchedule(habit.schedule)
    }));
  }
  return store.users[id];
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

async function callTelegram(method, payload) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || "Telegram API request failed");
  }
  return data.result;
}

async function handleTelegramWebhook(req, res) {
  const update = await readJson(req);
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || "");

  if (!chatId) {
    return sendJson(res, 200, { ok: true });
  }

  if (text.startsWith("/start")) {
    const webAppUrl = PUBLIC_URL || `https://${req.headers.host}`;
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "Трекер привычек готов. Открой его кнопкой ниже.",
      reply_markup: {
        inline_keyboard: [[
          {
            text: "Открыть трекер",
            web_app: { url: webAppUrl }
          }
        ]]
      }
    });
  }

  return sendJson(res, 200, { ok: true });
}

async function handleTelegramSetup(req, res) {
  if (!BOT_TOKEN) {
    return sendJson(res, 500, { error: "BOT_TOKEN is not configured" });
  }

  const publicUrl = PUBLIC_URL || `https://${req.headers.host}`;
  const webhookUrl = `${publicUrl}/telegram/webhook`;
  const result = await callTelegram("setWebhook", { url: webhookUrl });
  return sendJson(res, 200, { ok: true, webhookUrl, result });
}

async function handleApi(req, res) {
  const body = req.method === "GET" ? {} : await readJson(req);
  const store = await readStore();
  const profile = getRequester(req, body);
  const userState = await getOrCreateUser(store, profile);
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, { user: userState.profile, state: userState, today: todayKey() });
  }

  if (req.method === "POST" && url.pathname === "/api/habits") {
    const title = String(body.title || "").trim().slice(0, 60);
    if (!title) return sendJson(res, 400, { error: "Habit title is required" });

    userState.habits.push({
      id: crypto.randomUUID(),
      title,
      color: body.color || "#54a9ff",
      schedule: normalizeSchedule(body.schedule),
      archived: false,
      createdAt: new Date().toISOString()
    });
    userState.updatedAt = new Date().toISOString();
    await writeStore(store);
    return sendJson(res, 200, { state: userState });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/habits/")) {
    const habitId = url.pathname.split("/").pop();
    const habit = userState.habits.find((item) => item.id === habitId);
    if (!habit) return sendJson(res, 404, { error: "Habit not found" });

    if (typeof body.title === "string") habit.title = body.title.trim().slice(0, 60);
    if (typeof body.archived === "boolean") habit.archived = body.archived;
    if (typeof body.color === "string") habit.color = body.color;
    if (typeof body.schedule === "object" && body.schedule) habit.schedule = normalizeSchedule(body.schedule);
    userState.updatedAt = new Date().toISOString();
    await writeStore(store);
    return sendJson(res, 200, { state: userState });
  }

  if (req.method === "POST" && url.pathname === "/api/checkins") {
    const date = body.date || todayKey();
    const habitId = String(body.habitId || "");
    const habit = userState.habits.find((item) => item.id === habitId && !item.archived);
    if (!habit) return sendJson(res, 404, { error: "Habit not found" });

    userState.checkins[date] ||= {};
    userState.checkins[date][habitId] = Boolean(body.done);
    userState.updatedAt = new Date().toISOString();
    await writeStore(store);
    return sendJson(res, 200, { state: userState });
  }

  if (req.method === "POST" && url.pathname === "/api/notes") {
    const date = body.date || todayKey();
    userState.notes[date] = String(body.note || "").trim().slice(0, 300);
    userState.updatedAt = new Date().toISOString();
    await writeStore(store);
    return sendJson(res, 200, { state: userState });
  }

  return notFound(res);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  const requested = safePath === "/" ? "/index.html" : safePath;
  const filePath = path.join(PUBLIC_DIR, requested);

  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    // Browser navigations to "unknown" paths should still load the app shell.
    // This avoids JSON 404s when the URL isn't exactly "/" (common in Telegram or refreshes).
    const acceptsHtml = String(req.headers.accept || "").includes("text/html");
    if (req.method === "GET" && acceptsHtml) {
      try {
        const html = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, { "content-type": MIME_TYPES[".html"] });
        return res.end(html);
      } catch {
        // fall through
      }
    }
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/telegram/webhook") {
      await handleTelegramWebhook(req, res);
    } else if (req.method === "GET" && req.url === "/telegram/setup") {
      await handleTelegramSetup(req, res);
    } else if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Habit tracker is running at http://localhost:${PORT}`);
});
