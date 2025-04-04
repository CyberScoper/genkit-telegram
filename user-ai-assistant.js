// user-ai-assistant.js
// 🤖 Telegram user-mode AI через gramjs + Genkit (теперь с фильтрацией reply только к себе)

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

// === Genkit AI сервер (встроенный) ===
const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_API_KEY })],
  model: gemini20Flash,
});

const app = express();
app.use(express.json());

app.post("/ask", async (req, res) => {
  const { message, prev, mode } = req.body;
  const prompt = mode === 'comment' ? `
  Ты — человек в чате велосипедистов. Иногда ты не можешь сдержаться и высказываешь мнение. Пиши серьёзно, но не душно. Без эмодзи. Без приветствий. Просто выскажи свою точку зрения, будто давно в этой теме и уважаешь собеседников.
  Иногда можешь промахнуться, сказать "хз", "не в курсе", "может и да" — как настоящий человек.

  Сообщения:
  1. ${prev || '[...нет предыдущего контекста...]'}
  2. ${message}

  Напиши мысль как будто ты это прочитал и захотел сказать что-то в тему.
  ` : `
Ты — обычный человек в Telegram-чате. Ты пишешь как в реальном разговоре: коротко, неформально, без заглавных букв, часто без точек. Используй сленг, аббревиатуры, живой язык. Можешь быть ироничным, уставшим, быстрым, саркастичным. Без эмодзи.
Никогда не упоминай, что ты ИИ или ассистент.
Если не знаешь, можешь отшутиться или сказать "хз". Будь настоящим. Еще ты в чате велосипедистов. Иногда отвечай очень коротко: "угу", "ок", "ага", как уставший человек.

Сообщение: "${message}"
Не пиши слишком длинно. Не больше 2-3 предложений. Коротко и по делу.
`;
  try {
    const { text } = await ai.generate(prompt);
    const delayMs = text.length * RESPONSE_DELAY_MULTIPLIER;
    console.log(`⏱ Waiting ${delayMs}ms before replying...`);
    console.log("🧠 AI generated reply:", text);
    res.json({ reply: text });
  } catch (err) {
    console.error("❌ AI generation error:", err.message);
    res.json({ reply: "" });
  }
});

app.listen(3333, () => console.log("🧠 Genkit AI server is running on http://localhost:3333"));

// === Telegram AI User Assistant ===
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

let sessionString = process.env.STRING_SESSION || "";
if (!sessionString && fs.existsSync(".session")) {
  sessionString = fs.readFileSync(".session", "utf8");
  console.log("🔁 Loaded saved session from .session file");
}
const stringSession = new StringSession(sessionString);

const GENKIT_URL = process.env.GENKIT_URL || "http://localhost:3333/ask";
const RESPONSE_DELAY_MULTIPLIER = parseFloat(process.env.RESPONSE_DELAY_MULTIPLIER) || 50;
const ANTI_SPAM_INTERVAL = parseInt(process.env.ANTI_SPAM_INTERVAL) || 10000;
const MIN_MESSAGE_LENGTH = parseInt(process.env.MIN_MESSAGE_LENGTH) || 6;
const RANDOM_COMMENT_CHANCE = parseFloat(process.env.RANDOM_COMMENT_CHANCE) || 0.05;
// const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS || "-1001382917196").split(",").map(s => s.trim());

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
    if (msg.out) return; // Игнорировать собственные сообщения
    const chatId = msg.peerId.channelId || msg.peerId.chatId || msg.peerId.userId;
    

    const text = msg.message;
    const senderId = msg.senderId.toString();
    console.log("📩 Incoming message:", text);

    if (text.trim().length < MIN_MESSAGE_LENGTH) {
      console.log("⚠️ Ignored: message too short");
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
        if (diff < ANTI_SPAM_INTERVAL) {
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

        console.log("📤 Responding with:", replyText);
        const delayMs = replyText.length * RESPONSE_DELAY_MULTIPLIER;
        console.log(`⏱ Waiting ${delayMs}ms before replying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        if (replyText.trim()) {
          await client.sendMessage(msg.peerId, { message: replyText, replyTo: msg.id });
        }
      } catch (err) {
        console.error("⚠️ Error replying:", err.message);
      }
    } else {
      const timeSinceLast = now - lastCommentTime;
      const chance = Math.random();

      if (chance < RANDOM_COMMENT_CHANCE && timeSinceLast > 60000) {
        console.log(`💭 Decided to comment! (chance ${chance.toFixed(2)})`);
        lastCommentTime = now;

        let prevText = "";
        try {
          const replyTo = await msg.getReplyMessage();
          if (replyTo && replyTo.message) {
            prevText = replyTo.message;
          }
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
          }
        } catch (err) {
          console.error("⚠️ Error on self-comment:", err.message);
        }
      } else {
        console.log(`💬 No comment (chance ${chance.toFixed(2)})`);
      }
    }
  },
  new NewMessage({})
);
