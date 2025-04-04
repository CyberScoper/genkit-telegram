// user-ai-assistant.js
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import input from "input";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import express from "express";
import { genkit } from "genkit";
import { googleAI, gemini20Flash } from "@genkit-ai/googleai";

dotenv.config();

const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_API_KEY })],
  model: gemini20Flash,
});

const promptData = JSON.parse(fs.readFileSync("./prompts.json", "utf8"));

const app = express();
app.use(express.json());

let stats = {
  startTime: Date.now(),
  messagesSeen: 0,
  repliesSent: 0,
  commentsMade: 0,
  ignored: 0,
};

let pausedUntil = 0;

function isPaused() {
  return Date.now() < pausedUntil;
}

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / 60000) % 60;
  const hrs = Math.floor(ms / 3600000);
  return `${hrs}ч ${min}м ${sec}с`;
}

const ADMIN_IDS = (process.env.ADMIN_IDS || "565536669")
  .split(",")
  .map((x) => x.trim());

function getHumanDelay(text) {
  const base = text.length * (parseFloat(process.env.RESPONSE_DELAY_MULTIPLIER) || 50);
  const randomness = 1000 + Math.random() * 3000;
  const thinking = Math.random() < 0.3 ? 2000 + Math.random() * 3000 : 0;
  return Math.floor(base + randomness + thinking);
}

let recentMessages = [];
let lastMoodUpdate = 0;
let botMood = 1.0;

function recordMessage(now) {
  recentMessages.push(now);
  recentMessages = recentMessages.filter(t => now - t < 5 * 60 * 1000); // 5 мин окно
}

function updateMood(now) {
  if (now - lastMoodUpdate > 60 * 60 * 1000) { // раз в час
    botMood = Math.random() * 1.5 + 0.5; // от 0.5 до 2.0
    lastMoodUpdate = now;
  }
}

function shouldComment(now, lastTime) {
  const baseChance = parseFloat(process.env.RANDOM_COMMENT_CHANCE || 0.01);
  const minInterval = parseInt(process.env.COMMENT_INTERVAL || 60000);

  recordMessage(now);
  updateMood(now);

  const activityFactor = Math.min(recentMessages.length / 5, 2);
  const finalChance = baseChance * activityFactor * botMood;
  const roll = Math.random();
  const forceOverride = roll > 0.989 && roll < 0.991;

  const should = (now - lastTime > minInterval) && (roll < finalChance || forceOverride);

  console.log(`📈 Activity in last 5 min: ${recentMessages.length} messages`);
  console.log(`🧠 Mood factor: ${botMood.toFixed(2)}`);
  console.log(`🎲 Rolled: ${roll.toFixed(4)} → ${forceOverride ? 'override fired!' : 'no fire'}`);
  console.log(`💬 ${should ? 'Will comment' : 'No comment'} (final chance ${finalChance.toFixed(4)})`);

  return should;
}

app.post("/ask", async (req, res) => {
  const { message, prev, mode } = req.body;
  const stylePool = promptData[mode || "normal"];
  const modifiers = stylePool.modifiers.join("\n");
  const basePrompt = `${stylePool.basePrompt}\n\n${modifiers}\n\nпиши не более двух предложений. никаких списков. отвечай, как будто пишешь одним глазом в телефон.`;

  const prompt = mode === "comment"
    ? `${basePrompt}\n\nСообщения:\n1. ${prev || "[...нет предыдущего контекста...]"}\n2. ${message}\n\nНапиши мысль по теме.`
    : `${basePrompt}\n\nСообщение: \"${message}\"`;

  console.log("🧠 Final prompt sent to AI:\n", prompt);

  try {
    const { text } = await ai.generate({ prompt, maxOutputTokens: 150 });
    console.log("🧠 AI generated reply:", text);
    res.json({ reply: text });
  } catch (err) {
    console.error("❌ AI generation error:", err.message);
    res.json({ reply: "" });
  }
});

app.listen(3333, () => console.log("🧠 Genkit AI server is running on http://localhost:3333"));

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

let sessionString = process.env.STRING_SESSION || "";
if (!sessionString && fs.existsSync(".session")) {
  sessionString = fs.readFileSync(".session", "utf8");
  console.log("🔁 Loaded saved session from .session file");
}
const stringSession = new StringSession(sessionString);

const GENKIT_URL = process.env.GENKIT_URL || "http://localhost:3333/ask";
const MIN_MESSAGE_LENGTH = parseInt(process.env.MIN_MESSAGE_LENGTH) || 6;

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

const lastReplyTimes = new Map();
let lastCommentTime = 0;

await client.start({
  phoneNumber: sessionString ? undefined : async () => await input.text("📱 Phone number: "),
  password: sessionString ? undefined : async () => await input.text("🔐 2FA Password: "),
  phoneCode: sessionString ? undefined : async () => await input.text("📩 Code (SMS or Telegram): "),
  onError: (err) => console.log(err),
});

const self = await client.getMe();
console.log("✅ Logged in as:", self.username);
console.log("🤖 Telegram AI Assistant is running...");

if (!process.env.STRING_SESSION && !fs.existsSync(".session")) {
  const sessionString = client.session.save();
  fs.writeFileSync(".session", sessionString);
  console.log("📂 Session saved to .session");
}

client.addEventHandler(
  async (event) => {
    if (!event.message || !event.message.message || event.message.media) return;

    const msg = event.message;
    if (msg.out) return;

    const chatId = msg.peerId.channelId || msg.peerId.chatId || msg.peerId.userId;
    const text = msg.message;
    const senderId = msg.senderId.toString();
    stats.messagesSeen++;

    if (text.trim().toLowerCase() === "/debug" && ADMIN_IDS.includes(senderId)) {
      const uptime = formatUptime(Date.now() - stats.startTime);
      const debugMsg = `📊 <b>Статистика</b>
🟢 Статус: ${isPaused() ? '⏸️ Пауза активна' : '✅ Активен'}
🕒 Аптайм: ${uptime}

📬 Сообщений всего: <b>${stats.messagesSeen}</b>
✅ Обработано: <b>${stats.repliesSent + stats.commentsMade}</b>
⛔ Игнорировано: <b>${stats.ignored}</b>
↩️ Ответов: <b>${stats.repliesSent}</b>
💬 Комментариев: <b>${stats.commentsMade}</b>

📈 Активность (5 мин): <b>${recentMessages.length}</b>
🧠 Mood: <b>${botMood.toFixed(2)}</b>
🕓 Последний комментарий: <i>${new Date(lastCommentTime).toLocaleTimeString()}</i>`;
      await client.sendMessage(msg.peerId, { message: debugMsg, parseMode: 'html', replyTo: msg.id });
      return;
    }

    if (text.trim().toLowerCase() === "/mood" && ADMIN_IDS.includes(senderId)) {
      botMood = Math.random() * 1.5 + 0.5;
      lastMoodUpdate = Date.now();
      await client.sendMessage(msg.peerId, {
        message: `🧠 Новое настроение: ${botMood.toFixed(2)}`,
        replyTo: msg.id,
      });
      return;
    }

    if (text.trim().toLowerCase().startsWith("/pause") && ADMIN_IDS.includes(senderId)) {
      const [, minutes] = text.trim().split(" ");
      const mins = parseInt(minutes);
      if (!isNaN(mins) && mins > 0) {
        pausedUntil = Date.now() + mins * 60000;
        await client.sendMessage(msg.peerId, {
          message: `⏸️ Бот приостановлен на ${mins} мин.`,
          replyTo: msg.id,
        });
      } else {
        await client.sendMessage(msg.peerId, {
          message: `⚠️ Укажи количество минут: /pause 10`,
          replyTo: msg.id,
        });
      }
      return;
    }

    if (text.trim().toLowerCase() === "/resume" && ADMIN_IDS.includes(senderId)) {
      pausedUntil = 0;
      await client.sendMessage(msg.peerId, {
        message: `▶️ Бот снова активен.`,
        replyTo: msg.id,
      });
      return;
    }

    if (text.trim().toLowerCase() === "/mood" && ADMIN_IDS.includes(senderId)) {
      botMood = Math.random() * 1.5 + 0.5;
      lastMoodUpdate = Date.now();
      await client.sendMessage(msg.peerId, {
        message: `🧠 Новое настроение: ${botMood.toFixed(2)}`,
        replyTo: msg.id,
      });
      return;
    }

    console.log("📩 Incoming message:", text);

    if (isPaused()) {
      console.log("⏸️ Ignored: bot is paused");
      return;
    }

    if (text.trim().length < MIN_MESSAGE_LENGTH) {
      console.log("⚠️ Ignored: message too short");
      stats.ignored++;
      return;
    }

    const now = Date.now();
    const isMention = msg.entities?.some((e) => e.className === 'MessageEntityMentionName');
    let replyTargetMe = false;

    if (msg.replyTo) {
      try {
        const replied = await msg.getReplyMessage();
        replyTargetMe = replied && replied.senderId?.toString() === self.id.toString();
      } catch (_) {}
    }

    if (replyTargetMe || isMention) {
      if (lastReplyTimes.has(senderId)) {
        const diff = now - lastReplyTimes.get(senderId);
        const antiSpamInterval = parseInt(process.env.ANTI_SPAM_INTERVAL) || 10000;
        if (diff < antiSpamInterval) {
          console.log("🚫 Ignored due to anti-spam policy");
          return;
        }
      }
      lastReplyTimes.set(senderId, now);

      try {
        let prevText = "";
        if (msg.replyTo) {
          try {
            const replied = await msg.getReplyMessage();
            if (replied && replied.message) prevText = replied.message;
          } catch (_) {}
        }
        const res = await axios.post(GENKIT_URL, { message: text, prev: prevText });
        const replyText = res.data.reply || "";

        const delayMs = getHumanDelay(replyText);
        console.log(`⏱ Waiting ${delayMs}ms before replying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        if (replyText.trim()) {
          await client.sendMessage(msg.peerId, { message: replyText, replyTo: msg.id });
          stats.repliesSent++;
        }
      } catch (err) {
        console.error("⚠️ Error replying:", err.message);
      }
    } else {
      if (shouldComment(now, lastCommentTime)) {
        console.log("💭 Decided to comment!");
        lastCommentTime = now;

        let prevText = "";
        try {
          const replyTo = await msg.getReplyMessage();
          if (replyTo && replyTo.message) prevText = replyTo.message;
        } catch (err) {
          console.warn("⚠️ Can't fetch reply chain:", err.message);
        }

        try {
          const res = await axios.post(GENKIT_URL, {
            message: text,
            prev: prevText,
            mode: 'comment',
          });
          const replyText = res.data.reply || "";
          if (replyText.trim()) {
            await client.sendMessage(msg.peerId, { message: replyText });
            stats.commentsMade++;
          }
        } catch (err) {
          console.error("⚠️ Error on self-comment:", err.message);
        }
      }
    }
  },
  new NewMessage({})
);
